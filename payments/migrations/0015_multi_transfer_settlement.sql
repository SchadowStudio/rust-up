-- Optional invoice-level multi-transfer settlement, OFF until fully deployed.
-- All amounts are decimal TEXT because wei exceeds SQLite's signed 64-bit range.
-- Every blockchain transaction can belong to only ONE invoice across tenants.
CREATE TABLE IF NOT EXISTS v2_payment_parts (
 chain TEXT NOT NULL CHECK(chain IN ('bitcoin','ethereum','tron')),
 tx_hash TEXT NOT NULL,
 invoice_id TEXT NOT NULL REFERENCES v2_invoices(id),
 project_id TEXT NOT NULL REFERENCES v2_projects(id),
 asset TEXT NOT NULL,
 actual_atomic TEXT NOT NULL CHECK(
   length(actual_atomic) BETWEEN 1 AND 60 AND
   actual_atomic NOT GLOB '*[^0-9]*' AND actual_atomic!='0'),
 payment_time_ms INTEGER NOT NULL CHECK(payment_time_ms>0),
 block_hash TEXT NOT NULL,
 confirmed_at_ms INTEGER NOT NULL,
 PRIMARY KEY(chain,tx_hash),
 UNIQUE(invoice_id,tx_hash)
);
CREATE INDEX IF NOT EXISTS v2_payment_parts_invoice
 ON v2_payment_parts(invoice_id,confirmed_at_ms);
