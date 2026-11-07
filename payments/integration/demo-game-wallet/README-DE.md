# RUST UP – gleiches Wallet-Protokoll für Stars und Krypto (nur DEMO)

**Stand:** technischer Teststand, keine Echtgeld-Einzahlung, kein Deployment.
Die bestehende Telegram Mini App bleibt die einzige Benutzeroberfläche.

## Testablauf

1. Zahlungsquelle `demo_stars` oder `demo_crypto` schreibt einen eindeutigen, nicht übertragbaren **DEMO**-Eingang.
2. Das Guthabenbuch führt beide Quellen in einem Sandbox-Konto zusammen.
3. Ein Test-Spielkauf bucht die vorherige Demo-Gutschrift kontrolliert ab.
4. Doppelt eingehende Belege werden nicht erneut gebucht.
5. Erstattungen erzeugen eine separate negative Buchung; bei zu wenig Demo-Guthaben wird der Vorgang zur manuellen Klärung markiert.
6. Die Historie ist nach Telegram-Benutzer-ID isoliert.

```powershell
cd "$HOME\RUST-UP-Local"
git pull --ff-only origin feature/rustup-payment-admin-controls
node .\payments\scripts\demo-game-wallet.mjs
node --test .\payments\integration\demo-game-wallet\ledger.test.mjs
```

Alle Punkte sind rein lokal und ohne Blockchain- oder Telegram-Netzwerkzugriffe testbar.
Die SQLite-Datenbank ist `:memory:` und wird nach dem Test verworfen.

## Sicherheitsgrenzen (wichtig)

- **Nicht** mit `bot/game.js`, dem bestehenden `rustup-stats`-Spielkonto,
  Inventar, echten Skins, Auszahlungen, Gegenständen mit wirtschaftlichem
  Wert oder Telegram-Stars-Echtgeldzahlungen verbinden.
- Keine vorhandene `/pay`-Konfiguration, Cloudflare-Produktionsumgebung oder
  GitHub-Pages-Oberfläche wird geändert.
- Das Modul hat absichtlich **keinen öffentlichen HTTP-Endpunkt** und keine
  Funktion, mit der Nutzer echte Zahlungseingänge vortäuschen können.
- `demo_stars` und `demo_crypto` sind Testlabels, **keine** verifizierten
  Belege der Telegram-API bzw. einer Blockchain.
- Die Demo-Einheiten sind weder Geld noch auszahlbar noch als Einsatz für
  werthaltige Zufallsgewinne nutzbar.

## Für einen späteren zulässigen Echtgeldbetrieb

Ein echter Anbieter müsste zuerst die konkreten rechtlichen Voraussetzungen
und möglichen Genehmigungen nachweisen. Für digitale Käufe in Telegram
ist nach den offiziellen Telegram-Regeln ausschließlich Stars vorgesehen,
nicht ein alternativer Krypto-Checkout. Krypto-Wallet-Interaktionen in Mini
Apps müssen die TON/TON-Connect-Anforderungen beachten.

Ein späterer Echtgeld-Ledger erfordert einen anderen separaten Kontenplan,
nachgewiesene serverseitige Zahlungsauthentizität und Finalität, antifraud,
vollständig nachvollziehbare Buchungen, Rückzahlungen, Nutzeridentifizierung,
rechtliche Alters- und Spielerschutzprüfung, Lizenzabnahme, Sicherheitsaudit,
Monitoring und Backups. **Dieses Demo-Modul darf dafür nicht einfach per
Feature-Flag in Produktion geschaltet werden.**

Rechtsquellen:
- https://core.telegram.org/bots/payments-stars
- https://telegram.org/tos/bot-developers
- https://www.gluecksspiel-behoerde.de/de/fuer-gluecksspielanbieter/gesetzliche-regelungen
