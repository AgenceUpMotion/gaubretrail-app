import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../server/passwords.mjs';

const path = '.env.local';
if (!existsSync(path)) throw Error('.env.local est introuvable. Exécutez d’abord npm run setup.');

const requestedUsername = process.env.GAUBRE_RESET_USERNAME;
const requestedPassword = process.env.GAUBRE_RESET_PASSWORD;
if (requestedUsername !== undefined && !requestedUsername.trim()) throw Error('GAUBRE_RESET_USERNAME ne peut pas être vide.');
if (requestedPassword !== undefined && !requestedPassword) throw Error('GAUBRE_RESET_PASSWORD ne peut pas être vide.');
const password = requestedPassword || randomBytes(18).toString('base64url');
const hash = await hashPassword(password);
const source = readFileSync(path, 'utf8');
const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
const set = (content, key, value) => {
  const line = `${key}=${value}`;
  const matcher = new RegExp(`^${key}=.*$`, 'm');
  return matcher.test(content)
    ? content.replace(matcher, line)
    : `${content}${content && !content.endsWith('\n') ? lineEnding : ''}${line}${lineEnding}`;
};
let next = set(source, 'GAUBRE_ADMIN_PASSWORD_HASH', hash);
if (requestedUsername !== undefined) next = set(next, 'GAUBRE_ADMIN_USERNAME', requestedUsername.trim());

writeFileSync(path, next, 'utf8');
console.log('Le mot de passe organisateur a été réinitialisé. Toutes les sessions existantes sont invalidées.');
if (requestedUsername !== undefined) console.log(`Identifiant organisateur mis à jour : ${requestedUsername.trim()}`);
if (requestedPassword === undefined) console.log(`Nouveau mot de passe (à conserver dans votre gestionnaire de mots de passe) : ${password}`);
