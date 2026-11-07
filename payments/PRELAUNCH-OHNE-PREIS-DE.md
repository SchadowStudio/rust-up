# RUST UP – Vorbereitungen und festgelegter Stars/RUB-Kurs
Stand 05.11.2026. Technische Freigabeprüfung für das vorhandene Telegram-Mini-App-Projekt.

## Kursauswahl des Betreibers (05.11.2026)
Die vom Betreiber gelieferte Screenshot-Tabelle setzt 1.000 Stars = 1.871,59 RUB.
`payments/stars-owner-rate.json` speichert den exakten rationalen Referenzkurs:
`STARS_RUB_MINOR_PER_STAR_NUM=187159`, `STARS_RUB_MINOR_PER_STAR_DEN=1000`.
Rechnungsbeträge werden auf ganze Stars **aufgerundet**. Beispiel: 1.000 RUB
entsprechen 535 zahlbaren Stars. Das ist ein gewählter Anzeige-/Angebotskurs,
kein offizieller oder garantierter Telegram-Auszahlungswechselkurs.

Der Wert ist im Entwicklungsrepository gespeichert. Ob derselbe Wert auch im
aktiven Cloudflare Worker liegt, wird separat read-only geprüft. Diese
Kurswahl aktiviert weder Zahlungen noch die Spielerkonto-Gutschrift.

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
  Das Skript gleicht den festgelegten Kurs zusätzlich mit Live-Variablen ab.
- Tests und ausführbares Windows-Skript sind vorhanden.

## Windows: Prüfung mit hinterlegtem Kurs ausführen
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
- Die im Repository festgelegten Kursvariablen müssen auf dem Live-Worker
  erst kontrolliert mit dem gewählten Wert abgeglichen werden.

**Echtgeldzahlungen und jegliche Echtgeldgutschrift für Cases, Upgrades,
Case Battles oder auszahlbares Spielguthaben sind NICHT aktiviert.**
Es gab keine Live-DB-Migration, kein Worker-Deployment und keine Echtgeldzahlung
durch diese Vorbereitung.

## Technische Ergänzung: Beleg- und Rückerstattungssicherheit (05.11.2026)
- Abweichende variable Telegram-Stars-Belege werden jetzt im Entwicklungsbranch
  in `rustup_stars_receipt_incidents` aufgezeichnet, **bevor** der Webhook
  den Auftrag als erledigt bestätigt. Doppelte Belege erzeugen keine doppelte
  Incident-Buchung. Unvollständige Beweise führen zu einem Fehler statt
  stiller Anerkennung.
- `variable-refunds.mjs` und `variable-refunds.test.mjs` enthalten eine
  operatorautorisierte, explizit bestätigte Rückerstattungsroutine mit
  einzigartiger Reservierung vor dem externen Telegram-Aufruf. Unklare
  Telegram-Antworten werden für manuelle Klärung gesperrt und **nicht**
  erneut automatisch refundiert.
- Die additive Tabelle `rustup_stars_variable_refund_intents` und ihr
  Prüfindex wurden in der isolierten Cloudflare-Zahlungs-D1 erstellt.
  Kein Echtgeld wurde eingezogen oder erstattet; weder die Spiel-D1 noch
  das Live-Worker-Bundle wurden hierbei geändert.
- `variable-stars-prelaunch.mjs` prüft zusätzlich die
  Refund-Datenbanktabelle und eine gesonderte Finance-Admin-Allowlist.
  `PAYMENT_ADMIN_IDS` ist live noch nicht konfiguriert.
- Die neue Refund-Routine und der neue Incident-Belegpfad sind **nicht
  im Live-Worker veröffentlicht**. Ein erfolgreicher Offline-Test ist
  kein funktionierendes Live-Refund-System.
- Refunds verändern im Test keinen Spielsaldo. Falls Echtgeldguthaben
  für irgendwelche erlaubten Produkte entwickelt wird, ist die
  separate, nachvollziehbare Rücknahme der tatsächlichen Leistung
  ausdrücklich noch offen.
