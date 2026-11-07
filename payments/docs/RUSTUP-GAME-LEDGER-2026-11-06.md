# RUST UP — Game ledger deployment checkpoint (2026-11-06)

## Current implementation

- Game D1: `rustup-stats`, existing canonical `accounts.state.balance` and `users.balance`; no player balance migration.
- Stars D1: `rustup-stars-staging`, existing variable Stars orders, frozen quote and refund-intent tables.
- `atomic-game-credit.sql` was applied additively to game D1 on 2026-11-06 after verifying a D1 Time Travel bookmark, seven Worker flags explicitly `false`, three payment control rows `enabled=0`, and zero orders in paid/refunded/approved/manual-review state.
- Installed exactly 10 ledger objects: `rustup_game_paid_release_control`, `rustup_game_paid_receipts`, `rustup_game_paid_refunds`, indexes, preflight and atomic balance update/reversal triggers.
- Verified after installation: `rustup_game_paid_release_control.enabled=0` with no approval reference, `0` paid receipt rows, `0` refund rows, release-disable trigger present.
- Worker `rustup-bot` retained both D1 bindings, four bot secrets, and seven disabled payment flags as checked after migration. **The real deposit/game-credit adapter is not production-enabled.**

## Fail-closed guards

The receipt trigger refuses all credits when the separate game ledger release gate is off. When authorized later, it also rejects blocked/banned players, missing game accounts, mismatched canonical/mirror balances, sub-cent precision and overflow. Uniqueness constraints prevent replay by order or provider receipt. Refunds require matching receipts, do not produce negative balances, and do not silently fix corrupted mirrors. All of these are tested in a local SQLite database with no real money.

Read-only audits:
- `payments/scripts/preflight-game-ledger-migration.ps1` checks full vs partial installation, the lock, database wiring, balances and a current recovery bookmark.
- `payments/scripts/audit-stars-settlement-readonly.ps1` checks cross-D1 receipts, quotes, reversals, outstanding refunds and the DB lock.

## Known limits (do NOT turn on payments)

1. The live database had several historical disagreements between `accounts.state.balance` and `users.balance` during inspection, plus two accounts above the supported paid-credit threshold. These balances were **not modified** and are blocked from automatic credit by SQL.
2. The Telegram Stars variable-payment adapter and verified settlement/refund consumer are **not connected end to end in the active Worker**. Fixed-goods Stars wrappers have been tested in a private compiled build, not published.
3. Two different Wrangler publishers previously overwrote Worker bindings. Ensure a single controlled deployment path. Wrangler source bundles can alter source-map availability; always compare live version, code etag, cron and bindings before upload.
4. The operator has not selected an approved Stars→RUB rate. No placeholder quote authorizes a live invoice.
5. Any required gaming/operator authorization, age/identity controls, terms, payment-provider permissions and independent end-to-end verification must be established before accepting real deposits or offering paid games.

## Recovery caution

A D1 Time Travel bookmark was checked before the schema migration, but **restoring the entire game database can erase later game activity**. Do not restore it casually. No automatic rollback or money activation is provided. Review D1 schema and journals before changing any version or dropping objects.
