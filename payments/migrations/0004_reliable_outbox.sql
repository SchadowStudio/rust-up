-- Persistent retries for verified-payment delivery to an authorized ledger.
ALTER TABLE payment_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0
 CHECK(attempts>=0);
ALTER TABLE payment_outbox ADD COLUMN next_attempt_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_outbox ADD COLUMN last_error TEXT;
CREATE INDEX IF NOT EXISTS payment_outbox_delivery_queue
 ON payment_outbox(delivered_at_ms,next_attempt_ms,created_at_ms);
