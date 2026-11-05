# RUST UP – Vorbereitungen ohne den RUB/Stars-Kurs
Stand 05.11.2026. Technische Freigabeprüfung für das vorhandene Telegram-Mini-App-Projekt.

## Absichtlich nicht konfiguriert
Die vier Werte STARS_MIN_RUB_MINOR, STARS_MAX_RUB_MINOR,
STARS_RUB_MINOR_PER_STAR_NUM und STARS_RUB_MINOR_PER_STAR_DEN bleiben offen.
Hier wird kein Kurs angenommen, geschätzt oder automatisch hinterlegt.

## Tatsächlicher Live-Stand (read-only geprüft)
- Die bestehende Mini App zeigt die bereinigte variable Stars-/RUB-Eingabemaske.
- Die Spielerkonto-Datenbank enthält die Tabellen accounts und grants.
- Die getrennte Zahlungs-D1 enthält rustup_stars_variable_orders, Zahlungsschalter,
  Refund-/Incident-Tabellen.
- Variable Stars-Aufträge: 0; als bezahlt registriert: 0.
- Manuelle Fälle, unerledigte Refunds und Receipt-Incidents: 0.
- Alle 7 harten Zahlungsflags OFF; Master/Stars/Krypto-Schalter in D1 OFF.
- Im Live-Worker ist die strikte Kontrolle des importierten Spielzustands vorhanden.
- Die neue persistierte Rechnungslink-Prüfung ist im Entwicklungs-Branch,
  NICHT im Live-Worker veröffentlicht.
- Eine Tabelle rustup_verified_deposit_credits zur serverseitigen Buchungsverfolgung
  existiert in der Spiel-D1 noch NICHT.

## Vorbereitet im GitHub-Branch
- Variable Stars-Invoice- und Belegtests mit serverseitiger Telegram-Identität,
  wiederholungsfesten Rechnungen und Receipt-Prüfung.
- Prüfer account-link-audit.mjs ordnet dokumentierte Stars-Aufträge zum
  kanonischen accounts.id zu, ohne Spielguthaben zu verändern.
- Demosettlement mit künstlichen Belegen und einem ausschließlich simulierten,
  nicht auszahlbaren Wallet, inklusive Replay- und Refund-Tests.
- Neuer Prüfer scripts/variable-stars-prelaunch.mjs inspiziert Worker,
  beide Live-D1-Datenbanken, offene Störungen und Mini-App ausschließlich lesend.
  Der User-Preis wird bewusst nicht benötigt.
- Tests und ausführbares Windows-Skript sind vorhanden.

## Windows: jetzt ohne Preis alle lesbaren Prüfungen ausführen
cd "$HOME\RUST-UP-Local"
powershell -ExecutionPolicy Bypass -File ".\payments\scripts\variable-stars-prelaunch.ps1"

Das Skript kann mit Exitcode 2 enden: Dann wurden noch offene Freigabeblocker
gefunden; das ist NICHT gleichbedeutend mit einem Codefehler. API-Tokens
bleiben privat auf dem lokalen PC und dürfen nicht in Chats kopiert werden.

## Noch nicht erfüllt / darf nicht als Echtgeld-Launch bezeichnet werden
- Keine produktive, atomare Gutschrift im accounts.state.balance für
  Stars-Zahlungen. Die simulierte Wallet darf nicht auf live umgeschaltet werden.
- Keine unabhängige echte Telegram-Zahlung mit nachgewiesenem Auslieferungs-,
  Erstattungs- und wiederholungsfestem Buchungsablauf.
- Kein Nachweis, dass das konkret monetarisierte Case-/Battle-Angebot von
  Betreiber-, Rechts- und Plattformfreigaben abgedeckt ist.
- Kein zertifizierter Ende-zu-Ende-Last-/Ausfalltest der produktiven Zahlungswege.
- Keine Stars-Preisfestlegung durch den Betreiber (bewusst verschoben).

**Echtgeldzahlungen und jegliche Echtgeldgutschrift für Cases, Upgrades,
Case Battles oder auszahlbares Spielguthaben sind NICHT aktiviert.**
Es gab keine Live-DB-Migration, kein Worker-Deployment und keine Echtgeldzahlung
durch diese Vorbereitung.
