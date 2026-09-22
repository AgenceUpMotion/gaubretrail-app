import { createHash, randomBytes } from 'node:crypto';
import { validate } from '../domain.js';
import { HttpError } from './errors.mjs';

const tokenHash = token => createHash('sha256').update(token).digest('hex');

function configurationError(message) {
  return Error(`Supabase indisponible : ${message}`);
}

function parsePayload(payload) {
  return typeof payload === 'string' ? JSON.parse(payload) : payload;
}

/**
 * Storage backed by Supabase's PostgREST API. The secret key is used only
 * from this server module; it must never be exposed as NEXT_PUBLIC_*.
 */
export async function createSupabaseStorage({ url, secretKey, fetch: fetcher = globalThis.fetch }, seed, now = Date.now) {
  validate(seed);
  if (!url || !secretKey) throw configurationError('SUPABASE_URL et SUPABASE_SECRET_KEY sont nécessaires.');
  if (typeof fetcher !== 'function') throw configurationError('l’API fetch de Node.js est nécessaire.');

  let baseUrl;
  try { baseUrl = new URL(url).toString().replace(/\/$/, ''); }
  catch { throw configurationError('SUPABASE_URL doit être une URL valide.'); }

  const headers = {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };

  async function request(path, init = {}) {
    let response;
    try {
      response = await fetcher(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...init.headers } });
    } catch {
      throw configurationError('la requête vers le projet a échoué.');
    }
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      const message = typeof body === 'object' && body?.message ? body.message : 'la base a refusé la requête.';
      const error = configurationError(message);
      error.code = typeof body === 'object' ? body?.code : undefined;
      throw error;
    }
    return body;
  }

  async function rpc(name, body) {
    try { return await request(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) }); }
    catch (error) {
      if (error.code === 'P0001') throw new HttpError(409, 'Les données ont été modifiées ailleurs. Rechargez avant de réessayer.');
      if (/DELETE requires a WHERE clause/i.test(error.message)) {
        throw new HttpError(503, 'La migration corrective Supabase 20260921140000 doit être exécutée avant de modifier les données.');
      }
      throw error;
    }
  }

  // The migration defines the table, while this idempotent insert initializes
  // a new project from the application seed without overwriting existing data.
  await request('/rest/v1/gaubretrail_state?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, revision: 1, payload: seed }),
  });

  const read = async () => {
    const rows = await request('/rest/v1/gaubretrail_state?select=revision,payload&id=eq.1');
    const row = rows?.[0];
    if (!row) throw configurationError('la table gaubretrail_state est vide. Vérifiez la migration SQL.');
    return { revision: Number(row.revision), state: parsePayload(row.payload) };
  };

  return {
    read,
    async save(state, revision) {
      try { validate(state); } catch (error) { throw new HttpError(422, error.message); }
      const nextRevision = await rpc('save_gaubretrail_state', { expected_revision: revision, next_payload: state });
      return { revision: Number(nextRevision) };
    },
    async createSession(credentialHash) {
      const token = randomBytes(32).toString('hex');
      await request(`/rest/v1/gaubretrail_sessions?expires=lte.${now()}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      await request('/rest/v1/gaubretrail_sessions', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ token_hash: tokenHash(token), credential_hash: credentialHash, expires: now() + 12 * 60 * 60 * 1000 }),
      });
      return token;
    },
    async hasSession(token, credentialHash) {
      if (!/^[a-f0-9]{64}$/.test(token || '')) return false;
      const query = new URLSearchParams({ select: 'token_hash', token_hash: `eq.${tokenHash(token)}`, credential_hash: `eq.${credentialHash}`, expires: `gt.${now()}` });
      const rows = await request(`/rest/v1/gaubretrail_sessions?${query}`);
      return Boolean(rows?.length);
    },
    async deleteSession(token) {
      if (token) await request(`/rest/v1/gaubretrail_sessions?token_hash=eq.${tokenHash(token)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    },
    async consumeLoginAttempt(key) {
      const attempts = await rpc('consume_gaubretrail_login_attempt', { attempt_key: key });
      if (Number(attempts) > 8) throw new HttpError(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    },
    async clearLoginAttempts(key) {
      await request(`/rest/v1/gaubretrail_login_limits?id_key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    },
    async close() {},
  };
}
