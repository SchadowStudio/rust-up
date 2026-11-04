# RUST UP – Cloudflare Staging Status (4. November 2026)

**ACHTUNG: Keine realen Zahlungen aktiviert.**

Neue isolierte Ressourcen im RUST-UP Cloudflare-Account:

- Worker: rustup-stars-staging
- Neue D1: rustup-stars-staging
- D1 UUID: 06079270-a227-466a-9991-abd4201ec5f6
- Worker-Binding DB verweist auf diese Staging-D1.
- Script-Subdomain per API enabled=true, previews_enabled=false.
- STARS_PAYMENT_ENABLED = false
- STARS_VARIABLE_TOPUP_ENABLED = false
- STARS_FIXED_PRODUCTS_ENABLED = false
- STARS_ALLOWED_ORIGIN = https://example.invalid (Placeholder, kein produktiver Origin)
- Telegram Stars test bot token: nicht konfiguriert
- Telegram webhook secret: nicht konfiguriert
- 6 Staging-Tabellen sind angelegt: rustup_stars_products, rustup_stars_orders, rustup_stars_variable_orders, rustup_external_fixed_products, rustup_external_fixed_orders, rustup_external_variable_orders.
- Die zunächst am D1-Free-Tier-Limit gescheiterte variable-migration.sql wurde nach dem Tarif-Upgrade vollständig eingespielt; alle fünf Migrationseinzelbefehle waren erfolgreich.
- Der Staging-Worker wurde mit variable-stars.mjs neu bereitgestellt und die neue DB-Bindung anschließend per API bestätigt.
- Echte Einzahlungen, automatische Spielguthabenbuchungen und Cashouts bleiben deaktiviert.
- Live Worker rustup-bot und Live D1 rustup-stats wurden NICHT geändert.

## Manuell von Windows aus überprüfen

Mit dem lokalen curl die Test-URL prüfen (von dieser Arbeitsumgebung aus war kein DNS-Zugriff möglich):

    curl.exe -i https://rustup-stars-staging.ttzoomrust.workers.dev/health

Erwartung: HTTP 200; JSON mit liveEnabled:false und realGameCredits:false.

Falls die URL nicht erreichbar ist, Cloudflare Workers & Pages > rustup-stars-staging > Triggers/Subdomain prüfen. Eine erfolgreiche API-Subdomain-Freigabe belegt nicht bereits eine erfolgreiche externe HTTP-Abfrage.

## Nächster sicherer Schritt

Zunächst einen separaten Telegram-Testbot (NICHT rustuper_bot) erstellen, die Variabel-Einzahlungsbetragskonfiguration und den serverseitigen Stars-Kurs ausdrücklich festlegen sowie einen rechtlich zulässigen, nicht auszahlbaren Verwendungszweck prüfen. Die Feature-Flags bleiben bis zu dieser Freigabe false; Refund/Support und idempotente Auslieferung sind noch offen. Bot-Token niemals im Chat oder im Repository posten, sondern als Worker-Secret setzen.
Produktiven RUST-UP-Worker keinesfalls blind mit diesen Staging-Modulen überschreiben.

Die eigene Crypto-Provider-Anbindung ist im Branch programmiert, aber weder deployed noch mainnet-freigegeben. Für Telegram-Mini-App-Digitalgüter keinen alternativen Kryptocheckout anbieten.

## Testqualität und ausstehende Schritte

- Letzter früherer GitHub-CI-Test vor der variablen Zahlfunktion war erfolgreich; die nachfolgenden Tests mit variable-payments.test.mjs waren beim letzten Check noch in GitHub Actions queued, daher noch **kein bestätigtes grünes Ergebnis** für die jüngste Änderung.
- Für den neuen Stars-Test-Worker sind TG_STARS_BOT_TOKEN und TG_STARS_WEBHOOK_SECRET noch nicht gesetzt. STARS_ALLOWED_ORIGIN ist weiterhin ein ungültiger Platzhalter.
- Der neue unabhängige Krypto-Checkout ist nur Quellcode im Branch. Multi-Projekt-Provider, echte Blockchain-RPCs, Empfangsadressen und Live-Tests fehlen weiterhin.
- Erneute Prüfung des Cloudflare-D1-Verbrauchs wird empfohlen, weil der ursprüngliche Account seine täglichen 5 Mio. gelesenen Datenbankzeilen erschöpft hatte. Upgrade verhindert nicht automatisch schlecht optimierte Abfragen oder zusätzliche Gebühren.
