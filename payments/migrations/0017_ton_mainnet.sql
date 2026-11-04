-- TON/toncoin expansion for the independently hosted V2 payment gateway.
-- D1 cannot disable foreign_keys; this migration uses deferred checks.
-- No destructive CASCADE dependencies exist on these payment ledger tables.
-- Do not run against production without verified backup and restore test.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE deposit_addresses_ton_upgrade(
 chain TEXT NOT NULL CHECK(chain IN ('bitcoin','ethereum','tron','ton')),
 address TEXT NOT NULL,
 assigned_intent TEXT UNIQUE,
 source TEXT NOT NULL DEFAULT 'operator_watch_only'
  CHECK(source IN ('operator_watch_only','trust_wallet','wallet_public_import')),
 added_at_ms INTEGER NOT NULL DEFAULT 0,
 label TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 confirmed_at_ms INTEGER,
 PRIMARY KEY(chain,address)
);
INSERT INTO deposit_addresses_ton_upgrade
 (chain,address,assigned_intent,source,added_at_ms,label,enabled,confirmed_at_ms)
 SELECT chain,address,assigned_intent,source,added_at_ms,label,enabled,confirmed_at_ms
 FROM deposit_addresses;
DROP TABLE deposit_addresses;
ALTER TABLE deposit_addresses_ton_upgrade RENAME TO deposit_addresses;
CREATE INDEX deposit_addresses_available
 ON deposit_addresses(chain,enabled,assigned_intent);

CREATE TABLE v2_exchange_rates_ton_upgrade(
 fiat TEXT NOT NULL CHECK(fiat IN ('RUB','EUR','USD')),
 asset TEXT NOT NULL CHECK(asset IN ('BTC','ETH','TRX','USDT_ERC20','USDT_TRC20','TON')),
 numerator_atomic TEXT NOT NULL CHECK(length(numerator_atomic) BETWEEN 1 AND 60
  AND numerator_atomic NOT GLOB '*[^0-9]*'),
 denominator_minor TEXT NOT NULL CHECK(length(denominator_minor) BETWEEN 1 AND 60
  AND denominator_minor NOT GLOB '*[^0-9]*'),
 valid_from_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 source TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 PRIMARY KEY(fiat,asset)
);
INSERT INTO v2_exchange_rates_ton_upgrade
 SELECT * FROM v2_exchange_rates;
DROP TABLE v2_exchange_rates;
ALTER TABLE v2_exchange_rates_ton_upgrade RENAME TO v2_exchange_rates;
CREATE INDEX v2_rates_expiry ON v2_exchange_rates(enabled,expires_at_ms);

CREATE TABLE v2_market_prices_ton_upgrade(
 fiat TEXT NOT NULL CHECK(fiat IN ('RUB','EUR','USD')),
 asset TEXT NOT NULL CHECK(asset IN ('BTC','ETH','TRX','USDT_ERC20','USDT_TRC20','TON')),
 price_e8 TEXT NOT NULL CHECK(length(price_e8)>0 AND price_e8 NOT GLOB '*[^0-9]*'),
 observed_at_ms INTEGER NOT NULL,
 source TEXT NOT NULL,
 PRIMARY KEY(fiat,asset)
);
INSERT INTO v2_market_prices_ton_upgrade SELECT * FROM v2_market_prices;
DROP TABLE v2_market_prices;
ALTER TABLE v2_market_prices_ton_upgrade RENAME TO v2_market_prices;

CREATE TABLE v2_project_crypto_methods_ton_upgrade(
 project_id TEXT NOT NULL REFERENCES v2_projects(id) ON DELETE CASCADE,
 asset TEXT NOT NULL CHECK(asset IN ('BTC','ETH','TRX','USDT_ERC20','USDT_TRC20','TON')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 PRIMARY KEY(project_id,asset)
);
INSERT INTO v2_project_crypto_methods_ton_upgrade
 SELECT * FROM v2_project_crypto_methods;
DROP TABLE v2_project_crypto_methods;
ALTER TABLE v2_project_crypto_methods_ton_upgrade RENAME TO v2_project_crypto_methods;
INSERT OR IGNORE INTO v2_project_crypto_methods(project_id,asset,enabled)
 SELECT id,'TON',0 FROM v2_projects;
CREATE INDEX v2_project_payment_methods_enabled
 ON v2_project_crypto_methods(project_id,enabled);

CREATE TABLE v2_invoices_ton_upgrade(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES v2_projects(id),
 project_order_ref TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 sku TEXT NOT NULL,
 fiat TEXT NOT NULL CHECK(fiat IN ('RUB','EUR','USD')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 asset TEXT NOT NULL,
 chain TEXT NOT NULL CHECK(chain IN ('bitcoin','ethereum','tron','ton')),
 receive_address TEXT NOT NULL,
 amount_atomic TEXT NOT NULL,
 rate_numerator TEXT NOT NULL,
 rate_denominator TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'awaiting_payment'
  CHECK(status IN ('awaiting_payment','verified','expired','manual_review')),
 tx_hash TEXT,
 created_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 verified_at_ms INTEGER,
 UNIQUE(project_id,project_order_ref),
 UNIQUE(project_id,idempotency_key),
 UNIQUE(chain,receive_address),
 UNIQUE(chain,tx_hash),
 FOREIGN KEY(chain,receive_address) REFERENCES deposit_addresses(chain,address)
);
INSERT INTO v2_invoices_ton_upgrade SELECT * FROM v2_invoices;
DROP TABLE v2_invoices;
ALTER TABLE v2_invoices_ton_upgrade RENAME TO v2_invoices;
CREATE INDEX v2_invoice_status ON v2_invoices(status,created_at_ms);
CREATE INDEX v2_invoice_project ON v2_invoices(project_id,created_at_ms);
CREATE TRIGGER v2_invoice_reject_null_id
 BEFORE INSERT ON v2_invoices WHEN NEW.id IS NULL OR NEW.id=''
 BEGIN SELECT RAISE(ABORT,'invoice_reservation_not_committed'); END;

CREATE TABLE v2_payment_parts_ton_upgrade(
 chain TEXT NOT NULL CHECK(chain IN ('bitcoin','ethereum','tron','ton')),
 tx_hash TEXT NOT NULL,
 invoice_id TEXT NOT NULL REFERENCES v2_invoices(id),
 project_id TEXT NOT NULL REFERENCES v2_projects(id),
 asset TEXT NOT NULL,
 actual_atomic TEXT NOT NULL CHECK(
  length(actual_atomic) BETWEEN 1 AND 60 AND
  actual_atomic NOT GLOB '*[^0-9]*' AND actual_atomic!='0'),
 payment_time_ms INTEGER NOT NULL CHECK(payment_time_ms>0),
 block_hash TEXT NOT NULL,
 confirmed_at_ms INTEGER NOT NULL,
 PRIMARY KEY(chain,tx_hash),
 UNIQUE(invoice_id,tx_hash)
);
INSERT INTO v2_payment_parts_ton_upgrade SELECT * FROM v2_payment_parts;
DROP TABLE v2_payment_parts;
ALTER TABLE v2_payment_parts_ton_upgrade RENAME TO v2_payment_parts;
CREATE INDEX v2_payment_parts_invoice
 ON v2_payment_parts(invoice_id,confirmed_at_ms);

-- No trusted funds are accepted at migration time.
-- TON must additionally pass per-project opt-in, enabled receiving-address
-- and independent RPC quorum / masterchain finality checks.
PRAGMA foreign_key_check;
-- The existing children still point to unchanged primary keys. Clearing the
-- deferred-violation bookkeeping after explicit FK validation is required by
-- SQLite when parent tables were rebuilt in place.
PRAGMA defer_foreign_keys = OFF;
