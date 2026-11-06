PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rustup_stars_refund_reconciliation_done (
 order_id TEXT PRIMARY KEY REFERENCES rustup_stars_variable_orders(id),
 outcome TEXT NOT NULL CHECK(outcome IN ('reversed','no_game_credit')),
 completed_at_ms INTEGER NOT NULL CHECK(completed_at_ms>0)
);
