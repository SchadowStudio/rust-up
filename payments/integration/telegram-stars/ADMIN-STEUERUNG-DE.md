# RUST UP — Adminbefehle für Zahlungsarten

Stand: 04.11.2026. Entwicklungszweig `feature/rustup-payment-admin-controls`.
**Sicherheitsstatus: Alle Zahlungsmethoden bleiben für Echtgeld standardmäßig AUS.**

## Telegram-Befehle (nur freigeschaltete Admins in privatem Bot-Chat)

- `/pay status` — alle Schalter plus effektiven Status anzeigen.
- `/pay stars on` und `/pay stars off` — Stars schalten.
- `/pay crypto on` und `/pay crypto off` — Crypto schalten.
- `/pay master on` — globalen Schalter freigeben; aktiviert ohne weitere Freigaben keine Zahlung.
- `/pay master off` oder `/pay off` — globaler Not-Aus.
- `/pay@rustuper_bot status` — direkter Befehl mit Botname.

Nicht-Admins, Gruppenmitglieder und weitergeleitete Befehle können keinen Status ändern. Keine Telegram-IDs aus dem Browser akzeptieren.

## D1 Schema

`payment-controls-migration.sql` ausschließlich in der isolierten Staging-Datenbank
`rustup-stars-staging` ausführen. Die Migration enthält:
- `rustup_payment_settings`: master, stars, crypto; alle initial 0.
- `rustup_payment_settings_audit`: unveränderliche Einträge durch einen SQLite-Trigger.
- `UPDATE` eines Schalters und zugehöriges Audit erfolgen atomar innerhalb von SQLite.

Niemals die Staging-Migration unkontrolliert auf `rustup-stats` anwenden. Für den Hauptbot ist ein **zusätzliches** Cloudflare-D1-Binding `PAYMENTS_DB` auf die isolierte Payment-Datenbank vorgesehen; sein existierendes `DB`-Binding auf `rustup-stats` darf nicht geändert werden.

## Zwei voneinander unabhängige Schutzstufen

1. Authentifizierte Admin-Schalter in D1 (master + spezifische Zahlart)
2. Server-seitige Freigaben in Cloudflare-Variablen

`PAYMENT_PRODUCTION_ENABLED=true` ist das zentrale **zusätzliche** Produktions-Gate.
Ohne diesen Wert lehnt die Zahlungs-API alle neuen Zahlungen ab, auch wenn
`/pay master on` und `/pay stars on` ausgeführt wurden.

Stars braucht außerdem `STARS_PAYMENT_ENABLED=true`. Crypto braucht
`EXTERNAL_VARIABLE_CRYPTO_CHECKOUT_ENABLED=true` und
`CRYPTO_GATEWAY_CONNECTED=true`. Ein realer Crypto-Gateway ist noch
**nicht** an den Stars-Worker angeschlossen.

Alle neuen Schalter sind AUS, wenn die D1-Migration fehlt oder
D1 nicht erreichbar ist.

## Admin-Berechtigung

In Cloudflare `PAYMENT_ADMIN_IDS` als geheimes, kommasepariertes Feld mit
den tatsächlich berechtigten Telegram-User-IDs hinterlegen. **Keine IDs im Git-Repository**.
`BOT_USERNAME=rustuper_bot` für die korrekte `/pay@...`-Adressierung.

Nur von Telegram verifizierte Nachrichten über die vorhandene authentifizierte
Webhook-Route akzeptieren. Befehle niemals in einem öffentlichen HTTP-Endpunkt
annehmen.

## In den existierenden Live-Worker integrieren

Der derzeit auf Cloudflare laufende `rustup-bot` benutzt `/tg` als Telegram-Webhook
und besitzt zusätzliche Bots, Routen und Spielzustände. Sein vollständiger
Build-Quellcode ist nicht im derzeitigen Repository gesichert. **Niemals den
bestehenden Worker durch `worker.mjs` ersetzen.**

Stattdessen im vollständigen Quellcode des Hauptbots im bestehenden Handler
`onUpdate(upd,env)` *nach der Webhook-Secret-Prüfung* und vor der bisherigen
Command-Verarbeitung aufrufen:

```js
import {handleExistingBotPaymentCommands} from './integration/telegram-stars/live-bot-hook.mjs';

// In onUpdate(upd, env) VOR der bisherigen Verarbeitung:
if (await handleExistingBotPaymentCommands(upd, env, {
  isAdmin,      // vorhandene, Telegram-verifizierte Adminfunktion
  telegramApi: tg // vorhandener Telegram-API-Client des Hauptbots
})) return;
```

Pfad beim Bundling an das echte Repository anpassen; den bestehenden
Webhook `/tg`, `BOT_TOKEN`, `WEBHOOK_SECRET`, die weiteren Bot-Routen,
D1-Bindings und den vorhandenen Code beibehalten.

Für die Stars-Verarbeitung den **gleichen** Telegram-Webhook nutzen; niemals
ein zweites `setWebhook` mit dem gleichen Bot-Token ausführen. Nach
der Admin-Verarbeitung und vor dem bisherigen Update-Handler die
Zahlungs-Updates an die Adapter leiten. Bereits bestätigte Rechnungen
müssen auch nach einem Admin-Not-Aus nachweisbar und verarbeitbar bleiben.

## Tests und Freigabe

```powershell
cd "$HOME\RUST-UP-Local"
git fetch origin
git switch feature/rustup-payment-admin-controls
cd payments
node --test .\integration\telegram-stars\*.test.mjs
```

Die 18 vorherigen Integrationsprüfungen und die neuen Sicherheits-/Admin-Tests
arbeiten ausschließlich mit simulierten Transaktionen (0 EUR). Eine erfolgreiche
CI-Prüfung ist keine produktive Freigabe.

Die vorhandene `rustup-stars-staging`-Datenbank hat die drei Schalter
mit dem Anfangswert 0. Keine echten Zahlungsmittel, keine Gutschrift
von Case-/Upgrade-/auszahlbarem Spielguthaben und keine Auszahlung.

### Status der Live-Aktivierung

Der separate Test-Worker ist aktualisiert. **Der bisherige Live-Worker ist noch
NICHT mit dem Hook neu bereitgestellt worden.** Seine Original-Quellen liegen
nicht als editierbarer Quellcode im GitHub-Repository, sondern nur als gebauter
Cloudflare-Worker vor. Ein direkter Live-Eingriff in diesen Build wurde
abgebrochen, um vorhandene Secrets/Bindings und parallele Änderungen zu
schützen. Der fertige GitHub-Code kann eingebaut werden, sobald die originale
Hauptbot-Quelle und der normale Deploymentprozess vorliegen.

Vor dem Deploy alle ursprünglichen Cloudflare-Bindings inklusive
`BOT_TOKEN`, `WEBHOOK_SECRET`, `ADMIN_BOT_TOKEN`, `CLIPS_BOT_TOKEN`,
`FIRST_ADMIN`, `DB` sowie weitere aktuelle Bindings bewahren. Alte und
neue Versions-IDs festhalten, einen Preflight mit falschem Webhook-Secret
(403) prüfen und erst danach über den privaten Admin-Chat testen.
