# RUST UP – aktuelle 10-Modul-Bot-Version: sicherer Stars-Dark-Launch
Stand: 05.11.2026. Dieser Weg betrifft NUR feste, nicht übertragbare,
nicht auszahlbare digitale Produkte (z. B. Supporter-Abzeichen).
**Er aktiviert keine Echtgeld-Cases, Upgrades, Wetten oder Guthaben.**

## Verifizierter Live-Zustand
- Der Cloudflare Worker rustup-bot wurde am 05.11.2026 neu bereitgestellt.
- Seine aktuelle Sourcemap enthält 10 Originalmodule: money, broadcast,
  creator, gamedata, progress, modes, game, support, admin und worker.
- Bot-, Spiel- und Supportcode sowie der Minuten-Cron bleiben erhalten.
- Der Live Worker hat aktuell nur die rustup-stats-DB; PAYMENTS_DB fehlt.
- Die isolierte D1 mit ID 06079270-a227-466a-9991-abd4201ec5f6 enthält
  jetzt die beiden Käuferzustimmungs-Tabellen und ihre Indizes.
- In D1 stehen master/stars/crypto alle auf OFF.
- Der Betreiberkurs ist festgelegt: 1000 Stars = 1871,59 RUB.
- Im Live-Shop gibt es keine aktivierten Stars-Produkte, keine gesetzten
  Bedingungen/Version und keinen belastbaren Telegram-Testkaufbeleg.

## Aktuelle technische Vorbereitung (standardmäßig keine Veröffentlichung)
Windows PowerShell, aus dem lokalen Repository:

```powershell
cd "$HOME\RUST-UP-Local"
git switch feature/rustup-payment-admin-controls
git pull --ff-only origin feature/rustup-payment-admin-controls
powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\prepare-current-bot10-stars.ps1"
```

Das Skript prüft die Tests, holt den aktuell auf Cloudflare laufenden
Bot ausschließlich in einen privaten, gitignorierten Ordner, legt die
fixed-goods Stars-Erweiterung und beide D1-Bindings in einer privaten
Wrangler-Konfiguration an, baut das Bundle, führt einen Dry-Run aus und
vergleicht danach die Live-Version erneut. Sobald die Originalversion
abweicht, bricht das Skript ab. Keine privaten Quellen im GitHub-Repo.

Optionaler **nicht abrechnender** Dark-Deploy, ausschließlich nach Prüfung
des lokalen Backups und der Konsole:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\prepare-current-bot10-stars.ps1" -DeployWithPaymentsOff
```

Dieses Kommando lädt zwar neuen Botcode hoch, schaltet aber sämtliche
Zahlungsflags ausdrücklich auf false. Vor dem Upload wird der Live-Bot
ein zweites Mal auf unveränderte Quelle, Cron und Bindings geprüft. Es
ist keine Echtgeld-Aktivierung; überprüfe danach die bestehende Bot-/Spiel-
Funktionalität. Nach einem Dark-Deploy hat der Worker eine neue Sourcemap;
für einen weiteren Release ist ein neuer Snapshot nötig.

## Nach der technischen Bereitstellung
Read-only Prüfer:

```powershell
node ".\payments\scripts\supporter-payment-preflight.mjs"
```

Voraussetzungen für einen späteren echten Fixed-Goods-Checkout:
- tatsächlich veröffentlichte, inhaltlich geprüfte Zahlungsbedingungen mit
  operatorseitig festgelegter STARS_TERMS_VERSION und HTTPS-STARS_TERMS_URL;
- Finance-Operator-Allowlist über PAYMENT_ADMIN_IDS;
- Supporter-Abzeichen oder anderes **festes** zulässiges Produkt mit
  nachgewiesener Auslieferung und explizitem, vom Betreiber festgelegtem
  Betrag in ganzen Stars;
- die feste Stars-Kaufoberfläche tatsächlich in der vorhandenen Mini App;
- belastbarer echter Telegram TEST-Kauf, Test-Refund, Replay-/Timeout-
  Tests, Support-/Refund-Prozess und rechtliche Prüfung des Angebots.

D1 kann absichtlich schon vor dem Dark-Deploy migriert werden. Die Migration
legt ausschließlich zusätzliche Zahlungstabellen an und verändert keine
bestehenden Spielerbilanzen. Keine vorhandenen Schalter werden dabei aktiviert.

Die oben genannten Betreiberentscheidungen und Nachweise können nicht
durch einen Offline-Test ersetzt oder vom System erfunden werden.

## Unveränderte harte Trennung
Telegram Stars für digitale Güter IN Telegram; der externe mehrprojektfähige
Krypto-Provider ist separat und nicht die Alternative für dieses Checkout.
Keine Gutschrift des gekauften Produkts an Spielerkonto, Case Battle,
Upgrade, skinauszahlbares Guthaben oder anderes Zufallsspiel.
