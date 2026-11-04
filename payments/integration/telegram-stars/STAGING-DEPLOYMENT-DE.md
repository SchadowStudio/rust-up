# RUST UP – aktualisieren und sicher aktivieren

**Stand: 4. November 2026. Live-Zahlungen weiterhin gesperrt.**

Entwicklungsbranch: feature/rustup-payments-staging. Vorhandener rustup-bot und D1 rustup-stats wurden nicht verändert.
Der live laufende Original-Worker liegt nicht vollständig als Quellcode im GitHub-Projekt.

## Lokal aktualisieren und testen

PowerShell im lokalen Repository (vor dem Umschalten ungesicherte Änderungen prüfen):

    cd "$HOME\RUST-UP-Local"
    git fetch origin
    git switch feature/rustup-payments-staging
    git pull --ff-only origin feature/rustup-payments-staging
    cd .\payments
    npm run test:local
    node --test .\integration\telegram-stars\stars.test.mjs .\integration\telegram-stars\worker.test.mjs

## Isolierten Stars-Staging-Worker vorbereiten

Benötigt: ein separater Test-Telegram-Bot, eine separate Test-D1-Datenbank und eine eigene HTTPS-Testseite.
Die folgenden Cloudflare-Befehle erstellen neue Ressourcen im ausgewählten Account. Der Betreiber muss deren Nutzung und etwaige Kosten freigeben.

    npx wrangler whoami
    npx wrangler d1 create rustup-stars-staging
    Copy-Item .\wrangler.stars.toml.example .\wrangler.stars.toml

Danach die neu erzeugte Datenbank-UUID in wrangler.stars.toml eintragen und STARS_ALLOWED_ORIGIN auf die autorisierte HTTPS-Testseite setzen.
STARS_PAYMENT_ENABLED muss false bleiben.

    npx wrangler d1 execute rustup-stars-staging --remote --file=integration/telegram-stars/migration.sql --config=wrangler.stars.toml
    npx wrangler deploy --config wrangler.stars.toml

Staging-Endpunkte: GET /health; POST /api/stars/checkout; POST /telegram/stars/webhook.
Testbot-Tokens ausschließlich als Cloudflare-Secrets setzen, niemals als Dateien committen:

    npx wrangler secret put TG_STARS_BOT_TOKEN --config wrangler.stars.toml
    npx wrangler secret put TG_STARS_WEBHOOK_SECRET --config wrangler.stars.toml

Bestehendes Webhook des Live-Bots rustuper_bot nicht verändern.
Ein erfolgreiches Test-Deployment ist keine Freigabe echter Stars-Käufe.

## Eigenes Krypto-System

Das vorhandene payments/src/multi ist eine separate Multi-Projekt-Provider-Basis. Es ist nicht für reale Mainnet-Zahlungen freigegeben.
Für eine produktive Nutzung fehlen echte Wallet-Empfangsadressen, unabhängige Blockchain-Verifikation, gesicherte Kursquellen, Mainnet-Tests, Monitoring, Backups, Refunds sowie Betreiber- und Compliance-Freigaben.
EXTERNAL_CRYPTO_CHECKOUT_ENABLED=false und EXTERNAL_FIXED_RECEIPTS_ENABLED=false bleiben deaktiviert.
Krypto wird nicht als Zahlungsalternative für digitale Telegram-Mini-App-Güter angeboten oder dorthin verlinkt.

## Sperren für RUST UP

Keine Echtgeldeinzahlungen auf Cases, Skin-Upgrades, zufallsbasierte Belohnungen oder auszahlbares Spielguthaben.
Nur konkret definierte feste, nicht übertragbare und nicht einlösbare Produkte dürfen mit Stars getestet werden, wenn sie rechtlich und plattformseitig zulässig sind.
Vor echten Kundenkäufen: Bot-Quellcode sichern, Workflow prüfen, idempotente Lieferung, /paysupport, refundStarPayment, Betrugsschutz, Logs, Support, Backup-/Wiederherstellungstest und Freigabe.

Quellen:
- https://core.telegram.org/bots/payments-stars
- https://core.telegram.org/bots/webapps
- https://telegram.org/tos/bot-developers