import { copyFileSync, cpSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const publicDirectory = join(root, 'public');

mkdirSync(publicDirectory, { recursive: true });

for (const directory of ['assets', 'data/routes']) {
  const source = join(root, directory);
  if (existsSync(source)) cpSync(source, join(publicDirectory, directory), { recursive: true, force: true });
}

mkdirSync(join(publicDirectory, 'data'), { recursive: true });
for (const file of ['forms.json', 'sites.geojson']) {
  copyFileSync(join(root, 'data', file), join(publicDirectory, 'data', file));
}
// Only generated legacy copies: public state now comes from the filtered API.
for (const file of ['organization.json', 'public.json']) {
  const generated = join(publicDirectory, 'data', file);
  if (existsSync(generated)) unlinkSync(generated);
}

for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(root, 'node_modules', 'maplibre-gl', 'dist', file), join(publicDirectory, file));
}

console.log('Ressources Gaubre’Trail synchronisées pour Next.js.');
