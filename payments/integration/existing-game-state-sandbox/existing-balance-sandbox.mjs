// Local-only compatibility test for RUST UP's existing accounts.state.balance.
// It creates its OWN in-memory copy of the legacy game table, not a second wallet.
// NEVER import this into a deployed Worker or connect it to real payment receipts.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const SOURCES = new Set(['demo_stars', 'demo_crypto', 'demo_fixed_purchase', 'demo_refund']);
const REF = /^demo:[a-z0-9][a-z0-9:_-]{5,100}$/i;
const MAX_CHANGE = 1_000_000;
const MAX_BALANCE = 100_000_000;

function checkUser(id) {
  if (!Number.isSafeInteger(id) || id < 1) throw Error('invalid_demo_user');
}
function checkState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !Number.isSafeInteger(state.balance) ||
      state.balance < 0 || state.balance > MAX_BALANCE)
    throw Error('invalid_existing_game_state');
}

export class ExistingGameBalanceSandbox {
  #db;
  constructor() {
    if (process.env.NODE_ENV === 'production' || process.env.MULTI_LIVE_ENABLED === 'true')
      throw Error('demo_sandbox_forbidden_in_production');
    this.#db = new DatabaseSync(':memory:');
    this.#db.exec(`CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      state TEXT NOT NULL,
      v INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE TABLE demo_balance_events (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      delta INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      UNIQUE(source,source_ref)
    );`);
  }
  loadSyntheticAccount(userId, state = { balance: 0, history: [], inventory: [] }) {
    checkUser(userId);
    checkState(state);
    const now = Date.now();
    this.#db.prepare('INSERT INTO accounts(id,state,v,created,updated) VALUES(?,?,0,?,?)')
      .run(userId, JSON.stringify(state), now, now);
    return this.readAccount(userId);
  }
  readAccount(userId) {
    checkUser(userId);
    const record = this.#db.prepare('SELECT state,v FROM accounts WHERE id=?').get(userId);
    if (!record) return null;
    const state = JSON.parse(record.state);
    checkState(state);
    return { state, version: record.v, simulationOnly: true, withdrawable: false,
      redeemable: false, paidGameStakesAllowed: false };
  }
  applyDemoEvent({ userId, source, reference, delta }) {
    checkUser(userId);
    if (!SOURCES.has(source) || !REF.test(reference) || !Number.isSafeInteger(delta) ||
        Math.abs(delta) < 1 || Math.abs(delta) > MAX_CHANGE ||
        ((source === 'demo_stars' || source === 'demo_crypto') && delta <= 0) ||
        ((source === 'demo_fixed_purchase' || source === 'demo_refund') && delta >= 0))
      throw Error('invalid_demo_event');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.#db.prepare('SELECT user_id,delta FROM demo_balance_events WHERE source=? AND source_ref=?')
        .get(source, reference);
      if (old) {
        if (old.user_id !== userId || old.delta !== delta)
          throw Error('duplicate_reference_conflict');
        this.#db.exec('COMMIT');
        return { applied: false, replayed: true, ...this.readAccount(userId) };
      }
      const existing = this.#db.prepare('SELECT state,v FROM accounts WHERE id=?').get(userId);
      if (!existing) throw Error('demo_account_missing');
      const state = JSON.parse(existing.state);
      checkState(state);
      const next = state.balance + delta;
      if (!Number.isSafeInteger(next) || next < 0 || next > MAX_BALANCE)
        throw Error('demo_insufficient_funds_or_limit');
      const updated = { ...state, balance: next };
      const now = Date.now();
      const change = this.#db.prepare('UPDATE accounts SET state=?,v=v+1,updated=? WHERE id=? AND v=?')
        .run(JSON.stringify(updated), now, userId, existing.v);
      if (change.changes !== 1) throw Error('demo_concurrent_change');
      this.#db.prepare('INSERT INTO demo_balance_events(id,user_id,source,source_ref,delta,created_at_ms) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), userId, source, reference, delta, now);
      this.#db.exec('COMMIT');
      return { applied: true, replayed: false, ...this.readAccount(userId) };
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  history(userId) {
    checkUser(userId);
    return this.#db.prepare('SELECT source,source_ref,delta,created_at_ms FROM demo_balance_events WHERE user_id=? ORDER BY created_at_ms DESC,id DESC').all(userId);
  }
  close() { this.#db.close(); }
}
