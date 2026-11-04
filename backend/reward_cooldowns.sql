-- RUST UP -- illustrative server-side cooldown guards, NOT wired into live worker.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS rustup_reward_cooldowns (
  telegram_id TEXT NOT NULL,
  reward_type TEXT NOT NULL CHECK(reward_type IN ('daily', 'timer_case')),
  last_claim_ms INTEGER NOT NULL,
  total_claims INTEGER NOT NULL DEFAULT 1 CHECK(total_claims >= 1),
  PRIMARY KEY(telegram_id, reward_type)
);
CREATE TABLE IF NOT EXISTS rustup_telegram_sub_once (
  telegram_id TEXT PRIMARY KEY,
  claimed_at_ms INTEGER NOT NULL
);
-- Example guarded claim, within a transaction that also applies the reward:
-- INSERT INTO rustup_reward_cooldowns(telegram_id,reward_type,last_claim_ms,total_claims)
-- VALUES(:verified_tg_id,:reward_type,:server_now_ms,1)
-- ON CONFLICT(telegram_id,reward_type) DO UPDATE SET
--   last_claim_ms=excluded.last_claim_ms,
--   total_claims=rustup_reward_cooldowns.total_claims+1
-- WHERE excluded.last_claim_ms >= rustup_reward_cooldowns.last_claim_ms+86400000
-- RETURNING total_claims;
-- No returned row = reject claim; no item or 5000 kopeck credit.
-- Subscription: verify membership with Telegram bot API, then INSERT OR IGNORE
-- into rustup_telegram_sub_once; only award on first successful insertion.
