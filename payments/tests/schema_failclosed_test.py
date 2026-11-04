import pathlib
import re
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'src/multi/api.js').read_text(encoding='utf-8')
MATCH=re.search(r"db\.prepare\(`(INSERT INTO v2_invoices.*?)`\)\s*\.bind\(",SOURCE,re.S)
if not MATCH:
 raise RuntimeError('production invoice INSERT statement is missing')
INVOICE_INSERT=MATCH.group(1)

P='1a6d0a83-7d70-4f41-8e6b-73460732cefe'
ADDRESS='0xabcabc'
I='2b79634d-63ce-49ed-909d-d8243a769d1f'
def conn(free=True,quota=0):
 db=sqlite3.connect(':memory:')
 db.execute('PRAGMA foreign_keys=ON')
 for f in sorted((ROOT/'migrations').glob('*.sql')):
  db.executescript(f.read_text(encoding='utf-8'))
 db.execute("""INSERT INTO v2_projects
  (id,label,webhook_url,status,created_at_ms,updated_at_ms)
  VALUES (?, 'Test project','https://shop.example.com/payments','active',100,100)""",(P,))
 if free:
  db.execute("""INSERT INTO deposit_addresses(chain,address,enabled,assigned_intent)
   VALUES('ethereum',?,1,NULL)""",(ADDRESS,))
 else:
  db.execute("""INSERT INTO deposit_addresses(chain,address,enabled,assigned_intent)
   VALUES('ethereum',?,1,'someone_else')""",(ADDRESS,))
 if quota:
  db.execute("""INSERT INTO v2_invoice_quota
    (project_id,bucket_minute_ms,invoice_count,last_invoice_id)
    VALUES(?,60000,1,'other')""",(P,))
 db.commit()
 return db

def transaction(db,invoice=I,limit=5):
 # Exactly the three D1 prepared-statement operations used in the API.
 db.execute("""INSERT INTO v2_invoice_quota
  (project_id,bucket_minute_ms,invoice_count,last_invoice_id)
  VALUES(?,60000,1,?) ON CONFLICT(project_id,bucket_minute_ms)
  DO UPDATE SET invoice_count=invoice_count+1,last_invoice_id=excluded.last_invoice_id
  WHERE invoice_count<?""",(P,invoice,limit))
 db.execute("""UPDATE deposit_addresses SET assigned_intent=?
  WHERE chain=? AND address=? AND enabled=1 AND assigned_intent IS NULL
  AND EXISTS (SELECT 1 FROM v2_invoice_quota
   WHERE project_id=? AND bucket_minute_ms=? AND last_invoice_id=?)""",
  (invoice,'ethereum',ADDRESS,P,60000,invoice))
 parameters=(
  'ethereum',ADDRESS,invoice,P,60000,invoice,
  invoice,P,'90a56fa3-cde8-46c3-a5ad-5d76a22c7184',
  'a2a01c5a-2dcf-4b1d-a612-aee77234d2a1',
  'samplehash','__crypto_deposit__','RUB',10000,'ETH',
  'ethereum',ADDRESS,'1000000000000000','1','1',100,500
 )
 db.execute(INVOICE_INSERT,parameters)

class NoOrphanInvoicing(unittest.TestCase):
 def test_production_sql_requires_null_to_abort_when_receiver_was_claimed(self):
  self.assertIn('THEN ? ELSE NULL END',INVOICE_INSERT)
  self.assertEqual(INVOICE_INSERT.count('?'),22)
  db=conn(free=False)
  with self.assertRaises(sqlite3.IntegrityError):
   with db:transaction(db)
  self.assertEqual(db.execute('SELECT COUNT(*) FROM v2_invoice_quota').fetchone()[0],0)
  self.assertEqual(db.execute('SELECT COUNT(*) FROM v2_invoices').fetchone()[0],0)
 def test_quota_rejection_rolls_back_receiver_claim(self):
  db=conn(free=True,quota=1)
  with self.assertRaises(sqlite3.IntegrityError):
   with db:transaction(db,limit=1)
  self.assertIsNone(db.execute('SELECT assigned_intent FROM deposit_addresses').fetchone()[0])
  self.assertEqual(db.execute('SELECT invoice_count FROM v2_invoice_quota').fetchone()[0],1)
 def test_safely_insert_only_when_quota_and_receive_address_are_reserved(self):
  db=conn()
  with db:transaction(db)
  self.assertEqual(db.execute('SELECT COUNT(*) FROM v2_invoices').fetchone()[0],1)
  self.assertEqual(db.execute('SELECT assigned_intent FROM deposit_addresses').fetchone()[0],I)
  self.assertEqual(db.execute('SELECT invoice_count FROM v2_invoice_quota').fetchone()[0],1)
 def test_second_invoice_cannot_reuse_same_address(self):
  db=conn()
  with db:transaction(db)
  with self.assertRaises(sqlite3.IntegrityError):
   with db:transaction(db,invoice='4f8ab177-65e4-4ea9-8dae-a6a3e43c7e58')
  self.assertEqual(db.execute('SELECT COUNT(*) FROM v2_invoices').fetchone()[0],1)

if __name__=='__main__':unittest.main()
