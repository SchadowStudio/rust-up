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
The adapter is only for fixed non-transferable, non-redeemable products. NEVER use it for cases, gambling, upgrades, wager balances, redeemable skins, NFTs or cashout.
No alternative crypto checkout, crypto wallet linking or redirect from the Telegram Mini App.

## Independent provider boundary

The pre-existing multi-project cryptocurrency provider may be integrated only into an independently compliant external storefront for fixed products, where permitted by law and platform rules.
Do not use the provider to circumvent the Telegram Stars rules; do not represent local fake invoice tests as real blockchain settlement.

## Files

- stars.mjs: Stars createInvoiceLink, pre_checkout_query, successful_payment validation and unique receipt recording.
- migration.sql: isolated staging D1 orders and catalog, no products enabled by default.
- crypto-checkout.mjs: disabled server-only crypto invoice creation using the existing multi-project provider; accepts only a server-authenticated external-store customer ID and a fixed product catalog.
- crypto-receipt.mjs: signed external fixed-product provider callback adapter.
- stars.test.mjs: offline verification and replay tests (no Telegram or money involved).

## Safe setup

1. Create a NEW staging D1 database, never apply migration.sql to production rustup-stats.
2. Use a staging Telegram bot. Keep STARS_PAYMENT_ENABLED unset/false until controlled tests.
3. The live Telegram webhook must be recovered and extended; do not overwrite it. The handler must verify Telegram's webhook secret header.
4. Call createStarsCheckout only with a verified Telegram identity from server-validated initData. Never trust a browser-supplied user ID.
5. A Stars successful_payment is recorded but does not credit game balance or automatically deliver products.
6. Keep EXTERNAL_FIXED_RECEIPTS_ENABLED and EXTERNAL_CRYPTO_CHECKOUT_ENABLED unset/false. Never expose provider API keys to browsers.
7. Implement audited fulfillment, refundStarPayment, reconciliation, chargebacks, support and logs before launch.
8. A legal/platform review is required for random rewards, transferable skins, NFT prizes and withdrawal.

Test: cd payments && node --test integration/telegram-stars/stars.test.mjs

In the standalone store, the crypto adapter uses private settings CRYPTO_PROVIDER_URL (HTTPS origin), CRYPTO_PROJECT_ID and CRYPTO_PROJECT_API_KEY, plus an isolated EXTERNAL_DB staging binding. It calls POST /v2/deposits with a stable merchant request UUID for retries. This must NOT be called from the Telegram Mini App or connected to gambling balance, case openings or cash-outs. The original crypto provider is not deployed and has no proof of real payments.

Official: https://core.telegram.org/bots/payments-stars
Official: https://telegram.org/tos/bot-developers