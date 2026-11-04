# RUST UP — Trust Wallet / Krypto-Zahlungsdienst einrichten (Windows)

**GitHub-Branch:** `feature/self-hosted-crypto-payments`

**Aktuell: Entwicklung und Tests. Kein produktiver Zahlungsempfang.**
Der bestehende RUST-UP-Cloudflare-Worker gehört nicht zu diesem Repository.
`main` und die laufende Telegram-App bleiben unverändert.

## A. Lokal entwickeln und testen

In PowerShell im bereits ausgecheckten Branch:

```powershell
cd .\payments
npm run validate
npm run build:operator
```

Das erzeugt `payments/dist-admin/` mit einer separat veröffentlichbaren
Verwaltungsoberfläche, ohne Cloudflare-Worker-Quellcode oder Secrets zu kopieren.

## B. Eigene Cloudflare-Umgebung (noch ausstehend)

Du benötigst einen eigenen Cloudflare-Zugang. Der bisherige Besitzer muss
keinen Zugang zu seinem Worker herausgeben, aber ohne die ursprüngliche
Spieldatenbank können alte Guthaben nicht übernommen werden.

```powershell
npm install -g wrangler
wrangler login
cd .\payments
wrangler d1 create rustup-crypto-staging
```

Kopiere `wrangler.toml.example` nach `wrangler.toml`, trage die zurückgegebene
D1-ID ein, und wende die Migrationen an:

```powershell
Copy-Item .\wrangler.toml.example .\wrangler.toml
wrangler d1 migrations apply rustup-crypto-staging --remote
```

Die Datenbank enthält Rechnungen, Zahlungs- und Prüfprotokolle, öffentliche
Empfangsadressen und Gutschrift-Ereignisse. **Keine privaten Schlüssel.**

## C. Zugangsdaten als Cloudflare Secrets

Erstelle für den **Betreiberzugang** lokal einen zufälligen Geheimwert von
mindestens 256 Bit (z. B. in einem Passwortmanager). Keine Secrets nach GitHub,
Telegram, in Screenshots oder in diesen Chat kopieren.

```powershell
wrangler secret put OPERATOR_API_KEY
wrangler secret put TG_BOT_TOKEN
wrangler secret put ETHEREUM_RPC_URL
wrangler secret put TRON_RPC_URL
wrangler secret put BITCOIN_RPC_URL
wrangler secret put BITCOIN_RPC_BASIC_B64
wrangler secret put GAME_LEDGER_WEBHOOK_URL
wrangler secret put GAME_LEDGER_SIGNING_KEY
```

Weitere Konfiguration: `TRON_RPC_API_KEY`, `BITCOIN_START_BLOCKHASH`,
`ETHEREUM_START_BLOCK` und die zwei echten USDT-Mainnet-Vertragsadressen.

Achtung: `TG_BOT_TOKEN` musst du von einem Telegram-Bot bekommen, den du selbst
kontrollierst. Zugriff auf den Telegram-**Kanal** allein reicht dafür nicht.

Der Bitcoin-Core-JSON-RPC-Endpunkt muss geschützt und über HTTPS erreichbar
sein, mit Watch-only-Adressen, nicht mit deinen Trust-Wallet-Private-Keys.

## D. Trust Wallet verbinden

1. Veröffentliche `payments/dist-admin` als eigene private/zugriffsgeschützte
   Cloudflare-Pages-Seite. Setze diese HTTPS-Adresse als `OPERATOR_ORIGIN`.
2. Öffne unter der veröffentlichten URL `/admin/` die Verwaltung.
3. Trage deine eigene Worker-URL und deinen Betreiber-Schlüssel ein.
   Der Schlüssel wird nicht im Browser-Storage gespeichert.
4. Klicke **Trust Wallet verbinden**. Bestätige in der offiziellen
   Trust-Wallet-Erweiterung die Verbindung für Ethereum Mainnet.
   Das System übernimmt **nur deine öffentliche ETH-Adresse**.
5. Für TRON und Bitcoin kopierst du die jeweilige **Empfangsadresse**
   direkt aus Trust Wallet in das Netzwerkauswahlfeld. Nicht deine
   Recovery Phrase, nicht den Private Key.
6. Klicke **Adresse deaktiviert hinzufügen**. Prüfe die Netzwerkzuordnung
   und führe einen kleinen kontrollierten Test durch.
7. BTC-Adressen zusätzlich mit `scripts/register-bitcoin-address.mjs`
   in deine getrennte Bitcoin-Core-Watch-only-Wallet importieren.
8. Erst danach die Adresse im Operator-Dashboard freigeben.

Hinweis: Für parallele Zahlungen mehrerer Kunden sind mehrere verschiedene
Empfangsadressen nötig. Eine einzige Trust-Wallet-Adresse wird absichtlich
nicht für mehrere Kundenrechnungen wiederverwendet. Für BTC/ETH/TRON musst
du die Adressen selbst kontrollieren; der Server kann sie ohne deine
Wallet nicht eigenständig erzeugen.

## E. Krypto-Angebote verwalten

Im Operator-Dashboard kannst du jetzt neue Pakete in **Kopeken**
(100 ₽ = 10000 Kopeken) anlegen und feste Kryptobeträge hinterlegen.
BTC, ETH, TRX, USDT-ERC20 und USDT-TRC20 sind getrennte Assets.
Neue Beträge und Pakete sind standardmäßig deaktiviert, damit keine
alten Preise versehentlich weiterverkauft werden.

Aktive Pakete werden nur aus der serverseitigen D1-Datenbank abgerufen.
Der Browser darf keine Preise, Wallet-Adressen oder Gutschriften bestimmen.

## F. Eigene Blockchain-Knoten und Überwachung

Die optionalen Scanner erkennen Zahlungstransaktionen aus folgenden Quellen:

- BTC: Bitcoin-Core-Wallet-RPC `listsinceblock`, mit 3 oder mehr Bestätigungen.
- ETH: Ethereum-Mainnet-RPC für native Transfers, 12 Bestätigungen.
- USDT-ERC20: Ethereum-Mainnet-USDT-Transfer-Logs, 12 Bestätigungen.
- TRX: bestätigte TRON-Empfängertransaktionen und TRON-Solidity-RPC.
- USDT-TRC20: bestätigte TRON-Token-Transfers und TRON-Solidity-RPC.

**Jeder erkannte Eingang wird erneut geprüft**, bevor die Rechnung als
verifiziert markiert wird. Zahlungen nach Ablauf werden zur manuellen
Nachprüfung festgehalten. Es gibt keine automatische Rückzahlung.

`CRYPTO_AUTO_SCAN_ENABLED=false` ist der sichere Default.

## G. Spielgutschrift / Produktivfreigabe

Die bestehende Mini App verwendet einen fremden Cloudflare Worker.
**Ohne dessen Quellcode und sicheren Spiel-Ledger-Endpunkt kann kein
echter gekaufter Ingame-Betrag gutgeschrieben werden.**

Der Dienst enthält eine signierte, idempotente Outbox-Schnittstelle, aber
noch keinen angebundenen Original-Spiel-Ledger-Consumer. Auch nach
Blockchain-Bestätigung zeigt er deshalb `creditedToGame:false`.

Der Kundenzahlungs-Checkout bleibt durch neun plus weitere technische
Readiness-Prüfungen geschlossen. Insbesondere müssen
`GAME_LEDGER_DELIVERY_ENABLED`, `CRYPTO_AUTO_SCAN_ENABLED` und
`OWNER_APPROVED_PRODUCTION` explizit gesetzt werden; Schlüssel, Endpunkte
und alle erforderlichen Mainnet-RPC-Verbindungen müssen existieren.

**Telegram-Regel:** Eine Telegram Mini App darf digitale Spielgüter und
digitales Spielguthaben nicht mit Krypto statt Telegram Stars verkaufen.
Die Krypto-Implementierung ist daher als eigenständiger Dienst getrennt.
Ihre Nutzung darf nicht als Umgehung dieser Plattformregeln dienen.

## H. Abnahme

```powershell
cd .\payments
npm run validate
npm run build:operator
```

Danach Cloudflare-Staging mit Test-Wallets und kleinen kontrollierten
Überweisungen testen. Einschließlich BTC/ETH/TRX/USDT auf dem richtigen
Netzwerk, Bestätigungen, falscher Adresse, doppelter Zahlung,
verspäteter Zahlung, Netzwerkstörungen, Operator-Rechten, Reorgs,
fehlgeschlagenen Gutschriften, idempotenter Retries und Support.

Produktivbetrieb ist erst nach der tatsächlich verbundenen Wallet,
korrekter Infrastruktur und überprüfter Spielgutschrift möglich.
