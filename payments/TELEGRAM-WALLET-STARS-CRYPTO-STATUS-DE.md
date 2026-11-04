# RUST UP – Telegram-Mini-App-Wallet: Stars + Krypto

Stand: 04.11.2026. **Noch nicht live veröffentlicht. Keine Echtgeldzahlungen aktiviert.**

## Einzige Bedienoberfläche
- Nutzer starten die bestehende Mini App von `@rustuper_bot`.
- `Кошелёк → Пополнить → Telegram Stars` öffnet im selben Wallet einen für Telegram signierten Katalog mit feststehenden, nicht übertragbaren digitalen Gütern.
- Die bestehende Karte `Криптовалюта` bleibt erhalten. Für digitale Güter in Telegram ist dort keine Kryptowährungszahlung möglich; die Karte erklärt das. Es wird weder eine Deposit-Adresse noch ein Krypto-Checkout in der Mini App angeboten.
- Kein extra `stars/`-Shop, keine zusätzliche Registerkarte, keine zweite Website. Telegram Mini Apps brauchen technisch weiterhin HTTPS-Auslieferung der **bestehenden** App. Spieler müssen keinen Browser oder Domain öffnen.
- Alte `Кошелёк → Вывести`, `История`, `Игры`, `Кейсы`, `Заработок`, `Бонусы` bleiben unberührt.

## Vorhandener Backend-Stand
- `payments/integration/telegram-stars/stars-existing-worker-wrapper.mjs` ergänzt die vorhandenen `/api/stars/*`-API-Routen und die `/tg` Telegram-Sterne-Webhooks mit bestehendem Webhook-Secret. Alle anderen APIs, Cron-Jobs und `/pay`-Kommandos bleiben erhalten.
- `stars-live-bridge.mjs` prüft serverseitig signierte Telegram-`initData`, festes Produkt, Stars-Preis, Liefer-Snapshot, `pre_checkout_query` und den `successful_payment`-Beleg und gibt den Inhalt erst bei bestätigter Zahlung frei.
- D1 `rustup-stars-staging` wurde bereits additiv um Inhalts-, Incident- und Rückerstattungstabellen erweitert.
- `PAYMENT_PRODUCTION_ENABLED=false`; zusätzlich Master/Stars/Krypto D1-Schalter OFF, keine aktiven realen Produkte, kein produktiver Krypto-Anbieter.
- Kein Echtgeld in Case Battles, Upgrade-Guthaben, auszahlbare Konten oder Glücksspiel-Elemente transferieren.

## Lokale Dateien aktualisieren – NOCH NICHT VERÖFFENTLICHEN

```powershell
cd "$HOME\RUST-UP-Local"
git pull --ff-only origin feature/rustup-payment-admin-controls
$folder = "$HOME\RUST-UP-Local\.private\rustup-bot-recovered\2026-11-04T17-51-22-065Z-f7ac5f36e2"
node .\payments\scripts\refresh-staged-telegram-stars.mjs "$folder"
if ($LASTEXITCODE -ne 0) { throw "Stars module refresh failed" }
npx --yes esbuild "$folder\worker.stars-entry.mjs" --bundle --platform=browser --format=esm --target=es2022 --outfile="$folder\worker.payment-admin.bundle.js"
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
node --check "$folder\worker.payment-admin.bundle.js"
if ($LASTEXITCODE -ne 0) { throw "Bundle syntax invalid" }
```

Es sind einmalige `.before-miniapp`-Backups vorhanden. Ist das Refresh bereits erfolgt, STOPP statt blind ein zweites Mal zu überschreiben.

```powershell
cd "$HOME\RUST-UP-Local"
node .\payments\scripts\install-telegram-wallet-payments.mjs "$HOME\RUST-UP-Website"
if ($LASTEXITCODE -ne 0) { throw "Existing app integration failed" }
cd "$HOME\RUST-UP-Website"
node --check .\js\app.js
node --check .\js\wallet-stars-panel.js
git diff --check
git status --short
```

Der Installer akzeptiert das originale veröffentlichte `js/app.js` oder die einzige schon früher ausgeführte Umbenennung `Telegram и CS2` → `Telegram Stars`. Bei sonstigen Abweichungen bricht er ohne Änderungen ab.

## Test und Inbetriebnahme
1. GitHub-CI und lokale Node-Tests ausführen.
2. Deployment-Vorabprüfung ausführen; Cloudflare-Version und D1 Bindings müssen mit dem aktuellen Stand übereinstimmen.
3. Rückerstattung über `refundStarPayment`, Entitlement-Entzug, eventuelle 503-Webhook-Retries und doppelt zugestellte Quittungen vollständig prüfen.
4. Das konkrete reale nicht-übertragbare digitale Produkt sowie den rechtlichen Umfang der behaupteten Sonderfreigaben nachweisen.
5. Erst bei erfolgreichem Ende-zu-Ende-Live-Test die separate Freigabe zur Echtgeldannahme erwägen. Die lokalen Code-Artefakte und erfolgreiche Syntax-Tests allein reichen **nicht**.

## Krypto-Provider
Der separate Multi-Projekt-Krypto-Provider unterstützt in seinem Code BTC, ETH, TRX, USDT (ERC20/TRC20) und TON. `demo:local:check` prüft ausschließlich simulierte Einzahlungen. Keine bestätigten Mainnet-Einzahlungen, keinen Echtbetrieb und keine Nutzung als alternative digitale Zahlung innerhalb Telegrams daraus ableiten.

Telegram-Vorgaben:
- https://core.telegram.org/bots/payments-stars
- https://telegram.org/tos/bot-developers


## Nachtrag: Ende-zu-Ende-Tests und gesicherter Worker-Build (04.11.2026)

Der SQLite-basierte Test `stars-sqlite-e2e.test.mjs` deckt signiertes `initData`,
den festen Katalog, die gebundene Rechnung, manipulationssicheren XTR-Preis,
Precheckout, `successful_payment`, Auslieferungsfreigabe, erneute Zustellung,
Not-Aus, nur dem Käufer sichtbare digitale Inhalte und Rückerstattung ab.
Ein zusätzlicher D1-Lock verhindert mehrere gleichzeitig erstellte
Telegram-Rechnungen für denselben Kunden und dasselbe Produkt. Die Tabelle
`rustup_stars_purchase_locks` wurde bereits in der isolierten
Cloudflare-D1 `rustup-stars-staging` ergänzt; NICHT in `rustup-stats`.

**WICHTIG:** Der Benutzer hat das ältere 340-KB-Bundle bereits lokal gebaut.
Nach dem Einbau der Reservierung ist ein erneuter sicherer Staging-Schritt
nötig. Die Dateien `stars-live-bridge.mjs.before-miniapp` und
`worker.before-stars.bundle.js` bleiben als Sicherungen unangetastet.

```powershell
cd "$HOME\RUST-UP-Local"
git pull --ff-only origin feature/rustup-payment-admin-controls
$folder = "$HOME\RUST-UP-Local\.private\rustup-bot-recovered\2026-11-04T17-51-22-065Z-f7ac5f36e2"
node .\payments\scripts\stage-stars-purchase-locks.mjs "$folder"
if ($LASTEXITCODE -ne 0) { throw "Stars-Lock-Schutz nicht vorbereitet" }
node .\payments\scripts\add-safe-stars-worker-vars.mjs "$folder"
if ($LASTEXITCODE -ne 0) { throw "Sichere Flags fehlen" }
npx --yes esbuild "$folder\worker.stars-entry.mjs" --bundle --platform=browser --format=esm --target=es2022 --outfile="$folder\worker.payment-admin.bundle.js"
if ($LASTEXITCODE -ne 0) { throw "Worker-Build fehlgeschlagen" }
node --check "$folder\worker.payment-admin.bundle.js"
if ($LASTEXITCODE -ne 0) { throw "Worker ungültig" }
node .\payments\scripts\check-telegram-wallet-bundle.mjs "$folder"
if ($LASTEXITCODE -ne 0) { throw "Worker-Sicherheitscheck fehlgeschlagen" }
npx --yes wrangler deploy --dry-run --config "$folder\wrangler.rustup-bot.toml"
if ($LASTEXITCODE -ne 0) { throw "Wrangler Dry-Run fehlgeschlagen" }
```

Vor einer tatsächlichen Bereitstellung zusätzlich die Cloudflare-Live-Version
per `payments/scripts/check-live-admin-panel-release.mjs` gegen die unveränderte
frühere Version prüfen und die vorherigen Versionen als Rollback bereithalten.
Die Produktionsfreigabe und alle drei Stars-Flags bleiben im vorbereiteten
Wrangler-Setup explizit auf `false`.

Eine kontrollierte Worker-Bereitstellung hinter diesen Sperren macht den
authentifizierten Katalog und die Hilfsendpunkte technisch erreichbar,
aktiviert aber KEINE Echtgeldzahlungen. Weitere Freigabe bedarf
vollständiger kontrollierter Live-Tests, realer auslieferbarer Produkte
und eines überprüften Rückerstattungs- und Supportbetriebs.

Bei digitalen Gütern darf innerhalb Telegrams nur mit Stars bezahlt werden.
Zusätzlich verlangen die aktuellen Telegram Bot Developer Terms von
Mini Apps mit Krypto-Funktionen grundsätzlich die TON-Blockchain und
TON Connect für Wallet-Verbindungen.

Quellen: https://core.telegram.org/bots/payments-stars
und https://telegram.org/tos/bot-developers
