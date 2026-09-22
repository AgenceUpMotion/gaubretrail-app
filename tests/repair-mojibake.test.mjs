import test from 'node:test';
import assert from 'node:assert/strict';
import { repairMojibake, repairStateEncoding } from '../lib/repair-mojibake.mjs';

test('Repairs single and double Windows-1252 UTF-8 mojibake without changing valid French text', () => {
  assert.equal(repairMojibake('PrÃ©sence prÃ©vue : 09:50â€“10:30'), 'Présence prévue : 09:50–10:30');
  assert.equal(repairMojibake('PrÃƒÂ©sence prÃƒÂ©vue'), 'Présence prévue');
  assert.equal(repairMojibake('Présence prévue : 09:50–10:30'), 'Présence prévue : 09:50–10:30');
});

test('Repairs all textual fields in a state document', () => {
  const original = { posts: [{ instructions: 'PrÃ©sence prÃ©vue : 09:50â€“10:30' }], volunteers: [{ firstName: 'Élodie' }] };
  const result = repairStateEncoding(original);
  assert.equal(result.repairedStrings, 1);
  assert.equal(result.state.posts[0].instructions, 'Présence prévue : 09:50–10:30');
  assert.equal(result.state.volunteers[0].firstName, 'Élodie');
  assert.equal(original.posts[0].instructions, 'PrÃ©sence prÃ©vue : 09:50â€“10:30');
});
