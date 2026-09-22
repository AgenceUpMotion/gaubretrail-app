import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSupabaseStorage } from '../server/supabase-storage.mjs';
import { seedState } from './helpers.mjs';

test('Supabase relational migrations use safe full-table deletes', () => {
  for (const migration of [
    '../supabase/migrations/20260921100000_relational_core.sql',
    '../supabase/migrations/20260921140000_fix_relational_sync_safe_delete.sql',
  ]) {
    const sql = readFileSync(new URL(migration, import.meta.url), 'utf8');
    assert.doesNotMatch(sql, /delete\s+from\s+[a-z_]+\s*;/i);
    assert.match(sql, /delete\s+from\s+assignments\s+where\s+true/i);
  }
});

test('Supabase storage reports the missing safe-delete migration', async () => {
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/gaubretrail_state') && init.method === 'POST') return new Response(null, { status: 201 });
    if (url.pathname.endsWith('/rpc/save_gaubretrail_state')) {
      return Response.json({ message: 'DELETE requires a WHERE clause' }, { status: 400 });
    }
    throw Error(`Unexpected request: ${url}`);
  };
  const state = seedState();
  const storage = await createSupabaseStorage({ url: 'https://example.supabase.co', secretKey: 'server-only', fetch }, state);
  await assert.rejects(storage.save(state, 1), error => error.status === 503 && /20260921140000/.test(error.message));
});

test('Supabase storage preserves seed, revisions, sessions and login limits', async () => {
  let state;
  let previous;
  const sessions = new Map();
  let attempts = 0;
  const json = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (url.pathname.endsWith('/gaubretrail_state') && init.method === 'POST') {
      state ||= { revision: body.revision, payload: body.payload };
      return json(null, 201);
    }
    if (url.pathname.endsWith('/gaubretrail_state')) return json([{ revision: state.revision, payload: state.payload }]);
    if (url.pathname.endsWith('/rpc/save_gaubretrail_state')) {
      if (body.expected_revision !== state.revision) return json({ code: 'P0001', message: 'revision conflict' }, 400);
      previous = structuredClone(state);
      state = { revision: state.revision + 1, payload: body.next_payload };
      return json(state.revision);
    }
    if (url.pathname.endsWith('/rpc/consume_gaubretrail_login_attempt')) return json(++attempts);
    if (url.pathname.endsWith('/gaubretrail_sessions') && init.method === 'POST') {
      sessions.set(body.token_hash, body);
      return json(null, 201);
    }
    if (url.pathname.endsWith('/gaubretrail_sessions') && init.method === 'DELETE') {
      const token = url.searchParams.get('token_hash')?.slice(3);
      if (token) sessions.delete(token);
      return json(null);
    }
    if (url.pathname.endsWith('/gaubretrail_sessions')) {
      const token = url.searchParams.get('token_hash')?.slice(3);
      const credential = url.searchParams.get('credential_hash')?.slice(3);
      const row = sessions.get(token);
      return json(row && row.credential_hash === credential ? [{ token_hash: token }] : []);
    }
    if (url.pathname.endsWith('/gaubretrail_login_limits')) return json(null);
    throw Error(`Unexpected request: ${url}`);
  };
  const storage = await createSupabaseStorage({ url: 'https://example.supabase.co/', secretKey: 'server-only', fetch }, seedState(), () => 1_000);

  const initial = await storage.read();
  assert.equal(initial.revision, 1);
  const next = structuredClone(initial.state);
  next.editions[0].name = 'Supabase';
  assert.deepEqual(await storage.save(next, 1), { revision: 2 });
  assert.equal(previous.revision, 1);
  await assert.rejects(storage.save(initial.state, 1), error => error.status === 409);

  const token = await storage.createSession('credential');
  assert.equal(await storage.hasSession(token, 'credential'), true);
  assert.equal(await storage.hasSession(token, 'other'), false);
  await storage.deleteSession(token);
  assert.equal(await storage.hasSession(token, 'credential'), false);
  for (let index = 0; index < 8; index++) await storage.consumeLoginAttempt('organizer');
  await assert.rejects(storage.consumeLoginAttempt('organizer'), error => error.status === 429);
  assert.equal(sessions.size, 0);
  assert.match(token, /^[a-f0-9]{64}$/);
});
