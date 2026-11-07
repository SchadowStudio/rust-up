# RUST UP Stars live readiness — 2026-11-06

Scope: Telegram-only Mini App Stars deposits to the existing RUST UP player balance, including cases, upgrades and case battles. **NOT AN ACTIVATION APPROVAL.**

## Live evidence (Cloudflare API, read-only)

- Deployed Worker `rustup-bot`: version `285f2656-d696-4fe4-a078-b90efb987e6d`, 100% traffic.
- D1 `rustup-stats` and `rustup-stars-staging` both bound.
- `PAYMENT_PRODUCTION_ENABLED`, `PAYMENT_WALLET_STRICT_MODE`, `STARS_PAYMENT_ENABLED`, `STARS_VARIABLE_TOPUP_ENABLED`, `STARS_VARIABLE_CREDIT_LEDGER_READY`, `STARS_REFUNDS_ENABLED`: **false**.
- Game D1 `rustup_game_paid_release_control.enabled=0`; no reviewed approval reference.
- Game paid receipt count 0, paid refund count 0.
- Payment D1 variable order count 0, frozen quote count 0.
- Quote `rub_per_usd_minor` now nullable; immutable quote update/delete triggers present.
- Added to PAYMENT D1 on 2026-11-06: `rustup_stars_variable_delivery_jobs`, `rustup_stars_refund_reconciliation_done`, `rustup_stars_delivery_ready_idx`, and paid/refund status triggers (from reviewed additive SQL migration). Confirmed present afterwards; 0 queue rows and 0 done records.
- `PRAGMA foreign_key_check` returned zero violations in both databases.
- Cloudflare D1 API rejected an extra `PRAGMA integrity_check` query with `SQLITE_AUTH`; **not a passed integrity check**, and not evidence of DB corruption.
- Owner-defined price: 1 Star = 1.83 RUB; 1 RUB = 1 RUST UP Coin, using server-frozen quotes.

## Prior verified local preflight

55/55 checkout, webhook, delivery/replay, and refund tests passed; compiled Worker source map and 15 modules matched staged source, and the old bot, cron, D1 and secrets passed prior live checks. **These are offline and configuration checks, not a successful real Telegram deposit.**

## Release blockers

1. Real-world age/eligibility, applicable gambling/licensing and provider/platform approval for **paid chance-based cases, upgrades and case battles** cannot be established from code or Cloudflare access. Operator must retain verifiable approval or obtain competent specialist review; do not infer it from claims that technical tests passed.
2. Telegram Stars digital-goods payments require clear payment support, timely dispute resolution and `/paysupport`; verify these runtime flows, including RefundStarPayment and recoverable spent-credit disputes, before paid rollout.
3. No real Telegram charge-to-ledger-to-game credit and refund test has been completed. A production paid test would require gates enabled and could charge a user; do not run without relevant authorization.
4. Before any paid activation, verify operation-specific anti-abuse safeguards, withdrawal/transfer restrictions and age protections from the actual game and approved product terms. A 1:1 Coin pricing formula does not prove compliance.

**DO NOT** enable payment Worker variables or game release gate based solely on this report. No real invoices or game credits were initiated by these checks.

References: https://core.telegram.org/bots/payments-stars and https://telegram.org/tos/bot-developers

## Follow-up: Telegram authentication and gateway fixes (same date)

- Live Telegram bot restored: `/start` and `/stats` respond.
- Mini-App bot-token HMAC fixed to include Telegram's optional `signature` field; 56/56 local tests passed. Verified deployed Worker version `24ca912d-76fc-4695-a2a4-bbe2020164da`.
- In the real Mini App, the server-side preview calculated 100 RUB as 55 Stars. This was **not** a real payment.
- Further source fix committed: change shared Telegram Bot API `redirect: 'error'` to `redirect: 'manual'` to avoid Cloudflare Workers failures when creating invoices or independently checking confirmed Stars charges. The manual mode does **not** follow untrusted 3xx responses; the client fails closed. Added redirect regression test.
- Safe live patch prepared at `payments/scripts/release-live-stars-gateway-fix.ps1`; **not yet deployed** as of this entry. The patch verifies current live bundle, Worker version and settings before publishing.
- Latest production read-only verification: GAME release gate disabled and no approval reference; runtime payment switches master/stars/crypto all disabled; variable orders, frozen quotes, delivery jobs and unmatched receipt records all zero. All payment Worker flags still off.
- Existing compliance/eligibility and end-to-end actual charge/refund blockers above remain; a successful technical patch is not approval to switch payments on.
