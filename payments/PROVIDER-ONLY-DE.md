# Krypto-Zahlungsprovider – unabhängige Einzahlungen

**Status:** Entwicklung, nicht veröffentlicht. Alle Änderungen liegen nur auf
`feature/self-hosted-crypto-payments`. Der originale RUST-UP-Worker und
`main` bleiben unverändert.

## Was dieser Provider macht

Projekte können mit einem jeweils eigenen **serverseitigen API-Schlüssel**
eine Einzahlungsrechnung erstellen. Der Projektserver wählt einen Fiat-Wert
in **RUB, EUR oder USD** und die gewünschte Kryptowährung.

Der Kunde überweist **Kryptowährung**, nicht Euro, Rubel oder Dollar per Bank.
RUB/EUR/USD bestimmen den Rechnungswert; der Provider verwendet einen
geprüften, zeitlich begrenzten Kurs und berechnet die erforderliche Menge
BTC, ETH, TRX, USDT-ERC20 oder USDT-TRC20. Betrag und Kurs bleiben für diese
Rechnung festgeschrieben.

Nach ausreichenden Blockchain-Bestätigungen meldet der Provider eine
**Zahlungsbestätigung** an das zugehörige Projekt und speichert einen
einmaligen, wiederholbaren Zustellungsnachweis. Das Projekt entscheidet
später selbst, ob die Zahlung für einen Rang, ein Produkt oder Guthaben
verwendet wird. **Keine automatische RUST-UP-Guthaben-Umrechnung im Provider.**

## Neue API für Einzahlungen

Authentifizierte Server-zu-Server-Endpunkte:

```http
GET /v2/methods
Authorization: Bearer <PROJECT_API_KEY>
X-Project-Id: <PROJECT_UUID>
```

Liefert unterstützte Fiat-Währungen und Kryptowährungen.

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

Das bedeutet **25,00 € Rechnungswert**, bezahlt in **USDT auf TRON**.
Der aus EUR umgerechnete Krypto-Betrag kommt aus den gültigen
serverseitigen Kursen. Die gezeigte Menge ist nicht vorab festgelegt.

Andere Kombinationen:

- `{"currency":"RUB","amountMinor":10000,"asset":"BTC", ...}` = 100 ₽
  Rechnungswert, Bezahlung in BTC.
- `{"currency":"USD","amountMinor":5000,"asset":"ETH", ...}` = 50 $
  Rechnungswert, Bezahlung in ETH.
- `{"currency":"EUR","amountMinor":2500,"asset":"USDT_ERC20", ...}` =
  25 € Rechnungswert, Bezahlung in USDT auf Ethereum.

Alle Beträge sind **Ganzzahlen in 1/100 der Fiat-Währung**, keine Floats.
Client-seitige Preise sind nicht autoritativ. Das Projekt darf seine
geheimen API-Zugangsdaten ausschließlich im eigenen Server speichern.

Der Provider antwortet mit Rechnungs-ID, Krypto-Betrag in atomaren
Einheiten, Netzwerk, öffentlicher Empfangsadresse und Ablaufzeit.
Der Krypto-Betrag wird niemals allein durch die gewählte
Fiat-Währung festgelegt.

```http
GET /v2/invoices/<INVOICE_UUID>
Authorization: Bearer <PROJECT_API_KEY>
X-Project-Id: <PROJECT_UUID>
```

Eine spätere Zahlungsbestätigung erhält das Projekt über seine
signierte HTTPS-Webhook-Schnittstelle. Die Nachricht enthält die
ursprünglichen Fiat-Rechnungsdaten, Kryptowährung, Netzwerk,
bestätigte Transaktions-ID und Projektbestellreferenz, aber **keine**
RUST-UP-Spielgutschrift und keine Kundenidentität.

## Bei Verbindungsfehlern

- Gleicher `Idempotency-Key` + identische Angaben: dieselbe Rechnung.
- Gleicher `Idempotency-Key` + andere Angaben: Fehler, keine neue Rechnung.
- Jede Empfangsadresse darf nur einer Rechnung zugeordnet werden.
- Fehlende/abgelaufene Kurse: neue Rechnung blockiert.
- Noch nicht bestätigte, falsche oder zu kleine Kryptozahlung:
  keine Bestätigung als vollständig bezahlt.
- Zustellung an ein Projekt kann wiederholt werden: dessen Backend
  muss `eventId` ebenfalls eindeutig speichern.

## Trust Wallet

Trust Wallet ist das **Empfangs-Wallet des Betreibers**, kein
Pflicht-Wallet für Kunden. Die Betreiberoberfläche kann über die
offizielle Erweiterung die öffentliche Ethereum-Adresse lesen;
Bitcoin- und TRON-Empfangsadressen werden gesondert hinterlegt.

Private Keys oder die Recovery Phrase werden niemals in den
Provider eingetragen. Die persönliche Wallet-Verbindung erfolgt
erst bei der tatsächlichen Einrichtung durch den Betreiber.

## Was ausdrücklich noch nicht live ist

Cloudflare-Konto, D1-Datenbank, signierte Projektwebhooks,
Blockchain-RPCs, Wallet-Adressen und Testüberweisungen müssen
eingerichtet und unabhängig abgenommen werden.

Der Provider akzeptiert **keine echten Einzahlungen**, solange
Produktionsfreigabe und Infrastruktur nicht vollständig konfiguriert sind.
Die Krypto-Zahlung darf innerhalb einer Telegram Mini App nicht als
Ersatz für die dort vorgeschriebenen Telegram Stars für digitale
Güter und Dienste verwendet werden.
