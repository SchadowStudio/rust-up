-- Additive migration for the ISOLATED rustup-stars-staging database ONLY.
-- No game credits, wagers, cashouts or live provider configuration.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS rustup_stars_variable_orders(
 id TEXT PRIMARY KEY,
 telegram_user_id INTEGER NOT NULL CHECK(telegram_user_id>0),
 client_request_id TEXT NOT NULL,
 requested_amount_minor INTEGER NOT NULL CHECK(requested_amount_minor BETWEEN 100 AND 100000000),
 price_stars INTEGER NOT NULL CHECK(price_stars BETWEEN 1 AND 1000000),
 rate_num INTEGER NOT NULL CHECK(rate_num>0),
 rate_den INTEGER NOT NULL CHECK(rate_den>0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','checkout_approved','paid','refunded','manual_review')),
 checkout_query_id TEXT UNIQUE,
 telegram_charge_id TEXT UNIQUE,
 invoice_url TEXT,
 created_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 paid_at_ms INTEGER,
 UNIQUE(telegram_user_id,client_request_id),
 CHECK(expires_at_ms>created_at_ms)
);
CREATE INDEX IF NOT EXISTS rustup_stars_variable_user_status
 ON rustup_stars_variable_orders(telegram_user_id,status,created_at_ms);

CREATE TABLE IF NOT EXISTS rustup_external_variable_orders(
 project_order_ref TEXT PRIMARY KEY,
 merchant_request_id TEXT UNIQUE NOT NULL,
 external_customer_ref TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency IN('RUB','EUR','USD')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 100 AND 100000000),
 asset TEXT NOT NULL,
 provider_invoice_id TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','paid_confirmed','manual_review','refunded')),
 provider_event_id TEXT UNIQUE,
 created_at_ms INTEGER NOT NULL,
 confirmed_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS rustup_external_variable_customer
 ON rustup_external_variable_orders(external_customer_ref,created_at_ms);
