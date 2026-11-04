-- Exact partial payment information is retained for manual resolution.
-- Values are blockchain amounts, not personal data.
ALTER TABLE v2_payment_reviews ADD COLUMN actual_amount_atomic TEXT;
CREATE INDEX IF NOT EXISTS v2_reviews_open ON v2_payment_reviews(resolved_at_ms,created_at_ms);
