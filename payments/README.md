# RUST UP — own cryptocurrency payment service (development branch)

> **Neuer Stand (Multi-Projekt-Provider):** Das eigenständige, headless
> Backend unter `src/multi/` ist die aktuelle Entwicklungsgrundlage.
> Einzahlungen werden pro Projekt in RUB/EUR/USD berechnet und in BTC, ETH,
> TRX oder USDT bezahlt. Das bisherige Beispiel unten betrifft das ältere
> einzelne Telegram-Projekt und wird nicht produktiv aktiviert.
>
> - [Wallet-Import, Trust Wallet und neue Coins](./WALLET-COIN-ONBOARDING-DE.md)
> - [Projektübergreifende Integrationen](./PROJECT-INTEGRATIONS-DE.md)
> - [TON / Toncoin als neue, separat schaltbare Kryptowährung](./TON-INTEGRATION-DE.md)
> - [Aktueller Release-Status & Blocker](./RELEASE-STATUS-2026-11-04-DE.md)
> - [Sicherheits- und Ausfallkonzept](./SECURITY-FAILOVER-DE.md)
> - [Headless CLI ohne eigene Provider-Website](./HEADLESS-CLI-DE.md)
>
> Neue Assets werden über die zentrale Registry und Coin-Vorlagen vorbereitet,
> aber **nie** ungeprüft automatisch für echte Zahlungen freigeschaltet.

**Branch:** `feature/self-hosted-crypto-payments`. **Not deployed, not integrated,
and NOT enabled in the existing Telegram Mini App.** The live original Worker
`rustup-bot.ttzoomrust.workers.dev` is not part of this repository.

The payment code is completely independent of checkout providers, with
watch-only receivers in **your own Trust Wallet**. A customer can pay from any
compatible wallet, not necessarily Trust Wallet.

| Asset | Chain | Unit | Transfer verification |
| --- | --- | --- | --- |
| BTC | Bitcoin mainnet | satoshi | Bitcoin Core JSON-RPC (txindex=1) |
| ETH | Ethereum mainnet | wei | Ethereum JSON-RPC transaction + receipt |
| TRX | TRON mainnet | sun | TRON Solidity confirmed transaction |
| USDT (ERC-20) | Ethereum mainnet | 6 decimals | USDT contract Transfer event |
| USDT (TRC-20) | TRON mainnet | 6 decimals | USDT contract Transfer event |

ETH and USDT-ERC20 can be received at an Ethereum account address; TRX and
USDT-TRC20 at a TRON address. Choosing the **correct chain** is essential.
An address must be funded sufficiently to pay the relevant network fees when
you later transfer funds out of Trust Wallet.

## Security model

1. You pre-provision watch-only **fresh, dedicated addresses**, generated and
   controlled **outside the server** by your own wallet. One address is assigned
   permanently to exactly one payment intent; an expired intent does not
   release it for reassignment. **Do not provide a seed/private key** to the app,
   Cloudflare, GitHub, or ChatGPT.
2. The customer authenticates with signed Telegram initData (HMAC and TTL).
   The game and payment service do not share wallet authority.
3. A server-controlled quote fixes one amount in integer smallest units.
   Never trust a client's supplied price, amount, currency conversion or
   destination address.
4. The customer submits a transaction hash for verification. A
   **network-specific RPC** verifies chain, recipient, amount, status and
   confirmations. A hash alone is not proof of payment.
5. A D1 transaction marks the intent verified, uniquely reserves the
   transaction hash, and writes a **single outbox event**.
6. **No game balance is credited yet.** The separate game-worker integration
   must atomically consume each outbox event once. Until then, the response
   includes `creditedToGame:false`.

### Important limitations

- This remains a **development foundation**, not a production-ready gateway.
  Scheduled Ethereum, Bitcoin Core and TRON scanners have been added as an
  **opt-in** feature (default OFF), plus manual transaction-ID verification.
  Live blockchain integration has NOT been deployed or tested with real coins.
  Comprehensive reorganization recovery, refunds, partial/multi-payment
  handling, risk controls, pricing and incident operations remain outstanding.
- One receiver address per order is necessary here. A single shared
  BTC/ETH/TRON address for many users is **not sufficient for safe, automatic
  customer attribution**. If your Trust Wallet contains only one address
  per network, this implementation can process at most one intent per
  network until you provision more addresses. It does not derive wallet keys.
- The verified event is not itself a real-money payout or game credit.
- All node RPC endpoints must be trusted, secure and protected by secrets.
  Bitcoin Core RPC with `txindex=1` must be reachable by the Worker via
  protected HTTPS; never expose an unrestricted node publicly.
- Do not enter real wallet addresses or API credentials in public git history.
- **Telegram restriction:** Telegram Stars is the required in-app currency
  for digital goods/services in Telegram bots and Mini Apps. This
  standalone crypto service is *not* offered as a Mini App deposit route
  and must not be used to circumvent Telegram platform rules.
- Obtain necessary approval for any real-money, chance-based or
  cashout-enabled gaming before enabling this service.

## Local validation

```sh
cd payments
npm run validate
cd ..
python3 -m unittest discover -s payments/tests -p 'schema_test.py' -v
```

No npm dependencies are required for the code and tests.

## Future staging setup (needs your own Cloudflare account)

1. Copy `payments/wrangler.toml.example` to `payments/wrangler.toml`.
2. Install Wrangler locally and create a Cloudflare D1 staging database.
3. Set D1 database ID in your untracked `wrangler.toml`.
4. Apply `payments/migrations/0001_crypto.sql`.
5. Add secret `TG_BOT_TOKEN`; only use the token for a bot you control.
6. Add your own HTTPS Ethereum/Bitcoin/TRON RPC endpoints as secrets.
7. In D1, insert package offers and quotes **only after choosing fixed prices,
   rates, fees and expiry policy**. There are intentionally no default active
   offers and no fabricated exchange rates.
8. Manually insert your verified Trust Wallet receive addresses into
   `deposit_addresses` for each chain. Never reuse an assigned address.
9. Keep `CRYPTO_PAYMENTS_ENABLED=false` until staging tests, bot ownership,
   policy/compliance verification and game integration are complete.

### D1 staging-only example (do NOT use real receiving addresses)
```sql
INSERT INTO payment_packages (id,title,credit_kopecks,enabled)
 VALUES ('test100','STAGING TEST ONLY',10000,0);
INSERT INTO payment_quotes (package_id,asset,amount_atomic,enabled)
 VALUES ('test100','USDT_TRC20','1000000',0);
-- Replace with a *real* recipient address from an account you control:
-- INSERT INTO deposit_addresses(chain,address) VALUES ('tron','T...');
```

### API (disabled by default)

- `GET /health`: non-secret service status
- `GET /v1/crypto/options`: active server-authoritative offers
- `POST /v1/crypto/intents`: `{"packageId":"...","asset":"BTC"}`
- `GET /v1/crypto/intents/:uuid`: owned intent status
- `POST /v1/crypto/intents/:uuid/verify`: `{"transactionId":"..."}`

Authenticated routes require HTTP header
`x-telegram-init-data: <unaltered Telegram.WebApp.initData>`.
Never accept `initDataUnsafe` as an identity proof. Only HTTPS and explicitly
allowed frontend origins are supported.

## Next implementation steps

- Add robust automatic block/indexer scanning and delayed-payment handling.
- Add a reorganization-safe confirmation policy and manual review controls.
- Add a secure outbox consumer with idempotent **game ledger** credits.
- Add a complete dedicated crypto payment page separate from the Telegram
  Mini App (only where permitted).
- Production security review, monitoring, anti-fraud, rates and audits.

The existing `main` branch and deployed Worker are **not changed**.

## Current development milestones

- [x] Own Cloudflare Worker source in `payments/src/`
- [x] BTC, ETH, TRX and both USDT networks supported as separate assets
- [x] Watch-only receiver pool and strict address/checksum verification
- [x] Protected owner receiver-management endpoints
- [x] Standalone Trust Wallet management page in `payments/admin/`
- [x] EIP-6963 Trust Wallet connection for ETH addresses; BTC/TRX manual import
- [x] Blockchain proof checks and confirmed-block timestamps
- [x] Atomic and replay-resistant D1 payment event queue
- [x] Optional cron watchers for Ethereum, Bitcoin Core and TRON
- [x] Signed, retry-safe outbox interface for a future game-ledger consumer
- [x] GitHub tests for security rules and database uniqueness
- [ ] Own Cloudflare account, D1, RPC endpoints and Bot Token configured
- [ ] Multiple fresh owner-controlled receiving addresses provisioned per chain
- [ ] Real Trust Wallet connected by owner, and actual receive addresses approved
- [ ] Game Worker ledger consumer implemented and deployed with idempotent credits
- [ ] End-to-end testnet and real-chain controlled small-amount test payments
- [ ] Monitoring, support workflow, refunds and reorganization recovery verified
- [ ] Separate hosting / platform policy approval for any checkout UI

**Never switch the config flags to true until the unchecked items required
for production have been addressed.**

### Connecting your Trust Wallet (later, with your account)

1. Deploy the **operator console** (`payments/admin/`) on your own HTTPS
   origin, separate from the Telegram Mini App. Set that host as
   `OPERATOR_ORIGIN` in the Worker.
2. Generate a long operator key locally, set it as Cloudflare secret
   `OPERATOR_API_KEY`, and paste it only into your own operator console.
3. Install the **official Trust Wallet extension**. Click **Trust Wallet
   verbinden** to authorize the console to read your ETH address.
   The code discovers Trust Wallet using EIP-6963.
4. For Bitcoin and TRON, copy their **public receiving addresses** from Trust
   Wallet and enter them separately with the correct network.
5. Add an address to the payment service: it is **disabled by default**.
   Check the address, perform a test, then explicitly enable it. Never reuse
   an address already assigned to an invoice.
6. For Bitcoin, import every new public receive address into your separate
   Bitcoin Core **watch-only descriptor wallet** before you enable it:
   `node payments/scripts/register-bitcoin-address.mjs <BTC_ADDRESS> --confirm-watch-only`
   (requires protected Bitcoin Core RPC environment variables).
7. No recovery phrase, wallet password, private key or token-sending
   permission is requested or needed.

### Operating the chain scanner

- `CRYPTO_AUTO_SCAN_ENABLED=false` by default.
- Configure HTTPS `ETHEREUM_RPC_URL` and the deployment-start block
  `ETHEREUM_START_BLOCK`. The scanner walks confirmed blocks and filters
  Ethereum transfers and USDT Transfer logs for unused, unique invoice
  addresses.
- Configure `TRON_RPC_URL`, `TRON_INDEXER_URL`, and the TronGrid API key
  for TRX and USDT TRC-20 scan candidates, subsequently verified on TRON.
- Configure a private **Bitcoin Core watch-only wallet** behind a protected
  HTTPS RPC endpoint, `BITCOIN_RPC_BASIC_B64` and
  `BITCOIN_START_BLOCKHASH`. The scanner uses `listsinceblock` and
  explicitly verifies each matching transaction before settling.
- Scanning fails closed when a node or signature is unavailable. Check Worker
  logs and manual review queues if progress stops.

### Signed ledger delivery

- `GAME_LEDGER_DELIVERY_ENABLED=false` until an actual game Worker exists.
- Configure `GAME_LEDGER_WEBHOOK_URL` (trusted HTTPS URL) and
  `GAME_LEDGER_SIGNING_KEY` as secrets. The game Worker must independently
  verify HMAC-SHA256 over `timestamp.eventId.payload`, reject stale requests,
  and credit each unique `eventId` **at most once** inside its own DB
  transaction.
- Sender retries with backoff until it receives a JSON acknowledgement
  `{"ok":true,"eventId":"crypto:..."}`. A network timeout may mean the
  game already processed a request; the consumer's uniqueness constraint
  is mandatory.
- **No sender-side acknowledgement by itself credits the game**: the
  receiver's implementation is missing from this repository.

### Database migrations

Apply files in `payments/migrations/` in numeric order with Wrangler D1:
`0001_crypto.sql`, `0002_operations.sql`,
`0003_receivers_enabled.sql`, `0004_reliable_outbox.sql`.
Never start against a partially migrated database.
