# RUST UP Payments V2 – projektübergreifende Architektur

**Status: Entwicklungsbranch, nicht produktiv.** Der bestehende RUST-UP-Worker
wird nicht verändert. Ein eigener Cloudflare-Zugang, Trust-Wallet-Freigaben,
Ratenanbieter, Blockchain-RPCs und Zielprojekt-Backends fehlen noch.

## Ziel und Währungen

Die Plattform bedient beliebig viele getrennte Projekte mit unabhängigen
Produkten, API-Schlüsseln, Rechnungen, Buchungsereignissen und Webhooks.

| Rechnungswährung | Speichereinheit | Beispiel |
| --- | --- | --- |
| RUB | Kopeken | 5000 = 50,00 ₽ |
| EUR | Eurocent | 5000 = 50,00 € |
| USD | US-Cent | 5000 = 50,00 $ |

**Der Rechnungsbetrag ist Fiat; die Einzahlung ist Krypto.** Zum Bezahlen
stehen BTC, ETH, TRX, USDT-ERC20 und USDT-TRC20 zur Verfügung. Das
Empfangs-Wallet ist Trust Wallet des Plattformbetreibers. Kunden können
jedes kompatible Wallet verwenden.

Der Server berechnet aus Fiat-Minus-Einheiten und einem zeitlich begrenzten
Kurs einen in Krypto-Atomeinheiten fixierten Rechnungsbetrag. Ausschließlich
BigInt-Integer-Arithmetik, aufgerundet. **Der Browser darf keine Preise,
Kurse oder Empfangsadressen bestimmen.**

## Projektisolation und minimale Daten

- Ein Projekt wird nur durch den Betreiber registriert und bekommt einen
  zufälligen 256-Bit-API-Schlüssel. In D1 liegt **nur dessen SHA-256-Hash**.
- Jedes Projekt hat eigene Produkte, Rechnungskontingente und Webhooks.
  Projektzugriffe benötigen den eigenen Schlüssel und die Projekt-ID.
- Kunden werden zentral **nicht** mit Name, E-Mail, Telefonnummer,
  Telegram-/Steam-ID, IP-Adresse, privaten Wallet-Schlüsseln oder Seed Phrase
  erfasst. Stattdessen übergibt das Projekt ein zufälliges Bestell-UUID.
  Die Identität des Nutzers bleibt in seiner eigenen Projektdatenbank.
- Das zentrale System speichert notwendige Projekt- und Rechnungs-IDs,
  Transaktions-Hashes, Netzwerk, Empfangsadresse, Beträge und Zeitstempel
  für Zuordnung, Buchungsprüfung und Rückabwicklung.
- **Pseudonymität ist nicht vollständige Anonymität.** Blockchain-Transfers
  sind öffentlich. Infrastruktur-/RPC-Provider und Cloudflare können
  Netzwerkmetadaten verarbeiten. Keine Anonymitätsgarantie!
- Aufbewahrung der Buchungsnachweise muss gesetzliche und operative
  Anforderungen erfüllen; automatische Löschung darf nicht die
  Duplikat- und Auditkontrollen zerstören.

## Verzeichnis

- `src/multi/api.js` – mandantenisolierte Server-zu-Server-API
- `src/multi/admin.js` – Betreiber-Onboarding, Schlüssel/Produkte/Preise
- `src/multi/fiat.js` – RUB/EUR/USD und exakte BigInt-Kursrechnung
- `src/multi/market.js` – Dual-Feed-Kurse (CoinGecko + CryptoCompare)
- `src/multi/fx-worker.js` – eigenständiger 10-Minuten-Kurs-Cron
- `src/multi/monitor.js` – kleiner Chain-Polling-Fallback
- `src/multi/candidate.js` – Queue-Consumer für Blockchain-Events
- `src/multi/settlement.js` – atomare, einmalige Verifikation
- `src/multi/delivery.js` – signierte Webhooks mit Wiederholung
- `multi-admin/` – Trust Wallet und Projektverwaltung
- `integration/project-ledger/` – Beispiel für sichere Gutschrift im Zielprojekt
- `integration/project-client.mjs` – wiederverwendbarer Server-Client
- `migrations/0005-0008*` – Multi-Projekt-, Kurs- und Queue-Schema

## Beispiel: Projekt einrichten

Alle folgenden Aktionen laufen auf deinem **eigenen** HTTPS-Gateway,
nicht auf `rustup-bot.ttzoomrust.workers.dev`.

Betreiber erstellt Projekt und registriert dessen zugelassenen
Webhook-Host unter `MULTI_WEBHOOK_HOST_ALLOWLIST`.
Der Betreiber-API-Schlüssel wird als Cloudflare Secret `MULTI_ADMIN_KEY`
gespeichert.

```http
POST /v2/admin/projects
Authorization: Bearer <MULTI_ADMIN_KEY>
Content-Type: application/json

{"label":"Demo EU","webhookUrl":"https://demo.example.com/internal/crypto/credit"}
```

Antwort enthält einmalig `projectId`, `apiKey`,
`webhookSigningSecret`. Die letzten beiden Werte **nur im jeweiligen
Projektserver** als Secrets speichern.

Produkt konfigurieren:

```http
POST /v2/admin/products
Authorization: Bearer <MULTI_ADMIN_KEY>
Content-Type: application/json

{"projectId":"<UUID>","sku":"rank_small","title":"Kleiner Rang",
 "currency":"EUR","amountMinor":500}
```

Das entspricht **5,00 €**. RUB und USD funktionieren identisch.
Das Produkt wird erst nach einer ausdrücklich bestätigten
Admin-Aktivierung zum Verkauf freigeschaltet.

Im Projektserver:

```http
POST /v2/invoices
Authorization: Bearer <PROJECT_API_KEY>
X-Project-Id: <PROJECT_UUID>
Idempotency-Key: <RANDOM_UUID_V4>
Content-Type: application/json

{"sku":"rank_small","asset":"USDT_TRC20",
 "projectOrderRef":"<RANDOM_UUID_V4>"}
```

Antwort enthält nur eingefrorenen Fiat-/Kryptobetrag, Netzwerk,
Empfangsadresse, Ablaufzeit und Rechnungs-ID. Ein Geheimschlüssel darf
niemals in eine öffentlich erreichbare Webseite oder Mini App gelangen.

```http
GET /v2/invoices/<INVOICE_UUID>
Authorization: Bearer <PROJECT_API_KEY>
X-Project-Id: <PROJECT_UUID>
```

Für Offline-Abgleich:
`GET /v2/events?after=<unix_ms>&afterEventId=<event_id>&limit=50`.
Der Cursor besteht aus Zeitstempel und Event-ID, damit Ereignisse
mit identischen Millisekunden nicht verloren gehen.

## Trust Wallet anschließen

1. Registriere dein eigenes HTTPS-Gateway, D1 und Cloudflare-Secrets.
2. Veröffentliche `payments/multi-admin/` hinter Cloudflare Access oder
   vergleichbarer Betreiber-Authentifizierung. Nur diesen HTTPS-Origin
   als `MULTI_ADMIN_ORIGIN` zulassen.
3. Über `Trust Wallet verbinden` autorisierst du am eigenen Browser
   **ausschließlich die öffentliche Ethereum-Adresse**.
4. BTC-/TRON-Empfangsadressen werden direkt aus Trust Wallet kopiert,
   gegen Prüfsummen validiert und zunächst deaktiviert gespeichert.
5. Prüfe jedes Netzwerk und die Adresskontrolle. Für BTC zusätzlich
   die Adresse in eine **Bitcoin-Core-Watch-only-Wallet** aufnehmen.
6. Erst nach einem kontrollierten Test Empfangsadressen freigeben.

**Keine Recovery Phrase, private Keys oder Signaturrechte für das Ausgeben
von Vermögen werden auf dem Server benötigt.** Für hohe parallele
Zahlungszahlen reichen einzelne Wallet-Adressen nicht: Es müssen
viele **tatsächlich kontrollierte, eindeutige Empfangsadressen** sicher
bereitgestellt werden. Das Projekt erzeugt keine neuen Wallet-Schlüssel.
Eine HD-Wallet-/xpub-Watch-only-Automation muss gegebenenfalls zusätzlich
geprüft werden; Trust Wallet stellt nicht automatisch beliebig viele
serverseitig verwaltbare Adressen zur Verfügung.

## Wechselkurse und Ausfallverhalten

- Ein separater Kurs-Worker fragt höchstens alle 10 Minuten zwei
  Marktdatenquellen ab. Beide müssen einen plausiblen, aktuellen Kurs
  liefern. Die Abweichung darf 2,5 % nicht überschreiten.
- Ein Preis verschiebt sich nicht nach Rechnungserstellung.
- Kurse laufen nach 30 Minuten ab. Fehlen gültige Kurse, wird
  für die entsprechende Kombination **keine neue Rechnung ausgestellt**.
- Bei Marktpreis-Sprüngen von mehr als 30 % gegenüber dem letzten
  akzeptierten Preis ist eine manuelle Prüfung erforderlich.
- Für die Kursanbieter sind separate API-Schlüssel nötig; sie sind
  **Marktdatenanbieter, keine Zahlungsabwickler**.

## Zahlungserkennung und Ausfallsicherheit

- Kleinere Installationen können die Blockchain via Cron und RPC scannen.
- Für hohe Last wird ein **eigener Blockchain-Indexer** benötigt, der
  Transaktionskandidaten an Cloudflare Queues sendet. Die Queue akzeptiert
  keine Zahlung als Beweis: Jeder Kandidat wird unabhängig erneut gegen
  die Chain-RPCs geprüft. Konfiguration mit Dead-Letter-Queue.
- Cloudflare Queues liefert standardmäßig mindestens einmal, nicht
  exakt einmal. Deshalb D1-`UNIQUE`-Schlüssel je Projekt/Bestellung,
  Adresse, Chain-Transaktion, Invoice und Gutschrift-Event.
- Projektgutschriften werden mit einem pro Projekt abgeleiteten
  HMAC-SHA256-Schlüssel signiert. Die Zielprojekt-Datenbank muss
  die Gutschrift **atomar und idempotent** buchen.
- Auch ein erfolgreich bestätigter Zahlungseingang ist nicht
  automatisch eine verbuchte Spielgutschrift: Der Projektserver
  muss das Webhook-Ereignis bestätigen.
- Bei Ausfall von Knoten, Kursfeeds oder DB werden neue Zahlungen
  gegebenenfalls gestoppt. Bestehende Aufträge bleiben in der
  Datenbank, Webhook-Zustellungen werden wiederholt.
- Verspätete Zahlungen und Reorgs dürfen nicht stillschweigend
  ignoriert oder fälschlich als neue Gutschrift behandelt werden:
  Sie benötigen eine manuelle Prüfungs- und Erstattungsroutine.

## Hochlast und Katastrophenfälle – noch nicht nachgewiesen

Wichtige technische Grenzen sind weiterhin offen:

- Ein einzelnes D1-Database-Backend ist keine unbegrenzt skalierbare
  Buchungsdatenbank. Bei echter Großlast: **Sharding je Projekt/Region**,
  getrennte Indexer, getrennte Abgleich- und Webhook-Queue-Worker,
  Lastverteilung und definierte Kapazitätsgrenzen.
- Regelmäßige verschlüsselte Offsite-Backups und erprobte Point-in-Time-
  Recovery; Wiederherstellung nur nach Probelauf im Staging freigeben.
- Unabänderliche Buchungsereignisse mit nachvollziehbarer Auditspur,
  Schlüsselrotation mit Übergangsphase und Alarme bei Queue-Backlog,
  fehlenden Kursen und RPC-Ausfall.
- Wiederherstellung nach Chain-Reorgs, Teilzahlungen, Überzahlungen,
  Refunds und vermissten Zahlungen sind **noch nicht vollständig**
  implementiert und müssen vor Echtbetrieb ergänzt werden.
- Ein echter Lasttest (p95/p99-Latenz, Fehlerquote, Tagesvolumen,
  Recovery Point/Time, D1-Limits, Queue-Backlog) muss auf deiner
  Cloudflare-Infrastruktur stattfinden. Unit-Tests beweisen das nicht.

**Absolute Sicherheit, vollständige Anonymität und Null-Ausfallrisiko sind
technisch nicht garantierbar.** Die Architektur bevorzugt bei Unsicherheit
das Unterbrechen neuer Rechnungen gegenüber falschen Buchungen.

## Live-Schaltung

Der Multi-Worker ist standardmäßig deaktiviert.
Nur du kannst nach erfolgreichem Infrastruktur-, Wallet-, Ledger-,
Backup-, Sicherheits- und Lasttest die Freigaben setzen.

**Telegram-Hinweis:** Digitale Güter und Guthaben in Telegram
Bots/Mini Apps sind mit Telegram Stars zu bezahlen. Der
Krypto-Service ist als eigenständiges System vorgesehen; kein
Umgehen der Telegram-Plattformregeln.
