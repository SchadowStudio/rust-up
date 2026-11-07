# RUST UP Telegram Stars — technische Freigabe, 6. November 2026

**Status: NO LIVE CHARGES.** Dieser Bericht ist ein überprüfbarer Entwicklungsstand, keine Zahlungsfreigabe.

## Aktive Systeme

- Aktuell zuletzt durch Nutzer-Logs bestätigter Cloudflare Worker: `rustup-bot` Version `d618b572-ae34-4ec5-9e0e-471df5cbcfe2`. Die Preis- und History-API laufen damit.
- Betreiberkurs: **1 Telegram Star = 1,83 RUB**. Ganze Stars; Preiswerte als ganzzahlige Kopeken.
- Live-Stars-Rechnungen, Spielerkonto-Gutschriften und Zahlungsfreigabe bleiben **OFF**.
- Beide D1-Datenbanken und der ursprüngliche Bot samt Cron-Handler wurden bei den zuletzt erfolgreichen Veröffentlichungen erhalten. Ein erneuter Cloudflare-Read hatte später HTTP 503; nicht daraus auf Ausfälle des Workers schließen.

## Fertig und offline getestet

1. Serverauthentifizierte Stars-Preisabfrage und Spieler-History.
2. `v:<UUID>` Telegram `pre_checkout_query`/`successful_payment`-Dispatch; andere Bot-Funktionen unangetastet.
3. Idempotente Speicherung bezahlter Orders und Quarantäne für doppelte/abweichende Rechnungsbelege.
4. Neuer Fail-Closed-Schutz: Ohne serverseitig eingefrorene, dauerhafte Game-Coin-Gutschrift **kein InvoiceLink und keine Pre-Checkout-Freigabe**.
5. Additive D1-SQL-Migration `variable-stars-delivery-queue.sql` für persistente Zustellaufträge mit Retry, Lease, manueller Prüfung und Abbruch vor Zustellung erstatteter Orders.
6. `stars-delivery-queue.mjs`: eigener, vollständig abgeschalteter Settlement-Consumer nutzt bestehenden geprüften Telegram-Beleg und atomischen Spielerkonto-Trigger; Crash-/Replay-/Parallelitäts-/Refund-Tests mit in-memory SQLite.
7. Erweitertes `scheduled`-Dispatch der aktuellen Bot-Version: bestehender Cron läuft zuerst; Settlement nur bei zusätzlichen, separat freigegebenen Schaltern.
8. Source-Map-sichere private Worker-Recovery, Build-/Dry-Run- und post-deployment Verifier im Feature-Branch.

## Offene zwingende Live-Freigabepunkte

- **Checkout noch im Code gesperrt:** `stars-variable-bridge.mjs` enthält weiterhin einen Build-Time-Lock; `stars-history-only-wrapper.mjs` blockiert `/checkout`. Ein korrekt und sicher freigegebener Checkout benötigt den aktiven, geprüften Quote-Freezer, frische Kursquelle, Konto- und Zahlungskontrollen.
- **Delivery-Migration noch nicht live eingespielt:** SQL ist im Repository. Installation nur auf PAYMENTS_DB nach Backup, Prüfung und kontrollierter Migration; nicht auf GAME D1.
- **Refund-/Spielergutschrift-Abgleich noch nicht durchgängig live:** `verified-stars-game-refund.mjs` ist offline getestet, aber das variable Refund-Admin-Modul sperrt Rückerstattungen nach aktivierter Game-Credit-Bridge bewusst. Kein Live-Checkout vor einer sicheren, überprüften Refund- und Ausgleichsstrategie.
- **Keine echte Telegram-Stars-Zahlung oder Live-Game-Credit-Gutschrift durchgeführt.** Telegram Test-Environment und operative Belastungsproben stehen aus.
- **Unabhängige Freigabe/Nachweise:** Kontoidentität, Chargeback-/Refund-Streitfall, Wiederholungsverhalten, Reconciliation und Admin-Abschaltung müssen im echten System geprüft werden.

## Sicherer nächster Schritt (keine Echtgeld-Freigabe)

```powershell
cd "$HOME\RUST-UP-Local"
git pull --ff-only origin feature/rustup-payment-admin-controls
if ($LASTEXITCODE -ne 0) { throw "Git Pull fehlgeschlagen" }
powershell -ExecutionPolicy Bypass -File ".\payments\scripts\prepare-current-stars-webhook-only.ps1"
```

Danach nur bei grünem Dry-Run und versionsgleichem Build `release-current-stars-webhook-only.ps1` mit dem privaten StageFolder ausführen. Standard ohne `-PublishWebhookOnly` veröffentlicht nichts. Mit diesem Schalter wird ausschließlich die deaktivierte Webhook-/Cron-Erweiterung publiziert; **keine zahlungspflichtigen Rechnungen oder Spielgutschriften**.

**Zahlungsschalter, Datenbank-Release-Gate und Provider-Zahlungen niemals allein aufgrund bestandener Unit-Tests freigeben.**
