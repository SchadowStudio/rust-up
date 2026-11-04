-- RUST UP multi-project V2. Apply AFTER migrations 0001-0004.
-- Database contains no names, email, IP, Telegram ID or private wallet keys.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS v2_projects (
 id TEXT PRIMARY KEY,
 label TEXT NOT NULL,
 webhook_url TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'disabled' CHECK(status IN ('disabled','active')),
 created_at_ms INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_api_keys (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES v2_projects(id),
 secret_sha256 TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 created_at_ms INTEGER NOT NULL,
 revoked_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS v2_keys_by_project ON v2_api_keys(project_id,status);
CREATE TABLE IF NOT EXISTS v2_products (
 project_id TEXT NOT NULL REFERENCES v2_projects(id),
 sku TEXT NOT NULL,
 title TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency IN ('RUB','EUR','USD')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000000),
 status TEXT NOT NULL DEFAULT 'disabled' CHECK(status IN ('disabled','active')),
 updated_at_ms INTEGER NOT NULL,
 PRIMARY KEY(project_id,sku)
);
CREATE TABLE IF NOT EXISTS v2_exchange_rates (
 fiat TEXT NOT NULL CHECK(fiat IN ('RUB','EUR','USD')),
 asset TEXT NOT NULL CHECK(asset IN ('BTC','ETH','TRX','USDT_ERC20','USDT_TRC20')),
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
CREATE TABLE IF NOT EXISTS v2_invoices (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES v2_projects(id),
 project_order_ref TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 sku TEXT NOT NULL,
 fiat TEXT NOT NULL CHECK(fiat IN ('RUB','EUR','USD')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 asset TEXT NOT NULL,
 chain TEXT NOT NULL CHECK(chain IN ('bitcoin','ethereum','tron')),
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
CREATE INDEX IF NOT EXISTS v2_invoice_status ON v2_invoices(status,created_at_ms);
CREATE INDEX IF NOT EXISTS v2_invoice_project ON v2_invoices(project_id,created_at_ms);
CREATE TABLE IF NOT EXISTS v2_chain_claims (
 chain TEXT NOT NULL,
 tx_hash TEXT NOT NULL,
 invoice_id TEXT NOT NULL UNIQUE REFERENCES v2_invoices(id),
 project_id TEXT NOT NULL REFERENCES v2_projects(id),
 claimed_at_ms INTEGER NOT NULL,
 PRIMARY KEY(chain,tx_hash)
);
CREATE TABLE IF NOT EXISTS v2_payment_reviews (
 id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL REFERENCES v2_invoices(id),
 tx_hash TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN ('late','underpaid','chain_reorg','manual')),
 created_at_ms INTEGER NOT NULL,
 resolved_at_ms INTEGER,
 UNIQUE(invoice_id,tx_hash)
);
CREATE TABLE IF NOT EXISTS v2_delivery_outbox (
 event_id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES v2_projects(id),
 invoice_id TEXT NOT NULL UNIQUE REFERENCES v2_invoices(id),
 event_body TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL,
 next_attempt_ms INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 delivered_at_ms INTEGER,
 last_error TEXT
);
CREATE INDEX IF NOT EXISTS v2_delivery_due ON v2_delivery_outbox(delivered_at_ms,next_attempt_ms,created_at_ms);
CREATE TABLE IF NOT EXISTS v2_operator_audit (
 id TEXT PRIMARY KEY,
 action TEXT NOT NULL,
 project_id TEXT,
 details TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL
);
