-- Keep the merchant wallet denomination separate from the fiat display currency.
-- Existing V2 invoices remain historically unchanged.
ALTER TABLE v2_projects ADD COLUMN wallet_currency TEXT NOT NULL DEFAULT 'RUB'
 CHECK(wallet_currency IN ('RUB','EUR','USD'));
ALTER TABLE v2_invoices ADD COLUMN credit_currency TEXT
 CHECK(credit_currency IN ('RUB','EUR','USD'));
ALTER TABLE v2_invoices ADD COLUMN credit_amount_minor INTEGER
 CHECK(credit_amount_minor>0);
UPDATE v2_invoices SET credit_currency=fiat,credit_amount_minor=amount_minor
 WHERE credit_currency IS NULL;
CREATE INDEX IF NOT EXISTS v2_invoices_project_credit
 ON v2_invoices(project_id,credit_currency,created_at_ms);
