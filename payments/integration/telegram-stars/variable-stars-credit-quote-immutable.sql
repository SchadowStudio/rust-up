-- PAYMENTS_DB only. Apply after variable-stars-credit-quote.sql.
-- Once an invoice has a frozen player entitlement, no process may edit
-- or delete its money conversion or ownership.
PRAGMA foreign_keys=ON;
CREATE TRIGGER IF NOT EXISTS rustup_stars_variable_credit_quotes_immutable_update
BEFORE UPDATE ON rustup_stars_variable_credit_quotes
BEGIN
 SELECT RAISE(ABORT,'rustup_stars_frozen_quote_immutable');
END;
CREATE TRIGGER IF NOT EXISTS rustup_stars_variable_credit_quotes_immutable_delete
BEFORE DELETE ON rustup_stars_variable_credit_quotes
BEGIN
 SELECT RAISE(ABORT,'rustup_stars_frozen_quote_immutable');
END;
