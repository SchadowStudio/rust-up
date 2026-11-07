-- RUST UP / PAYMENTS_DB. ONE-TIME, FAIL-CLOSED EMPTY-TABLE REBUILD.
-- Converts legacy NOT NULL rub_per_usd_minor to nullable, preserving all
-- orders/receipts and never altering balances or enabling payments.
-- Apply ONLY after verified D1 backup and sqlite_master dependency inspection.
-- Transactional wrangler D1 import is required. Do not execute sections alone.
PRAGMA foreign_keys=ON;
CREATE TABLE rustup_quote_schema_migration_guard(
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 cleared INTEGER NOT NULL CHECK(cleared=1)
);
INSERT INTO rustup_quote_schema_migration_guard(singleton,cleared)
SELECT 1,CASE WHEN
 (SELECT COUNT(*) FROM rustup_stars_variable_credit_quotes)=0
 AND (SELECT COUNT(*) FROM sqlite_master
      WHERE type IN ('trigger','view')
        AND tbl_name<>'rustup_stars_variable_credit_quotes'
        AND sql LIKE '%rustup_stars_variable_credit_quotes%')=0
 AND (SELECT COUNT(*) FROM sqlite_master
      WHERE type='table'
        AND name NOT IN ('rustup_stars_variable_credit_quotes',
                         'rustup_quote_schema_migration_guard')
        AND sql LIKE '%REFERENCES rustup_stars_variable_credit_quotes%')=0
 THEN 1 ELSE 0 END;
-- These triggers belong exclusively to the empty quotes table and are
-- restored below. DROP TABLE also drops its own indexes and triggers.
DROP TABLE rustup_stars_variable_credit_quotes;
CREATE TABLE rustup_stars_variable_credit_quotes(
 order_id TEXT PRIMARY KEY REFERENCES rustup_stars_variable_orders(id),
 telegram_user_id INTEGER NOT NULL CHECK(telegram_user_id>0),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 100 AND 100000000),
 coin_cents INTEGER NOT NULL CHECK(coin_cents BETWEEN 1 AND 100000000),
 rub_per_usd_minor INTEGER CHECK(rub_per_usd_minor IS NULL
                             OR rub_per_usd_minor BETWEEN 100 AND 100000),
 quoted_at_ms INTEGER NOT NULL CHECK(quoted_at_ms>0)
);
CREATE INDEX rustup_stars_variable_credit_quote_owner
 ON rustup_stars_variable_credit_quotes(telegram_user_id,quoted_at_ms DESC);
CREATE TRIGGER rustup_stars_variable_credit_quotes_immutable_update
BEFORE UPDATE ON rustup_stars_variable_credit_quotes
BEGIN
 SELECT RAISE(ABORT,'rustup_stars_frozen_quote_immutable');
END;
CREATE TRIGGER rustup_stars_variable_credit_quotes_immutable_delete
BEFORE DELETE ON rustup_stars_variable_credit_quotes
BEGIN
 SELECT RAISE(ABORT,'rustup_stars_frozen_quote_immutable');
END;
DROP TABLE rustup_quote_schema_migration_guard;
PRAGMA foreign_key_check;
