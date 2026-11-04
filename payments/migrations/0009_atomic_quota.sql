-- Atomic per-project invoice quota buckets. Created/updated with the invoice
-- reservation in one D1 batch. Only random invoice IDs are stored, no user PII.
CREATE TABLE IF NOT EXISTS v2_invoice_quota (
 project_id TEXT NOT NULL REFERENCES v2_projects(id),
 bucket_minute_ms INTEGER NOT NULL,
 invoice_count INTEGER NOT NULL CHECK(invoice_count BETWEEN 1 AND 100000),
 last_invoice_id TEXT NOT NULL,
 PRIMARY KEY(project_id,bucket_minute_ms)
);
CREATE INDEX IF NOT EXISTS v2_quota_expiration ON v2_invoice_quota(bucket_minute_ms);
