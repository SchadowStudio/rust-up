# RUST UP Crypto Provider – kostenlos und lokal testen (Windows)

**Kosten: 0 € | Keine Wallet | Keine echten Coins | Kein Cloudflare |
Keine Domain | Kein Docker | Keine eigenen Blockchain-Knoten.**

Der Provider wird vorerst **nicht deployed** und nimmt keine echten Zahlungen an.
Der originale RUST-UP-Worker und der `main`-Branch bleiben unberührt.

## Voraussetzungen

- Windows 10/11 mit PowerShell und Git
- Node.js 22 oder neuer (Node.js 24 funktioniert)
- Python 3.11 oder neuer für echte SQLite/D1-Schema-Regressionstests

Alle eingesetzten Tools sind kostenlos. Es ist **kein**
`npm install`, keine kostenpflichtige RPC-Anmeldung, kein
Trust Wallet Connect und keine Cloudflare-Anmeldung nötig.

## Ein Befehl für alle lokalen Tests

Im Terminal vom geklonten Repository:

```powershell
git fetch origin
git switch feature/self-hosted-crypto-payments
git pull --ff-only
cd payments
npm run test:local
```

Ausgabe: `PASSED` oder `FAILED`, fehlgeschlagener Teilschritt sowie
`.local-test-results/last-run.json` (wird von Git ignoriert).
Das Testskript nutzt nur die Node.js-/Python-Standardbibliotheken
und führt keine echte Krypto-Transaktion aus.

Wer zuerst nur die schnellen JavaScript-Tests möchte:

```powershell
npm run test:local:quick
```

Bei `FAILED` bitte den **Fehlertext** und den Abschnitt
`result` / `steps` aus der generierten JSON-Datei prüfen.
Darin sind keine Wallet-Secrets vorgesehen.

## Was ohne einen Cent simuliert wird

1. **BTC/ETH/TRX/USDT/TON:** Testtransaktionen und Netzwerkantworten
   ausschließlich als künstlich erzeugte Fixtures/Mocks. Mainnet wird
   nicht angesprochen.
2. **Blockchain-Sicherheit:** Falsche Empfangsadressen, Token-Verträge,
   zu kleine Zahlungen, unbestätigte Transaktionen, uneinige RPC-Anbieter,
   fehlerhafte TON-Indexer und potenzielle Reorgs werden getestet.
3. **E2E-Geldfluss:** Eine künstliche ETH-Zahlung wird von der echten
   Verifikationsfunktion als simulierte Chain-Antwort verarbeitet,
   im Test-Outbox gespeichert, per signiertem Webhook an den
   **lokal simulierten** Merchant-Worker geleitet und dort genau einmal
   als Testsaldo gebucht.
4. **Ausfall und Wiederholung:** Projekt-Webhook fällt aus und die
   persistente Retry-Logik liefert anschließend einmalig aus.
5. **Betrugsabwehr:** Veränderte signierte Zahlungsnachrichten dürfen
   nicht angenommen werden; laufende manuelle Reviews blockieren
   eine Auszahlungsmeldung.
6. **Projekt-Isolation, Limits, Kurse und Datenbankschema:**
   Bestehende Testfälle für getrennte Projekt-Schlüssel, Idempotenz,
   Rechnungswerte, SQLite-Constraints und sichere Migrationen.
7. **Bau der Bedienoberfläche:** Die isolierte Admin-Konsole und das
   Checkout-Modul werden statisch erzeugt. Das ist **kein Deployment**
   und schaltet keine Zahlungen frei.

Bei der lokalen E2E-Simulation wird jedes HTTP-`fetch` durch eine
Mock-Funktion abgefangen. Unbekannte Netzwerkadressen werden abgelehnt.
Die Produktionsimplementierung selbst wird hierfür **nicht** in einen
unsicheren Testnet-/Fake-Zahlungsmodus geschaltet.

## Stufenplan ohne Startkapital

**Phase 1 – vollständig offline (jetzt):** Syntax, komplette Regressionen,
SQLite-Migrationen, Blockchain-Mocks, signierte Webhooks, Buchungslogik,
Ausfallfälle und Bedienoberflächen-Build lokal prüfen.

**Phase 2 – lokale Infrastruktur (später, immer noch 0 € möglich):**
Eine getrennte lokale Cloudflare-Workers-/D1-Emulation
(`wrangler dev --local` mit eigener Testkonfiguration) aufsetzen.
Keine reale Wallet, keine Live-Schalter und keine produktiven Secrets
verwenden. Die heutige erste Phase benötigt Wrangler ausdrücklich nicht.

**Phase 3 – öffentliche Testnets (wenn gewünscht):** Testnet-Coins
über kostenlose Faucets erhalten, aber nur in **gesonderten**
Testnet-Wallets/Adaptern. Das derzeitige Payment-Verifikationssystem
ist **mainnet-pinned** und darf nicht nur durch Ändern einer RPC-URL
als Testnet-Gateway ausgegeben werden. Testnet-Abnahme benötigt
separaten Code und separate Konfiguration.

**Phase 4 – echter Betrieb (erst mit Ressourcen und Freigaben):**
Persönliche Wallet-Kontrolle, echte geringe Mainnet-Zahlungen,
belastbare unabhängige RPCs/Indexer, Backup-/Restore, Monitoring,
Lasttests, Sicherheits- und rechtliche Abnahme. Bis dahin bleibt
`MULTI_LIVE_ENABLED=false` und der Release-Gate **BLOCKED**.

**Wichtig für RUST UP:** Diese Phase testet nur den eigenständigen
Krypto-Provider und den simulierten Projekt-Webhook. Die bestehende
Telegram-Mini-App wird nicht verändert. Für digitale Güter innerhalb
einer Telegram Mini App dürfen externe Kryptozahlungen keine Umgehung
der Telegram-Stars-Vorgaben sein.
