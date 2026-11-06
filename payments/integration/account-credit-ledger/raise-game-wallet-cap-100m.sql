-- GAME D1 ONLY. Operator requested 100,000,000 Coin wallet ceiling.
-- No game balances or financial approval values are edited.
-- Deploy ONLY while rustup_game_paid_release_control.enabled=0.
PRAGMA foreign_keys=ON;
DROP TRIGGER IF EXISTS rustup_game_paid_receipts_preflight;
CREATE TRIGGER IF NOT EXISTS rustup_game_paid_receipts_preflight
BEFORE INSERT ON rustup_game_paid_receipts
BEGIN
 SELECT RAISE(ABORT,'rustup_paid_credit_release_disabled')
 WHERE NOT EXISTS (
  SELECT 1 FROM rustup_game_paid_release_control
  WHERE id=1 AND enabled=1
    AND length(approval_reference)>=8 AND reviewed_at_ms>0
 );
 SELECT RAISE(ABORT,'rustup_paid_credit_account_restricted_or_unsynced')
 WHERE NOT EXISTS (
  SELECT 1 FROM accounts a JOIN users u ON u.id=a.id
  WHERE a.id=NEW.telegram_user_id
    AND u.blocked=0 AND u.banned=0 AND u.balance IS NOT NULL
    AND CASE WHEN json_valid(a.state)=1 THEN
      json_type(a.state,'$.balance') IN ('integer','real')
      AND json_extract(a.state,'$.balance')>=0
      AND json_extract(a.state,'$.balance') < 100000000
      AND ABS(json_extract(a.state,'$.balance')-u.balance)<0.000001
      AND ABS(json_extract(a.state,'$.balance')*100.0-
              ROUND(json_extract(a.state,'$.balance')*100.0))<0.00001
     ELSE 0 END
 );
END;;
DROP TRIGGER IF EXISTS rustup_game_paid_receipts_apply;
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
         (100000000.0 - NEW.coin_cents/100.0);
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
END;;
