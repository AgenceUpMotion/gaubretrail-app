import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashPassword } from '../server/passwords.mjs';

// Real Next production server, isolated database and throwaway credentials.
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const directory = mkdtempSync(join(tmpdir(), 'gaubre-http-test-'));
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  env: { ...process.env, GAUBRE_DATABASE_PATH: join(directory, 'test.sqlite'), GAUBRE_ADMIN_USERNAME: 'test', GAUBRE_ADMIN_PASSWORD_HASH: await hashPassword('http-test-password'), GAUBRE_APP_ORIGIN: origin },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
let cookie = '';
async function api(route, method = 'GET', body, extra = {}) {
  return fetch(`${origin}/api/${route}`, { method, headers: { Origin: origin, Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(`Next stopped: ${output}`);
    try { const response = await api('session'); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Server failed to start: ${output}`);
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /next-app-shell/);
  const scripts = [...html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)].map(match => match[1]);
  assert.ok(scripts.length);
  for (const script of scripts) assert.equal((await fetch(new URL(script, origin))).status, 200);
  assert.equal((await fetch(`${origin}/data/organization.json`)).status, 404);
  assert.equal((await fetch(`${origin}/data/forms.json`)).status, 200);
  assert.equal((await fetch(`${origin}/maplibre-gl-worker.mjs`)).status, 200);
  assert.equal((await api('state')).status, 401);
  const login = await api('login', 'POST', { username: 'test', password: 'http-test-password' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /Secure/);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const initial = await (await api('state')).json();
  const next = structuredClone(initial.state);
  next.volunteers.push({ id: 'smoke', firstName: 'Test', lastName: 'Migration', active: true, publicVisible: false, editionIds: [next.editions[0].id], email: 'private@example.test' });
  assert.equal((await api('state', 'PUT', next, { 'If-Match': String(initial.revision) })).status, 200);
  assert.equal((await (await api('state')).json()).state.volunteers.at(-1).lastName, 'Migration');
  assert.equal((await api('state', 'PUT', initial.state, { 'If-Match': String(initial.revision) })).status, 409);
  assert.doesNotMatch(await (await api('public')).text(), /private@example.test/);
  assert.equal((await api('logout', 'POST')).status, 200);
  assert.equal((await api('state')).status, 401);
  console.log('HTTP production OK: HTML, chunks, assets, private-file exclusion, login, persistence, conflict, public filtering, logout.');
} finally {
  if (child.exitCode === null) { const closed = once(child, 'exit'); child.kill(); await closed; }
  assert.ok(directory.startsWith(join(tmpdir(), 'gaubre-http-test-')));
  rmSync(directory, { recursive: true, maxRetries: 5, retryDelay: 100 });
}
