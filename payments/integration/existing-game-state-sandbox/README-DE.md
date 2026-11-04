# RUST UP: Vorhandenes Spielguthaben wiederverwenden (lokale Simulation)

Die aktive RUST-UP-Architektur hat bereits ein Spielkonto: `rustup-stats.accounts.state` enthält den Spielzustand mit `balance`; `accounts.v` ist die Versionsspalte. `rustup-stats.users.balance` ist nur ein vom Client gemeldeter Anzeige-/Statistikwert und **keine** zuverlässige Gutschrift-Schnittstelle. Zudem existiert eine separate Tabelle `grants` für bestehende Admin-Gutschriften. Dieses Modul verwendet die Form von `accounts.state.balance` statt ein zweites Wallet für die Spieloberfläche zu entwerfen.

## Entwicklungsstand

`existing-balance-sandbox.mjs` stellt eine **ausschließlich lokale, flüchtige** Kopie der bestehenden `accounts`-Tabelle her. Alle Operationen finden in `:memory:` statt; das Programm verbindet sich niemals mit Cloudflare, Telegram oder dem bestehenden Worker. Die Simulation zeigt, wie ein von mehreren Kanälen gespeister, einziger Saldo in `state.balance` mit einer idempotenten Buchungshistorie verwaltet werden kann. Die einzige Test-Ausgabe ist ein stabiler Bestandswert. Es gibt keine neue Live-Wallet und keinen neuen API-Endpunkt.

```powershell
cd "$HOME\RUST-UP-Local"
node --test .\payments\integration\existing-game-state-sandbox\existing-balance-sandbox.test.mjs
```

## Sicherheit und Abgrenzung

- Alle Testreferenzen beginnen mit `demo:`. Echte Telegram-Belege, echte Coins und Zahlungen werden nicht akzeptiert.
- `accounts.state` wird nur in der lokalen In-Memory-Kopie verändert. Keine Änderung an `rustup-stats`, keinem Cloudflare-Worker und keiner Mini-App.
- Die schon vorhandene `grants`-Warteschlange und das Spiele-Backend bleiben unverändert. `users.balance` darf nicht als Auszahlungskonto behandelt werden.
- Geldwerte Credits dürfen **nicht** ohne Genehmigungen und Alters-/Spielerschutz in Cases, Upgrades, Wetten, übertragbare Skins oder Auszahlungen fließen.
- Das Konzept für ein späteres zulässiges Nicht-Glücksspiel-Produkt erfordert zuerst: verifizierte Anbieterquittung, verlässliche Serverbuchung, eindeutige Transaktionsreferenz, Dubletten-Abwehr, Refund-/Chargeback-Verfahren, Audit und Abgleich mit der Spielkonten-Logik.
- Dieses Testmodul ist ausdrücklich nicht der Produktionsadapter und lässt sich nicht durch bloßes Umschalten eines Flags zu einem machen.
