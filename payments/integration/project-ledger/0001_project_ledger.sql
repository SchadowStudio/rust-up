-- EXAMPLE ONLY. Deploy in each project's own DB, not the payment gateway.
-- account_id is local pseudonymous account ID; no customer name/email/IP.
CREATE TABLE IF NOT EXISTS merchant_pending_orders (
 project_order_ref TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency IN ('RUB','EUR','USD')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS merchant_credit_events (
 event_id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL UNIQUE,
 project_order_ref TEXT NOT NULL UNIQUE REFERENCES merchant_pending_orders(project_order_ref),
 body_sha256 TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 credited_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS merchant_wallets (
 account_id TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency IN ('RUB','EUR','USD')),
 balance_minor INTEGER NOT NULL DEFAULT 0 CHECK(balance_minor>=0),
 PRIMARY KEY(account_id,currency)
);
