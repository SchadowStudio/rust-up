-- Isolated payment admin controls (apply to rustup-stars-staging D1 first).
-- Independent of game wallet. All channels start disabled.
CREATE TABLE IF NOT EXISTS rustup_payment_settings(
  channel TEXT PRIMARY KEY CHECK(channel IN ('master','stars','crypto')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  updated_at_ms INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO rustup_payment_settings(channel,enabled,updated_at_ms,updated_by)
  VALUES ('master',0,0,0),('stars',0,0,0),('crypto',0,0,0);

CREATE TABLE IF NOT EXISTS rustup_payment_settings_audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK(channel IN ('master','stars','crypto')),
  old_enabled INTEGER NOT NULL CHECK(old_enabled IN (0,1)),
  new_enabled INTEGER NOT NULL CHECK(new_enabled IN (0,1)),
  telegram_admin_id INTEGER NOT NULL CHECK(telegram_admin_id>0),
  occurred_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rustup_payment_settings_audit_recent
  ON rustup_payment_settings_audit(occurred_at_ms DESC);

-- A trigger ensures no setting changes without a corresponding audit row.
CREATE TRIGGER IF NOT EXISTS rustup_payment_settings_audit_update
AFTER UPDATE OF enabled ON rustup_payment_settings
WHEN OLD.enabled<>NEW.enabled
BEGIN
  INSERT INTO rustup_payment_settings_audit
    (channel,old_enabled,new_enabled,telegram_admin_id,occurred_at_ms)
    VALUES(NEW.channel,OLD.enabled,NEW.enabled,NEW.updated_by,NEW.updated_at_ms);
END;
