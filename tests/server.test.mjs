import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorage } from '../server/state-storage.mjs';
import { hashPassword } from '../server/passwords.mjs';
import { createApi, readJson } from '../server/api.mjs';
import { seedState } from './helpers.mjs';

test('API: authentication, origin, validation, revision conflicts and revoked sessions', async () => {
  const storage = createStorage(':memory:', seedState());
  const env = { GAUBRE_ADMIN_USERNAME: 'test', GAUBRE_ADMIN_PASSWORD_HASH: await hashPassword('integration-password'), GAUBRE_APP_ORIGIN: 'http://localhost' };
  const handle = createApi({ storage: () => storage, env });
  let cookie = '';
  const request = (route, method = 'GET', body, extra = {}) => handle(new Request(`http://localhost/api/${route}`, {
    method, headers: { Origin: 'http://localhost', Cookie: cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), route);
  try {
    assert.equal((await request('state')).status, 401);
    assert.equal((await request('state', 'PUT', seedState(), { 'If-Match': '1' })).status, 401);
    assert.equal((await request('login', 'POST', { username: 'test', password: 'wrong' })).status, 401);
    assert.equal((await request('login', 'POST', {}, { Origin: 'http://other.test' })).status, 403);
    const login = await request('login', 'POST', { username: 'test', password: 'integration-password' });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await request('session')).json()).admin, true);
    const original = await (await request('state')).json();
    const next = structuredClone(original.state);
    next.editions[0].name = 'Édition modifiée';
    assert.equal((await request('state', 'PUT', next)).status, 428);
    assert.equal((await request('state', 'PUT', { ...next, volunteers: null }, { 'If-Match': '1' })).status, 422);
    assert.equal((await request('state', 'PUT', next, { 'If-Match': '1' })).status, 200);
    assert.equal((await request('state', 'PUT', original.state, { 'If-Match': '1' })).status, 409);
    assert.equal(storage.read().state.editions[0].name, 'Édition modifiée');
    assert.equal((await request('logout', 'POST')).status, 200);
    assert.equal((await request('state')).status, 401);
    assert.equal((await request('users')).status, 404);
  } finally { storage.close(); }
});

test('Public API: publication consent and allowlists keep private fields private', async () => {
  const seed = seedState();
  const editionId = seed.editions[0].id;
  const post = seed.posts.find(item => item.editionId === editionId);
  post.publicVisible = true;
  seed.volunteers = [
    { id: 'visible', firstName: 'Alice', lastName: 'Visible', active: true, publicVisible: true, phone: 'SECRET_PHONE', email: 'SECRET_EMAIL', notes: 'SECRET_NOTES' },
    { id: 'private', firstName: 'Bob', lastName: 'PRIVATE_NAME', active: true, publicVisible: false },
    { id: 'inactive', firstName: 'C', lastName: 'INACTIVE_NAME', active: false, publicVisible: true },
  ];
  seed.assignments = seed.volunteers.map(volunteer => ({ id: volunteer.id, volunteerId: volunteer.id, postId: post.id, editionId, date: '2026-07-01', notes: 'PRIVATE_ASSIGNMENT' }));
  seed.owners = [{ id: 'owner', lastName: 'PRIVATE_OWNER' }];
  const storage = createStorage(':memory:', seed);
  try {
    const response = await createApi({ storage: () => storage, env: {} })(new Request('http://localhost/api/public'), 'public');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.state.volunteers.map(volunteer => volunteer.id), ['visible']);
    assert.equal(data.state.assignments.length, 1);
    assert.doesNotMatch(JSON.stringify(data), /SECRET_|PRIVATE_|INACTIVE_NAME/);
    assert.deepEqual(data.state.owners, []);
  } finally { storage.close(); }
});

test('SQLite persistence and competing connections never overwrite a newer revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gaubre-test-'));
  const path = join(directory, 'state.sqlite');
  const first = createStorage(path, seedState());
  const second = createStorage(path, seedState());
  try {
    const original = second.read();
    const next = structuredClone(original.state);
    next.editions[0].name = 'Persistée';
    first.save(next, original.revision);
    assert.throws(() => second.save(original.state, original.revision), error => error.status === 409);
    assert.equal(second.read().state.editions[0].name, 'Persistée');
  } finally { first.close(); second.close(); }
  const reopened = createStorage(path, seedState());
  try { assert.equal(reopened.read().revision, 2); }
  finally {
    reopened.close();
    assert.ok(directory.startsWith(join(tmpdir(), 'gaubre-test-')));
    rmSync(directory, { recursive: true });
  }
});

test('Sessions expire, password changes invalidate sessions, login rate limit expires', () => {
  let time = 1000;
  const storage = createStorage(':memory:', seedState(), () => time);
  try {
    const token = storage.createSession('credential');
    assert.equal(storage.hasSession(token, 'credential'), true);
    assert.equal(storage.hasSession(token, 'new-password'), false);
    for (let i = 0; i < 8; i++) storage.consumeLoginAttempt('organizer');
    assert.throws(() => storage.consumeLoginAttempt('organizer'), error => error.status === 429);
    time += 16 * 60 * 1000;
    storage.consumeLoginAttempt('organizer');
    time += 12 * 60 * 60 * 1000;
    assert.equal(storage.hasSession(token, 'credential'), false);
  } finally { storage.close(); }
});

test('Streaming JSON limit is enforced even without Content-Length', async () => {
  await assert.rejects(readJson(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(100) }) }), 20), error => error.status === 413);
});

test('Unconfigured server never enables local administrator access', async () => {
  const storage = createStorage(':memory:', seedState());
  try {
    const handle = createApi({ storage: () => storage, env: {} });
    const response = await handle(new Request('http://localhost/api/session'), 'session');
    assert.deepEqual(await response.json(), { available: true, configured: false, admin: false, capabilities: ['state'], user: null });
  } finally { storage.close(); }
});
