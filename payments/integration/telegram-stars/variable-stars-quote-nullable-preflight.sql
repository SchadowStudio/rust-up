-- RUST UP / PAYMENTS_DB read-only preflight for nullable RUB/USD legacy field.
-- DO NOT apply a table rebuild before inspecting its dependent objects.
SELECT 'quote_rows' AS item,COUNT(*) AS value FROM rustup_stars_variable_credit_quotes
UNION ALL
SELECT 'quote_rows_legacy_usd',COUNT(*) FROM rustup_stars_variable_credit_quotes
 WHERE rub_per_usd_minor IS NOT NULL
UNION ALL
SELECT 'quote_rows_direct',COUNT(*) FROM rustup_stars_variable_credit_quotes
 WHERE rub_per_usd_minor IS NULL
UNION ALL
SELECT 'paid_orders',COUNT(*) FROM rustup_stars_variable_orders WHERE status='paid';
SELECT type,name,tbl_name,sql FROM sqlite_master
 WHERE (tbl_name='rustup_stars_variable_credit_quotes'
 OR sql LIKE '%REFERENCES rustup_stars_variable_credit_quotes%'
 OR (type='trigger' AND sql LIKE '%rustup_stars_variable_credit_quotes%'))
 ORDER BY type,name;
PRAGMA foreign_key_check;
