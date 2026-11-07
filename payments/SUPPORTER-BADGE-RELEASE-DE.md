# RUST UP Supporter: sichere Auslieferung und Telegram TEST

## Das digitale Produkt

* SKU: supporter_badge_v1
* Produkt: RUST UP Supporter, dauerhaftes Konto-/Profil-Abzeichen
* Keine Spielvorteile, keine Coins, keine Wetten/Cases, keine Auszahlungen
* Nur für das eigene Telegram-Konto, weder handelbar noch übertragbar
* Entzug des Abzeichens bei bestätigter Telegram-Stars-Rückerstattung

## Zahlungsbeleg und produktive Auslieferung

Der existierende Bot validiert Telegram initData, Precheckout, Betrag,
Währung XTR, Auftrag, Nutzer und Telegram Charge-ID. Erst nach einer
bestätigten Zahlung und freigeschaltetem, unveränderlichem Liefer-Snapshot
erhält der Käufer das Supporter-Abzeichen. Ein bedingtes INSERT in einer
isolierten D1-Datenbank erzwingt eine eindeutige aktive Inhaberschaft.
Wiederholte identische Quittungen vergeben keine weiteren Abzeichen.
Die Besitzerabfrage erfordert eine signierte Telegram-Session.
Bei Rückerstattung werden Auftrag, Freischaltung, Abzeichen und
Refund-Protokoll in derselben Datenbank-Transaktion aktualisiert.

Die additive Badge-Migration ist bereits in PAYMENTS_DB angelegt. Die
Rust-Spiel-Datenbank wurde nicht verändert.

## Aktueller Freigabestand

* Entwicklungs-Code und Tests auf dem Feature-Branch: JA
* Separates LIVE-D1-Entitlement-Schema: JA
* Betreiberkurs RUB/Stars: NOCH NICHT FESTGELEGT
* Abzeichenpreis in Stars: NOCH NICHT FESTGELEGT
* Aktives Abzeichen-Angebot: NEIN
* Worker mit Abzeichen-Modul deployed: NEIN
* Geändertes Mini-App-Asset online: NEIN
* Echte Telegram-TEST-Zahlung und -Refund: NOCH NICHT DURCHGEFÜHRT
* Alle produktiven Zahlungsschalter: AUS

## Ein Kommando: Tests und Cloudflare-Dry-Run, kein Deployment

In PowerShell unter RUST-UP-Local:

    git pull --ff-only origin feature/rustup-payment-admin-controls
    powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\prepare-supporter-badge-release.ps1"

Der Befehl prüft die SQLite-Belegzustellung und Refund-Rücknahme,
überprüft die signierte Mini-App-Ansicht, sichert den exakten aktuellen
Bot privat, baut die neue Variante und führt einen Cloudflare-Dry-Run
mit allen Zahlungsschaltern OFF aus.

## Echter Telegram-TEST-Kauf

Testkonto auf Telegram TEST-Server anlegen, dort einen separaten Bot
über @BotFather registrieren. Details:
https://core.telegram.org/bots/features#dedicated-test-environment

Mit dem neuen Testkonto /start an den Testbot schicken und dann:

    powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\run-telegram-stars-test.ps1" -Action identify

Mit der eigenen Test-ID (nicht dem normalen RUST-UP Steam-Konto)
dann einen vollständigen Test mit 7 TEST-Stars starten:

    powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\run-telegram-stars-test.ps1" -Action fulltest -TestUserId 123456 -Stars 7

123456 durch die vom Testbot ermittelte TEST_USER_ID ersetzen.
Im Telegram TEST-Client den Rechnungslink öffnen und den Kauf bewusst
bestätigen. Der Test-Runner prüft danach Zustellung des TEST-Abzeichens
und führt die Erstattung über die Telegram TEST-API aus.

Ohne separates TEST-Bot-Token und Testkonto ist kein realer Telegram-
E2E-Nachweis möglich. Simulierte Tests sind kein Testkauf. Außerdem ist
der Stars-Kurs weiterhin offen: der feste Abzeichenpreis in Stars ist
technisch getrennt vom freien RUB-Betrags-Topup und wird nicht erfunden.
