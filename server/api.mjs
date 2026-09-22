import { createHash, randomUUID } from 'node:crypto';
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

const applicationText = (data, key, limit, required = false) => {
  const value = typeof data?.[key] === 'string' ? data[key].trim() : '';
  if (required && !value) throw new HttpError(422, `Champ obligatoire : ${key}.`);
  if (value.length > limit) throw new HttpError(422, `Champ trop long : ${key}.`);
  return value;
};

function applicationPayload(data, state) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Demande d’inscription invalide.');
  if (applicationText(data, 'website', 200)) return { honeypot: true };
  if (data.consent !== true) throw new HttpError(422, 'Votre accord est nécessaire pour envoyer cette demande.');
  const firstName = applicationText(data, 'firstName', 100, true);
  const lastName = applicationText(data, 'lastName', 100, true);
  const email = applicationText(data, 'email', 200, true).toLowerCase();
  const phone = applicationText(data, 'phone', 50);
  const availability = applicationText(data, 'availability', 2000);
  const preference = applicationText(data, 'preference', 500);
  const notes = applicationText(data, 'notes', 2000);
  const friendVolunteerId = applicationText(data, 'friendVolunteerId', 100);
  const friendName = applicationText(data, 'friendName', 200);
  const editionId = applicationText(data, 'editionId', 100, true);
  const preferredMissionTypes = Array.isArray(data.preferredMissionTypes) ? [...new Set(data.preferredMissionTypes)] : [];
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(422, 'Adresse e-mail invalide.');
  if (!state.editions.some(edition => edition.id === editionId)) throw new HttpError(422, 'Édition introuvable.');
  if (preferredMissionTypes.length > 8 || preferredMissionTypes.some(type => typeof type !== 'string' || !type || type.length > 100)) throw new HttpError(422, 'Sélection de missions invalide.');
  const availableMissionTypes = new Set(state.posts.filter(post => post.editionId === editionId).map(post => post.postType || 'Commissaire'));
  if (preferredMissionTypes.some(type => !availableMissionTypes.has(type))) throw new HttpError(422, 'Un type de mission sélectionné est introuvable.');
  const friendVolunteer = friendVolunteerId ? state.volunteers.find(volunteer => volunteer.id === friendVolunteerId) : null;
  if (friendVolunteerId && !friendVolunteer) throw new HttpError(422, 'Le bénévole choisi est introuvable.');
  return { firstName, lastName, email, phone, availability, preference, notes, editionId, missionTypes: preferredMissionTypes, friend: friendVolunteer ? { volunteerId: friendVolunteer.id, name: `${friendVolunteer.firstName} ${friendVolunteer.lastName}`.trim() } : friendName ? { name: friendName } : null };
}

const applicationDetails = application => ({
  submittedAt: new Date().toISOString(), editionId: application.editionId,
  availability: application.availability, preference: application.preference,
  notes: application.notes, missionTypes: application.missionTypes, friend: application.friend,
});

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
        return json({ available: true, configured, admin, capabilities: ['state', 'applications'], user: admin ? { id: 'primary', name: env.GAUBRE_ADMIN_NAME || 'Organisation', role: 'organizer' } : null });
      }
      if (route === 'public' && method === 'GET') {
        const document = await db.read();
        return json({ revision: document.revision, state: publicState(document.state) });
      }
      if (route === 'applications' && method === 'POST') {
        const application = applicationPayload(await readJson(request, 8192), (await db.read()).state);
        // Bots receive a successful response but never create a record.
        if (application.honeypot) return json({ ok: true }, 201);
        for (let attempt = 0; attempt < 3; attempt++) {
          const document = await db.read();
          const duplicate = document.state.volunteers.find(volunteer => String(volunteer.email || '').trim().toLowerCase() === application.email);
          const details = applicationDetails(application);
          if (duplicate) {
            const editionIds = Array.isArray(duplicate.editionIds) ? duplicate.editionIds : document.state.editions.map(edition => edition.id);
            if (editionIds.includes(application.editionId)) return json({ ok: true, alreadyRegistered: true });
            const next = structuredClone(document.state);
            const volunteer = next.volunteers.find(item => item.id === duplicate.id);
            volunteer.editionIds = [...new Set([...editionIds, application.editionId])];
            if (!volunteer.phone && application.phone) volunteer.phone = application.phone;
            volunteer.application = details;
            volunteer.applicationHistory = [...(volunteer.applicationHistory || []), details];
            if (!volunteer.active) volunteer.applicationPending = true;
            try {
              const result = await db.save(next, document.revision);
              return json({ ok: true, addedToEdition: true, revision: result.revision }, 201);
            } catch (error) {
              if (error instanceof HttpError && error.status === 409 && attempt < 2) continue;
              throw error;
            }
          }
          const volunteer = {
            id: randomUUID(), firstName: application.firstName, lastName: application.lastName,
            email: application.email, phone: application.phone, editionIds: [application.editionId], active: false,
            applicationPending: true,
            application: details, applicationHistory: [details],
          };
          try {
            const result = await db.save({ ...document.state, volunteers: [...document.state.volunteers, volunteer] }, document.revision);
            return json({ ok: true, revision: result.revision }, 201);
          } catch (error) {
            if (error instanceof HttpError && error.status === 409 && attempt < 2) continue;
            throw error;
          }
        }
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
      throw new HttpError(['session', 'login', 'logout', 'state', 'public', 'applications'].includes(route) ? 405 : 404, 'Point d’accès ou méthode non disponible.');
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('GaubreTrail API:', error.message);
      return json({ error: error instanceof HttpError ? error.message : 'Le serveur ne peut pas traiter la demande.' }, error instanceof HttpError ? error.status : 500);
    }
  };
}

export const handleApi = createApi();
