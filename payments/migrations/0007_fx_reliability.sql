-- Independent rate-refresh leases and bounded last-good rates.
CREATE TABLE IF NOT EXISTS v2_fx_jobs (
 name TEXT PRIMARY KEY,
 lease_until_ms INTEGER NOT NULL DEFAULT 0,
 last_ok_at_ms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS v2_market_prices (
 fiat TEXT NOT NULL CHECK(fiat IN ('RUB','EUR','USD')),
 asset TEXT NOT NULL CHECK(asset IN ('BTC','ETH','TRX','USDT_ERC20','USDT_TRC20')),
 price_e8 TEXT NOT NULL CHECK(length(price_e8)>0 AND price_e8 NOT GLOB '*[^0-9]*'),
 observed_at_ms INTEGER NOT NULL,
 source TEXT NOT NULL,
 PRIMARY KEY(fiat,asset)
);
