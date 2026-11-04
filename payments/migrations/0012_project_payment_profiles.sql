-- Independent payment integration per project. Every method starts disabled.
-- No new wallet keys, private data, addresses or personal identifiers are stored.
CREATE TABLE IF NOT EXISTS v2_project_payment_profiles (
 project_id TEXT PRIMARY KEY REFERENCES v2_projects(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 3 AND 60),
 invoices_enabled INTEGER NOT NULL DEFAULT 0 CHECK(invoices_enabled IN (0,1)),
 deposits_enabled INTEGER NOT NULL DEFAULT 0 CHECK(deposits_enabled IN (0,1)),
 products_enabled INTEGER NOT NULL DEFAULT 0 CHECK(products_enabled IN (0,1)),
 invoice_lifetime_minutes INTEGER NOT NULL DEFAULT 20
  CHECK(invoice_lifetime_minutes BETWEEN 5 AND 20),
 updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_project_fiat_methods (
 project_id TEXT NOT NULL REFERENCES v2_projects(id) ON DELETE CASCADE,
 currency TEXT NOT NULL CHECK(currency IN ('RUB','EUR','USD')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 min_minor INTEGER NOT NULL DEFAULT 100 CHECK(min_minor BETWEEN 1 AND 100000000000),
 max_minor INTEGER NOT NULL DEFAULT 100000000 CHECK(max_minor BETWEEN 1 AND 100000000000),
 CHECK(min_minor<=max_minor),
 PRIMARY KEY(project_id,currency)
);
CREATE TABLE IF NOT EXISTS v2_project_crypto_methods (
 project_id TEXT NOT NULL REFERENCES v2_projects(id) ON DELETE CASCADE,
 asset TEXT NOT NULL CHECK(asset IN ('BTC','ETH','TRX','USDT_ERC20','USDT_TRC20')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 PRIMARY KEY(project_id,asset)
);
-- Migrated projects are disabled until manually configured and reviewed.
INSERT OR IGNORE INTO v2_project_payment_profiles(project_id,display_name,updated_at_ms)
 SELECT id,label,updated_at_ms FROM v2_projects;
INSERT OR IGNORE INTO v2_project_fiat_methods(project_id,currency)
 SELECT p.id,f.currency FROM v2_projects p
 CROSS JOIN (SELECT 'RUB' AS currency UNION ALL SELECT 'EUR' UNION ALL SELECT 'USD') f;
INSERT OR IGNORE INTO v2_project_crypto_methods(project_id,asset)
 SELECT p.id,a.asset FROM v2_projects p CROSS JOIN
  (SELECT 'BTC' AS asset UNION ALL SELECT 'ETH' UNION ALL SELECT 'TRX'
   UNION ALL SELECT 'USDT_ERC20' UNION ALL SELECT 'USDT_TRC20') a;
CREATE INDEX IF NOT EXISTS v2_project_payment_methods_enabled
 ON v2_project_crypto_methods(project_id,enabled);
