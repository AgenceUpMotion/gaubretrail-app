import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../server/passwords.mjs';

if (existsSync('.env.local')) throw Error('.env.local existe déjà. Il a été conservé ; utilisez .env.example pour compléter sa configuration.');
const password = randomBytes(18).toString('base64url');
const hash = await hashPassword(password);
// Next expands dollar signs in env files: this hash format deliberately uses colons.
writeFileSync('.env.local', [
  'GAUBRE_ADMIN_USERNAME=organisation',
  'GAUBRE_ADMIN_NAME="Organisation GaubreTrail"',
  `GAUBRE_ADMIN_PASSWORD_HASH=${hash}`,
  'GAUBRE_DATABASE_PATH=.storage/gaubretrail.sqlite',
  'GAUBRE_APP_ORIGIN=http://localhost:3000',
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
console.log('Configuration créée dans .env.local. Identifiant : organisation');
console.log(`Mot de passe initial (à conserver dans votre gestionnaire de mots de passe) : ${password}`);
