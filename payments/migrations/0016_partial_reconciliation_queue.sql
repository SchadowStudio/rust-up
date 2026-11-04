-- Durable queue for invoices with confirmed partial deposits.
-- A cron can finish invoices even if two deposits arrive concurrently and
-- both request handlers initially observe an insufficient subtotal.
CREATE TABLE IF NOT EXISTS v2_partial_reconcile_queue (
 invoice_id TEXT PRIMARY KEY REFERENCES v2_invoices(id),
 next_check_ms INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_partial_reconcile_due
 ON v2_partial_reconcile_queue(next_check_ms);
