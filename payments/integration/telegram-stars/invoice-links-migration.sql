-- RUST UP Telegram Stars fixed-good order retries.
-- Apply ONLY to rustup-stars-staging (PAYMENTS_DB), NEVER rustup-stats.
-- No products, wallet credits or payment toggles are enabled.
CREATE TABLE IF NOT EXISTS rustup_stars_invoice_links(
 order_id TEXT PRIMARY KEY REFERENCES rustup_stars_orders(id),
 invoice_url TEXT NOT NULL CHECK(length(invoice_url) BETWEEN 15 AND 1024),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0)
);
