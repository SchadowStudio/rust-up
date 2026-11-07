-- Isolated PAYMENTS_DB only. No game-state migration, products or payment activation.
-- Operator-signed variable Stars refund intent: reserve exactly once before Telegram API.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rustup_stars_variable_refund_intents (
 order_id TEXT PRIMARY KEY REFERENCES rustup_stars_variable_orders(id),
 telegram_charge_id TEXT NOT NULL UNIQUE,
 requested_by INTEGER NOT NULL CHECK(requested_by>0),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 100),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','completed','manual_review')),
 requested_at_ms INTEGER NOT NULL CHECK(requested_at_ms>0),
 completed_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS rustup_variable_refund_review
 ON rustup_stars_variable_refund_intents(state,requested_at_ms);
