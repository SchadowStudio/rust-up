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
