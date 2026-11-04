-- Imported Trust Wallet addresses start inactive until checked by the operator.
ALTER TABLE deposit_addresses ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0
 CHECK(enabled IN (0,1));
ALTER TABLE deposit_addresses ADD COLUMN confirmed_at_ms INTEGER;
CREATE INDEX IF NOT EXISTS deposit_addresses_available
 ON deposit_addresses(chain,enabled,assigned_intent);
