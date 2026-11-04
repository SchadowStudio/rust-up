-- Ethereum addresses are case-insensitive; TRON/Bitcoin addresses are not.
CREATE INDEX IF NOT EXISTS v2_invoice_evm_lookup
 ON v2_invoices(chain,receive_address COLLATE NOCASE,status);
-- Index supports tenants with many active invoices and fast payment-event routing.
CREATE INDEX IF NOT EXISTS v2_invoice_chain_status
 ON v2_invoices(chain,status,created_at_ms);
