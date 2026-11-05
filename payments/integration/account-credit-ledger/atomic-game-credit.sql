-- RUST UP GAME D1: atomic exactly-once account balance credit journal.
-- DO NOT apply or wire to live wagering until verified paid-order quotes,
-- refund reversals, account restrictions and release approval are complete.
-- This schema contains NO payment provider secrets and never self-activates.
-- One INSERT into rustup_game_paid_receipts changes both the unique journal
-- and accounts.state.balance inside the SAME SQLite transaction.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rustup_game_paid_receipts (
  source TEXT NOT NULL CHECK(source IN ('stars_variable','crypto_variable')),
  order_id TEXT NOT NULL CHECK(length(order_id) BETWEEN 8 AND 100),
  receipt_id TEXT NOT NULL CHECK(length(receipt_id) BETWEEN 8 AND 256),
  telegram_user_id INTEGER NOT NULL CHECK(telegram_user_id > 0),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 100 AND 100000000),
  coin_cents INTEGER NOT NULL CHECK(coin_cents BETWEEN 1 AND 100000000),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms > 0),
  PRIMARY KEY(source,order_id),
  UNIQUE(source,receipt_id)
);
CREATE INDEX IF NOT EXISTS rustup_game_paid_receipts_by_user
  ON rustup_game_paid_receipts(telegram_user_id,created_at_ms DESC);

CREATE TRIGGER IF NOT EXISTS rustup_game_paid_receipts_apply
AFTER INSERT ON rustup_game_paid_receipts
BEGIN
  UPDATE accounts
     SET state=json_set(state,'$.balance',
                       round((json_extract(state,'$.balance')*100.0+
                              NEW.coin_cents)/100.0,2)),
         v=v+1,
         updated=NEW.created_at_ms
   WHERE id=NEW.telegram_user_id
     AND json_valid(state)
     AND json_type(state,'$.balance') IN ('integer','real')
     AND json_extract(state,'$.balance')>=0
     AND json_extract(state,'$.balance') <=
         (1000000.0 - NEW.coin_cents/100.0);
  SELECT RAISE(ABORT,'rustup_paid_credit_account_or_balance_unavailable')
   WHERE changes()<>1;
  -- Keep the existing users.balance materialized view in sync with the
  -- canonical accounts.state.balance, exactly like game.storeAccount().
  UPDATE users SET balance=(
    SELECT json_extract(state,'$.balance') FROM accounts
    WHERE id=NEW.telegram_user_id
  ) WHERE id=NEW.telegram_user_id;
  SELECT RAISE(ABORT,'rustup_paid_credit_user_mirror_missing')
   WHERE changes()<>1;
END;
