-- Additional auditable receiver, scanner and late-payment state. No secret material.
ALTER TABLE deposit_addresses ADD COLUMN source TEXT NOT NULL DEFAULT 'operator_watch_only'
 CHECK(source IN ('operator_watch_only', 'trust_wallet'));
ALTER TABLE deposit_addresses ADD COLUMN added_at_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deposit_addresses ADD COLUMN label TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS payment_scan_cursors (
  scanner TEXT PRIMARY KEY,
  cursor_value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_review_queue (
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  intent_id TEXT NOT NULL REFERENCES payment_intents(id),
  reason TEXT NOT NULL CHECK(reason IN ('late_payment','early_payment','amount_mismatch','manual_review')),
  actual_amount_atomic TEXT,
  detected_at_ms INTEGER NOT NULL,
  resolved_at_ms INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(chain,tx_hash)
);
CREATE TABLE IF NOT EXISTS payment_operator_audit (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  metadata TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL
);
-- Claim settlement remains one event per intent and one chain + tx per payment.
-- Never share assigned receiving addresses between customer orders.
