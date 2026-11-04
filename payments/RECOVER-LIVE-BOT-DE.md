# RUST UP — ursprünglichen Live-Bot wiederherstellen und /pay einbauen

**Die neun originalen JavaScript-Module sind noch als vollständige
`sourcesContent`-Einträge in der Source-Map des aktiven Cloudflare Workers
`rustup-bot` vorhanden.** Dazu gehören `worker.js`, `admin.js`,
`game.js`, `creator.js`, `support.js`, `money.js`, `modes.js`,
`broadcast.js` und `gamedata.js`.

## Kein öffentliches Upload der Bot-Quellen

Das bestehende GitHub-Repository ist öffentlich. Deshalb speichert das
Wiederherstellungs-Skript die originalen Backend-Dateien **nur lokal**
unter `.private/rustup-bot-recovered/`. Die neue `.gitignore` verhindert
versehentliches Committen dieses Ordners.

## 1. Cloudflare API Token (nur lesen)

In Cloudflare unter **My Profile > API Tokens > Create Token** einen Token
für den eigenen Account mit **Workers Scripts Read** anlegen. Keine
Schreibberechtigung erforderlich. Den Token niemals in Chats senden.

## 2. Auf Windows wiederherstellen

In einer PowerShell:

```powershell
cd "$HOME\RUST-UP-Local"
git switch feature/rustup-payment-admin-controls
git pull --ff-only origin feature/rustup-payment-admin-controls

# Nicht als Klartext auf der Konsole eingeben oder in Git speichern:
$secure = Read-Host "Cloudflare API Token (Workers Scripts Read)" -AsSecureString
$env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new("", $secure).Password

node .\payments\scripts\recover-live-bot-source.mjs
Remove-Item Env:CLOUDFLARE_API_TOKEN
```

Das Skript lädt ausschließlich den `rustup-bot`-Quellcode, prüft die
Originaldateinamen und speichert die neun Dateien zusammen mit ihren
SHA-256-Prüfsummen in einem timestampbasierten lokalen Ordner.

## 3. Authentifizierte Adminbefehle lokal hinzufügen

Der Recovery-Prozess gibt einen Befehl mit dem **exakten lokalen Ordner**
aus, etwa:

```powershell
node .\payments\scripts\patch-recovered-live-bot.mjs "C:\Users\...\.private\rustup-bot-recovered\2026-..."
```

Das Patch-Skript:
- legt `worker.before-payment-admin.js` als lokalen Quellcode-Backup an,
- kopiert `payment-controls.mjs` und `live-bot-hook.mjs`,
- integriert `/pay` am Anfang von `onUpdate(upd,env)`,
- nutzt ausschließlich die vorhandene `isAdmin(env,user)`-Funktion,
- verändert keine Spielertabellen, Guthaben, Telegram-Webhooks oder Cloudflare Secrets.

Dafür wird **noch nichts** auf Cloudflare deployed.

## 4. Vor einem späteren Live-Deploy

1. Den recovered Worker mit seinen acht übrigen Originalmodulen bauen.
   Die Source-Map-Version muss der aktuellen Worker-Deployment-Version
   entsprechen; zwischenzeitliche Deployments des Kollegen erfordern
   eine neue Wiederherstellung.
2. Die bisherige D1 `DB=rustup-stats` unverändert lassen.
3. Zusätzlich `PAYMENTS_DB=rustup-stars-staging` binden.
4. Alle bisherigen Secrets und Cron/Trigger-Einstellungen behalten.
5. `PAYMENT_PRODUCTION_ENABLED=false` und alle Zahlungs-Schalter AUS lassen.
6. Das Deployment separat prüfen. Die gepatchte Quelle ist nicht gleich
   einer Freigabe für Echtgeldzahlungen.
7. Im privaten Telegram-Chat des vorhandenen Bots `/pay status` testen.

**Niemals den separaten Zahlungs-Testworker einfach anstelle von
`rustup-bot` deployen!** Dies würde die eigentliche App außer Betrieb
setzen.
