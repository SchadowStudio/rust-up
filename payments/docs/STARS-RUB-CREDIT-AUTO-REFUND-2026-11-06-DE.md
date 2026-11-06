# RUST UP — RUB-Gutschrift und automatischer Stars-Refund (2026-11-06)

## Festgelegte Preise
1 Telegram Star = 1,83 RUB. Die Preisquote wird serverseitig als ganzzahlige Kopeken eingefroren. 4 Stars entsprechen 7,32 RUB, sofern die zugehörige Bestellung genau 7,32 RUB enthält. Historische Bestellungen behalten ihre ursprünglichen Beträge.

## Game-Konto
Das bestehende Spiel speichert interne Coins (1 Coin = 0,02 USD) und zeigt den Kontostand je nach aktueller Einstellung in RUB an. Für neue Stars-Bestellungen berechnet der Worker die benötigten internen Coins anhand zweier geprüfter RUB/USD-Quellen und speichert den damaligen Umrechnungskurs und den genau eingefrorenen Coin-Betrag in der Bestellung. Kein Client darf diese Werte liefern. Für eine spätere Rückerstattung wird ausschließlich der ursprüngliche Coin-Betrag rückgängig gemacht. Die sichtbare RUB-Anzeige kann um kleine Rundungs- oder Wechselkursdifferenzen abweichen; die Anzeige ist kein eigenes RUB-Ledger.

## Automatische Rückerstattung
Der bereits vorhandene Cron ruft bei aktivierter, separater Refund-Reconciliation die unabhängige Telegram-Refund-Erkennung auf, danach den bereits existierenden, exakt-einmaligen Game-Ledger-Reversal-Batch. Ein Provider-Refund wird nur dann in PAYMENTS_DB als refunded markiert, wenn im vollständigen abgerufenen Telegram-Transaktionsfenster derselbe Charge-ID eine eindeutige Zahlung und Refund an denselben Telegram-Nutzer mit identischer Starzahl belegt sind. Keine zweite Refund-Anfrage an Telegram. Ein unverifizierter oder mehrdeutiger Vorgang ist ein Review-Fall.

Die Reversal-Buchung wird je Order einmalig per DB-Primärschlüssel gespeichert. Bei unzureichendem verfügbarem Spielguthaben wird kein negativer Saldo erzeugt, sondern manuelle Prüfung erforderlich. Historisch bereits erstattete Zahlungen dürfen nicht erneut gutgeschrieben werden.

## Kein Live-Deployment durch diese Commits
Alle Änderungen liegen nur auf feature/rustup-payment-admin-controls. Live-Worker-Script, D1-Release-Gate und Schalter wurden hier nicht geändert. Auf dem lokalen Checkout-Worker müssen die aktuellen Wrangler-Bindings und die bestehende Bot-Code-Version separat geprüft werden. Das vorhandene Staging-Script erwartet absichtlich eine bestimmte Worker-Version und scheitert bei Abweichungen; diesen Lock nicht umgehen.

## Lokale Validierung
```powershell
cd "$HOME\RUST-UP-Local"
git pull --ff-only origin feature/rustup-payment-admin-controls
node --test .\payments\integration\account-credit-ledger\freeze-verified-stars-game-quote.test.mjs
node --test .\payments\integration\account-credit-ledger\stars-checkout-frozen-quote-e2e.test.mjs
node --test .\payments\integration\account-credit-ledger\verified-stars-game-refund.test.mjs
node --test .\payments\integration\telegram-stars\stars-variable-webhook-wrapper.test.mjs
node --test .\payments\scripts\stage-current-stars-webhook-only.test.mjs
```

Erst nach grünen Tests, kontrolliertem Provider-Refund-E2E, Game-DB-Backup, unabhängiger Freigabe und geprüften Zahlungsbedingungen eine gesonderte Live-Veröffentlichung prüfen. Keine bestehenden Beträge automatisch nachbuchen.
