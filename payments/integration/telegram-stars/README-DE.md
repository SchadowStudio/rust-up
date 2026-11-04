# RUST UP — Telegram Stars + eigener Krypto-Provider (STAGING)

Branch: feature/rustup-payments-staging, based on feature/self-hosted-crypto-payments.
Nothing deployed, no live payment or game credit enabled.

## Current infrastructure (checked November 4, 2026)

- Live Cloudflare Worker: rustup-bot (rustup-bot.ttzoomrust.workers.dev).
- Existing D1: rustup-stats, binding DB. No payment tables yet.
- Live worker source is NOT in this GitHub repository. Never overwrite the deployed Worker with this branch.
- Self-hosted crypto provider under payments/src/multi remains simulation/test-only and is not production-ready.

## Telegram Stars boundary

Digital goods/services in Telegram bots and Mini Apps must be paid for using Telegram Stars (XTR).
A separate *variable-amount* checkout prototype now supports the player's chosen amount, with a server-defined price per Star and an immutable per-order quote. No fixed top-up package is required.
The fixed-price adapter remains available only for non-transferable, non-redeemable digital goods. Do NOT use any payment adapter for cases, gambling, upgrades, wager balances, redeemable skins, NFTs or cashout.
No alternative crypto checkout, crypto wallet linking or redirect from the Telegram Mini App.

## Independent provider boundary

The pre-existing multi-project cryptocurrency provider may be integrated only into an independently compliant external storefront for fixed products, where permitted by law and platform rules.
Do not use the provider to circumvent the Telegram Stars rules; do not represent local fake invoice tests as real blockchain settlement.

## Files

- stars.mjs: original fixed-price Stars adapter (disabled).
- variable-stars.mjs: new server-quoted variable RUB amount => whole Telegram Stars (XTR), one-use precheckout and receipt (disabled).
- variable-crypto.mjs: new independently hosted, server-only RUB/EUR/USD amount => crypto invoice (disabled).
- variable-migration.sql: additive D1 schema for variable-amount order records, no game balance.
- worker.mjs: /api/stars/topup endpoint accepts a RUB minor amount and a UUID idempotency key only after signed Telegram initData validation.
- migration.sql: isolated staging D1 orders and catalog, no products enabled by default.
- crypto-checkout.mjs: disabled server-only crypto invoice creation using the existing multi-project provider; accepts only a server-authenticated external-store customer ID and a fixed product catalog.
- crypto-receipt.mjs: signed external fixed-product provider callback adapter.
- stars.test.mjs: offline verification and replay tests (no Telegram or money involved).

## Safe setup

1. Create a NEW staging D1 database, never apply migration.sql or variable-migration.sql to production rustup-stats. The staging D1 exists already; additive variable migration is pending because Cloudflare returned error 7500 (daily D1 Free row reads exhausted) on November 4, 2026.
2. Use a staging Telegram bot. Keep STARS_PAYMENT_ENABLED, STARS_VARIABLE_TOPUP_ENABLED, and STARS_FIXED_PRODUCTS_ENABLED unset/false until controlled tests. Configure STARS_MIN_RUB_MINOR, STARS_MAX_RUB_MINOR, STARS_RUB_MINOR_PER_STAR_NUM, STARS_RUB_MINOR_PER_STAR_DEN with an explicit operator-chosen rate; these are blank by default. Never convert Stars at a guessed marketplace rate.
3. The live Telegram webhook must be recovered and extended; do not overwrite it. The handler must verify Telegram's webhook secret header.
4. Call createStarsCheckout only with a verified Telegram identity from server-validated initData. Never trust a browser-supplied user ID.
5. A Stars successful_payment is recorded but does not credit game balance or automatically deliver products.
6. Keep EXTERNAL_FIXED_RECEIPTS_ENABLED, EXTERNAL_CRYPTO_CHECKOUT_ENABLED, EXTERNAL_VARIABLE_CRYPTO_CHECKOUT_ENABLED and EXTERNAL_VARIABLE_CRYPTO_RECEIPTS_ENABLED unset/false. Never expose provider API keys to browsers.
7. Implement audited fulfillment, refundStarPayment, reconciliation, chargebacks, support and logs before launch.
8. A legal/platform review is required for random rewards, transferable skins, NFT prizes and withdrawal.

Test: cd payments && node --test integration/telegram-stars/stars.test.mjs

In the standalone store, the crypto adapter uses private settings CRYPTO_PROVIDER_URL (HTTPS origin), CRYPTO_PROJECT_ID and CRYPTO_PROJECT_API_KEY, plus an isolated EXTERNAL_DB staging binding. It calls POST /v2/deposits with a stable merchant request UUID for retries. This must NOT be called from the Telegram Mini App or connected to gambling balance, case openings or cash-outs. The original crypto provider is not deployed and has no proof of real payments.

Official: https://core.telegram.org/bots/payments-stars
Official: https://telegram.org/tos/bot-developers
## Variable Einzahlungsbeträge (noch nicht live)

**Beispiel ohne echten Kurs:** Der Spieler gibt 150,00 RUB ein. Der Browser schickt ganzzahlig `amountMinor:15000`, `currency:'RUB'` und eine zufällige `requestId` UUID. Nur der Server legt die maßgebliche Stars-Umrechnung fest; die Rechnung wird mit `XTR` erstellt, nicht mit RUB. Nach Zahlung speichert das System die bestätigte Menge und die vorher eingefrorene RUB-Summe. Eine Echtgeld-Gutschrift in die vorhandene Case-/Upgrade-/Auszahlungs-Wallet findet **nicht** statt.

Für Crypto wählt der Kunde auf einem **separaten, zulässigen externen Shop** z. B. `amountMinor:15000`, `currency:'RUB'`, `asset:'USDT_TRC20'`; der Provider bestimmt die genaue Tokenmenge und verifiziert den Zahlungseingang. Das Zielsystem speichert nur eine bestätigte Bestellung, kein Spielguthaben. Der echte Multi-Projekt-Provider ist noch nicht live.

**Achtung Cloudflare:** Am 4. November 2026 meldete die D1-REST-API Fehler `7500` wegen des accountweiten täglichen Free-Tier-Row-Read-Limits. Die additive Migration ist noch nicht ausgeführt. Cloudflare sperrt weitere D1-Abfragen bis zum nächsten Reset um Mitternacht UTC oder einer freigegebenen Planumstellung; auch der Live-Bot könnte betroffen sein. Keine Zahlungsfunktionen einschalten, solange die Datenbank nicht zuverlässig verfügbar ist.

Tests: `node --test integration/telegram-stars/*.test.mjs`.
