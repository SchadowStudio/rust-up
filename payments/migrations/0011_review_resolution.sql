-- Support work is auditable without personal customer details.
ALTER TABLE v2_payment_reviews ADD COLUMN resolution_code TEXT
 CHECK(resolution_code IN ('operator_reviewed','external_refund_unverified','invalid_transfer'));
ALTER TABLE v2_payment_reviews ADD COLUMN resolved_by TEXT;
