# RUST UP – Cloudflare Staging Status (4. November 2026)

**ACHTUNG: Keine realen Zahlungen aktiviert.**

Neue isolierte Ressourcen im RUST-UP Cloudflare-Account:

- Worker: rustup-stars-staging
- Neue D1: rustup-stars-staging
- D1 UUID: 06079270-a227-466a-9991-abd4201ec5f6
- Worker-Binding DB verweist auf diese Staging-D1.
- Script-Subdomain per API enabled=true, previews_enabled=false.
- STARS_PAYMENT_ENABLED = false
- STARS_ALLOWED_ORIGIN = https://example.invalid (Placeholder, kein produktiver Origin)
- Telegram Stars test bot token: nicht konfiguriert
- Telegram webhook secret: nicht konfiguriert
- 4 Staging-Tabellen sind angelegt: rustup_stars_products, rustup_stars_orders, rustup_external_fixed_products, rustup_external_fixed_orders
- Live Worker rustup-bot und Live D1 rustup-stats wurden NICHT geändert.

## Manuell von Windows aus überprüfen

Mit dem lokalen curl die Test-URL prüfen (von dieser Arbeitsumgebung aus war kein DNS-Zugriff möglich):

    curl.exe -i https://rustup-stars-staging.ttzoomrust.workers.dev/health

Erwartung: HTTP 200; JSON mit liveEnabled:false und realGameCredits:false.

Falls die URL nicht erreichbar ist, Cloudflare Workers & Pages > rustup-stars-staging > Triggers/Subdomain prüfen. Eine erfolgreiche API-Subdomain-Freigabe belegt nicht bereits eine erfolgreiche externe HTTP-Abfrage.

## Nächster sicherer Schritt

Zunächst einen separaten Telegram-Testbot (NICHT rustuper_bot) erstellen, einen erlaubten festen, nicht übertragbaren Testartikel definieren und Refund/Support regeln. Bot-Token niemals im Chat oder im Repository posten, sondern als Worker-Secret setzen.
Produktiven RUST-UP-Worker keinesfalls blind mit diesen Staging-Modulen überschreiben.

Die eigene Crypto-Provider-Anbindung ist im Branch programmiert, aber weder deployed noch mainnet-freigegeben. Für Telegram-Mini-App-Digitalgüter keinen alternativen Kryptocheckout anbieten.
