# Sicherheits- und Ausfallkonzept – Headless Crypto Payments

**Status: STAGING ONLY. LIVE CHECKOUT BLOCKED.** Entwicklung nur im Branch
`feature/self-hosted-crypto-payments`; keine Änderung an `main`.
Keine echte Wallet-Verbindung oder reale Zahlung wurde hier ausgeführt.

## Implementierte Schutzmaßnahmen

1. **RPC-Quorum (2 von 3).** Jede der unterstützten Blockchains muss
   von drei getrennten HTTPS-RPC-Endpunkten geprüft werden. Zwei identische,
   kanonische Bestätigungen müssen übereinstimmen: Netzwerk, TX-Hash,
   tatsächlich empfangener Betrag, Block-Hash und Blockzeit.
   Ein einzelner Knoten kann ausfallen oder fehlerhafte Angaben machen,
   ohne einen Zahlungserfolg zu erzwingen. Wenn nur ein vertrauenswürdiger
   Knoten verfügbar ist oder die Antworten widersprüchlich sind,
   **bleibt die Zahlung unbestätigt**. Die Hosts müssen zudem unabhängig
   betrieben werden – drei Hostnamen desselben Backend-Providers bieten
   keine echte organisatorische Unabhängigkeit.
2. **Kanonische Blöcke.** Ethereum: Transaktion/Receipt/Block-Hash;
   Bitcoin: bestätigter Transaktionsblock, Header und kanonische Höhe;
   TRON: solidifizierter Block über `walletsolidity/getblockbynum`.
   Alle Überweisungen müssen Empfänger, Coin, Chain, Betrag und
   Mindestbestätigungen erfüllen.
3. **Zweitprüfung vor Webhooks.** Sogar nach ursprünglicher Bestätigung
   überprüft der Provider vor der Weiterleitung an ein Projekt die
   Blockchain-Quellen erneut. Kann er den Zahlungsnachweis nicht
   bestätigen, wird die Zustellung verzögert, nicht gefälscht.
4. **Transaktionale Datensicherung.** Die eigentliche Rechnung, der
   Empfangsadressen-Claim und das Projektkontingent werden in einem
   D1-Batch geschrieben. Eine SQLite-Trigger-Prüfung in Migration
   `0013_invoice_reservation_guard.sql` erzwingt einen tatsächlichen
   Rollback, wenn der Adress- oder Kontingent-Claim misslingt.
   Regressions-Tests prüfen den echten SQL-Insert und Rollback.
5. **Idempotente Webhooks.** Je Rechnung eindeutige Projekt-/Event-/Chain-
   Transaktionskennungen; signierter HMAC-SHA256-Payload, Zeitstempel,
   eindeutige Ereignis-ID. Projekt-Ledger muss auch bei Wiederholung
   genau einmal buchen.
6. **Ausfallsicheres Delivery-Prinzip.** Persistente Outbox,
   Lease, Backoff, Queue und Dead-Letter-Queue. Fehlgeschlagene
   Zustellungen erscheinen in Betreiberstatus und Logs und werden erneut
   versucht. Fehlende Freigaben oder fehlende RPCs verhindern einen
   unkontrollierten Produktionsstart.
7. **Keine Hot-Wallet-Schlüssel.** Der Provider benötigt ausschließlich
   zuvor geprüfte öffentliche Trust-Wallet-Empfangsadressen und
   Watch-only-RPCs. Private Schlüssel oder Recovery Phrases niemals
   an Cloudflare, GitHub, den Projektserver oder Chat übermitteln.
8. **Mandantentrennung.** Jedes Projekt hat separate Zugangsschlüssel,
   Limits, akzeptierte Kryptowährungen, Webhook und Transaktionshistorie.
   Neue Projekte und Zahlungsmethoden sind zunächst ausgeschaltet.

## Einrichtung der drei unabhängigen RPCs

In der eigenen Cloudflare-Worker-Umgebung ausschließlich über
`wrangler secret put <NAME>`, niemals in einer Git-Datei:

| Chain | Erster RPC | Zweiter RPC | Dritter RPC |
| --- | --- | --- | --- |
| BTC | BITCOIN_RPC_URL | BITCOIN_RPC_URL_SECONDARY | BITCOIN_RPC_URL_TERTIARY |
| ETH | ETHEREUM_RPC_URL | ETHEREUM_RPC_URL_SECONDARY | ETHEREUM_RPC_URL_TERTIARY |
| TRON | TRON_RPC_URL | TRON_RPC_URL_SECONDARY | TRON_RPC_URL_TERTIARY |

Für alle drei BTC-RPCs zudem die jeweils **eigenen** Base64-Basic-
Authentication-Secrets:
`BITCOIN_RPC_BASIC_B64`,
`BITCOIN_RPC_BASIC_B64_SECONDARY` und
`BITCOIN_RPC_BASIC_B64_TERTIARY`.
Wenn TRON-Provider API-Schlüssel benötigen, konfigurieren:
`TRON_RPC_API_KEY`, `TRON_RPC_API_KEY_SECONDARY`,
`TRON_RPC_API_KEY_TERTIARY`.

Die Nodes müssen Mainnet-Daten aus eigenständigen Quellen prüfen.
Betreiber darf drei Domains nicht bloß auf denselben Knoten zeigen lassen.
Verschiedene Hosting- und Infrastrukturbetreiber bevorzugen.
Im Staging **MULTI_STRICT_QUORUM=false und MULTI_LIVE_ENABLED=false**
lassen, bis die Infrastruktur installiert und sicher getestet wurde.
Danach explizite Betreiberfreigabe; niemals automatisch live schalten.

## Sichere Ausfallreaktionen

| Situation | Verhalten |
| --- | --- |
| Ein RPC antwortet nicht | Zustimmung der übrigen zwei erforderlich |
| Zwei RPCs antworten nicht | Keine neue Zahlungsbestätigung; Retry |
| Blockchain-Nachweise widersprechen sich | Keine Gutschrift; prüfen und alarmieren |
| Krypto-Zahlung zu klein/zu spät | Manuelle Prüfung; keine automatische Freigabe |
| Ein Projekt antwortet nicht | Zahlungsereignis verbleibt in Outbox; erneute Zustellung |
| Queue fällt aus | Outbox-Polling versucht die Zustellung weiterhin |
| Kein freier Wallet-Empfänger | Keine neue Rechnung statt Adresswiederverwendung |
| Kontingent oder Adress-Claim scheitert | Vollständiger Datenbank-Rollback |
| Kursanbieter widersprechen sich | Keine neue Rechnung mit unsicherem Kurs |
| Blockchain-Reorganisation **nach** Webhook | Noch nicht automatisch zurückabgewickelt: Betreiberprozess erforderlich |

## Verbleibende Grenzen und Produktionsblocker

**Kein Softwareprojekt kann 100 % Sicherheit oder 100 % Uptime zusichern.**
Diese Einschränkungen sind weiterhin **offen**:

- Cloudflare D1 bleibt ein Kapazitäts-/Verfügbarkeitsrisiko; für echte
  Großlast separate Datenbank-Shards je Projekt/Region und gemessene
  Performancegrenzen vorsehen. D1-Backup und Restore auf anderer
  Infrastruktur müssen vorab geprobt werden.
- End-to-end-Störungen: Queue-Dead-Letter-Nachrichten können nach
  begrenzter Aufbewahrung ablaufen. Outbox und Chain-Scanner sind
  zusätzliche Wiederherstellungswege, ersetzen aber kein umfassendes
  Monitoring. Betreiber benötigt Alarme bei RPC-Fehlern, Scanner-Lag,
  Staus und fehlenden Empfangsadressen.
- Späte Chain-Reorganisation **nach** einem bereits zugestellten Webhook
  kann nicht durch die Vorab-Zweitprüfung ausgeschlossen werden. Ein
  späteres Reversal-/Sperr-Ereignis und projektseitige Kompensation
  werden für anspruchsvollen Echtbetrieb benötigt.
- Keine produktive Wallet-Verbindung, kein echter RPC-Rollout, keine
  realen Testüberweisungen, kein Penetrationstest, keine echten Last-
  und Disaster-Recovery-Tests. Solange das fehlt: nicht live.
- Ohne ausreichend eindeutige, zuvor verifizierte öffentliche
  Trust-Wallet-Empfangsadressen kann das System nicht beliebig viele
  parallele neue Einzahlungen annehmen.
- Kundendaten minimiert, aber Blockchain-Transaktionen und die
  Infrastruktur können identifizierbare Metadaten offenlegen.
  Nicht behaupten, das System sei vollständig anonym.

## Tests

```powershell
git switch feature/self-hosted-crypto-payments
cd .\payments
npm run validate
python -m unittest discover -s tests -p 'schema*_test.py' -v
```

`quorum.test.mjs`: Zweidrittelquorum bei einem ausgefallenen Provider,
abweichende Blöcke, fehlendes kanonisches Receipt und unzulässige Hosts.

`quorum-chains.test.mjs`: Bitcoin kanonische Header,
TRON-Solidity-Blockübereinstimmung.

`schema_failclosed_test.py`: Live-SQL-Insert mit Null-PK-Guard,
Rollback bei Adresskonflikt und Projektkontingent-Fehler.

**Go/No-Go:** keine echten Kundengelder, bis die Konfiguration und
die End-to-End-Tests auf deiner Infrastruktur erfolgreich abgenommen
wurden. Telegram Mini Apps müssen die geltenden Stars-Zahlungsregeln
für digitale Güter einhalten.
