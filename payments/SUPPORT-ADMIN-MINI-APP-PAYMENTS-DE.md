# RUST UP – Zahlungsverwaltung in @rustuperhelp_bot

**Bestehende /pay-Befehle in @rustuper_bot bleiben bestehen.** Zusätzliche
Bedienoberfläche im vorhandenen Admin Mini App:
`https://ttzoomrust-hub.github.io/rust-up/admin/` — neue Registerkarte
`Платежи`. Sprachstil Russisch, bestehendes Dark-Glass-Design.

## Sicherheit

* Die API läuft auf `/api/adm/payments` und `/api/adm/payments-set`,
  **innerhalb** der bestehenden `adminApi`-Funktion.
* Vor jedem Zugriff: Telegram `initData`-Prüfung mit `ADMIN_BOT_TOKEN`,
  danach `isAdmin(env,user)`. Dieselbe Admin-Berechtigung wie andere
  Adminfunktionen. Falls Finanzzugriff enger sein soll, vor Deployment
  eigene Finanzrollen ergänzen.
* `PAYMENTS_DB` (isolierte D1) ist zwingend. Keine Ausweichschreibzugriffe auf
  die Spieldatenbank.
* Status der drei Schalter, wirksame Zahlungen und 15 letzte Audit-Ereignisse.
* Mutationen verlangen boolean `expected` (Compare-And-Swap gegen parallele
  Änderungen), `enabled` und `confirmation`.
* Die Datenbank protokolliert Änderungen über einen Trigger.
* `PAYMENT_PRODUCTION_ENABLED=false` bleibt erhalten. **Keine Echtgeldzahlungen
  aktivieren** und keine Wallet-Gutschriften durch dieses Panel.

## 1. Bestehende lokal wiederhergestellte Backend-Version erweitern

Die im November bereits gepatchte und live ausgerollte
`RUST-UP-Local/.private/rustup-bot-recovered/2026-11-04T17-51-22-065Z-f7ac5f36e2`
ist die Basis. Kein neues SourceMap-Recovery durchführen: der neue Live-Build
enthält möglicherweise keine ursprünglichen Sources mehr.

```powershell
cd "$HOME\RUST-UP-Local"
git switch feature/rustup-payment-admin-controls
git pull --ff-only origin feature/rustup-payment-admin-controls

$folder = "$HOME\RUST-UP-Local\.private\rustup-bot-recovered\2026-11-04T17-51-22-065Z-f7ac5f36e2"
node .\payments\scripts\patch-recovered-admin-panel.mjs "$folder"
if ($LASTEXITCODE -ne 0) { throw 'Patch fehlgeschlagen' }

npx --yes esbuild "$folder\worker.js" --bundle --platform=browser --format=esm --target=es2022 --outfile="$folder\worker.payment-admin.bundle.js"
if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen' }
node --check "$folder\worker.payment-admin.bundle.js"
if ($LASTEXITCODE -ne 0) { throw 'Syntaxprüfung fehlgeschlagen' }

node --test .\payments\integration\telegram-stars\admin-panel-api.test.mjs
node --test .\payments\scripts\patch-recovered-admin-panel.test.mjs
```

## 2. Sicherheitsprüfung unmittelbar vor Veröffentlichung

```powershell
$secure = Read-Host 'Cloudflare API Token (Workers Scripts Read)' -AsSecureString
$env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new("",$secure).Password

node .\payments\scripts\check-live-admin-panel-release.mjs "$folder"
Remove-Item Env:CLOUDFLARE_API_TOKEN
if ($LASTEXITCODE -ne 0) { throw 'Cloudflare-Sicherheitsprüfung fehlgeschlagen' }

npx --yes wrangler deploy --dry-run --config "$folder\wrangler.rustup-bot.toml"
```

Die Prüfung verlangt unveränderte Live-Version `5bb816ee-965b-49a5-9493-f05bea973e67`,
bestehende Bot-Secrets, `DB` und `PAYMENTS_DB`, Minutentakt-Cron
sowie `PAYMENT_PRODUCTION_ENABLED=false`.
Falls der Worker seitdem weiterentwickelt wurde, **NICHT erzwingen**:
Änderungen mit der neuen Live-Version abgleichen.

Erst nach erfolgreichem Check, Dry-run und bewusstem Review darf
`npx wrangler deploy --config "$folder\wrangler.rustup-bot.toml"`
den Backend-Worker veröffentlichen.

## 3. Separate, öffentliche Admin-Mini-App ergänzen

Die aktuelle Website gehört zum **anderen** GitHub-Repository
`ttzoomrust-hub/rust-up`, nicht zu `SchadowStudio/rust-up`.
Unser GitHub-Connector kann dieses Repository lesen, aber dort derzeit
keine Branches erstellen oder Änderungen schreiben. Daher lokaler
Integrations-Patch, der nur exakt bekannte Originaldateien verändert.

```powershell
cd "$HOME"
git clone https://github.com/ttzoomrust-hub/rust-up.git RUST-UP-Website
cd "$HOME\RUST-UP-Local"
node .\payments\scripts\patch-existing-support-admin-frontend.mjs "$HOME\RUST-UP-Website"
if ($LASTEXITCODE -ne 0) { throw 'Website-Layout geändert; manuell prüfen' }

cd "$HOME\RUST-UP-Website"
node --check .\admin\app.js
node --check .\admin\payments-tab.js
git diff --check
git status --short
```

Die lokale Mini App ist dann geändert, aber noch nicht veröffentlicht.
Vor dem Push prüfen, dass die beiden neuen Admin-API-Endpunkte im Worker
funktionieren. Erst dann committen/pushen:

```powershell
git add admin/index.html admin/app.js admin/payments.css admin/payments-tab.js
git commit -m "Add secure Payments tab to support Admin Mini App"
git push origin main
```

Aus `@rustuperhelp_bot` per `/start` die bestehende Admin-Mini-App öffnen,
dann die fünfte Registerkarte `Платежи` auswählen.

Wenn Cloudflare- oder GitHub-Versionschecks scheitern, stopp statt Force-Push.
