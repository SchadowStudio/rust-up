-- RUST UP canonical balance sync protection.
-- When canonical accounts.state.balance changes, atomically update users.balance
-- in the SAME D1 statement, eliminating a separate success/failure boundary.
-- Does not change any existing account balances by itself.
-- Existing game.storeAccount must be updated to REMOVE its independent
-- users.balance write to avoid a stale second update after concurrent deposits.
CREATE TRIGGER IF NOT EXISTS rustup_canonical_balance_after_account_update
AFTER UPDATE OF state ON accounts
WHEN json_valid(NEW.state)=1
 AND json_type(NEW.state,'$.balance') IN ('integer','real')
 AND (
   json_valid(OLD.state)=0
   OR json_type(OLD.state,'$.balance') NOT IN ('integer','real')
   OR ABS(json_extract(NEW.state,'$.balance')-
     json_extract(OLD.state,'$.balance'))>=0.000001
 )
BEGIN
  UPDATE users SET balance=json_extract(NEW.state,'$.balance')
  WHERE id=NEW.id;
  SELECT RAISE(ABORT,'rustup_canonical_balance_user_missing')
    WHERE changes()<>1;
END;
