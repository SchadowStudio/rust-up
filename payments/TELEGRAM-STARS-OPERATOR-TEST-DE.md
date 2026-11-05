# RUST UP — Telegram Stars Operator Test

## Scope

These tools DO NOT connect actual Stars payments to paid cases, upgrades,
withdrawable skins, cryptocurrencies or the live game account. All production
payment switches remain OFF. This is a test invoice for a non-wagerable,
non-transferable, non-redeemable digital TEST receipt, not a game item.

The real RUB-per-Star ratio has NOT been provided by the operator. It must never
be guessed. The Mini App still accepts a freely entered RUB amount, not fixed
payment packages. The minimum and maximum are technical validation limits only.

## Owner-selected rate (preview without charging)

Run in Windows PowerShell from RUST-UP-Local:

    git pull --ff-only origin feature/rustup-payment-admin-controls
    powershell -NoProfile -ExecutionPolicy Bypass -File .\payments\scripts\setup-stars-operator-rate.ps1

Enter your own choice for the number of RUB per Star. This validates price
bounds, creates a private preview config and executes only a Cloudflare dry run.
No real charge or game credit is enabled.

A live but NONCHARGING price preview can optionally use
-PublishReadOnlyPreview when the owner is ready to publish the quote only.

## Test invoice, payment, delivery and refund in Telegram TEST environment

Official reference: https://core.telegram.org/bots/features#testing-your-bot
Official Stars payments: https://core.telegram.org/bots/payments-stars

Telegram Desktop: Settings, then Shift+Alt+right click Add Account, select Test
Server. In this separate Telegram test account, create a NEW bot via @BotFather.
DO NOT use the production @rustuper_bot token. The PowerShell wrapper prompts
privately for the TEST bot token and does not save it.

First, with the test Telegram user, send /start to the NEW test bot.

    powershell -NoProfile -ExecutionPolicy Bypass -File .\payments\scripts\run-telegram-stars-test.ps1 -Action probe
    powershell -NoProfile -ExecutionPolicy Bypass -File .\payments\scripts\run-telegram-stars-test.ps1 -Action identify

The identify output lists Telegram TEST account IDs that sent messages. Choose
your own test ID. The Stars amount is free choice, with 7 as an example:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\payments\scripts\run-telegram-stars-test.ps1 -Action invoice -TestUserId 123456 -Stars 7

Replace 123456 with the actual TEST_USER_ID returned by identify.
Open the invoiceUrl in the Telegram TEST app. Start the watch command while
interacting with the test invoice, so Telegram precheckout gets a timely answer:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\payments\scripts\run-telegram-stars-test.ps1 -Action watch
    powershell -NoProfile -ExecutionPolicy Bypass -File .\payments\scripts\run-telegram-stars-test.ps1 -Action status

The delivery is ONLY a test receipt message. It is marked delivered after a
verified payment update and a confirmed Telegram message_id from sendMessage.
It does not credit any real or test-game coin, skin or balance. Replay attempts
are checked by order, test user, price, currency and charge ID.

After a successful TEST delivery, refund the test order with its exact UUID:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\payments\scripts\run-telegram-stars-test.ps1 -Action refund -OrderId 53e41abc-7696-4da9-8f1d-95b5409e3841

Replace that example UUID with the UUID printed for your actual test order.
The runner calls refundStarPayment on Telegram's dedicated /test/ endpoint.
A refund intent is saved BEFORE the external API call. If its result is
uncertain, manual review is required rather than a blind repeated refund.

## Production not yet ready

A successful unit test and a generated test runner are NOT a completed payment.
The operator must still choose a real exchange ratio, define a legitimate
non-wagerable paid digital service, prove its permanent idempotent delivery,
perform an actual Telegram TEST checkout and refund, and complete operational
legal/support checks. Do not enable the production payment switches.
