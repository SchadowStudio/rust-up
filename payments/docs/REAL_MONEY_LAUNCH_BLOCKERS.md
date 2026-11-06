# RUST UP – Real-money launch readiness (not approval)

**Status: BLOCKED.** Prepared for offline review only. This document does not authorize live payment processing, gambling, or crediting the existing RUST UP game balance.

**Scope:** Telegram-only RUST UP Mini App featuring cases, upgrades, and case battles. These mechanics involve chance and may involve valuable rewards or an account balance funded by real money.

## Findings from current project (6 November 2026)

- The public Mini App displays the Stars deposit/status panel and its history UI.
- Cloudflare Worker `rustup-bot` was updated with an *authenticated read-only* `POST /api/stars/variable/history` endpoint. The public payment route `/api/stars/variable/quote` and `/api/stars/variable/checkout` remain blocked in the history-only wrapper.
- Live Cloudflare `DB` and `PAYMENTS_DB` bindings are present. Telegram bot, cron and original Durable Object export preserved.
- All seven payment gates were last independently checked OFF: `PAYMENT_PRODUCTION_ENABLED`, `STARS_PAYMENT_ENABLED`, `STARS_FIXED_PRODUCTS_ENABLED`, `STARS_REFUNDS_ENABLED`, `STARS_VARIABLE_TOPUP_ENABLED`, `STARS_VARIABLE_CREDIT_LEDGER_READY`, `PAYMENT_WALLET_STRICT_MODE`.
- A variable Stars payment module exists in the repository, but it contains `VERIFIED_GAME_CREDIT_CONSUMER_PRESENT=false` and is **not** in the deployed history-only Worker. Never regard an invoice receipt as proof of a game credit.
- The operator has reserved the Stars-to-RUB rate decision until all other prerequisites are resolved. Do not select or assume a rate.

## Nontechnical and contractual gates — mandatory *before* any payment or wager-enabled launch

1. **Eligible adult, authorized legal operator.** A competent, legally accountable adult operator/entity must be responsible for contractual, refund, payment, tax and compliance obligations. Do not use a proxy, false age, or a third-party account to bypass identity checks.
2. **Written jurisdiction-by-jurisdiction legal assessment.** Obtain competent review of cases, upgrades, case battles, any skin/NFT/Telegram Gift prizes, withdrawal mechanics and the precise role of game coins. Germany's GGL notes that lootboxes have no uniform classification; the exact model determines whether gambling rules apply. Obtain any necessary authorization *before* taking funds.
3. **Payment-provider acceptance in writing.** Obtain a documented, accurate disclosure to Telegram and any crypto/payment processor of the chance-based mechanics, user age restrictions, winnings and redemptions. Telegram Stars' digital-goods API by itself is not gambling authorization. Do not mislabel wallet top-ups as unrelated goods.
4. **Age/identity, jurisdiction and harm prevention controls.** Where legally required, verified 18+ age/identity, geolocation restrictions, self-exclusion, deposits/loss/playing limits, sanctions/AML and dispute/refund workflows must be designed and independently reviewed. Telegram's `initData.user.id` is an account ID, **not** independent proof of age/identity.
5. **Independent production assurance.** Verify refunds, zero-double-credit guarantees, receipt replay and crash recovery, reconciliation across payment and game databases, observability and emergency OFF switches, safe handling of account mirror discrepancies, audits of refunds/chargebacks and payment-provider terms. None of these technical checks can replace legal clearance.
6. **Rate decision LAST.** The operator-approved Stars-to-RUB price must be explicit, tested and disclosed; do not infer it from Telegram's acquisition price or the player's client.

No single environment variable, GitHub merge, Wrangler deployment or passing test should remove these conditions. Payment gates remain OFF until every applicable requirement has independently documented evidence.

## Safe work permitted while blocked

- Keep public history endpoints read-only and Telegram-authenticated; do not create invoices.
- Run offline simulation using fake signed receipts, in-memory SQL, account-ledger reconciliation and refund scenarios.
- Verify the deployed Worker, original bot checksum and disabled gates without further deployments.
- Fix unrelated UI accessibility and account-security vulnerabilities.
- Consider, subject to age/operator/provider eligibility, a **separate** non-chance digital-goods storefront whose purchases cannot fund cases, upgrades, case battles or convertible/redemption currencies. That would be a separate product requiring its own compliance review.

## Official references (retrieved 6 November 2026)

- GGL: lootbox/skin-betting classification requires case-specific analysis: https://www.gluecksspiel-behoerde.de/de/news/ggl-unterstuetzt-appell-fuer-umfassende-regeln-zu-lootboxen-expertenworkshop-setzt-impulse-fuer-fundierte-gluecksspielrechtliche-bewertung
- GGL: authorized operators and permission process: https://www.gluecksspiel-behoerde.de/de/fuer-gluecksspielanbieter/online-poker-und-virtuelle-automatenspiele
- GGL: official permitted-operator whitelist: https://www.gluecksspiel-behoerde.de/de/fuer-spielende/uebersicht-erlaubter-anbieter-whitelist
- GGL: player protection and restricted payment sources: https://gluecksspiel-behoerde.de/de/fuer-spielende/die-spielerschutzmassnahmen-des-gluestv21-im-ueberblick
- Telegram Stars digital goods docs: https://core.telegram.org/bots/payments-stars
- Telegram Bot Developer Terms (legal compliance, privacy, regulated goods): https://telegram.org/tos/bot-developers

**No deployment made by this document. No real-money permission granted.**
