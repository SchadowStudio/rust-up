-- RUST UP GAME WALLET SANDBOX. Isolated from real Stars/crypto D1 and from game inventory.
-- Only simulated, nontransferable, nonredeemable demo points.
-- Never join this with real-payment callbacks or real-money game stakes.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rustup_demo_wallet_accounts (
 telegram_user_id INTEGER PRIMARY KEY CHECK(telegram_user_id>0),
 balance_units INTEGER NOT NULL DEFAULT 0 CHECK(balance_units BETWEEN 0 AND 100000000),
 last_applied_event TEXT,
 updated_at_ms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rustup_demo_wallet_events (
 id TEXT PRIMARY KEY,
 telegram_user_id INTEGER NOT NULL REFERENCES rustup_demo_wallet_accounts(telegram_user_id),
 source TEXT NOT NULL CHECK(source IN ('demo_stars','demo_crypto','demo_game_spend','demo_refund')),
 source_ref TEXT NOT NULL,
 delta_units INTEGER NOT NULL CHECK(delta_units BETWEEN -1000000 AND 1000000 AND delta_units<>0),
 status TEXT NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending','applied','manual_review')),
 created_at_ms INTEGER NOT NULL,
 settled_at_ms INTEGER,
 UNIQUE(source,source_ref)
);
CREATE INDEX IF NOT EXISTS rustup_demo_wallet_recent
 ON rustup_demo_wallet_events(telegram_user_id,created_at_ms DESC);
