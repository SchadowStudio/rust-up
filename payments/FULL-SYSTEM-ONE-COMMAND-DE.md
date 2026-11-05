# RUST UP: Vollständiger automatischer Systemcheck

Dieses Skript ist ein einziger, **nicht zahlender** Prüflauf für:
- Multi-Projekt-Kryptozahlungsprovider, Blockchain-Adapter und Buchungslogik
- Telegram Stars, frei wählbare Beträge, Rechnungen, Refund-Schutz
- Telegram Mini App, Bot-Quellcodewiederherstellung und Release-Schutz
- Bestehende Rust-Up-Spielkonten und Integritäts-/Importprüfungen
- Getrenntes, nicht auszahlbares Demo-Wallet

## Einmalig alles prüfen

~~~powershell
cd "$HOME\RUST-UP-Local"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\run-entire-rustup-check.ps1"
~~~

Wird das Skript beim ersten Versuch nicht gefunden, vorher
"git pull --ff-only origin feature/rustup-payment-admin-controls"
ausführen. Das Skript synchronisiert anschließend den aktuellen Branch,
prüft das System offline und führt die vorhandenen Cloudflare-Stars-Audits
nur lesend aus (lokal angemeldeter Wrangler wird vorausgesetzt).

Optional ohne Cloudflare-Zugang:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\run-entire-rustup-check.ps1" -OfflineOnly
~~~

Bericht: "payments/.local-test-results/system-last-run.json".
Er enthält ausschließlich Ergebnisstatus und Dauern, keine Tokens oder Belege.
Bei einem Fehler bricht der Lauf ab, meldet den betroffenen Bereich und gibt
kein Freigabesignal. Skript und Tests sind ausdrücklich **keine**
Produktions-Freigabe und führen niemals echte Zahlungen aus.

## Vollständiger Stars-Test in EINEM Durchlauf

Separate Telegram-Testumgebung und eigenen Testbot verwenden. Kein echter
RUST-UP-Produktivbot, keine echten Stars, keine Spieleinzahlungen.

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\run-telegram-stars-test.ps1" -Action fulltest -TestUserId 123456 -Stars 7
~~~

Die Beispiel-ID 123456 durch die **echte Testkonto-ID** ersetzen.
Der Token wird einmal lokal und verdeckt abgefragt, nie in GitHub gespeichert.
Das Skript erzeugt eine **Testrechnung**, zeigt den Testlink und verarbeitet
anschließend Test-Zahlung, bestätigte Testzustellung und automatische
**Test-Rückerstattung**. Die Bedienung des Telegram-TEST-Clients (Rechnung
öffnen und ausdrücklich bezahlen) ist eine externe Benutzeraktion, die das
Skript nicht übernehmen kann.

Der Ablauf ist automatisch, aber **ein Programmtest mit Mock-Antworten
ist kein echter Telegram-End-to-End-Nachweis**. Solange keine
Testbestätigung und keine gültige Zustellung vorliegt, darf der Runner keine
Erstattung versuchen. Bei unklarem Ergebnis folgt manuelle Prüfung.

## Betreiberkurs

Telegram definiert keinen global einheitlichen festen RUB-Preis pro Star für
alle Kunden. Der Betreiber kann selbst einen Quote-Wert festlegen, wenn ein
freier RUB-Eingabebetrag in Stars umgerechnet werden soll:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\setup-stars-operator-rate.ps1"
~~~

Eine **nicht zahlende** Preisvorschau wird vorbereitet; das Skript aktiviert
keine Stars-, Krypto- oder Spielguthaben-Zahlungen. Der Betreiberwert ist
eine ausdrückliche Preisentscheidung, keine vorgetäuschte Telegram-Wechselrate.

## Was nicht automatisiert oder freigegeben wird

- Echter Zahlungsabschluss mit einem bereits existierenden Nutzer ohne dessen
  explizite Zahlung in Telegram; das ist nicht ersetzbar.
- Echtgeld-Stars-/Krypto-Gutschriften in Spielguthaben für Cases, Wetten,
  Upgrades, Skinauszahlungen oder ähnliche Einsätze.
- Ein Produktiv-Go-live ohne konkret bestimmte nichtauszahlbare Leistung,
  gültige Test-/Refund-Nachweise, Operator-Kontrolle und Abnahme.
