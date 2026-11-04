-- RUST UP -- illustrative SQLite / Cloudflare D1 referral ledger; NOT wired into live worker.
-- Obtain both IDs from server-validated Telegram initData + stored referral attribution.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS rustup_referral_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_tg_id TEXT NOT NULL,
  referred_tg_id TEXT NOT NULL UNIQUE,
  unordered_pair TEXT NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL,
  CHECK (referrer_tg_id <> referred_tg_id),
  CHECK (unordered_pair = CASE
    WHEN referrer_tg_id < referred_tg_id
    THEN referrer_tg_id || ':' || referred_tg_id
    ELSE referred_tg_id || ':' || referrer_tg_id END)
);
CREATE TABLE IF NOT EXISTS rustup_referral_credits (
  claim_id INTEGER NOT NULL REFERENCES rustup_referral_claims(id),
  recipient_tg_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('referrer', 'referred')),
  amount_kopecks INTEGER NOT NULL CHECK (amount_kopecks = 5000),
  credited_at_ms INTEGER NOT NULL,
  PRIMARY KEY(claim_id, recipient_tg_id),
  UNIQUE(claim_id, role)
);
CREATE TRIGGER IF NOT EXISTS rustup_referral_awards_after_insert
AFTER INSERT ON rustup_referral_claims
BEGIN
  INSERT INTO rustup_referral_credits(claim_id, recipient_tg_id, role, amount_kopecks, credited_at_ms)
  VALUES(NEW.id, NEW.referrer_tg_id, 'referrer', 5000, NEW.created_at_ms);
  INSERT INTO rustup_referral_credits(claim_id, recipient_tg_id, role, amount_kopecks, credited_at_ms)
  VALUES(NEW.id, NEW.referred_tg_id, 'referred', 5000, NEW.created_at_ms);
END;
-- DB uniqueness prevents self/referral replay/reversed pair and double association
-- of any one referred account. Wallet ledger must apply these credits ONCE, atomically.
