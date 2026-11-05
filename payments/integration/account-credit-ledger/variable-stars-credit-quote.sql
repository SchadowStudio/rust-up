-- Isolated PAYMENTS_DB: immutable server-frozen game coin quote per
-- verified Telegram Stars invoice. No client-side price is accepted.
-- No live activation and NO account balance changes from this migration.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rustup_stars_variable_credit_quotes(
 order_id TEXT PRIMARY KEY REFERENCES rustup_stars_variable_orders(id),
 telegram_user_id INTEGER NOT NULL CHECK(telegram_user_id>0),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 100 AND 100000000),
 coin_cents INTEGER NOT NULL CHECK(coin_cents BETWEEN 1 AND 100000000),
 rub_per_usd_minor INTEGER NOT NULL CHECK(rub_per_usd_minor BETWEEN 100 AND 100000),
 quoted_at_ms INTEGER NOT NULL CHECK(quoted_at_ms>0)
);
CREATE INDEX IF NOT EXISTS rustup_stars_variable_credit_quote_owner
 ON rustup_stars_variable_credit_quotes(telegram_user_id,quoted_at_ms DESC);
