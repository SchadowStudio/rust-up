import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SQLS=sorted((ROOT/'migrations').glob('*.sql'))
P1='11111111-1111-4111-8111-111111111111'
P2='22222222-2222-4222-8222-222222222222'
def make():
 db=sqlite3.connect(':memory:')
 db.execute('PRAGMA foreign_keys=ON')
 for p in SQLS:db.executescript(p.read_text(encoding='utf8'))
 for id in (P1,P2):
  db.execute("""INSERT INTO v2_projects
  (id,label,webhook_url,status,created_at_ms,updated_at_ms)
  VALUES (?,?,'https://example.com/payments','active',100,100)""",(id,'Project'))
  db.execute("""INSERT INTO v2_products
  (project_id,sku,title,currency,amount_minor,status,updated_at_ms)
  VALUES (?,'rank1','Rank','RUB',5000,'active',100)""",(id,))
  # Mirrors the atomic project creation API, after all migrations are installed.
  db.execute("INSERT INTO v2_project_payment_profiles(project_id,display_name,updated_at_ms) VALUES(?,?,100)",(id,'Project'))
  for fiat in ('RUB','EUR','USD'):
   db.execute("INSERT INTO v2_project_fiat_methods(project_id,currency) VALUES(?,?)",(id,fiat))
  for asset in ('BTC','ETH','TRX','USDT_ERC20','USDT_TRC20'):
   db.execute("INSERT INTO v2_project_crypto_methods(project_id,asset) VALUES(?,?)",(id,asset))
 for n,address in enumerate(('0xaaa','0xbbb','0xccc')):
  db.execute("""INSERT INTO deposit_addresses(chain,address,enabled,assigned_intent)
    VALUES ('ethereum',?,1,NULL)""",(address,))
 return db
def invoice(db,id,project,ref,key,address='0xaaa',tx=None):
 db.execute("""INSERT INTO v2_invoices
 (id,project_id,project_order_ref,idempotency_key,request_hash,sku,fiat,
  amount_minor,asset,chain,receive_address,amount_atomic,rate_numerator,
  rate_denominator,created_at_ms,expires_at_ms,tx_hash)
 VALUES (?,?,?,?,?,'rank1','RUB',5000,'ETH','ethereum',?,'10000','2','1',100,500,?)""",
 (id,project,ref,key,'sha',address,tx))

class MultiTenantSchema(unittest.TestCase):
 def setUp(self):self.db=make()
 def test_currency_and_product_isolation(self):
  a=self.db.execute('SELECT COUNT(*) FROM v2_products WHERE project_id=?',(P1,)).fetchone()[0]
  b=self.db.execute('SELECT COUNT(*) FROM v2_products WHERE project_id=?',(P2,)).fetchone()[0]
  self.assertEqual((a,b),(1,1))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("""INSERT INTO v2_products
    (project_id,sku,title,currency,amount_minor,updated_at_ms)
    VALUES (?,'invalid','bad','GBP',100,1)""",(P1,))
 def test_idempotency_is_scoped_to_merchant(self):
  invoice(self.db,'i1',P1,'ref','key')
  invoice(self.db,'i2',P2,'ref','key','0xbbb')
  with self.assertRaises(sqlite3.IntegrityError):
   invoice(self.db,'i3',P1,'ref-other','key','0xccc')
 def test_external_order_reference_not_double_sold(self):
  invoice(self.db,'i1',P1,'ref','key')
  with self.assertRaises(sqlite3.IntegrityError):
   invoice(self.db,'i2',P1,'ref','other','0xbbb')
 def test_one_receiver_address_per_invoice_across_projects(self):
  invoice(self.db,'i1',P1,'ref1','key1')
  with self.assertRaises(sqlite3.IntegrityError):
   invoice(self.db,'i2',P2,'ref2','key2','0xaaa')
 def test_chain_transaction_hash_cannot_be_reused(self):
  invoice(self.db,'i1',P1,'ref1','key1','0xaaa','0xhash')
  with self.assertRaises(sqlite3.IntegrityError):
   invoice(self.db,'i2',P2,'ref2','key2','0xbbb','0xhash')
 def test_only_one_settlement_event_per_invoice(self):
  invoice(self.db,'i1',P1,'ref1','key1')
  self.db.execute("""INSERT INTO v2_delivery_outbox
   (event_id,project_id,invoice_id,event_body,created_at_ms)
   VALUES ('e1',?,'i1','{}',1)""",(P1,))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("""INSERT INTO v2_delivery_outbox
    (event_id,project_id,invoice_id,event_body,created_at_ms)
    VALUES ('e2',?,'i1','{}',2)""",(P1,))
 def test_transaction_registry_rejects_replay(self):
  invoice(self.db,'i1',P1,'ref1','key1','0xaaa')
  invoice(self.db,'i2',P2,'ref2','key2','0xbbb')
  self.db.execute("""INSERT INTO v2_chain_claims
   (chain,tx_hash,invoice_id,project_id,claimed_at_ms)
   VALUES ('ethereum','0xhash','i1',?,100)""",(P1,))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("""INSERT INTO v2_chain_claims
    (chain,tx_hash,invoice_id,project_id,claimed_at_ms)
    VALUES ('ethereum','0xhash','i2',?,100)""",(P2,))
 def test_project_quota_atomically_blocks_oversubscription(self):
  def slot(project,invoice,limit=1):
   sql="""INSERT INTO v2_invoice_quota
    (project_id,bucket_minute_ms,invoice_count,last_invoice_id)
    VALUES (?,60000,1,?) ON CONFLICT(project_id,bucket_minute_ms)
    DO UPDATE SET invoice_count=invoice_count+1,last_invoice_id=excluded.last_invoice_id
    WHERE invoice_count<?"""
   return self.db.execute(sql,(project,invoice,limit)).rowcount
  self.assertEqual(slot(P1,'invoice1'),1)
  self.assertEqual(slot(P1,'invoice2'),0)
  self.assertEqual(slot(P2,'invoice3'),1)
  self.assertEqual(self.db.execute(
   'SELECT invoice_count FROM v2_invoice_quota WHERE project_id=?',(P1,)).fetchone()[0],1)
  self.assertEqual(self.db.execute(
   'SELECT last_invoice_id FROM v2_invoice_quota WHERE project_id=?',(P1,)).fetchone()[0],'invoice1')
 def test_quota_failure_cannot_reserve_a_receiver(self):
  self.db.execute("""INSERT INTO v2_invoice_quota
   (project_id,bucket_minute_ms,invoice_count,last_invoice_id) VALUES(?,60000,1,'first')""",(P1,))
  changed=self.db.execute("""UPDATE deposit_addresses SET assigned_intent='second'
   WHERE chain='ethereum' AND address='0xbbb' AND enabled=1
   AND assigned_intent IS NULL AND EXISTS(
    SELECT 1 FROM v2_invoice_quota
    WHERE project_id=? AND bucket_minute_ms=60000 AND last_invoice_id='second')""",(P1,)).rowcount
  self.assertEqual(changed,0)
  self.assertIsNone(self.db.execute(
   "SELECT assigned_intent FROM deposit_addresses WHERE address='0xbbb'").fetchone()[0])
 def test_project_payment_methods_start_disabled_and_isolated(self):
  for project in (P1,P2):
   profile=self.db.execute(
    "SELECT invoices_enabled,deposits_enabled,products_enabled FROM v2_project_payment_profiles WHERE project_id=?",(project,)).fetchone()
   self.assertEqual(profile,(0,0,0))
   self.assertEqual(self.db.execute(
    "SELECT COUNT(*) FROM v2_project_fiat_methods WHERE project_id=? AND enabled=0",(project,)).fetchone()[0],3)
   self.assertEqual(self.db.execute(
    "SELECT COUNT(*) FROM v2_project_crypto_methods WHERE project_id=? AND enabled=0",(project,)).fetchone()[0],5)
  self.db.execute("UPDATE v2_project_payment_profiles SET invoices_enabled=1,deposits_enabled=1 WHERE project_id=?",(P1,))
  self.db.execute("UPDATE v2_project_fiat_methods SET enabled=1 WHERE project_id=? AND currency='RUB'",(P1,))
  self.db.execute("UPDATE v2_project_crypto_methods SET enabled=1 WHERE project_id=? AND asset='USDT_TRC20'",(P1,))
  self.assertEqual(self.db.execute(
   "SELECT invoices_enabled FROM v2_project_payment_profiles WHERE project_id=?",(P2,)).fetchone()[0],0)
  self.assertEqual(self.db.execute(
   "SELECT COUNT(*) FROM v2_project_fiat_methods WHERE project_id=? AND enabled=1",(P2,)).fetchone()[0],0)
  self.assertEqual(self.db.execute(
   "SELECT COUNT(*) FROM v2_project_crypto_methods WHERE project_id=? AND enabled=1",(P2,)).fetchone()[0],0)
 def test_cannot_enable_unsupported_currency_or_invalid_limits(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO v2_project_fiat_methods(project_id,currency) VALUES (?,'GBP')",(P1,))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE v2_project_fiat_methods SET min_minor=10000,max_minor=1000 WHERE project_id=? AND currency='RUB'",(P1,))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE v2_project_payment_profiles SET invoice_lifetime_minutes=500 WHERE project_id=?",(P1,))
 def test_project_wallet_keys_and_payment_method_are_independent(self):
  self.db.execute("UPDATE v2_project_payment_profiles SET invoices_enabled=1,deposits_enabled=1 WHERE project_id=?",(P1,))
  self.db.execute("UPDATE v2_project_fiat_methods SET enabled=1 WHERE project_id=? AND currency='EUR'",(P1,))
  self.db.execute("UPDATE v2_project_crypto_methods SET enabled=1 WHERE project_id=? AND asset='BTC'",(P1,))
  query="""SELECT p.invoices_enabled,p.deposits_enabled,
    f.enabled,c.enabled FROM v2_project_payment_profiles p
    JOIN v2_project_fiat_methods f ON f.project_id=p.project_id AND f.currency=?
    JOIN v2_project_crypto_methods c ON c.project_id=p.project_id AND c.asset=?
    WHERE p.project_id=?"""
  self.assertEqual(self.db.execute(query,('EUR','BTC',P1)).fetchone(),(1,1,1,1))
  self.assertEqual(self.db.execute(query,('EUR','BTC',P2)).fetchone(),(0,0,0,0))
  self.assertEqual(self.db.execute(query,('RUB','BTC',P1)).fetchone(),(1,1,0,1))
  self.assertEqual(self.db.execute(query,('EUR','ETH',P1)).fetchone(),(1,1,1,0))
 def test_tables_store_no_direct_customer_identifiers(self):
  for table in ('v2_projects','v2_api_keys','v2_products','v2_invoices',
    'v2_chain_claims','v2_delivery_outbox'):
   columns={row[1] for row in self.db.execute('PRAGMA table_info('+table+')')}
   self.assertFalse(columns.intersection({'email','ip','telegram_id','name','phone',
     'wallet_private_key','seed_phrase','real_name'}))
 def test_ledger_persists_distinct_currency_balances(self):
  sql=(ROOT/'integration'/'project-ledger'/'0001_project_ledger.sql').read_text()
  game=sqlite3.connect(':memory:')
  game.executescript(sql)
  game.execute("INSERT INTO merchant_pending_orders VALUES ('r1','acct1','EUR',10000,1)")
  game.execute("""INSERT INTO merchant_credit_events
   VALUES ('event','invoice','r1','sha',10000,100)""")
  game.execute("INSERT INTO merchant_wallets VALUES('acct1','EUR',10000)")
  with self.assertRaises(sqlite3.IntegrityError):
   game.execute("""INSERT INTO merchant_credit_events
    VALUES ('event','invoice2','r1','sha2',10000,101)""")
  self.assertEqual(game.execute("SELECT balance_minor FROM merchant_wallets WHERE currency='EUR'").fetchone()[0],10000)

if __name__=='__main__':unittest.main()
