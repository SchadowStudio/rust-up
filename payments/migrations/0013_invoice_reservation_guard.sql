-- SQLite rowid tables can accept NULL in TEXT PRIMARY KEY columns.
-- Harden the invoice reservation invariant for D1 batch atomicity:
-- abort the entire batch if the CASE guard returned NULL.
CREATE TRIGGER IF NOT EXISTS v2_invoice_reject_null_id
BEFORE INSERT ON v2_invoices
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN
 SELECT RAISE(ABORT, 'invoice_reservation_not_committed');
END;
