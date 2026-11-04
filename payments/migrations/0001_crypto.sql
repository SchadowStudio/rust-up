-- Watch-only payment ledger. Never put seed phrases or private keys here.
CREATE TABLE IF NOT EXISTS payment_packages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  credit_kopecks INTEGER NOT NULL CHECK(credit_kopecks>0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS payment_quotes (
  package_id TEXT NOT NULL REFERENCES payment_packages(id),
  asset TEXT NOT NULL CHECK(asset IN ('BTC','ETH','TRX','USDT_ERC20','USDT_TRC20')),
  amount_atomic TEXT NOT NULL CHECK(length(amount_atomic)>0 AND amount_atomic NOT GLOB '*[^0-9]*'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  PRIMARY KEY(package_id,asset)
);
CREATE TABLE IF NOT EXISTS deposit_addresses (
  chain TEXT NOT NULL CHECK(chain IN ('bitcoin','ethereum','tron')),
  address TEXT NOT NULL,
  assigned_intent TEXT UNIQUE,
  PRIMARY KEY(chain,address)
);
CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  package_id TEXT NOT NULL REFERENCES payment_packages(id),
  asset TEXT NOT NULL,
  chain TEXT NOT NULL,
  receive_address TEXT NOT NULL,
  amount_atomic TEXT NOT NULL,
  credit_kopecks INTEGER NOT NULL CHECK(credit_kopecks>0),
  status TEXT NOT NULL DEFAULT 'awaiting_payment'
    CHECK(status IN ('awaiting_payment','verified','expired')),
  tx_hash TEXT,
  verified_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  last_verify_ms INTEGER NOT NULL DEFAULT 0,
  verify_attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE(chain,tx_hash),
  UNIQUE(chain,receive_address),
  FOREIGN KEY(chain,receive_address) REFERENCES deposit_addresses(chain,address)
);
CREATE INDEX IF NOT EXISTS payment_intents_owner ON payment_intents(telegram_id,created_at_ms);
CREATE TABLE IF NOT EXISTS payment_verifications (
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  intent_id TEXT NOT NULL UNIQUE REFERENCES payment_intents(id),
  confirmations INTEGER NOT NULL,
  verified_at_ms INTEGER NOT NULL,
  PRIMARY KEY(chain,tx_hash)
);
CREATE TABLE IF NOT EXISTS payment_outbox (
  event_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES payment_intents(id),
  event_type TEXT NOT NULL CHECK(event_type='crypto_payment_verified'),
  payload TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  delivered_at_ms INTEGER
);
-- The outbox is deliberately NOT connected to the original game-worker wallet.
-- A separate authenticated consumer must atomically apply each event exactly once.
