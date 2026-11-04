# RUST UP + Crypto Provider: Phase 3 lokal, kostenlos, sicher

## Ergebnis und Grenzen
Der separate headless Crypto Provider wird **nicht** in die RUST-UP-Webseite
eingebaut. Für lokale Tests gibt es einen eigenständigen serverseitigen
RUST-UP-Adapter unter `payments/integration/rust-up-local/bridge.mjs`.

Er verarbeitet:
- lokale Test-Bestellungen mit einer zufälligen **Test-Spieler-UUID**;
- `POST /v2/deposits` über die bereits gestartete **localhost-Demo-API**;
- Wiederholungen mit dauerhaftem Idempotency-Key;
- das simulierte Provider-Event und die bereits gecheckte lokale
  HMAC-Merchant-Buchung;
- eine **separate, ausschließlich virtuelle** RUST-UP-Testguthaben-Datenbank;
- erneute Zahlungsevents ohne zusätzliche Gutschrift.

Er spricht **nicht** mit dem öffentlichen Telegram-Bot, Steam, Trust Wallet,
Cloudflare oder irgendeiner Blockchain. Weder Echtgeld noch echte Skins
werden verbucht. In der lokalen RUST-UP-Webseite gibt es noch keinen
produktiven Checkout-Button.

Warum? Das GitHub-Repository enthält die statische RUST-UP-Mini-App
(`js/app.js`) und verweist auf `bot/game.js` / `bot/worker.js`. Die
hier sichtbare Repository-Version enthält aber **nicht** diese Backend-Dateien
oder einen authentifizierten echten Spieler-Guthaben-Endpunkt. Reale
Spielerkonten dürfen niemals aus einer Client-seitigen Demo heraus
gutgeschrieben werden.

## Windows PowerShell – 2 Fenster

**Fenster 1, localhost-Zahlungssimulator:**

```powershell
cd "$HOME\RUST-UP-Local"
git switch feature/self-hosted-crypto-payments
git pull --ff-only
cd payments
npm run demo:local
```

Fenster 1 offen lassen.

**Fenster 2, RUST-UP-Projektintegration:**

```powershell
cd "$HOME\RUST-UP-Local\payments"
npm run rustup:local:check
```

Erwartet:

```text
RUST UP LOCAL BRIDGE PASS — no real money
...
Before simulated confirmation: 0 EUR test balance
After simulated confirmation: 25.00 EUR test balance
Duplicate confirmation / replay: 0 extra credit
...
```

Die rein virtuelle RUST-UP-Datenbank wird in
`.local-test-results/rustup-sandbox.sqlite` abgelegt und ist Git-ignoriert.

## Technischer Ablauf

```text
RUST UP LOCAL-ORDER (anonymous test player UUID)
          |
          | local server-side project key, NOT browser/Telegram
          v
CRYPTO PROVIDER SIMULATOR 127.0.0.1:3029
          |
          | simulated operator confirmation (no network funds)
          v
SIGNED PROVIDER WEBHOOK -> LOCAL MERCHANT LEDGER (SQLite)
          |
          | authenticated local /v2/events, event/project/invoice match
          v
ISOLATED RUST UP TEST LEDGER (SQLite) -> artificial +25.00 EUR
```

Eine Manipulation des Fiat-Betrags, Coin-Symbols, der Projekt- oder
Invoice-ID, eine doppelte Event-ID und nicht zugestellte Ereignisse
sind keine autorisierten Guthabenbuchungen.

## Nächste technische Abnahme

1. Den fehlenden echten RUST-UP-Game-Backend-Code `bot/game.js`,
   `bot/worker.js` bzw. sein aktuelles privates GitHub-Repository
   lokalisieren.
2. Eine projektseitige **interne** Order- und Receipt-API integrieren;
   API-Schlüssel bleiben ausschließlich auf dem Backend.
3. Telegram-`initData` immer **serverseitig** prüfen; Spielerguthaben,
   Items und Ergebnisse nur in einer transaktional abgesicherten
   Backend-Datenbank ändern.
4. Zwei voneinander getrennte Konten/Integrationen: Stars direkt
   in RUST UP; der Multi-Projekt-Crypto-Provider ohne Stars.
5. Vor realer Nutzung: eigene Sicherheits- und Freigabetests für RPC,
   Wallet-Empfang, echte Beträge, Ausfallsicherheit sowie Plattform-
   und Rechtskonformität. Telegrams Stars-Vorgaben für digitale Käufe
   innerhalb von Mini Apps sind einzuhalten.

**Nicht verwechseln:** Das erfolgreiche Testledger hat keine
Rückwirkung auf echte Wallets oder das RUST-UP-Spiel.
