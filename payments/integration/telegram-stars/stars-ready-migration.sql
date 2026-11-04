-- ONLY rustup-stars-staging / PAYMENTS_DB. Never apply to game rustup-stats.
-- Apply AFTER migration.sql + payment-controls-migration.sql.
-- No products are auto-enabled, no gambling balances, no real-money gate changes.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS rustup_stars_fixed_content(
  sku TEXT PRIMARY KEY REFERENCES rustup_stars_products(sku),
  delivery_text TEXT NOT NULL CHECK(length(delivery_text) BETWEEN 1 AND 2000)
);

-- Immutable snapshot of the deterministic content, created BEFORE invoice.
CREATE TABLE IF NOT EXISTS rustup_stars_order_content(
  order_id TEXT PRIMARY KEY REFERENCES rustup_stars_orders(id),
  delivery_text TEXT NOT NULL CHECK(length(delivery_text) BETWEEN 1 AND 2000),
  unlocked_at_ms INTEGER,
  CHECK(unlocked_at_ms IS NULL OR unlocked_at_ms > 0)
);

-- An XTR payment with unexpected/mismatched invoice is recorded for operator
-- review. Never automatically credit or overwrite game balances.
CREATE TABLE IF NOT EXISTS rustup_stars_receipt_incidents(
  telegram_charge_id TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  invoice_payload TEXT NOT NULL,
  price_stars INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 100),
  occurred_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rustup_stars_receipt_incidents_recent
  ON rustup_stars_receipt_incidents(occurred_at_ms DESC);

CREATE TABLE IF NOT EXISTS rustup_stars_refund_intents(
  order_id TEXT PRIMARY KEY REFERENCES rustup_stars_orders(id),
  telegram_charge_id TEXT NOT NULL UNIQUE,
  requested_by INTEGER NOT NULL,
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','completed','manual_review')),
  requested_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER
);

-- No price, product, or content seeded. Operator must explicitly configure
-- real non-transferable, non-wagering digital goods and confirm deliverability.
