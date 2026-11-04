-- STAGING ONLY. Never apply to live rustup-stats.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rustup_stars_products (
  sku TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 32),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 255),
  kind TEXT NOT NULL DEFAULT 'fixed_nontransferable' CHECK(kind='fixed_nontransferable'),
  price_stars INTEGER NOT NULL CHECK(price_stars BETWEEN 1 AND 1000000),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS rustup_stars_orders (
  id TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL CHECK(telegram_user_id>0),
  sku TEXT NOT NULL REFERENCES rustup_stars_products(sku),
  price_stars INTEGER NOT NULL CHECK(price_stars>0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','checkout_approved','paid','refunded','manual_review')),
  checkout_query_id TEXT UNIQUE,
  telegram_charge_id TEXT UNIQUE,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  paid_at_ms INTEGER,
  CHECK(expires_at_ms>created_at_ms)
);
CREATE INDEX IF NOT EXISTS rustup_stars_user_status ON rustup_stars_orders(telegram_user_id,status,created_at_ms);

-- External standalone store only. No Telegram Mini App checkout.
CREATE TABLE IF NOT EXISTS rustup_external_fixed_products (
  sku TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'fixed_nontransferable' CHECK(kind='fixed_nontransferable'),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 128),
  currency TEXT NOT NULL CHECK(currency IN ('EUR','RUB','USD')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 100 AND 100000000),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS rustup_external_fixed_orders (
  project_order_ref TEXT PRIMARY KEY,
  merchant_request_id TEXT UNIQUE NOT NULL,
  external_customer_ref TEXT NOT NULL,
  sku TEXT NOT NULL REFERENCES rustup_external_fixed_products(sku),
  product_kind TEXT NOT NULL CHECK(product_kind='fixed_nontransferable'),
  currency TEXT NOT NULL CHECK(currency IN ('EUR','RUB','USD')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  asset TEXT NOT NULL,
  provider_invoice_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','paid_confirmed','manual_review','refunded')),
  provider_event_id TEXT UNIQUE,
  confirmed_at_ms INTEGER
);

CREATE INDEX IF NOT EXISTS rustup_external_customer_orders
  ON rustup_external_fixed_orders(external_customer_ref,project_order_ref);
