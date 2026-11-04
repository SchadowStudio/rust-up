import pathlib, sqlite3, unittest
schema='\n'.join(p.read_text() for p in sorted((pathlib.Path(__file__).parent.parent/'migrations').glob('*.sql')))
class PaymentSchema(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  self.db.executescript(schema)
  self.db.execute("INSERT INTO payment_packages(id,title,credit_kopecks,enabled) VALUES('p','Test',10000,1)")
  self.db.execute("INSERT INTO payment_quotes VALUES('p','ETH','100000',1)")
  self.db.execute("INSERT INTO deposit_addresses(chain,address,assigned_intent) VALUES('ethereum','0xaaa','order1')")
 def order(self,id,address='0xaaa',tx=None):
  self.db.execute("""INSERT INTO payment_intents
    (id,telegram_id,package_id,asset,chain,receive_address,amount_atomic,
     credit_kopecks,tx_hash,created_at_ms,expires_at_ms)
    VALUES (?,'1','p','ETH','ethereum',?,'100000',10000,?,1,2)""",(id,address,tx))
 def test_address_is_one_use(self):
  self.order('order1')
  with self.assertRaises(sqlite3.IntegrityError):self.order('order2')
 def test_one_tx_hash_per_chain(self):
  self.order('order1',tx='0xtest')
  self.db.execute("INSERT INTO deposit_addresses(chain,address,assigned_intent) VALUES('ethereum','0xbbb','order2')")
  with self.assertRaises(sqlite3.IntegrityError):self.order('order2','0xbbb','0xtest')
 def test_only_one_outbox_event_per_order(self):
  self.order('order1')
  self.db.execute("INSERT INTO payment_outbox(event_id,intent_id,event_type,payload,created_at_ms) VALUES('evt1','order1','crypto_payment_verified','{}',1)")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO payment_outbox(event_id,intent_id,event_type,payload,created_at_ms) VALUES('evt2','order1','crypto_payment_verified','{}',1)")
if __name__=='__main__':unittest.main()
