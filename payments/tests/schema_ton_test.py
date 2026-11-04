import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS=ROOT/'migrations'
PROJECT='c9de5ea2-ae84-4848-a8d0-17a1ccaa1352'
INVOICE='d9de5ea2-ae84-4848-a8d0-17a1ccaa1352'
RECV='0x'+'a'*40
TON_ADDR='UQDKbjIcfM6ezt8KjKJJLshZJJSqX7XOA4ff-W72r5gqPuwA'

def old_db():
 db=sqlite3.connect(':memory:')
 db.execute('PRAGMA foreign_keys=ON')
 for path in sorted(MIGRATIONS.glob('*.sql')):
  if path.name>='0017_ton_mainnet.sql':break
  db.executescript(path.read_text(encoding='utf8'))
 db.execute("""INSERT INTO v2_projects(id,label,webhook_url,status,created_at_ms,updated_at_ms)
  VALUES (?, 'Existing project','https://example.org/webhook','active',100,100)""",
  (PROJECT,))
 db.execute("""INSERT INTO v2_project_payment_profiles
  (project_id,display_name,updated_at_ms) VALUES (?,'Existing project',100)""",(PROJECT,))
 db.execute("""INSERT INTO v2_project_crypto_methods(project_id,asset,enabled)
  VALUES (?,'ETH',1)""",(PROJECT,))
 db.execute("""INSERT INTO v2_exchange_rates
  (fiat,asset,numerator_atomic,denominator_minor,valid_from_ms,
   expires_at_ms,source,enabled)
  VALUES ('EUR','ETH','100','1',100,1000,'old',1)""")
 db.execute("""INSERT INTO v2_market_prices(fiat,asset,price_e8,observed_at_ms,source)
  VALUES('EUR','ETH','150000000000',100,'old')""")
 db.execute("""INSERT INTO deposit_addresses(chain,address,source,added_at_ms,label,enabled)
  VALUES('ethereum',?,'trust_wallet',100,'old-wallet',1)""",(RECV,))
 db.execute("""INSERT INTO v2_invoices(id,project_id,project_order_ref,idempotency_key,
  request_hash,sku,fiat,amount_minor,asset,chain,receive_address,
  amount_atomic,rate_numerator,rate_denominator,created_at_ms,expires_at_ms)
  VALUES(?,?, 'test-ref','test-key','sha','deposit','EUR',100,'ETH',
  'ethereum',?,'500','100','1',100,1000)""",(INVOICE,PROJECT,RECV))
 db.execute("""INSERT INTO v2_payment_parts(chain,tx_hash,invoice_id,project_id,
  asset,actual_atomic,payment_time_ms,block_hash,confirmed_at_ms)
  VALUES('ethereum',?,?,?,'ETH','500',300,?,300)""",
  ('0x'+'b'*64,INVOICE,PROJECT,'0x'+'c'*64))
 db.execute("""INSERT INTO v2_delivery_outbox
  (event_id,project_id,invoice_id,event_body,created_at_ms)
  VALUES(?,?,?,'{}',300)""",('v2:'+INVOICE,PROJECT,INVOICE))
 db.commit()
 return db

def migrate(db):
 # D1 executes a migration in a transaction; reproduce the D1 semantics.
 source=(MIGRATIONS/'0017_ton_mainnet.sql').read_text(encoding='utf8')
 db.execute('BEGIN')
 statement=''
 try:
  for line in source.splitlines(keepends=True):
   statement+=line
   if not sqlite3.complete_statement(statement):continue
   db.execute(statement)
   statement=''
  db.commit()
 except sqlite3.IntegrityError as exc:
  violations=db.execute('PRAGMA foreign_key_check').fetchall()
  db.rollback()
  raise AssertionError(f'TON migration failed: {statement[:110]!r}; {exc}; FK={violations}') from exc

class TonMigrationSafety(unittest.TestCase):
 def test_existing_wallets_invoice_parts_webhooks_are_preserved(self):
  db=old_db()
  migrate(db)
  self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
  self.assertEqual(db.execute(
   'SELECT address,enabled FROM deposit_addresses WHERE chain="ethereum"').fetchone(),(RECV,1))
  self.assertEqual(db.execute(
   'SELECT id,amount_minor FROM v2_invoices WHERE id=?',(INVOICE,)).fetchone(),(INVOICE,100))
  self.assertEqual(db.execute(
   'SELECT COUNT(*) FROM v2_payment_parts WHERE invoice_id=?',(INVOICE,)).fetchone()[0],1)
  self.assertEqual(db.execute(
   'SELECT COUNT(*) FROM v2_delivery_outbox WHERE invoice_id=?',(INVOICE,)).fetchone()[0],1)
  self.assertEqual(db.execute(
   'SELECT enabled FROM v2_project_crypto_methods WHERE project_id=? AND asset="ETH"',
   (PROJECT,)).fetchone()[0],1)
  self.assertEqual(db.execute(
   'SELECT enabled FROM v2_project_crypto_methods WHERE project_id=? AND asset="TON"',
   (PROJECT,)).fetchone()[0],0)
 def test_ton_network_accepts_disabled_receiving_addresses_and_rates(self):
  db=old_db()
  migrate(db)
  db.execute("""INSERT INTO deposit_addresses(chain,address,source,enabled)
   VALUES('ton',?,'wallet_public_import',0)""",(TON_ADDR,))
  db.execute("""INSERT INTO v2_exchange_rates(fiat,asset,numerator_atomic,
   denominator_minor,valid_from_ms,expires_at_ms,source,enabled)
   VALUES('RUB','TON','1000000000','100',100,1000,'test',0)""")
  db.execute("""INSERT INTO v2_market_prices(fiat,asset,price_e8,observed_at_ms,source)
   VALUES('RUB','TON','15000000000',100,'test')""")
  self.assertEqual(db.execute(
   'SELECT enabled FROM deposit_addresses WHERE chain="ton"').fetchone()[0],0)
  self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_old_invoice_primary_key_rollback_guard_remains(self):
  db=old_db()
  migrate(db)
  with self.assertRaises(sqlite3.IntegrityError):
   db.execute("""INSERT INTO v2_invoices(
    id,project_id,project_order_ref,idempotency_key,request_hash,
    sku,fiat,amount_minor,asset,chain,receive_address,
    amount_atomic,rate_numerator,rate_denominator,created_at_ms,expires_at_ms)
    VALUES(NULL,?,'other-ref','other-key','sha','deposit','EUR',
    100,'ETH','ethereum',?,'500','100','1',100,1000)""",(PROJECT,RECV))
  self.assertEqual(db.execute(
   'SELECT COUNT(*) FROM v2_invoices').fetchone()[0],1)
if __name__=='__main__':
 unittest.main()
