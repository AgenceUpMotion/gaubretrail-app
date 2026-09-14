import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from '../domain.js';
import { getStorage } from '../server/state-storage.mjs';

const file = process.argv[2];
if (!file) throw Error('Usage : npm run import:state -- chemin/vers/sauvegarde-privee.json');
const raw = JSON.parse(readFileSync(resolve(file), 'utf8'));
const seed = JSON.parse(readFileSync(resolve('data/organization.json'), 'utf8'));
const next = migrate(raw.state || raw, seed);
const storage = getStorage();
try {
  const current = storage.read();
  if (current.revision !== 1 || JSON.stringify(current.state) !== JSON.stringify(seed)) {
    throw Error('La base contient déjà des modifications. Utilisez la restauration avec sauvegarde depuis l’administration.');
  }
  storage.save(next, current.revision);
  console.log(`Import validé : ${next.volunteers.length} bénévoles, ${next.posts.length} postes, ${next.assignments.length} affectations. Source conservée.`);
} finally { storage.close(); }
