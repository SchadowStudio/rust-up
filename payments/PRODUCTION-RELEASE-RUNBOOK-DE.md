# RUST UP Payments V2 — Produktions-Runbook

**Status: RELEASE BLOCKED.** Entwicklungsbranch
`feature/self-hosted-crypto-payments`. Das vorhandene RUST-UP-Produktivsystem
wird nicht verändert.

## 1. Vorbereitete Software

- Eigenes Projekt-Onboarding mit zufälligen Schlüsseln und Whitelist
  zulässiger Projekt-Webhook-Domains.
- Drei Rechnungswährungen: RUB, EUR, USD (jeweils Minor Units).
- BTC, ETH, TRX, USDT-ERC20, USDT-TRC20. Jede Kryptowährung wird ausschließlich
  auf der passenden Chain geprüft.
- Zwei unabhängige Kursquellen, BigInt-Rechnung, ablaufende Quotes.
- D1-Rechnungstransaktionen und einmalige Blockchain-Transaktionszuordnung.
- D1-Mandantenkontingente gegen gleichzeitige Rechnungserstellung.
- Persistenter Outbox mit signierten, projektindividuellen Webhooks,
  Quittungsprüfung und Retry.
- Empfängerpool: öffentliche Trust-Wallet-Adressen, ohne Seed/Private Keys.
- Betreiberkonsole, allgemeine Checkout-Komponente für externe Projekte.
- Manuelle Prüfungen für Teil-/Spätzahlungen.
- Optional Cloudflare Queue + Dead-Letter-Queue, zusätzlich Polling-Fallback.
- Testabdeckung mit Node.js- und SQLite-Regressionstests.

## 2. Aktuell offene Produktionsblocker

**Eine Freigabe darf erst erfolgen, wenn alle Punkte tatsächlich abgenommen
wurden:**

1. Eigener Cloudflare-Account mit Workers, D1 und Queues verbunden.
2. Produktive Domain, isoliertes Betreiberportal und Cloudflare Access/MFA.
3. Stark zufälliger Betreiber-Schlüssel, pro Projekt separater API-Schlüssel;
   Cloudflare Secrets vollständig konfiguriert.
4. Unabhängige HTTPS-RPC-Provider oder eigene gesicherte Bitcoin-, Ethereum-
   und TRON-Knoten. Bitcoin Watch-only-Wallet und TRON Solidity Node.
5. Belastbare, eigene Blockchain-Indexer für hohe Last eingerichtet; Cron-
   Polling alleine ist kein Hochlast-Indexer.
6. Deine Trust-Wallet-Verbindung autorisiert und Empfangsadressen je Chain
   kontrolliert. BTC/TRON-Adressimport und reale Adressprüfung erledigt.
7. Ausreichend **eindeutige, unbenutzte Empfangsadressen** für alle erwarteten
   gleichzeitigen Rechnungen nachweislich verfügbar. Trust Wallet allein
   erzeugt dafür derzeit keine automatische serverseitige HD-Poolversorgung.
8. Eigenes Zielprojekt-Backend vorhanden, das jede signierte Zahlung
   idempotent im eigenen Ledger verbucht. Bestehender RUST UP Worker fehlt.
9. Vollständige Rückerstattungs-, Teilzahlungs- und Reorg-Bearbeitung
   einschließlich betreiberseitiger Nachweise im Staging durchgespielt.
10. Zwei aktuelle, konsistente Marktdatenquellen und eine dokumentierte
    Störfallstrategie für abgelaufene oder widersprüchliche Kurse.
11. D1-Wiederherstellung und verschlüsselte Offsite-Backups erfolgreich
    getestet; RTO/RPO festgelegt.
12. Queue-Stau, RPC-Ausfall, Webhook-Ausfall und verlorene Bestätigungen
    unter Last und nach Wiederanlauf getestet.
13. Penetrationstest, Schlüsselrotation, Webhook-Hostschutz und
    Lasttest mit definierten p95/p99-Latenzen abgeschlossen.
14. Eigene Projektdomain und rechtliche/Plattform-Freigaben überprüft.
    Innerhalb einer Telegram Mini App sind digitale Güter grundsätzlich
    mit Telegram Stars zu bezahlen.
15. Betreiber schaltet Checkout **erst nach** allen Abnahmetests frei.

## 3. Lokale Prüfung (Windows PowerShell)

```powershell
git switch feature/self-hosted-crypto-payments
cd .\payments
npm run validate
npm run build:operator
npm run build:checkout
python -m unittest discover -s tests -p 'schema*_test.py' -v
```

Die statischen Build-Ordner `dist-admin/` und `dist-checkout/` enthalten
keine Operator- oder Projekt-API-Schlüssel.

## 4. Neue Cloudflare-Staging-Installation

Nur auf **deinem eigenen Cloudflare-Account**:

```powershell
npm install -g wrangler
npx wrangler login
cd .\payments
Copy-Item .\wrangler.multi.toml.example .\wrangler.multi.toml
Copy-Item .\wrangler.multi.fx.toml.example .\wrangler.multi.fx.toml
npx wrangler d1 create rustup-multi-payments-staging
```

Die zurückgegebene D1-Datenbank-ID in **beide** unversionierten
Wrangler-Dateien eintragen. Danach:

```powershell
npx wrangler d1 migrations list rustup-multi-payments-staging --remote --config wrangler.multi.toml
npx wrangler d1 migrations apply rustup-multi-payments-staging --remote --config wrangler.multi.toml
npx wrangler deploy --config wrangler.multi.toml --dry-run
```

Für echte, zunächst weiterhin deaktivierte Staging-Worker muss der
Accountinhaber die Deployments ausführen. Die Queues
`rustup-multi-events` und `rustup-multi-dead-letter` vorher anlegen,
damit die Consumer-Bindings gültig sind.

**Standardmäßig stehen alle Zahlungs-Flags auf `false`.**
Den Betreiberzugang und die Kurse erst nach Einrichtung aller Secrets
aktivieren, `MULTI_LIVE_ENABLED` bis zur vollständigen Abnahme auf
`false` belassen.

Benötigte Secrets:

- `MULTI_ADMIN_KEY` – langes, zufälliges Betreibergeheimnis.
- `MULTI_WEBHOOK_MASTER_KEY` – eigener geheimer Schlüssel
  für projektindividuelle HMAC-Zustellung.
- `ETHEREUM_RPC_URL`, `TRON_RPC_URL`,
  `TRON_INDEXER_URL`, `BITCOIN_RPC_URL`,
  `BITCOIN_RPC_BASIC_B64`, `BITCOIN_START_BLOCKHASH`.
- Separater Kurs-Worker: `COINGECKO_DEMO_KEY`,
  `CRYPTOCOMPARE_API_KEY`.

Keine Secrets in GitHub, Screenshots oder Chatnachrichten einfügen.

## 5. Trust Wallet

Im HTTPS-Operator-Portal `/multi-admin/` auf **deiner** Domain:

- Trust-Wallet-Erweiterung erkennen und mit EIP-6963 öffentliche
  Ethereum-Adresse freigeben.
- BTC-/TRON-Empfangsadressen separat aus deinem Wallet kopieren.
- Netzwerke und Prüfsummen automatisch prüfen, Adressen zunächst
  deaktiviert speichern.
- Adresse nur nach einem selbst kontrollierten Empfangstest aktivieren.
- Bitcoin-Adressen zusätzlich in Bitcoin Core watch-only importieren.
- Für parallele Aufträge viele unterschiedliche Empfangsadressen vorhalten.
  Keine geteilten Kundenadressen verwenden.
- Die Plattform kann keine Gelder senden: Auszahlungen/Refunds erfordern
  manuelle Wallet-Autorisierung auf deinem Gerät.

## 6. Betrieb und Krisenplan

Für D1-Backups (sicheres lokales Ziel, anschließend verschlüsselt ablegen):

```powershell
npx wrangler d1 export rustup-multi-payments-staging --remote --output .\private-staging-backup.sql --config wrangler.multi.toml
```

Wiederherstellung vor Echtbetrieb in eine **separate** Test-Datenbank
proben. Bei Service- oder Kursausfall keine neuen Rechnungen ausstellen.
Bestehende Rechnungen weiterhin nachvollziehbar halten, Queue-Retries
fortführen und den Status in der Betreiberkonsole überwachen.

Alarmieren bei:

- Versandfehlern, DLQ-Nachrichten und langer Webhook-Queue.
- Teilzahlungen, verspäteten Zahlungen, fehlerhaften Chain-Receipts,
  Kettenreorganisationen und unstimmigen Kursen.
- Kaum verbleibenden freien Empfangsadressen.
- Mehr als fünf Zustellungsversuchen einer Gutschrift.
- D1-Fehlern und fehlenden RPC-Daten.

Eine „erfolgreiche“ Zahlung und eine „im Projekt gebuchte“ Zahlung
sind unterschiedliche Zustände. Der Benutzer darf erst nach bestätigter
Gutschrift als versorgt gelten.

## 7. Lasttest-Akzeptanzkriterien

Keine unbelegten Versprechen zu „unbegrenzten Spielern“ oder
„100 % Ausfallsicherheit“. Im Staging muss ein reales Zielprofil
definiert und gemessen werden: Requests/Sekunde, gleichzeitige
Rechnungen, verfügbare Adressen, Datenbank-Query-Latenz, signierte
Webhook-Zustellung und Wiederherstellung nach Ausfall. Einzelne D1-
Datenbanken haben feste Durchsatz- und Größenlimits; bei großem
Volumen getrennte Datenbanken pro Projekt/Region evaluieren.

**Go/No-Go:** Kein Geldverkehr ohne persönliche Wallet-Verbindung,
eigenen Worker, sichere Zielprojekt-Gutschrift und kontrollierte Tests.
