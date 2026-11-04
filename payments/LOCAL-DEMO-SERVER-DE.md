# RUST UP Crypto Provider – Phase 2: kostenloser lokaler Zahlungstestserver

**Status: REINE SIMULATION. Nie mit echten Geldern benutzen.**
Kein Blockchain-RPC, keine Krypto-Empfangsadresse, keine private Wallet,
kein Telegram Stars und keine produktive RUST-UP-Guthabenbuchung.

Der Demo-Server nutzt den lokalen Loopback-Host `127.0.0.1`, eine lokale
SQLite-Testdatenbank und **dieselbe signierte V2-Webhook- und
Merchant-Ledger-Implementierung**, die auch der Provider verwendet.
Er erzeugt lediglich künstliche Zahlungsbestätigungen. Ein Simulationserfolg
ist kein echter Blockchain-Beweis.

## Schritt 1: Projekt aktualisieren

In deinem RUST-UP-Ordner (Windows PowerShell):

```powershell
cd "$HOME\RUST-UP-Local"
git switch feature/self-hosted-crypto-payments
git pull --ff-only
cd payments
npm run test:local
```

Node.js 24 und Python genügen; `npm install`, Wrangler, Cloudflare,
Docker und Wallets sind nicht erforderlich.

## Schritt 2: Lokalen Testserver starten

**PowerShell-Fenster 1** (in `payments`):

```powershell
npm run demo:local
```

Erwartet:

```text
RUST UP: LOCAL SIMULATION ONLY, NO REAL FUNDS
Local server: http://127.0.0.1:3029
Test-only credentials: .local-test-results/local-demo-credentials.json
Run in a NEW PowerShell window: npm run demo:local:check
```

Das Fenster offen lassen. Nur auf diesem Windows-PC ist der Server
über `127.0.0.1:3029` erreichbar; nicht über das Internet.

## Schritt 3: Komplette simulierte Zahlung ausführen

**PowerShell-Fenster 2:**

```powershell
cd "$HOME\RUST-UP-Local\payments"
npm run demo:local:check
```

Der Testclient führt über localhost selbständig aus:

1. Healthcheck: keine echten Zahlungen aktiv.
2. Prüfen, dass Anfragen ohne Projektschlüssel abgewiesen werden.
3. Künstliche EUR-25,00-Rechnung mit ETH als **Testetikett** erstellen.
4. Gleiche Rechnungsanfrage wiederholen: dieselbe Invoice wird geliefert.
5. Simulierte Zahlung nur über den **lokalen Operator-Testendpunkt**
   bestätigen – es erfolgt kein Transfer.
6. V2-Webhook mit dem echten HMAC-Signierer erzeugen und **intern** an
   den tatsächlichen Beispiel-Merchant-Worker übergeben.
7. SQLite-Merchant-Guthaben im Testkonto um 2500 Cent erhöhen.
8. Webhook wiederholen: keine zweite Buchung derselben Rechnung.
9. Rechnung, Ereignisliste und Ledgerstatus abfragen.

Erwartetes Ergebnis: `LOCAL DEMO PASS`.

Die Datenbank liegt unter `.local-test-results/local-demo.sqlite`.
Testschlüssel werden ausschließlich in
`.local-test-results/local-demo-credentials.json` gespeichert.
Beide Dateien sind Git-ignoriert und dürfen nicht veröffentlicht werden.
Sie sind nur Testschlüssel, keine echten Produktionsschlüssel.

## Was die Schnittstelle demonstriert

- `GET /health` ohne Schlüssel
- `GET /v2/me` mit `Authorization: Bearer <projectApiKey>` und
  `X-Project-Id`
- `POST /v2/deposits` mit `Idempotency-Key`
- `GET /v2/invoices/:id` und `GET /v2/events` mit Projektschlüssel
- `POST /demo/invoices/:id/simulate-confirmation` nur mit
  `X-Local-Operator`; **diesen Endpoint gibt es nicht im Live-Provider**
- `GET /demo/merchant/balance` für Testkontostände

Die lokale Demo-API ist bewusst nur ein **simulierter Vertrag** des
echten V2-Providers; sie ruft weder die produktive Worker-API noch
Mainnet-/Testnet-RPCs auf. Insbesondere `receiveAddress=null`,
`amountAtomic=null`, `confirmedOnChain=false` und
`simulationOnly=true`. Die Testnachricht `verified` bedeutet nur,
dass im **Demo** eine künstliche Bestätigung ausgelöst wurde.

Die echte Merchant-Buchungsimplementierung und ihre Signaturprüfung
werden dennoch direkt ausgeführt. Der Demo-Schlüssel darf niemals für
eine echte Projektbuchung akzeptiert werden.

## Stoppen / zurücksetzen

- In Fenster 1: `Strg+C`.
- Lokale Testdaten können bei gestopptem Server entfernt werden:

```powershell
Remove-Item ".\.local-test-results\local-demo.sqlite" -ErrorAction SilentlyContinue
Remove-Item ".\.local-test-results\local-demo-credentials.json" -ErrorAction SilentlyContinue
```

## Was danach folgt

Die originale RUST-UP-Bestellverwaltung kann zunächst gegen die **lokale
Demo-Schnittstelle** getestet werden, ohne dass echte Zahlungen oder
Spielerguthaben entstehen. Stars bleiben eine separate Integration in
RUST UP selbst.

Echte Krypto-Zahlungen erfordern später verifizierte Wallet-Kontrolle,
RPC-Quorum, deployment, Echtgeld-Eingangsprüfungen, rechtliche
Freigaben und sichere Merchant-Gutschriften. Eine Freigabe allein aufgrund
dieser lokalen Tests wäre gefährlich. Bei digitalen Käufen in Telegram
Mini Apps bleibt die Telegram-Stars-Pflicht maßgeblich.
