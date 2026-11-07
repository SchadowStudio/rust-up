-- Enforce canonical game balance for standalone writes to users.balance.
-- This migration does not mutate existing balances.
-- Updates to users.balance must match the canonical accounts.state.balance.
-- Standalone stale writes fail, so the original race cannot return through
-- another part of the game code.
CREATE TRIGGER IF NOT EXISTS rustup_users_balance_canonical_guard
BEFORE UPDATE OF balance ON users
WHEN EXISTS (SELECT 1 FROM accounts a WHERE a.id=NEW.id)
BEGIN
 SELECT RAISE(ABORT,'rustup_user_balance_must_match_canonical_account')
 WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
  WHERE a.id=NEW.id AND json_valid(a.state)=1
    AND json_type(a.state,'$.balance') IN ('integer','real')
    AND ABS(CAST(NEW.balance AS REAL)-
            CAST(json_extract(a.state,'$.balance') AS REAL))<0.000001
 );
END;
