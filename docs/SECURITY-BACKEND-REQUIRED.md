# RUST UP — Backend-Sicherheitsanforderungen (noch nicht live)

Dieses Repository enthält **Frontend und Datenkataloge**, aber nicht den ausführenden
Cloudflare-Worker (laut Frontend `bot/game.js`, `bot/worker.js`, `bot/creator.js`).
Die Aktualisierung in `js/rules.js` stellt die Frontend-Anzeigen um. **Sie verändert
nicht automatisch den bereits deployten Worker.**

## Verbindliche Serverregeln vor Produktionsfreigabe

- **15-Minuten-Case → 24-Stunden-Case:** je validierter Telegram-ID höchstens einmal
  in rollierenden 86.400.000 ms. Der Server muss die Zeit bestimmen.
- **Подарок дня:** 50,00 ₽ (= 5000 Kopeken), höchstens einmal je 24 Stunden.
- **Подписка на Telegram:** 50,00 ₽ einmalig, erst nach geprüfter
  Mitgliedschaft via getChatMember.
- **Пригласи друзей:** 50,00 ₽ für Einladenden und 50,00 ₽ für Eingeladenen
  pro erstmaliger, verifizierter Empfehlung. Eine eingeladene Person darf
  nicht mehreren Einladenden zugeordnet werden. Selbstwerbung und gegenseitige
  Rückeinladungen sind auszuschließen. Bereits vergebene Prämien nie erneut buchen.
- **Guthaben:** 50 RUB genau in einer RUB-Minor-Unit-Buchhaltung oder mit
  serverseitiger, einheitlicher Wechselkursumrechnung. 31 interne Coins sind
  ausdrücklich nur eine historische Näherung.
- Verifiziere `Telegram.WebApp.initData` bei **jedem** API-Request mit Signatur und
  `auth_date`. `initDataUnsafe` ist nicht authentifiziert.
- Guthaben, Inventar, Chancen, Gewinne, Cooldowns, Referral-Zuordnungen und
  Auszahlungen ausschließlich serverseitig autorisieren.
- Schalte den alten Worker-Import von `api('load', {local})` dauerhaft ab.
  Der Client sendet nun kein manipulierbares Browser-Guthaben mehr mit.
- Jede Prämien- und Itembuchung atomar und idempotent durchführen.
  Serverseitige UNIQUE-Constraints vorsehen und parallele Requests testen.
- Zusätzlicher Anti-Sybil-Schutz ist nötig: unterschiedliche Telegram-IDs
  beweisen nicht, dass dahinter unterschiedliche reale Personen stehen.
- Konten, Zahlungen und echte Geschenkauslieferung nicht als erfolgreich ausweisen,
  bevor der jeweilige Provider die Transaktion bestätigt.

In `backend/referral_guard.sql` und `backend/reward_cooldowns.sql` liegen
**isolierte D1/SQLite-Sicherheitsvorlagen**, keine aktive Worker-Integration.
Sie erzeugen keine echten Wallet-Gutschriften. Erst nach Anpassung an die
tatsächlichen Datenbanktabellen und Integration in Worker-Transaktionen verwenden.

## Abnahme / Tests

- `python3 -m unittest discover -s tests -v`
- `node --check js/app.js`, `node --check js/rules.js`
- `node --check creator/app.js`
- E2E: Telegram-Login, Case nach 23:59/24:00, Tagesbonus, A→B, B→A,
  doppelte und parallele Referrals, Auszahlungen und Spielaktionen testen.
- Nach Worker-Deployment muss der Server selbst seine effektiven Bonuswerte
  und Cooldowns bestätigen, bevor die UI als korrekt angesehen werden darf.
