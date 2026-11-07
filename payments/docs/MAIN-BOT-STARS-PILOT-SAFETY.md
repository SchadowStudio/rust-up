# RUST UP main-bot Stars pilot safety layer

Implementation status: **source code only, NOT deployed, NOT an activation**.

The variable-stars API now requires ALL of these safeguards on checkout and precheckout:
- Authenticated Telegram Mini App identity using the bot HMAC, not a caller-provided user ID.
- Server-only `STARS_VARIABLE_PILOT_USER_IDS` allowlist (comma-separated Telegram IDs, up to 10, fail-closed if absent).
- Server-only `STARS_VARIABLE_PILOT_MAX_STARS` integer from 1 to 10 Stars per invoice.
- Server-only `STARS_VARIABLE_PILOT_EXPIRES_AT_MS` Unix milliseconds within the next 24 hours. Expired pilot sessions cannot create new payable invoices.
- Every already-existing production, D1, immutable-quote, receipt-verification, independent settlement and refund gate must still pass.
- Even after the pilot expiry or allowlist removal, valid previously charged receipts continue to be journaled and reconciled.

The live worker **does not** contain this latest source change. Do NOT enable payment flags using the existing deployed Worker. First perform reviewed staged build against exact current live bot, verify tests, deploy preserving **all payment gates OFF**, then independently review live checkout/receipt handlers and game settlement before separate pilot approval.

Local tests:

```powershell
cd "$HOME\RUST-UP-Local"
git pull --ff-only origin feature/rustup-payment-admin-controls
node --test ".\payments\integration\telegram-stars\stars-variable-bridge.test.mjs"
node ".\payments\scripts\test-full-stars-offline-e2e.mjs"
```

This allowlist controls a future RUST UP technical pilot only. It neither authorizes gambling-related payment acceptance nor demonstrates successful live credit to game balances. The separate one-Star digital test-bot charge/refund was successful, but no live RUST UP main-bot charge or credit has been made.

## Three-phase sequence (code staged, NOT deployed)

Server-only `STARS_VARIABLE_PILOT_PHASE` must be exactly one of:
- `fixed`: a signed approved pilot user may request **only a 1-XTR invoice**. The expected minimum RUB amount at the approved 1 Star = 1.83 RUB pricing is **183 RUB minor units**; actual price is always recomputed from the live owner settings and never trusted from the browser.
- `custom`: the same approved pilot user may choose a RUB amount, but still cannot exceed `STARS_VARIABLE_PILOT_MAX_STARS` (1–10 XTR), 24-hour expiry, or any other financial safety gates.
- `refund`: new invoices and precheckout approvals are blocked. Existing paid receipts still journal and must be refunded via the existing finance-admin refund workflow with independently verified game balance reversal. **Changing phase does not automatically refund**.

An omitted/invalid phase disables the pilot. Do not change `fixed` to `custom` without confirming the initial receipt and game ledger independently. Do not change to `refund` until all invoices and payments have been reconciled. Do not flip financial switches or deploy the latest code based on offline tests alone.
