import { readFileSync } from 'node:fs';
export const seedState = () => JSON.parse(readFileSync(new URL('../data/organization.json', import.meta.url), 'utf8'));
