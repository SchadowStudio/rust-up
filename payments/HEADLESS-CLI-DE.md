# RUST UP Krypto-Provider – OHNE Website betreiben

Der Zahlungsprovider kann vollständig **headless** betrieben werden:
keine öffentliche Provider-Website, kein Web-Dashboard, keine Kundenkonten
auf dem Provider. Es bleibt ein HTTPS-API-Backend mit Cloudflare Workers,
D1, Cron Triggers und optional Cloudflare Queues.

**Status:** Entwicklung, nicht live. `main` bleibt unverändert. Die
Cloudflare-Konten, deine Trust-Wallet-Empfangsadressen und die angeschlossenen
Projektserver müssen später tatsächlich eingerichtet und getestet werden.

## Architektur

```text
Projekt A ─┐
Projekt B ─┼──> zentrale Payment-API ──> D1 + Chain RPC/Indexer
Projekt C ─┘            │                       │
                        │             Bitcoin/Ethereum/TRON
                        │                       │
                        └─ signierter Webhook ───┴─> Projekt A/B/C

Besitzer (Windows PowerShell / Terminal)
              │
              └── operator CLI ──> dieselbe geschützte Payment-API

Trust Wallet (nur auf DEINEM Gerät)
              │
              └── öffentliche Empfangsadressen von BTC, ETH und TRON
```

Kein Provider-Frontend ist notwendig. Ein angeschlossenes Projekt
kann den Kunden seine Rechnung in dessen eigener App, Website oder
Bot anzeigen. **Die HTTP-API ist trotzdem erforderlich**, damit das
Projekt Rechnungen erstellt, Status prüft und Webhooks empfängt.

## Ersteinrichtung auf Windows

```powershell
git switch feature/self-hosted-crypto-payments
cd .\payments
npm run validate

# Das Gateway ist eine Cloudflare-Worker-Adresse, keine Website.
$env:PAYMENTS_ADMIN_URL = "https://DEIN-WORKER.DEINE-DOMAIN"
```

Den Operator-Schlüssel niemals in der Befehlszeile als Argument angeben.
Du kannst ihn interaktiv in eine Umgebungsvariable für **diese**
PowerShell-Sitzung laden:

```powershell
$secureKey = Read-Host "Operator-API-Schlüssel" -AsSecureString
$handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $env:PAYMENTS_ADMIN_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle)
}
```

Umgebungsvariablen sind für Kindprozesse wie Node.js sichtbar.
Deshalb ein privates Gerät, keine gemeinsam genutzte Shell und kein
Terminal-Logging verwenden. Nach der Verwaltung:

```powershell
Remove-Item Env:\PAYMENTS_ADMIN_KEY
```

## Projektverwaltung ohne Website

Alle Befehle sind im Ordner `payments/` auszuführen.

```powershell
# Gesamtstatus + Projekte
npm run operator -- status
npm run operator -- projects

# Ein NEUES Projekt (zunächst deaktiviert) hinzufügen
npm run operator -- project-create "Rust Up" "https://projekt.example.com/internal/crypto/credit" --confirm

# Erzeugte Projekt-ID, API-Key und Webhook-Signaturschlüssel an einem
# sicheren Ort speichern. Das Terminal gibt die Geheimnisse EINMAL aus.
npm run operator -- project-config <PROJECT_UUID>

# Einzahlungen erlauben; Produktkäufe bleiben optional deaktiviert.
npm run operator -- project-profile <PROJECT_UUID> "Rust Up" true true false 15 --confirm

# Genau die erlaubten Fiat-Währungen für dieses Projekt aktivieren
npm run operator -- project-fiat <PROJECT_UUID> RUB true 100 100000000 --confirm
npm run operator -- project-fiat <PROJECT_UUID> EUR true 100 100000000 --confirm
npm run operator -- project-fiat <PROJECT_UUID> USD true 100 100000000 --confirm

# Coins/Netze jedes Projekt einzeln konfigurieren
npm run operator -- project-crypto <PROJECT_UUID> BTC true --confirm
npm run operator -- project-crypto <PROJECT_UUID> ETH true --confirm
npm run operator -- project-crypto <PROJECT_UUID> TRX true --confirm
npm run operator -- project-crypto <PROJECT_UUID> USDT_ERC20 true --confirm
npm run operator -- project-crypto <PROJECT_UUID> USDT_TRC20 true --confirm

# Projekt erst nach Integrationstests aktivieren
npm run operator -- project-enable <PROJECT_UUID> --confirm

# Sicherheit und Support
npm run operator -- project-summary <PROJECT_UUID>
npm run operator -- project-payments <PROJECT_UUID> verified
npm run operator -- project-keys <PROJECT_UUID>
npm run operator -- project-key-create <PROJECT_UUID> --confirm
npm run operator -- project-key-revoke <PROJECT_UUID> <KEY_UUID> --confirm
npm run operator -- project-disable <PROJECT_UUID> --confirm
npm run operator -- reviews
```

Alle Änderungen werden dem ausgewählten Projekt zugeordnet, mit
`--confirm` bestätigt und im System protokolliert.

## Trust Wallet ohne Website

Der Provider benötigt **keine Browser-Wallet-Verbindung**. Du öffnest
Trust Wallet nur auf deinem Handy oder in der offiziellen Browser-Erweiterung
und kopierst **öffentliche Empfangsadressen**. Geheimnisse bleiben im Wallet.

```powershell
npm run operator -- address-add ethereum 0xDEINE_OEFFENTLICHE_ETH_ADRESSE --confirm
npm run operator -- address-add bitcoin DEINE_OEFFENTLICHE_BTC_ADRESSE --confirm
npm run operator -- address-add tron DEINE_OEFFENTLICHE_TRON_ADRESSE --confirm

npm run operator -- address-list
# Nach kontrollierter Empfangsprobe Adressen gezielt freischalten:
npm run operator -- address-enable tron DEINE_OEFFENTLICHE_TRON_ADRESSE --confirm
```

- ETH und USDT-ERC20: Ethereum-Adresse (Ethereum Mainnet).
- TRX und USDT-TRC20: TRON-Adresse (TRON Mainnet).
- BTC: Bitcoin-Adresse (Bitcoin Mainnet), zusätzlich in eigener
  Bitcoin-Core-Watch-only-Wallet registrieren.
- Jede Rechnung benötigt eine **zuvor unbenutzte** öffentliche
  Empfangsadresse. Eine einzige Trust-Wallet-Adresse reicht deshalb
  nicht für beliebig viele gleichzeitige neue Rechnungen.
- Niemals Seed Phrase, Private Key oder Auszahlungsberechtigung
  in den Provider oder in die Shell eintragen.

## Wie Kunden bezahlen

Das angebundene Projekt ruft **serverseitig** die Payment-API auf:

```http
POST /v2/deposits
Authorization: Bearer <PROJEKT_API_KEY>
X-Project-Id: <PROJEKT_UUID>
Idempotency-Key: <ZUFALLS_UUID>
Content-Type: application/json

{
  "currency": "EUR",
  "amountMinor": 2500,
  "asset": "USDT_TRC20",
  "projectOrderRef": "<ZUFALLS_UUID>"
}
```

Der Server antwortet mit dem eingefrorenen Krypto-Betrag, einer
öffentlichen Empfangsadresse, Netzwerk und Ablaufzeit. **Fiat ist
nur Rechnungswährung**, die Überweisung erfolgt in Krypto.
Andere Projekte können RUB und USD akzeptieren.

Später meldet ein signierter, wiederholbarer HTTPS-Webhook dem
Projekt die bestätigte Blockchain-Einzahlung. Nur das Projekt
entscheidet, was daraufhin gutgeschrieben oder ausgeliefert wird.

## Was weiterhin eingerichtet/getestet werden muss

Der CLI-Code kann ohne eigene Website betrieben werden, aber ein
produktiver Provider ist noch nicht einfach durch diesen Quellcode
gegeben. Erfordert: eigene Cloudflare-Worker-/D1-/Queue-Installation,
sichere Blockchain-RPC- und Indexer-Verbindungen, verifizierte
Trust-Wallet-Empfangsadressen, echte Testzahlungen, projektseitige
Webhook-Verarbeitung, Offsite-Backup, Wiederherstellungstest und
Überwachung der Infrastruktur.

Vor Freigabe **keine echten Kundeneinzahlungen** ermöglichen.
Für digitale Güter in Telegram Mini Apps gelten zudem die
Telegram-Stars-Plattformvorgaben.
