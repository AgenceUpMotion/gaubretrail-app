import { migrate, validate } from '../domain.js';
import { createStateStore } from './state-store.mjs';

async function json(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let data;
  try { data = await response.json(); }
  catch { throw Object.assign(Error('Le serveur a renvoyé une réponse invalide. Vérifiez que l’application Node.js est démarrée.'), { status: response.status }); }
  if (!response.ok) throw Object.assign(Error(data.error || `Serveur indisponible (${response.status})`), { status: response.status });
  return data;
}

export async function openRepository() {
  const requested = new URLSearchParams(location.search).has('admin');
  const session = await json('./api/session');
  // Never fall back to browser-only administration if the server fails.
  const admin = requested && session.admin === true;
  const endpoint = admin ? './api/state' : './api/public';
  const initial = await json(endpoint);
  let revision = initial.revision;
  const seed = structuredClone(initial.state);
  const store = createStateStore(initial.state, async next => {
    if (!admin) throw Error('Accès administrateur nécessaire.');
    validate(next);
    const result = await json('./api/state', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(revision) },
      body: JSON.stringify(next),
    });
    revision = result.revision;
  });
  const request = (path, method = 'GET', data) => json(`./api/${path}`, {
    method,
    ...(data !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
  });
  return {
    admin, remote: true, requested, configured: session.configured,
    user: session.user, capabilities: session.capabilities || [], store,
    get state() { return store.getSnapshot(); },
    request,
    async login(password, username) { await request('login', 'POST', { password, username }); location.reload(); },
    save: store.save,
    reload: () => store.reload(async () => {
      const result = await json(endpoint);
      revision = result.revision;
      return result.state;
    }),
    migrate: raw => migrate(raw, seed),
    courseTemplates: season => seed.courses.filter(course => course.editionId === seed.editions.find(edition => edition.season === season)?.id),
    conversation: token => json('./api/conversations', { headers: { Authorization: `Bearer ${token}` } }),
    send: (token, postId, text) => json('./api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ postId, text }) }),
    invitation: (volunteerId, editionId) => request('invitations', 'POST', { volunteerId, editionId }),
  };
}
