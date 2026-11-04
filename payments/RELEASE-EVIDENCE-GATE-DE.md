# Produktionsfreigabe: technische und menschliche Abnahme

**Status: RELEASE BLOCKED.** Dieses Verfahren erlaubt keine Freischaltung
ohne echte, vom Betreiber geprüfte Infrastruktur und nachvollziehbare
Testprotokolle. Es ist kein Autodeploy und ersetzt keinen externen Audit.

## Was bereits automatisiert geprüft wird

- `npm run validate`: Syntax- und Regressionstests der Payment-Software.
- `python -m unittest discover -s tests -p 'schema*_test.py' -v`:
  SQLite/D1-Datenbank-Invarianten.
- `npm run preflight`: Nur-lesende Abfrage der tatsächlichen D1-/RPC-/
  Kurs-/Webhook-/Wallet-Konfiguration des *eigenen privaten Gateways*.
- `npm run gate:release -- ./release-evidence.json`: Zusätzliche manuelle
  Nachweise und Preflight zusammen prüfen. Fehlende/stale/negative Nachweise
  verursachen einen Fehlercode; das Gateway wird **nicht** aktiviert.

## Benötigte Nachweise

Die Vorlage `release-evidence.example.json` enthält den vollständigen Satz.
Jeder Eintrag muss `result: "pass"`, einen verantwortlichen Reviewer,
eine **interne** Audit-Referenz (keine Wallet-Seeds, Secrets oder
personenbezogenen Unterlagen) und ein aktuelles ISO-Testdatum haben.
Nachweise werden nach 30 Tagen als veraltet gewertet.

Kategorien: Mehrfaktorzugang, Besitzkontrolle der BTC-/ETH-/TRON-Wallets,
unabhängige Blockchain-RPCs, echte kontrollierte Mainnet-Transaktionen für
BTC, ETH, TRX und USDT auf Ethereum und TRON, idempotente Projekt-Gutschrift,
signierte Webhook-End-to-End-Tests, Kursquellen-Failover, verschlüsselte
Backup/Wiederherstellung, Queue-/RPC-Failover, Störfälle/Refund-Prozess,
Reorg-Eskalation, Lasttest, unabhängiges Security Review, rechtliche
Plattformabnahme und funktionierendes Monitoring.

**Wenn TON aktiviert ist**, sind zusätzlich die TON-Wallet-Kontrolle,
eine echte kleine TON-Mainnet-Zahlung und unabhängiger TON-Indexer-Failover
Pflicht. Der Status kommt zusätzlich aus dem Remote-Preflight, damit ein
falscher Eintrag in der lokalen Vorlage keine TON-Nachweise umgehen kann.

## Windows PowerShell

```powershell
git switch feature/self-hosted-crypto-payments
cd .\payments
npm run validate
python -m unittest discover -s tests -p 'schema*_test.py' -v

Copy-Item .\release-evidence.example.json .\release-evidence.json
git rev-parse HEAD
```

Trage im **lokalen** `release-evidence.json` den aktuellen Commit-Hash
und die überprüften Nachweise ein. Der Commit muss genau mit dem
ausgecheckten Code übereinstimmen. Die reale Konto-/Wallet-Freigabe ist
allein vom Betreiber auf dessen eigenen Geräten vorzunehmen.

Setze anschließend in der **privaten Shell** `PAYMENTS_ADMIN_URL` und
`PAYMENTS_ADMIN_KEY` für dein eigenes Cloudflare-Gateway. Niemals
Secrets in GitHub oder Chatnachrichten posten.

```powershell
npm run preflight
npm run gate:release -- .\release-evidence.json
```

Exit-Code 0 bedeutet lediglich: Die maschinell kontrollierbare Konfiguration
und die **selbst dokumentierten** Nachweise sind für eine abschließende
manuelle Prüfung vollständig. Es bedeutet **nicht**: sicher, rechtlich
genehmigt, zertifiziert oder bereits live. Keine Freischaltung erfolgt
durch diesen Befehl. Die letzte produktive Deployment-/Zahlungsfreigabe
verbleibt beim Betreiber nach unabhängiger Prüfung.

## Harte Grenzen

- BTC, ETH, TRX, USDT und TON sind öffentliche Blockchains. Nicht anonym.
- Seeds, Recovery Phrases und Private Keys bleiben außerhalb des Servers.
- Weder automatische Refunds noch selbstständige Reorg-Abbuchungen sind
  ohne separate Sicherheits- und Betriebsprozesse erlaubt.
- Ein Cron-Scanner allein ist kein belastbarer Hochlast-Indexer.
- Innerhalb einer Telegram Mini App dürfen Zahlungsregeln, insbesondere
  Telegram Stars für digitale Güter, nicht umgangen werden.
- Keine Freigabe für Echtgeld-/Zufallsgewinn- oder Auszahlungsmodelle ohne
  erforderliche regulatorische Abnahme und Altersschranken.
