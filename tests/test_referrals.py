import pathlib
import sqlite3
import unittest

SQL = (pathlib.Path(__file__).resolve().parent.parent / 'backend' / 'referral_guard.sql').read_text(encoding='utf-8')

class ReferralGuardTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SQL)

    def claim(self, a, b):
        pair = ':'.join(sorted((str(a), str(b))))
        return self.db.execute('''INSERT OR IGNORE INTO rustup_referral_claims
            (referrer_tg_id, referred_tg_id, unordered_pair, created_at_ms)
            VALUES (?, ?, ?, 12345)''', (str(a), str(b), pair)).rowcount

    def credits(self):
        return self.db.execute('SELECT recipient_tg_id, amount_kopecks FROM rustup_referral_credits ORDER BY recipient_tg_id').fetchall()

    def test_exactly_50_rub_each_once(self):
        self.assertEqual(self.claim(1001, 1002), 1)
        self.assertEqual(self.credits(), [('1001', 5000), ('1002', 5000)])
        self.assertEqual(self.claim(1001, 1002), 0)
        self.assertEqual(len(self.credits()), 2)

    def test_self_referral_blocked(self):
        self.assertEqual(self.claim(1001, 1001), 0)
        self.assertEqual(self.credits(), [])

    def test_reverse_referral_blocked(self):
        self.assertEqual(self.claim(1001, 1002), 1)
        self.assertEqual(self.claim(1002, 1001), 0)
        self.assertEqual(len(self.credits()), 2)

    def test_invitee_cannot_change_sponsor(self):
        self.assertEqual(self.claim(1001, 1003), 1)
        self.assertEqual(self.claim(1002, 1003), 0)
        self.assertEqual(len(self.credits()), 2)

    def test_two_separate_friends_each_one_award(self):
        self.assertEqual(self.claim(1001, 1002), 1)
        self.assertEqual(self.claim(1001, 1003), 1)
        self.assertEqual(len(self.credits()), 4)

    def test_invalid_pair_key_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO rustup_referral_claims (referrer_tg_id,referred_tg_id,unordered_pair,created_at_ms) VALUES('1001','1002','bad',1)")

if __name__ == '__main__':
    unittest.main()
