# RUST UP – Telegram Stars: Staging-Release (04.11.2026)

**Status: Kein Echtgeld-Go-Live. Bestehende /pay-Befehle bleiben bestehen.**

## Ergänzt
- Original `@rustuper_bot` Worker wird durch einen zusätzlichen Fetch-Wrapper erweitert; ursprüngliche Game-APIs, Admin-API, /tg-Webhooks, Cron und `/pay` bleiben erhalten.
- Ausschließlich bestätigte Telegram Stars-Zahlungen (`XTR`) werden verarbeitet. Der `pre_checkout_query` erhält bei fehlender Lieferzusage eine ausdrückliche Ablehnung.
- Feste, nicht übertragbare Digitalinhalte: Inhalt wird vor der Rechnung in D1 eingefroren und erst nach bestätigt bezahlter Rechnung dem Käufer angezeigt.
- Unklare Belege werden in einer Incident-Tabelle gespeichert und nie als Game-Guthaben verbucht. Fehlgeschlagene Zahlungswebhooks geben HTTP 503 für erneute Telegram-Zustellung zurück.
- Ein `/stars`-Befehl öffnet die separate GitHub-Pages-Mini-App. `/paysupport` verweist auf den bestehenden Support-Bot.
- Kein Wager-, Case-, Upgrade-, Skin-, Krypto- oder auszahlbares Guthaben wird durch diesen Adapter gutgeschrieben.

## Datenbank
Die vier neuen Tabellen `rustup_stars_fixed_content`, `rustup_stars_order_content`, `rustup_stars_receipt_incidents`, `rustup_stars_refund_intents` sind in der **isolierten** D1 `rustup-stars-staging` bereits angelegt. `rustup-stats` wurde nicht geändert.

## Lokaler Build – keine Veröffentlichung
```powershell
cd "$HOME\RUST-UP-Local"
git pull --ff-only origin feature/rustup-payment-admin-controls
$folder = "$HOME\RUST-UP-Local\.private\rustup-bot-recovered\2026-11-04T17-51-22-065Z-f7ac5f36e2"
node .\payments\scripts\prepare-stars-recovered-worker.mjs "$folder"
if ($LASTEXITCODE -ne 0) { throw "Stars-Integration fehlgeschlagen" }
npx --yes esbuild "$folder\worker.stars-entry.mjs" --bundle --platform=browser --format=esm --target=es2022 --outfile="$folder\worker.payment-admin.bundle.js"
if ($LASTEXITCODE -ne 0) { throw "Build fehlgeschlagen" }
node --check "$folder\worker.payment-admin.bundle.js"
if ($LASTEXITCODE -ne 0) { throw "Syntaxprüfung fehlgeschlagen" }
```

Vor jedem späteren Deployment: `payments/scripts/check-live-admin-panel-release.mjs` mit einem Cloudflare **Read-Token** sowie `wrangler deploy --dry-run` ausführen. Versionsabweichungen NICHT übergehen.

## GitHub Pages ohne eigene Domain
```powershell
cd "$HOME\RUST-UP-Local"
node .\payments\scripts\install-stars-shop.mjs "$HOME\RUST-UP-Website"
cd "$HOME\RUST-UP-Website"
node --check .\stars\app.js
git diff --check
git status --short
```
Das kopiert ausschließlich neue `/stars/`-Dateien, ohne vorhandene Website- oder Admin-Dateien zu überschreiben. Es pusht und veröffentlicht nichts.

## Noch erforderlich vor echten Stars-Zahlungen
1. Ein echtes, nachweisbar auslieferbares **festes** Produkt, ein bewusst gesetzter Preis in Telegram Stars und ein aktiver Betreiber-Support. Kein Verkauf von Phantasieprodukten.
2. Echte Testzahlungen, vorab verifizierte Produktinhalte und End-to-End-Tests für Replay, Rechnung, Precheckout, verspätete Belege, D1-Ausfälle, abgebrochene Zahlung und Kundenzugriff. Die zusätzlichen Wrapper-Tests sind noch nicht abgeschlossen.
3. Ein ausgearbeiteter und getesteter Prozess mit `refundStarPayment`, Rücknahme der Berechtigung und Audit-Protokoll. `rustup_stars_refund_intents` ist nur die Schema-Grundlage, noch kein kompletter Refund-Workflow.
4. Die vom Betreiber genannten Telegram-Sonderfreigaben für den konkreten Bot/Produkte/Geschäftsmodell unabhängig belegen und gesetzliche Glücksspiel-, Alters- und Verbraucherpflichten prüfen.
5. Cloudflare D1 Limits, Wiederherstellung, Monitoring und Lasttests abnehmen. Bei Überschreiten der D1 Free-Tier-Limits schlägt die Datenbank fehl.
6. **Bis zur Abnahme** bleiben `PAYMENT_PRODUCTION_ENABLED=false`, `STARS_PAYMENT_ENABLED=false`, `STARS_FIXED_PRODUCTS_ENABLED=false`, Master/Stars D1-Schalter OFF.

Telegram: https://core.telegram.org/bots/payments-stars und https://telegram.org/tos/bot-developers
