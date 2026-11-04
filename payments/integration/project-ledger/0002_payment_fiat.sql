-- Apply to each project ledger after 0001_project_ledger.sql.
-- Pending-order currency/amount_minor always represents IN-GAME balance.
-- These new fields freeze the customer's chosen payment display fiat.
ALTER TABLE merchant_pending_orders ADD COLUMN payment_currency TEXT
 CHECK(payment_currency IN ('RUB','EUR','USD'));
ALTER TABLE merchant_pending_orders ADD COLUMN payment_amount_minor INTEGER
 CHECK(payment_amount_minor>0);
UPDATE merchant_pending_orders
 SET payment_currency=currency,payment_amount_minor=amount_minor
 WHERE payment_currency IS NULL;
