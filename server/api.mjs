import { createHash } from 'node:crypto';
import { getStorage } from './state-storage.mjs';
import { validPasswordHash, verifyPassword } from './passwords.mjs';
import { publicState } from './public-state.mjs';
import { HttpError } from './errors.mjs';

const COOKIE = 'gaubretrail_session';
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });

export async function readJson(request, limit = 12 * 1024 * 1024) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Un corps JSON est nécessaire.');
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError(413, 'Données trop volumineuses.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Corps JSON manquant.');
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Données trop volumineuses.'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Corps JSON invalide.'); }
}

export function createApi({ storage = getStorage, env = process.env } = {}) {
  return async function handle(request, route) {
    try {
      const db = await storage();
      const username = env.GAUBRE_ADMIN_USERNAME || 'organisation';
      const hash = env.GAUBRE_ADMIN_PASSWORD_HASH;
      const configured = validPasswordHash(hash);
      const credentialHash = createHash('sha256').update(`${username}:${hash || ''}`).digest('hex');
      const token = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
      const admin = configured && await db.hasSession(token, credentialHash);
      const method = request.method;
      const secure = env.NODE_ENV === 'production';
      const cookie = (value, age) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;

      if (!['GET', 'HEAD'].includes(method)) {
        const expected = env.GAUBRE_APP_ORIGIN || (secure ? '' : new URL(request.url).origin);
        if (!expected || request.headers.get('origin') !== expected) throw new HttpError(403, 'Origine de la requête non autorisée.');
      }
      if (route === 'session' && method === 'GET') {
        return json({ available: true, configured, admin, capabilities: ['state'], user: admin ? { id: 'primary', name: env.GAUBRE_ADMIN_NAME || 'Organisation', role: 'organizer' } : null });
      }
      if (route === 'public' && method === 'GET') {
        const document = await db.read();
        return json({ revision: document.revision, state: publicState(document.state) });
      }
      if (route === 'login' && method === 'POST') {
        if (!configured) throw new HttpError(503, 'Le compte organisateur doit être configuré sur le serveur.');
        const data = await readJson(request, 4096);
        await db.consumeLoginAttempt('organizer');
        const valid = await verifyPassword(data?.password, hash);
        if (!valid || data?.username !== username) throw new HttpError(401, 'Identifiant ou mot de passe incorrect.');
        await db.clearLoginAttempts('organizer');
        await db.deleteSession(token);
        return json({ ok: true }, 200, { 'Set-Cookie': cookie(await db.createSession(credentialHash), 43200) });
      }
      if (['state', 'logout'].includes(route) && !admin) throw new HttpError(401, 'Connexion administrateur nécessaire.');
      if (route === 'logout' && method === 'POST') {
        await db.deleteSession(token);
        return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
      }
      if (route === 'state' && method === 'GET') return json(await db.read());
      if (route === 'state' && method === 'PUT') {
        const revision = request.headers.get('if-match');
        if (!/^\d+$/.test(revision || '') || !Number.isSafeInteger(Number(revision))) throw new HttpError(428, 'La révision des données est nécessaire.');
        return json(await db.save(await readJson(request), Number(revision)));
      }
      throw new HttpError(['session', 'login', 'logout', 'state', 'public'].includes(route) ? 405 : 404, 'Point d’accès ou méthode non disponible.');
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('GaubreTrail API:', error.message);
      return json({ error: error instanceof HttpError ? error.message : 'Le serveur ne peut pas traiter la demande.' }, error instanceof HttpError ? error.status : 500);
    }
  };
}

export const handleApi = createApi();
