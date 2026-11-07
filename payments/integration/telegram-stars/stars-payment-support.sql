-- PAYMENT D1 ONLY: customer Stars payment-support intake.
-- Idempotent per Telegram update_id; no paid writes.
CREATE TABLE IF NOT EXISTS rustup_stars_support_requests (
 update_id INTEGER PRIMARY KEY CHECK(update_id>=0),
 telegram_user_id INTEGER NOT NULL CHECK(telegram_user_id>0),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0),
 description TEXT NOT NULL CHECK(length(description)<=500),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','review','resolved'))
);
CREATE INDEX IF NOT EXISTS rustup_stars_support_open_idx
 ON rustup_stars_support_requests(status,created_at_ms);
