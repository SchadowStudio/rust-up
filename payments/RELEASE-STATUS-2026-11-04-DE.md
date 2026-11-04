# RUST UP Payment Provider – Abschlussstand & Release-Gates (4.11.2026)

## Ziel

Ein **eigenständiger Headless-Krypto-Zahlungsprovider** für beliebig viele
später angeschlossene Projekte, nicht nur RUST UP. Kunden bezahlen BTC,
ETH, TRX oder USDT auf den unterstützten Mainnets. Projekte wählen den
Fiat-Rechnungswert in RUB, EUR oder USD. Die Anbieter-API bestätigt den
tatsächlichen Krypto-Eingang und versendet projektindividuell signierte
Webhooks. **Das Projekt** entscheidet, ob und wie Guthaben entsteht.

**Der Dienst ist weiterhin absichtlich nicht live.** Das ist eine
Sicherheitsgrenze, kein Beleg abgeschlossener Produktionsabnahme.

## In diesem Entwicklungsabschnitt umgesetzt

1. **Atomare, pro Projekt begrenzte On-demand-Zahlungsprüfung.** Eine
   neue D1-Tabelle begrenzt fehlerhafte/manipulierte Verifizierungsversuche
   pro Projekt und Minute, ohne Projekt-API-Schlüssel im Browser abzulegen.
2. **Post-Settlement-Audits.** Bereits bestätigte Zahlungen werden über
   unabhängige RPC-Mehrfachprüfung nachkontrolliert, auch wenn der
   Projekt-Webhook schon zugestellt wurde. Nach wiederholten Problemen
   erscheint ein manueller Prüfungsfall. Keine gefälschte Rückerstattung,
   kein heimlicher Abzug im Zielprojekt.
3. **Emergency-Pause mit funktionierenden Bestands-APIs.** Der Schalter
   `MULTI_LIVE_ENABLED=false` blockiert neue Einzahlungen. Authentifizierte
   Projekte können bestehende Rechnungen und Ereignisse weiterhin abrufen
   und ihre Zustellungsprobleme beheben.
4. **Optionale automatische Teilzahlungskombination.**
   `MULTI_PARTIAL_AGGREGATION_ENABLED=true` aktiviert die Zusammenrechnung
   mehrerer bestätigter Blockchain-Transaktionen **für dieselbe Rechnung**.
   Chain-/Projektübergreifende Wiederverwendung von TX-Hashes ist durch
   einen globalen Datenbank-UNIQUE-Schlüssel gesperrt. Maximal acht Teile;
   darüber manuelle Prüfung. Sämtliche Teile werden erneut unabhängig
   verifiziert, bevor ein einzelnes signiertes Bezahl-Ereignis entsteht.
   Der Event-Payload enthält bei kombinierten Zahlungen
   `transactionHashes` und `paymentMode=combined_chain_transfers`.
5. **Dauerhafte Teilzahlungs-Wiederholung.** Die Datenbank verwaltet
   eine eigene Warteschlange `v2_partial_reconcile_queue`, damit auch
   parallele Transaktionen nach einem Neustart oder einem Race-Condition-
   Fehler noch gemeinsam verarbeitet werden können.
6. **Überzahlungen als manuelle Fälle.** Wenn ein Kunde mehr Krypto
   sendet als gefordert, kann die Rechnung erfüllt werden; der abweichende
   Betrag wird als Support-Fall markiert. Der Provider besitzt keine
   privaten Schlüssel und darf keine Refunds automatisch versenden.
7. **Read-only Produktions-Preflight.** Der Betreiber kann ohne Website
   prüfen, ob Konfiguration, Empfängeradressvorrat, Kursversorgung,
   Projekt-Webhooks und Blockchain-Audits bereit sind.

## Sichere Standardeinstellungen

Alle neuen Funktionen bleiben ohne ausdrückliche Freigabe deaktiviert:

```toml
MULTI_LIVE_ENABLED = "false"
MULTI_OPERATOR_APPROVED = "false"
MULTI_RECONCILE_ENABLED = "false"
MULTI_PARTIAL_AGGREGATION_ENABLED = "false"
MULTI_AUTO_QUEUE_ENABLED = "false"
MULTI_DELIVERY_ENABLED = "false"
MULTI_AUTO_SCAN_ENABLED = "false"
MULTI_VERIFY_PER_MINUTE = "30"
MULTI_PARTIAL_RECONCILE_BATCH = "10"
MULTI_RECONCILE_BATCH = "10"
```

`MULTI_RECONCILE_ENABLED` ist Voraussetzung für das Freischalten
neuer Zahlungen. Für das sichere Ausführen von Unit-Tests müssen **keine**
echten Wallets oder Blockchain-Secrets verwendet werden.

## Auf Windows testen

```powershell
git fetch origin
git switch feature/self-hosted-crypto-payments
cd .\payments
npm run validate
python -m unittest discover -s tests -p 'schema*_test.py' -v
```

Nach dem Deploy des **privaten** eigenen Cloudflare-Gateways kann der
Betreiber den ausschließlich lesenden Preflight starten.
Dafür müssen `PAYMENTS_ADMIN_URL` (HTTPS-Origin) und
`PAYMENTS_ADMIN_KEY` in der privaten Shell-Sitzung gesetzt werden:

```powershell
npm run preflight
```

Dieser Befehl **ändert keine Einstellungen**, erzeugt keine Rechnungen
und gibt keine API-Secrets aus. Er kann fehlende Voraussetzungen
erkennen, ersetzt aber keine Testüberweisung oder externe Sicherheitsprüfung.

## Zwingend noch offen – Release BLOCKED

**Ohne diese Schritte wäre die Aussage „produktionsfertig“ falsch:**

- Persönliche, verifizierte Trust-Wallet-Verbindung und ausreichend viele
  eindeutige **öffentliche** Empfangsadressen. Die Plattform kann keine
  unbegrenzten Wallet-Konten aus einem normalen Trust-Wallet-Connect
  ableiten. Private Schlüssel und Seed-Phrases dürfen nie auf den Server.
- Cloudflare Workers/D1/Queues, echtes Hosting, gesicherte Keys,
  signierte Webhook-Endpunkte und unabhängige Blockchain-Knoten auf
  einem vom Betreiber kontrollierten Account verbinden.
- Bitcoin-/Ethereum-/TRON-Mainnet-Testzahlungen, Auszahlungs-/Refund-
  Testverfahren unter persönlicher Wallet-Kontrolle und Proof-of-Control
  der Empfangsadressen durchführen.
- Tatsächliche Backup/Restore-Tests, Datenschutz- und gesetzliche
  Betreiberpflichten, PCI-/AML-/VASP-Abklärung je Geschäftsmodell und
  Rechtsraum. Keine rechtliche Freigabe wird durch Unit-Tests ersetzt.
- Echte automatische Reorg-Kompensation in angeschlossenen
  Projekten: Das jetzige System **erkennt und eskaliert** verdächtige
  post-settlement Situationen, löscht aber nicht rückwirkend
  Projektguthaben. Ein solches automatisches Reversal wäre ohne
  abgestimmte Integrationsverträge riskant.
- Vollständige automatisierte Erstattungsbearbeitung: Absichtlich
  nicht implementiert, denn sie würde Wallet-Auszahlungsberechtigungen
  erfordern; zunächst betreiberseitiger, protokollierter Prozess.
- Echte Hochlast-/Failover-/Sicherheitsaudits und Sharding nach
  gemessenen D1-/RPC-/Indexer-Grenzen. Das vorhandene einfache
  Blockchain-Cron-Polling hat feste Scan-Grenzen und ist noch
  **kein** Hochlast-Indexer.
- Weitere Coins (z. B. SOL oder USDC): Sicherer Scaffold vorhanden,
  aber neue Chains/Token-Verifier, Kursquellen und Testnet-/Mainnet-
  Abnahmen müssen einzeln implementiert werden. Nicht automatisch
  durch Hinzufügen eines Symbols aktivieren.
- Plattformregeln: Digitale Güter in Telegram Bots/Mini Apps müssen
  nach den geltenden Telegram-Bedingungen über Stars abgewickelt werden.
  Keine externe Krypto-Alternative zur Umgehung dieser Regeln anbieten.

## Entscheidung

**Softwaregrundlage: funktionsreich und automatisch getestet.**
**Produktionsfreigabe: NEIN, bis Echtbetrieb und Wallet nachgewiesen.**

Niemals absolute Anonymität, unbegrenzte Skalierung oder 100% Uptime
behaupten. Blockchain-Einzahlungen sind öffentlich nachvollziehbar;
Provider/Zahlungsprotokolle sollten nur minimal nötige pseudonyme Daten
speichern und Aufbewahrungspflichten erfüllen.


## Zusatzänderungen im Entwicklungsbranch (4.11.2026)

- Merchant-Webhooks werden bei **offenem** Blockchain-Streitfall oder
  manuellem Payment-Review zurückgehalten; es gibt keinen stillen Durchgriff
  auf eine bereits gutgeschriebene Kundenwallet.
- TON-Scanner kann bei HTTP-/Schema-Ausfall des Primär-Indexers
  konfigurierten SECONDARY/TERTIARY-Indexer zur **Entdeckung** verwenden.
  Ein Zahlungsfund wird weiterhin unabhängig per Blockchain-Quorum geprüft.
- Authentifiziertes `GET /v2/incidents` und `incidents()` im
  Projekt-Client erlauben projektspezifische Nachkontrolle, auch **nach**
  einer zugestellten Zahlung. Vorhandene Einträge sind maximal 100 pro
  Kategorie; operatives Monitoring ist weiterhin Pflicht.
- `npm run gate:release -- ./release-evidence.json` prüft
  einen privaten, commitgebundenen, zeitlich begrenzten manuellen
  Nachweiskatalog **zusammen mit** dem Remote-Preflight.
  Die Vorlage befindet sich in `release-evidence.example.json`;
  Anleitung: `RELEASE-EVIDENCE-GATE-DE.md`.
- Neue Regressionstests für Webhook-Sperren, TON-Indexer-Failover,
  projektspezifische Incident-Abrufe und Release-Gates.

**Wichtig:** Alle neuen Schutzmechanismen sind Software und automatische
Tests, **keine** Freigabe für reale Gelder. Produktionsfreigabe weiterhin
`RELEASE BLOCKED`, bis Wallet, Infrastruktur, unabhängiger Audit und
Mainnet-Testfälle vom Betreiber nachgewiesen sind.
