# Krypto-Assets und Wallet-Einrichtung – sicher und erweiterbar

**Status:** Entwicklungsbranch `feature/self-hosted-crypto-payments`.
Kein Echtgeldbetrieb. Keine Wallet wurde in diesem Chat tatsächlich
verbunden. Der Provider bleibt ohne öffentliche Website nutzbar.

## 1. Was „Wallet verbinden“ sicher bedeuten kann

Der Betreiber kann ausschließlich **öffentliche Empfangsadressen**
hinterlegen. Der Zahlungsprovider hat keine Fähigkeit, Gelder zu versenden,
Wallets zu entsperren oder Seed-Phrases zu lesen.

- ETH und USDT-ERC20 teilen sich den **Ethereum-Adressraum**.
- TRX und USDT-TRC20 teilen sich den **TRON-Adressraum**.
- BTC benötigt eine **Bitcoin-Mainnet-Empfangsadresse**.
- Damit sind die bisherigen fünf Zahlungsverfahren über drei
  Empfangsnetzwerke organisiert. Es entstehen nicht fünf geheime
  Wallets im Provider.
- Für jede neue Rechnung wird derzeit **eine unbenutzte Empfangsadresse**
  beansprucht, anschließend wird sie nie wieder für eine neue Rechnung
  freigegeben. Viele parallele Einzahlungen erfordern einen überprüften
  Vorrat unterschiedlicher öffentlicher Adressen.

### Option A: Trust Wallet über private Betreiberoberfläche (optional)

Die vorhandene private Betreiberoberfläche kann die offizielle
Trust-Wallet-Ethereum-Erweiterung über **EIP-6963** erkennen und nach
deiner Wallet-Freigabe öffentliche Ethereum-Adressen übernehmen.
Nach deiner Bestätigung werden diese Adressen **deaktiviert** importiert.
Nichts wird automatisch für Zahlungen freigeschaltet; das ist ein
expliziter Betreiberentscheid nach Testeingang.

Die Wallet-Verbindung liefert **nicht automatisch** die Bitcoin- und
TRON-Adressen und erzeugt nicht unendlich viele neue Adressen. Für
mobile Wallets ist WalletConnect/TrustConnect eine zusätzliche
Provider-abhängige Integration und keine garantierte Multi-Chain-Automation.

### Option B: Headless (ganz ohne Website)

Alle Befehle aus dem Verzeichnis `payments/`:

```powershell
npm run operator -- wallet-setup-plan
```

Die lokale Ausgabe gruppiert die vorhandenen Coins nach Netzwerken.
Für die öffentliche Watch-only-Adressliste legst du selbst eine
JSON-Datei auf deinem Rechner an:

```json
{
  "walletLabel": "Trust Wallet",
  "addresses": [
    {"chain": "bitcoin", "address": "DEINE_ECHTE_BTC_EMPFANGSADRESSE"},
    {"chain": "ethereum", "address": "DEINE_ECHTE_ETH_EMPFANGSADRESSE"},
    {"chain": "tron", "address": "DEINE_ECHTE_TRON_EMPFANGSADRESSE"}
  ]
}
```

Diese Platzhalter sind **keine gültigen Adressen**: Ersetze sie nur
durch echte, auf deinem Gerät kontrollierte Mainnet-Adressen. Für
viele Rechnungen können bis zu 25 vorher freigegebene öffentliche
Adressen pro Import übergeben werden.

Nach Konfiguration des privaten `PAYMENTS_ADMIN_URL` und
`PAYMENTS_ADMIN_KEY`:

```powershell
npm run operator -- wallet-import-public .\public-receivers.json --confirm
npm run operator -- address-list
```

Der Import validiert Bitcoin/ETH/TRON-Netzwerke und Prüfsummen,
normalisiert Ethereum-Adressen, erkennt doppelte Einträge und
schreibt maximal 25 Adressen mit **einem atomaren Datenbank-Batch**.
Fehlerhafte oder bereits belegte Adressen blockieren den gesamten
Import. Jede neue Adresse startet mit `enabled=0`.

Erst wenn du die Adresse selbst geprüft hast und die Backend-
Beobachtung funktioniert, kannst du sie einzeln freigeben:

```powershell
npm run operator -- address-enable ethereum DEINE_ECHTE_ETH_EMPFANGSADRESSE --confirm
```

**Niemals** private Keys, 12/24 Wörter, xprv, Wallet-Backups,
Zugangsdaten oder Wallet-Passwörter in diese Datei übernehmen.
Das Importformat akzeptiert ausschließlich `walletLabel`,
`addresses[].chain` und `addresses[].address`.

## 2. Leicht neue Coins vorbereiten

Die bestehende geprüfte Asset-Registry ist zentral in
`src/asset-registry.js`. Alle bisherigen Assets werden von
`src/assets.js` daraus übernommen. Unterstützt sind momentan nur:

- BTC (Bitcoin Mainnet)
- ETH (Ethereum Mainnet)
- TRX (TRON Mainnet)
- USDT ERC-20 (Ethereum, **offizieller gepinnter Contract**)
- USDT TRC-20 (TRON, **offizieller gepinnter Contract**)

**Planen ohne Netzwerkzugriff:**

```powershell
npm run operator -- coin-plan USDC_ERC20 ethereum erc20 6
npm run operator -- coin-plan SOL solana native 9
```

**Prüfungsvorlage erstellen:**

```powershell
npm run coin:scaffold -- USDC_ERC20 ethereum erc20 6
```

Das erzeugt im lokalen Verzeichnis `payments/coin-candidates/USDC_ERC20/`
eine `manifest.json` und `SECURITY-REVIEW.md`.
Es überschreibt keine bestehende Vorlage.

**Sicherheitsgrenze:** Die Vorlage ist `REVIEW_REQUIRED` und
`paymentAcceptanceEnabled=false`. Um tatsächlich neue Kryptowährungen
anzunehmen, müssen Entwickler die Token-/Chain-Identität, auf der Chain
nachgewiesene Zahlungen, Wallet-Adressen, Scanner, RPC-Quorum,
Kursquellen, Datenbankmigrationen und Tests ergänzen und überprüfen.
Ein neuer Coin wird **niemals** allein dadurch freigeschaltet,
dass sein Name in einer Liste steht.

Für USDT sind die geprüften Mainnet-Contract-Adressen fest
im Code hinterlegt. Änderungen an den Cloudflare-Werten müssen
mit der freigegebenen Contract-Adresse übereinstimmen; sonst
wird die Verifizierung verweigert.

## 3. Effizienz, Sicherheit und Ausfallschutz

- Empfängeradressen nach Chain statt nach Token gruppieren.
- Batch-Import für kontrollierte öffentliche Adresspools.
- Getrennte Zahlungsanbieter-/Projektzugangsschlüssel.
- Blockchain-Verifizierung über unabhängiges RPC-Quorum.
- Keine Hot-Wallet-Schlüssel im Provider, keine Transaktionen im Namen des Betreibers.
- Neue Coins und Adressen zunächst **deaktiviert**.
- Keine automatische Annahme von Transfers mit falschem Token-Contract.
- Bei nicht verfügbaren Kursen, Adressen, Blockchain-Beweisen oder
  Datenbankverbindung werden neue Einzahlungen abgelehnt bzw. Zahlungen
  zunächst nicht bestätigt.

## 4. Wichtige verbleibende Produktionsgrenzen

Ein Trust-Wallet-Connect darf weder geheime Schlüssel liefern noch die
Kontrolle über alle Chains ohne passende Wallet-APIs vortäuschen.
Auch unbegrenzt viele neue öffentliche Ethereum-/TRON-/Bitcoin-Adressen
können nicht aus einer normalen Browser-Connect-Freigabe abgeleitet
werden. Eine später optionale **auditierte Watch-only-
Adressableitung** muss die Wallet-Kompatibilität,
korrekten Netzwerk-Derivation-Paths und Datenschutzfolgen
gesondert nachweisen – niemals Seed-Phrases auf dem Server.

Vor einem Echtgeldstart fehlen weiterhin die Installation der
eigenen Cloudflare-/Blockchain-Infrastruktur, Wallet-Kontrolltests,
Echtzahlungen, Penetrationstest, Lasttest und geprüfter
Disaster-Recovery-/Reorg-Ablauf. Deshalb **weiterhin kein Go-live**.

Als Zahlungsmethode für digitale Güter innerhalb von Telegram
Mini Apps müssen die Telegram-Stars-Vorgaben beachtet werden.
