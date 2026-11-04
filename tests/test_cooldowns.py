import pathlib
import sqlite3
import unittest

SQL = (pathlib.Path(__file__).resolve().parent.parent / 'backend' / 'reward_cooldowns.sql').read_text(encoding='utf-8')
DAY = 86_400_000

class RewardCooldownTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SQL)

    def claim(self, user, kind, now):
        return self.db.execute('''INSERT INTO rustup_reward_cooldowns
            (telegram_id,reward_type,last_claim_ms,total_claims)
            VALUES (?,?,?,1) ON CONFLICT(telegram_id,reward_type) DO UPDATE SET
            last_claim_ms=excluded.last_claim_ms,
            total_claims=rustup_reward_cooldowns.total_claims+1
            WHERE excluded.last_claim_ms >= rustup_reward_cooldowns.last_claim_ms+86400000
            RETURNING total_claims''', (str(user),kind,now)).fetchone()

    def test_timer_case_once_24_hours(self):
        self.assertEqual(self.claim(1,'timer_case',1000)[0],1)
        self.assertIsNone(self.claim(1,'timer_case',1000+DAY-1))
        self.assertEqual(self.claim(1,'timer_case',1000+DAY)[0],2)

    def test_daily_is_independent_from_case(self):
        self.assertEqual(self.claim(1,'daily',1000)[0],1)
        self.assertEqual(self.claim(1,'timer_case',1000)[0],1)
        self.assertIsNone(self.claim(1,'daily',1000+DAY-10))
        self.assertIsNone(self.claim(1,'timer_case',1000+DAY-10))

    def test_separate_accounts(self):
        self.assertEqual(self.claim(1,'timer_case',1000)[0],1)
        self.assertEqual(self.claim(2,'timer_case',1000)[0],1)

    def test_subscription_bonus_once(self):
        a=self.db.execute('INSERT OR IGNORE INTO rustup_telegram_sub_once VALUES (?,?)',('1',123)).rowcount
        b=self.db.execute('INSERT OR IGNORE INTO rustup_telegram_sub_once VALUES (?,?)',('1',456)).rowcount
        self.assertEqual((a,b),(1,0))

if __name__ == '__main__':
    unittest.main()
