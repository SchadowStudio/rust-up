# RUST UP — Live Stars pilot: account mirror race and currency display (2026-11-06)

## Verified payment evidence

Two owner-only Stars payments for Telegram user 7390606911 were received and settled:

| Order | XTR | Paid RUB | Internal game coins | Paid status | Credit receipt |
| --- | ---: | ---: | ---: | --- | --- |
| `5acaf9ba-f7c3-448c-a1f5-d7dd0c1190ff` | 1 | 1.83 | 1.83 | paid | present |
| `3ed2f58b-61b7-4e23-9981-21a011aa9492` | 3 | 5.00 | 5.00 | paid | present |

Total: **4 XTR paid, 6.83 RUB charged/quoted, 6.83 internal game coins credited.**
There were no corresponding `rustup_game_paid_refunds` at the audit time.
No further invoices should be accepted during reconciliation.

## Root cause

The legacy compiled Worker previously ran the following two **independent** statements in `storeAccount`:

1. CAS update to `accounts.state`, including `balance` and `v`.
2. A later standalone `UPDATE users SET balance=?`, using a potentially stale snapshot, with errors swallowed by `.catch(() => {})`.

A concurrent verified Stars settlement could update both tables atomically, then a stale legacy game call overwrote `users.balance`.
The live owner-account snapshot at inspection showed:

- Canonical `accounts.state.balance = 129.09` internal coins
- Materialized `users.balance = 124.09` internal coins
- Mirror difference = **5.00** internal coins
- Game account version = `12229`

The persistent, uniquely identified second 5.00-coin credit was present.
**Do not credit the second payment again.** The stale mirror is not proof that payment was missing.

## Permanent protection implemented

1. Applied the additive D1 migration `payments/integration/account-credit-ledger/canonical-game-balance-sync.sql` to live game D1. Trigger: `rustup_canonical_balance_after_account_update`.
2. Deployed a targeted live Worker patch removing the legacy post-CAS `users.balance` update from `storeAccount`. The D1 trigger now mirrors the canonical balance **within the same transaction** as the original account update, and aborts if the mirror row is missing.
3. Added isolated regression tests covering update, rollback, non-balance changes, and no historical balance rewrites.
4. Added activation preflight checks for the mirror trigger, patched Worker, and owner account balance agreement.

**The migration and code deployment did not reconcile historical differences or issue any refund.**
A separate, authenticated, documented reconciliation is still required for the current 5-coin discrepancy.
Do not bypass the existing refund trigger `rustup_game_paid_refunds_preflight`.

## Why the UI shows ~204 RUB

The game frontend `js/app.js` defines **1 internal coin = 0.02 USD** and renders `RUB = coins * 0.02 * USD/RUB`. At an illustrative conversion of ~79 RUB/USD,
`129.09 * 0.02 * 79 = 203.9622 RUB`, rounded to **204 RUB** in the header.

The payment settlement rule, meanwhile, is **1 paid RUB = 1 internal game coin**. These are *different conversion rules*; therefore the payment amount in RUB must not be directly added to the displayed RUB value. The frontend display is not evidence of a lost credit. Changing the global currency coefficient would reprice existing game items and require a separate product decision.

## Mandatory before the refunds

- Independently verify the canonical balance is currently correct and has not been spent.
- Reconcile the existing mirror mismatch **without adding or subtracting any canonical coins**; obtain and retain an audit record of the fix.
- Verify `accounts.state.balance` and `users.balance` agree.
- Reconfirm both orders are `paid`, receipts match immutable frozen quotes and XTR transactions, and no prior refund intents/reversals exist.
- Use the one-time authenticated refund operator flow **one order at a time** and verify Telegram, refund intent, and atomic game reversal. An uncertain provider outcome must not trigger a second refund request.
- Only then turn off remaining runtime financial gates, retaining reconciliation for any unresolved payment.

## Caution

The frontend's ~204 RUB balance is a converted display, not the ledger's internal coin balance.
No additional game coins should be minted to chase an apparent currency-display discrepancy.
A full D1 database restore would erase intervening player activity; do not use it to correct this account.
