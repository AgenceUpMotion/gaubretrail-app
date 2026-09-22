import { getStorage } from '../server/state-storage.mjs';
import { repairStateEncoding } from '../lib/repair-mojibake.mjs';

const storage = await getStorage();
try {
  const current = await storage.read();
  const repaired = repairStateEncoding(current.state);
  if (!repaired.repairedStrings) {
    console.log('Aucun texte mal encodé détecté.');
  } else {
    await storage.save(repaired.state, current.revision);
    console.log(`${repaired.repairedStrings} texte(s) corrigé(s). Une copie de l’état précédent a été conservée.`);
  }
} finally {
  await storage.close();
}
