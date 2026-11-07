-- RUST UP supporter badge: isolated fixed non-transferable digital entitlement.
-- APPLY ONLY TO PAYMENTS_DB (rustup-stars-staging), AFTER stars-ready-migration.sql.
-- NEVER migrate the existing Rust game DB. No prices, invoices or payment flags.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS rustup_stars_supporter_badges(
 order_id TEXT PRIMARY KEY REFERENCES rustup_stars_orders(id),
 telegram_user_id INTEGER NOT NULL CHECK(telegram_user_id>0),
 sku TEXT NOT NULL DEFAULT 'supporter_badge_v1'
   CHECK(sku='supporter_badge_v1'),
 telegram_charge_id TEXT NOT NULL UNIQUE
   CHECK(length(telegram_charge_id) BETWEEN 1 AND 256),
 status TEXT NOT NULL CHECK(status IN('active','revoked')),
 granted_at_ms INTEGER NOT NULL CHECK(granted_at_ms>0),
 revoked_at_ms INTEGER,
 CHECK((status='active' AND revoked_at_ms IS NULL)
    OR (status='revoked' AND revoked_at_ms IS NOT NULL
        AND revoked_at_ms>=granted_at_ms))
);

-- One active supporter badge per Telegram user; refunds remain auditable.
CREATE UNIQUE INDEX IF NOT EXISTS rustup_stars_supporter_one_active
 ON rustup_stars_supporter_badges(telegram_user_id,sku)
 WHERE status='active';
CREATE INDEX IF NOT EXISTS rustup_stars_supporter_owner
 ON rustup_stars_supporter_badges(telegram_user_id,status,granted_at_ms DESC);
