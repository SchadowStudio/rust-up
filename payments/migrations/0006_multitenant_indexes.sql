-- Heavy-use invoice reconciliation is indexed by tenant.
CREATE INDEX IF NOT EXISTS v2_outbox_by_project ON v2_delivery_outbox(project_id,created_at_ms,event_id);
CREATE INDEX IF NOT EXISTS v2_claims_by_project ON v2_chain_claims(project_id,claimed_at_ms);
CREATE INDEX IF NOT EXISTS v2_rates_expiry ON v2_exchange_rates(enabled,expires_at_ms);
