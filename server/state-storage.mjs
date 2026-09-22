import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { validate } from '../domain.js';
import { HttpError } from './errors.mjs';

const tokenHash = token => createHash('sha256').update(token).digest('hex');

// Storage is isolated from HTTP and UI. Transactions protect the shared document
// and its previous revision, including writes from separate database connections.
export function createStorage(path, seed, now = Date.now) {
  validate(seed);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS state (
      id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS previous_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, credential_hash TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_limits (
      key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL
    );
  `);
  db.prepare('INSERT OR IGNORE INTO state VALUES (1, 1, ?)').run(JSON.stringify(seed));

  const read = () => {
    const row = db.prepare('SELECT revision, payload FROM state WHERE id = 1').get();
    return { revision: row.revision, state: JSON.parse(row.payload) };
  };

  return {
    read,
    save(state, revision) {
      try { validate(state); } catch (error) { throw new HttpError(422, error.message); }
      const payload = JSON.stringify(state);
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = db.prepare('SELECT revision, payload FROM state WHERE id = 1').get();
        if (current.revision !== revision) throw new HttpError(409, 'Les données ont été modifiées ailleurs. Rechargez avant de réessayer.');
        db.prepare('INSERT OR REPLACE INTO previous_state VALUES (1, ?, ?)').run(current.revision, current.payload);
        db.prepare('UPDATE state SET revision = ?, payload = ? WHERE id = 1').run(revision + 1, payload);
        db.exec('COMMIT');
        return { revision: revision + 1 };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    createSession(credentialHash) {
      const token = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now());
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash(token), credentialHash, now() + 12 * 60 * 60 * 1000);
      return token;
    },
    hasSession(token, credentialHash) {
      if (!/^[a-f0-9]{64}$/.test(token || '')) return false;
      return Boolean(db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND credential_hash = ? AND expires > ?').get(tokenHash(token), credentialHash, now()));
    },
    deleteSession(token) {
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    },
    consumeLoginAttempt(key) {
      // Account-wide limit: cannot be bypassed with a new cookie or forged IP.
      db.prepare('DELETE FROM login_limits WHERE expires <= ?').run(now());
      db.prepare(`INSERT INTO login_limits VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1`).run(key, now() + 15 * 60 * 1000);
      const row = db.prepare('SELECT attempts FROM login_limits WHERE key = ?').get(key);
      if (row.attempts > 8) throw new HttpError(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    },
    clearLoginAttempts(key) { db.prepare('DELETE FROM login_limits WHERE key = ?').run(key); },
    close() { db.close(); },
  };
}

let storage;
export function getStorage() {
  if (!storage) {
    const seed = JSON.parse(readFileSync(resolve('data/organization.json'), 'utf8'));
    const driver = process.env.GAUBRE_STORAGE_DRIVER || 'sqlite';
    if (driver === 'supabase') {
      storage = import('./supabase-storage.mjs').then(({ createSupabaseStorage }) => createSupabaseStorage({
        url: process.env.SUPABASE_URL,
        secretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      }, seed));
      return storage;
    }
    if (driver !== 'sqlite') throw Error('GAUBRE_STORAGE_DRIVER doit être « sqlite » ou « supabase ».');
    // Runtime database files are never build assets and must not be traced.
    const path = resolve(/* turbopackIgnore: true */ process.env.GAUBRE_DATABASE_PATH || '.storage/gaubretrail.sqlite');
    const publicPath = resolve('public');
    if (path === publicPath || path.startsWith(publicPath + sep)) throw Error('La base doit être stockée hors du dossier public.');
    storage = Promise.resolve(createStorage(path, seed));
  }
  return storage;
}
