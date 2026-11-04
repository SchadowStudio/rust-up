# TON / Toncoin – The Open Network (Telegram-Ökosystem)

**Stand:** Branch `feature/self-hosted-crypto-payments` des eigenständigen
Multi-Projekt-Krypto-Zahlungsproviders. Kein Deployment auf `main`.
Keine echten Kundenzahlungen aktiviert.

## TON ist NICHT TRON

- **TON (Toncoin):** The Open Network, eigenständige Blockchain, 9 Dezimalstellen
  (1 TON = 1 000 000 000 nanoTON).
- **TRON (TRX):** eigenes Netzwerk mit sechs Dezimalstellen.
- **USDT-TRC20:** TRON-Token; NICHT automatisch mit TON kompatibel.
- **USDT auf TON (Jetton):** **nicht** implementiert. Jettons benötigen
  eine gesonderte Contract-/Jetton-Wallet- und Finalitätsprüfung.
- Die Rechnung kann weiterhin in RUB, EUR oder USD erstellt werden;
  der Krypto-Zahlbetrag wird in TON berechnet.

## Sicherheitsarchitektur

1. **Nur TON Mainnet**: TON-adressformat mit CRC16-Prüfsumme nach TEP-0002.
   Testnet- und rohe prüfsummenlose Wallet-Adressen werden für neue
   Empfangsadressen abgelehnt. Bounceable-EQ-Adressen werden als
   nicht-bounceable-UQ-Adresse für denselben Mainnet-Account gespeichert.
2. **Nur öffentliche Wallet-Adressen** importieren. Keine Seed-Phrase,
   keine Private Keys und keine Auszahlungsberechtigungen.
3. **Pro Rechnung eine eigene, vorher unbenutzte Empfangsadresse**.
   Eine beliebige einzelne Telegram-/Trust-Wallet-Adresse unterstützt
   deshalb nicht unbegrenzt viele parallele Rechnungen.
4. **TON Center API v3-kompatible Transaktionsprüfung**:
   adressierte native Nachricht, NanoTON-Betrag als BigInt,
   keine zurückgeworfene Nachricht, keine emulierte/abgebrochene
   Transaktion, identische Transaktions-ID und bestätigte Einbindung
   in einen Mainnet-Masterchain-Block. Der zugehörige Shard-Block wird
   anhand seines Root-Hash und seiner Blockreferenz kontrolliert.
5. **Zwei unabhängige Anbieter müssen dieselben finalisierten
   Blockchain-Nachweise liefern** (2-von-3-Quorum).
   Ein Einzelanbieter-Ausfall kann toleriert werden; ohne Konsens
   erfolgt keine automatische Gutschrift.
6. **Atomare Projekt-/Adresszuordnung** und nur eine
   claimbare Transaktion pro Blockchain über alle Projekte.
7. **Signierter Webhook** an das entsprechende Projekt; vor jeder
   Auszahlungsmeldung wird der Zahlungsnachweis nochmals überprüft.
8. **RUB/EUR/USD zu TON** verwendet die bestehenden zwei unabhängigen
   Kursquellen (CoinGecko TON / CryptoCompare TON). Unsichere oder
   fehlende Kurse blockieren die Rechnung.

Die Implementation ist **nicht** ein kryptografischer TON-Lite-Client
mit vollständiger eigenständiger Merkle-Proof-Verifizierung.
Sie verlässt sich auf ein Quorum von voneinander unabhängigen
TON-Indexern. Für besonders hohe Beträge sollten darüber hinaus
geprüfte Lite-Client-Proofs und ein unabhängiges Sicherheits-Audit
eingesetzt werden.

## TON vor Live-Zahlungen einrichten

Zunächst in einer **privaten** Cloudflare-Staging-Umgebung:
- Migration `migrations/0017_ton_mainnet.sql` anwenden.
  Sie erhält vorhandene BTC/ETH/TRON-Projekt-Daten. Vor jeder
  produktiven Migration Datenbank-Backup und Restore-Test machen.
- Drei HTTPS-TON-Mainnet-Indexer mit unabhängiger Infrastruktur
  konfigurieren. Bei TON Center v3 übliche Base-URL
  `https://provider.example/api/v3`.
- Secrets:
  `TON_INDEXER_URL`, `TON_INDEXER_URL_SECONDARY`,
  `TON_INDEXER_URL_TERTIARY`; optional separate
  `TON_INDEXER_API_KEY`, `TON_INDEXER_API_KEY_SECONDARY`,
  `TON_INDEXER_API_KEY_TERTIARY`.
  Keine Secrets in GitHub eintragen.
- `MULTI_TON_ENABLED` bleibt **false** bis zum Abschluss des
  Wallet-Kontrolltests, der Mainnet-Indexerverifikation und einer
  vollständig bestätigten kleinen Testzahlung.
- Per Projekt TON in den Zahlungsregeln aktivieren. Neue Projekte
  starten mit deaktivierten Zahlungsmethoden.

Einrichten ohne Provider-Website:

```powershell
git switch feature/self-hosted-crypto-payments
cd .\payments
npm run validate
npm run operator -- wallet-setup-plan
npm run operator -- address-add ton DEINE_GUELTIGE_EQ_ODER_UQ_TON_ADRESSE --confirm
npm run operator -- address-list
```

Nach der Mainnet-Kontrolle und einer Testüberweisung:

```powershell
npm run operator -- address-enable ton DEINE_TON_EMPFANGSADRESSE --confirm
npm run operator -- project-crypto DEINE_PROJEKT_UUID TON true --confirm
```

Der Operator muss dazu privat seine `PAYMENTS_ADMIN_URL` und
`PAYMENTS_ADMIN_KEY` eingerichtet haben. Auch die
`MULTI_TON_ENABLED`-Freigabe muss im eigenen Worker ausdrücklich
aktiviert sein; sonst wird die Projektfreigabe abgelehnt.

Alternativ lassen sich 1 bis 25 öffentliche Wallet-Adressen über
`wallet-import-public` atomar und deaktiviert hinterlegen.
**TON Connect** kann später bei Bedarf für eine explizite
Wallet-Verbindung integriert werden. Der aktuelle Headless-Provider
fordert hingegen nie eine Signatur an und kann keine Wallet
automatisch aus privaten Schlüsseln generieren.

## Verifikation und automatische Zahlungserkennung

- `POST /v2/deposits` erstellt eine TON-Einzahlungsrechnung nach
  Freischaltung und gültigem serverkontrollierten Kurs.
- `GET /v2/invoices/{id}` zeigt Empfangsadresse, NanoTON-Betrag und Status.
- Der TON-Scanner entdeckt relevante native Überweisungen über
  den Indexer; der Fund ist nur ein **Hinweis**, keine Freigabe.
- Die unabhängige Quorum-Prüfung bestätigt die Zahlung.
- Signierter Webhook und projekteigener Idempotenzschutz verhindern
  mehrfache Gutschriften nach Zustellungswiederholung.
- Teilzahlungen sind nur mit der separaten,
  standardmäßig deaktivierten Teilzahlungsfunktion verfügbar.

## Noch offene Produktionsvoraussetzungen

Keine tatsächlichen TON-Mainnet-Zahlungen auf deinem Wallet getestet,
keine TON-Indexer/Cloudflare-Produktionsumgebung verbunden, keine
großangelegten Last- oder Recovery-Tests bestanden. Daher **kein
Go-live**.

Wenn TON in einer Telegram Mini App selbst integriert wird, verlangen
die Telegram-Bot-Plattformregeln für Krypto-Wallet-Funktionalität
TON Connect. Für digitale Güter innerhalb von Mini Apps gelten
außerdem die Telegram-Stars-Zahlungsvorgaben. Unser Provider ist
vorerst ein **eigenständiger Zahlungsdienst außerhalb von Telegram**.

Offizielle technische Referenzen:
- https://docs.ton.org/api/v3/blockchain-data/get-transactions
- https://docs.ton.org/api/v3/blockchain-data/get-blocks
- https://docs.ton.org/applications/payments/overview
- https://github.com/ton-blockchain/TEPs/blob/master/text/0002-address.md
