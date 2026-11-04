-- Fail-closed quotas prevent an authenticated but compromised project from
-- exhausting public chain RPCs with repeated on-demand verification.
CREATE TABLE IF NOT EXISTS v2_verify_quota (
 project_id TEXT NOT NULL REFERENCES v2_projects(id),
 bucket_minute_ms INTEGER NOT NULL,
 attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 100000),
 PRIMARY KEY(project_id,bucket_minute_ms)
);
CREATE INDEX IF NOT EXISTS v2_verify_quota_cleanup ON v2_verify_quota(bucket_minute_ms);

-- Durable independent post-settlement checks, including after the project
-- webhook was delivered. This never creates an unaudited automatic debit.
CREATE TABLE IF NOT EXISTS v2_chain_audit_state (
 invoice_id TEXT PRIMARY KEY REFERENCES v2_invoices(id),
 last_checked_ms INTEGER NOT NULL DEFAULT 0,
 next_check_ms INTEGER NOT NULL DEFAULT 0,
 failed_checks INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'pending'
   CHECK(state IN ('pending','confirmed','uncertain','manual_review')),
 last_error TEXT
);
CREATE INDEX IF NOT EXISTS v2_chain_audit_due
 ON v2_chain_audit_state(next_check_ms,state);
