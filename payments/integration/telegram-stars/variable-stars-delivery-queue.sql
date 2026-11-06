-- PAYMENTS_DB ONLY. Durable Stars delivery queue for an already confirmed
-- Telegram successful_payment. No charge, no balance write, no gate enabling.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rustup_stars_variable_delivery_jobs(
 order_id TEXT PRIMARY KEY REFERENCES rustup_stars_variable_orders(id),
 state TEXT NOT NULL DEFAULT 'pending'
  CHECK(state IN ('pending','leased','retry','delivered','manual_review','refunded')),
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 1000),
 next_attempt_at_ms INTEGER NOT NULL CHECK(next_attempt_at_ms>=0),
 lease_token TEXT,
 lease_until_ms INTEGER,
 completed_at_ms INTEGER,
 updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>=0),
 last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 64),
 CHECK(
  (state='leased' AND lease_token IS NOT NULL AND lease_until_ms IS NOT NULL)
  OR (state<>'leased' AND lease_token IS NULL AND lease_until_ms IS NULL)
 )
);
CREATE INDEX IF NOT EXISTS rustup_stars_delivery_ready_idx
 ON rustup_stars_variable_delivery_jobs(state,next_attempt_at_ms,lease_until_ms);
-- The order and its delivery job are recorded in one PAYMENTS_DB transaction.
CREATE TRIGGER IF NOT EXISTS rustup_stars_enqueue_confirmed_payment
AFTER UPDATE OF status ON rustup_stars_variable_orders
WHEN NEW.status='paid' AND OLD.status<>'paid'
BEGIN
 INSERT OR IGNORE INTO rustup_stars_variable_delivery_jobs
 (order_id,state,attempt_count,next_attempt_at_ms,updated_at_ms)
 VALUES (NEW.id,'pending',0,COALESCE(NEW.paid_at_ms,NEW.created_at_ms),
         COALESCE(NEW.paid_at_ms,NEW.created_at_ms));
END;
-- A refund before delivery blocks any future automatic credit.
-- A credit already delivered must be reversed through the separate,
-- independently verified game refund journal, not silently undone here.
CREATE TRIGGER IF NOT EXISTS rustup_stars_cancel_undelivered_refund
AFTER UPDATE OF status ON rustup_stars_variable_orders
WHEN NEW.status='refunded' AND OLD.status<>'refunded'
BEGIN
 UPDATE rustup_stars_variable_delivery_jobs
 SET state='refunded',lease_token=NULL,lease_until_ms=NULL,
     updated_at_ms=COALESCE(NEW.paid_at_ms,NEW.created_at_ms),
     last_error_code=NULL
 WHERE order_id=NEW.id AND state IN ('pending','retry','leased','manual_review');
END;
-- Idempotent recovery for payments recorded before this schema was installed.
INSERT OR IGNORE INTO rustup_stars_variable_delivery_jobs
(order_id,state,attempt_count,next_attempt_at_ms,updated_at_ms)
SELECT id,'pending',0,COALESCE(paid_at_ms,created_at_ms),
       COALESCE(paid_at_ms,created_at_ms)
FROM rustup_stars_variable_orders WHERE status='paid';
