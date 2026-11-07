-- PAYMENTS_DB only. Do not apply to game accounts or enable checkout.
-- Explicit, authenticated buyer acceptance for a specific published terms version.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rustup_stars_terms_acceptances(
  telegram_user_id INTEGER NOT NULL CHECK(telegram_user_id>0),
  terms_version TEXT NOT NULL CHECK(length(terms_version) BETWEEN 3 AND 40),
  accepted_at_ms INTEGER NOT NULL CHECK(accepted_at_ms>0),
  PRIMARY KEY(telegram_user_id,terms_version)
);
CREATE INDEX IF NOT EXISTS rustup_stars_terms_acceptance_recent
 ON rustup_stars_terms_acceptances(accepted_at_ms DESC);

-- Immutable terms receipt tied to the exact checkout, not just the current user.
CREATE TABLE IF NOT EXISTS rustup_stars_order_terms(
 order_id TEXT PRIMARY KEY REFERENCES rustup_stars_orders(id),
 terms_version TEXT NOT NULL CHECK(length(terms_version) BETWEEN 3 AND 40),
 accepted_at_ms INTEGER NOT NULL CHECK(accepted_at_ms>0),
 recorded_at_ms INTEGER NOT NULL CHECK(recorded_at_ms>0)
);
CREATE INDEX IF NOT EXISTS rustup_stars_order_terms_version
 ON rustup_stars_order_terms(terms_version,recorded_at_ms DESC);
