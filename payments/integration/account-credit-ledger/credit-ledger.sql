-- Additive change for GAME DB rustup-stats only. Do not run automatically.
-- Exactly-once settlement journal keyed to a verified external payment receipt.
-- Never populated from browser input or a Telegram initData ID alone.
CREATE TABLE IF NOT EXISTS rustup_verified_deposit_credits (
  source TEXT NOT NULL CHECK(source IN ('stars_variable','crypto_variable')),
  order_id TEXT NOT NULL CHECK(length(order_id) BETWEEN 8 AND 100),
  receipt_id TEXT NOT NULL CHECK(length(receipt_id) BETWEEN 8 AND 256),
  telegram_user_id INTEGER NOT NULL CHECK(telegram_user_id > 0),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 100 AND 100000000),
  coin_cents INTEGER NOT NULL CHECK(coin_cents BETWEEN 1 AND 100000000),
  status TEXT NOT NULL CHECK(status IN ('reserved','applied','manual_review')),
  created_at_ms INTEGER NOT NULL,
  applied_at_ms INTEGER,
  PRIMARY KEY (source, order_id),
  UNIQUE(source, receipt_id)
);
CREATE INDEX IF NOT EXISTS rustup_verified_credit_user_history
  ON rustup_verified_deposit_credits(telegram_user_id,created_at_ms DESC);
CREATE INDEX IF NOT EXISTS rustup_verified_credit_pending
  ON rustup_verified_deposit_credits(status,created_at_ms);
