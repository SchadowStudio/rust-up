# Mehrere Projekte – eigene Zahlungsintegration pro Projekt

**Gültiger Stand:** `feature/self-hosted-crypto-payments`.
Der Dienst ist ein eigenständiger Krypto-Zahlungsprovider. Er verändert weder
`main` noch das bisherige RUST-UP-Backend. Produktivbetrieb ist weiterhin
gesperrt, bis die eigene Infrastruktur und Trust Wallet verbunden sind.

## Konzept

Du verwaltest einen zentralen Provider und kannst jederzeit weitere Projekte
registrieren. **Jedes Projekt hat eine eigene Payment-Integration**, statt
dass alle Projekte dieselben Zugangsschlüssel, Webhooks oder Zahlungsregeln
teilen.

| Funktion | Pro Projekt getrennt? |
| --- | --- |
| Projekt-ID, Anzeigename und Aktivierung | Ja |
| Geheime Server-API-Schlüssel mit Rotation/Sperrung | Ja |
| Eigene Webhook-URL und getrennte HMAC-Signatur | Ja |
| Freigabe für Einzahlungen und/oder Produktkäufe | Ja |
| Akzeptierte Fiat-Rechnungswährungen RUB/EUR/USD | Ja |
| Akzeptierte Coins BTC/ETH/TRX/USDT ERC-20/TRC-20 | Ja |
| Mindest-/Höchstbetrag je Fiat-Währung | Ja |
| Rechnungsdauer 5–20 Minuten | Ja |
| Eigene Rechnungen, Transaktions- und Statushistorie | Ja |
| Eigene Zahlungsstatistik und Zustellungsstatus | Ja |
| Produktkatalog (optional) | Ja |
| Eigene Empfangs-Wallet mit Private Key im Provider | Nein |

**Empfang der Kryptowerte:** Deine verifizierten, öffentlichen
Trust-Wallet-Empfangsadressen werden zentral als Pool verwaltet.
Jeder Einzahlungsrechnung wird genau eine zuvor unbenutzte Adresse zugewiesen.
Die Rechnung ist eindeutig einem Projekt zugeordnet. Dadurch können mehrere
Projekte dieselbe Provider-Infrastruktur nutzen, ohne ihre Zahlungsdaten
oder API-Zugänge zu vermischen. Das System speichert keine Seed-Phrase und
keine privaten Schlüssel. Mehrere gleichzeitige Rechnungen benötigen viele
verifizierte Empfangsadressen, nicht eine einzige geteilte Adresse.

## Projekt anlegen und einrichten

1. In der Betreiberkonsole `/multi-admin/`: Projektname und
   zuvor genehmigte eigene HTTPS-Webhook-URL angeben.
2. Betreiber legt das Projekt an. Das System erzeugt:
   - eine Projekt-UUID,
   - einen zufälligen API-Key, nur einmal sichtbar,
   - einen projektspezifischen HMAC-Webhooksignaturschlüssel.
3. Projekt startet **gesperrt**. Alle drei Fiat-Währungen sowie alle
   fünf Coins starten ebenfalls gesperrt.
4. Im Abschnitt **Projekt-Zahlungsintegration** das Projekt wählen,
   Währungen, Mindest-/Höchstbeträge, Coins, Ablaufdauer und
   Rechnungsarten aktivieren.
5. Im Bereich **Zahlungen, API-Schlüssel und Webhooks pro Projekt** die
   Zahlungsübersicht einsehen, Schlüssel rotieren/sperren und den
   Ziel-Webhook ändern.
6. Projekt erst aktivieren, nachdem dessen separater Server-Webhook
   die signierten Zahlungsbestätigungen korrekt und idempotent verarbeitet.

Die Projektkonfiguration ist in folgenden Tabellen gespeichert:
`v2_project_payment_profiles`, `v2_project_fiat_methods` und
`v2_project_crypto_methods`. Die Migration lautet
`migrations/0012_project_payment_profiles.sql`.

## Betreiber-API für individuelle Projekt-Einstellungen

Der Betreiber benötigt `MULTI_ADMIN_KEY`; normale Projekte können die
Betreiber-API nicht aufrufen.

```http
GET /v2/admin/projects/<PROJECT_UUID>/payment-config
Authorization: Bearer <OPERATOR_KEY>
```

```http
POST /v2/admin/projects/<PROJECT_UUID>/payment-config
Authorization: Bearer <OPERATOR_KEY>
Content-Type: application/json

{
  "displayName": "Projekt A",
  "invoicesEnabled": true,
  "depositsEnabled": true,
  "productsEnabled": false,
  "invoiceLifetimeMinutes": 15,
  "confirmation": "CONFIRM_PROJECT_PAYMENT_SETTINGS"
}
```

```http
POST /v2/admin/projects/<PROJECT_UUID>/fiat-method
Authorization: Bearer <OPERATOR_KEY>
Content-Type: application/json

{
  "currency": "EUR",
  "enabled": true,
  "minMinor": 100,
  "maxMinor": 500000,
  "confirmation": "CONFIRM_PROJECT_PAYMENT_SETTINGS"
}
```

```http
POST /v2/admin/projects/<PROJECT_UUID>/crypto-method
Authorization: Bearer <OPERATOR_KEY>
Content-Type: application/json

{
  "asset": "USDT_TRC20",
  "enabled": true,
  "confirmation": "CONFIRM_PROJECT_PAYMENT_SETTINGS"
}
```

Zusätzlich gibt es für den Betreiber
`GET /v2/admin/projects/<UUID>/payments`,
`GET /v2/admin/projects/<UUID>/summary` und
`GET /v2/admin/projects/<UUID>/keys`.
Die Ergebnisse sind immer nach der Projekt-UUID gefiltert.
Geheime Schlüssel erscheinen **nicht** in der Schlüsselliste.

## API für das angeschlossene Projekt

Projekte authentifizieren sich nur serverseitig:

```http
GET /v2/methods
Authorization: Bearer <PROJECT_API_KEY>
X-Project-Id: <PROJECT_UUID>
```

Der Endpoint zeigt ausschließlich die für das betreffende Projekt
freigegebenen Fiat-Währungen, Grenzbeträge und Kryptowährungen.

```http
POST /v2/deposits
Authorization: Bearer <PROJECT_API_KEY>
X-Project-Id: <PROJECT_UUID>
Idempotency-Key: <RANDOM_UUID_V4>
Content-Type: application/json

{
  "currency": "EUR",
  "amountMinor": 2500,
  "asset": "USDT_TRC20",
  "projectOrderRef": "<RANDOM_UUID_V4>"
}
```

Beispiel: Projekt A akzeptiert EUR/USDT-TRC20 und erstellt eine
Rechnung über 25,00 €. Projekt B kann ausschließlich RUB/BTC aktivieren.
Projekt A erhält **keinen** Zugriff auf Rechnungen oder API-Schlüssel
von Projekt B.

## Einschränkungen vor der Live-Schaltung

- Cloudflare Workers, D1 und Queues auf dem eigenen Konto einrichten.
- Geheime Schlüssel, gültige Blockchain-RPCs und Kursanbieter konfigurieren.
- Öffentliche Trust-Wallet-Empfangsadressen durch dich verifizieren und
  kontrollierte Testzahlungen ausführen.
- Projekt-Webhooks und Wiederholungsfälle in echten Staging-Tests prüfen.
- Datenschutz-/Betriebskonzept, Abgleich, Lasttests, Backup und Recovery
  vor Produktivbetrieb abnehmen.
- Für digitale Güter in Telegram Bots/Mini Apps gelten weiterhin
  die Telegram-Stars-Vorgaben.

Die Existenz der Projektkonfiguration und erfolgreiche GitHub-Tests bedeuten
nicht, dass die echten Zahlungssysteme bereits verbunden oder live sind.
