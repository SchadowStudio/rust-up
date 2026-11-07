# RUST UP – Telegram-only Wallet-Einstieg

Die vorhandene RUST-UP Mini App bleibt die einzige Bedienoberfläche. GitHub Pages hostet nur die HTML/JS-Dateien, die Telegram im App-Fenster öffnet. Es wird keine zweite Shop-Seite erzeugt.

## Vorhandener Spielsaldo

Die ursprüngliche Spiele-Worker-Architektur nutzt `rustup-stats.accounts.state.balance`. Die Tabelle `users.balance` ist nur eine Clientmeldung und kein verlässlicher Server-Buchungsweg. Der Test-Prototyp unter `payments/integration/existing-game-state-sandbox/` simuliert dieses Format ohne Live-Daten.

## Telegram-Mini-App sicher korrigieren

Das neueste Website-Deployment hat die ältere Stars-Oberfläche entfernt. Der Patch `payments/scripts/publish-telegram-wallet-entry.mjs` arbeitet mit dem **neuesten** Website-Code, ohne andere Spiel- und Admin-Funktionen zurückzusetzen. Er macht die vorhandene Kachel »Telegram и CS2« zu einem lesbaren Telegram-Stars-Status ohne Rubel-Einzahlungsformular und ohne +7%-Bonus. Bis zur Freigabe werden **keine echten Zahlungen, keine Einzahlungen und keine Spielgutschriften** angeboten.

In PowerShell:

```powershell
cd "$HOME\RUST-UP-Local"
git pull --ff-only origin feature/rustup-payment-admin-controls
node --test .\payments\scripts\publish-telegram-wallet-entry.test.mjs
node .\payments\scripts\publish-telegram-wallet-entry.mjs "$HOME\RUST-UP-Website" --check
# Nach erfolgreicher Prüfung; veröffentlicht nur das sichere Status-UI:
node .\payments\scripts\publish-telegram-wallet-entry.mjs "$HOME\RUST-UP-Website" --publish
```

`--publish` funktioniert nur, wenn die lokale Website unter `RUST-UP-Website` auf dem Branch `main` liegt, die Git-Remote zu `ttzoomrust-hub/rust-up` gehört, keine lokalen Änderungen vorliegen und der lokale GitHub-Login Schreibrechte besitzt. Der Publisher führt `git pull --ff-only` aus, ändert ausschließlich `js/app.js` und die Cache-Version des `app.js`-Skripts in `index.html`, prüft die JS-Syntax und führt erst dann Commit/Push ohne Force aus. Bei verändertem Quellcode verweigert er die Änderung.

Der GitHub-Connector hat im Website-Repository nur Leserechte (403 beim Schreibversuch), deshalb ist die direkte Veröffentlichung durch ChatGPT nicht erfolgt.

## Was nicht freigeschaltet wurde

Echte Telegram Stars dürfen nicht ohne eine geprüfte, regelkonforme Produktlogik in Spielguthaben für zufallsbasierte Cases, Upgrades, Wetten, übertragbare Gegenstände oder Auszahlungen umgewandelt werden. Die vier Zahlungs-Gates bleiben `false`. Die vorhandene Stars-API und D1 werden durch diesen Patch nicht verändert. Fehler wie Browser-CORS und echte autorisierte Katalogaufrufe erfordern vor einer zukünftigen Freigabe separate Tests.

Offizielle Quellen:
- https://core.telegram.org/bots/webapps
- https://core.telegram.org/bots/payments-stars
- https://telegram.org/tos/bot-developers
