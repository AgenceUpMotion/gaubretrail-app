import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateStore } from '../lib/state-store.mjs';
import { selectVolunteers, saveVolunteer, editionIds } from '../features/volunteers/model.mjs';
import { prepareContactImport, exportContacts } from '../contacts.js';
import { validate } from '../domain.js';
import { seedState } from './helpers.mjs';
import { readLocalBackup } from '../lib/local-backup.mjs';

test('Store publishes only persisted state, rejects concurrent writes and keeps failures unchanged', async () => {
  let complete;
  const initial = { count: 1 };
  const store = createStateStore(initial, () => new Promise(resolve => { complete = resolve; }));
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  const draft = { count: 2 };
  const pending = store.save(draft);
  draft.count = 999;
  assert.equal(store.getSnapshot(), initial);
  await assert.rejects(store.save({ count: 3 }), /Enregistrement/);
  await assert.rejects(store.reload(async () => ({ count: 4 })), /Enregistrement/);
  complete(); await pending;
  assert.deepEqual(store.getSnapshot(), { count: 2 });
  assert.equal(notifications, 1); unsubscribe();
  const failing = createStateStore(initial, async () => { throw Error('network'); });
  await assert.rejects(failing.save({ count: 2 }), /network/);
  assert.equal(failing.getSnapshot(), initial);
});

test('Volunteer filters are edition-scoped, accent-insensitive, and include assigned posts', () => {
  const state = seedState();
  const [summer, winter] = state.editions;
  state.volunteers = [
    { id: 'a', firstName: 'Élodie', lastName: 'Martin', active: true, editionIds: [summer.id] },
    { id: 'b', firstName: 'Paul', lastName: 'Dupont', active: false, editionIds: [summer.id] },
    { id: 'c', firstName: 'Élodie', lastName: 'Hiver', active: true, editionIds: [winter.id] },
  ];
  const post = state.posts.find(post => post.editionId === summer.id);
  state.assignments = [{ id: 'a', editionId: summer.id, volunteerId: 'a', postId: post.id }];
  assert.deepEqual(selectVolunteers(state, summer.id, { query: 'elodie' }).items.map(row => row.volunteer.id), ['a']);
  assert.deepEqual(selectVolunteers(state, summer.id, { postId: 'none' }).items.map(row => row.volunteer.id), ['b']);
  assert.deepEqual(selectVolunteers(state, summer.id, { query: post.name }).items.map(row => row.volunteer.id), ['a']);
  assert.equal(selectVolunteers(state, summer.id).assigned, 1);
  assert.deepEqual(editionIds(state, { id: 'a' }), [summer.id]);
});

test('Editing preserves history, trims names and rejects broken assignment relations', () => {
  const state = seedState();
  const editionId = state.editions[0].id;
  state.volunteers = [{ id: 'v', firstName: 'Alice', lastName: 'Martin', active: true, editionIds: [editionId], history: [{ year: 2025, role: 'Accueil' }] }];
  const next = saveVolunteer(state, { id: 'v', firstName: ' Alice ', lastName: ' Dupont ' });
  assert.equal(next.volunteers[0].lastName, 'Dupont');
  assert.deepEqual(next.volunteers[0].history, state.volunteers[0].history);
  assert.equal(state.volunteers[0].lastName, 'Martin');
  validate(next);
  next.assignments = [{ id: 'a', volunteerId: 'v', postId: next.posts.find(post => post.editionId === editionId).id, editionId, date: '2026-07-01' }];
  assert.throws(() => validate({ ...next, volunteers: [] }), /Relation introuvable/);
  assert.throws(() => validate(saveVolunteer(next, { id: 'v', firstName: 'Alice', lastName: 'Martin', editionIds: [state.editions[1].id] })), /ne participe pas/);
});

test('CSV round-trip preserves accents, multiline notes, publication consent and IDs', () => {
  const state = seedState();
  const volunteer = { id: 'v', firstName: 'Élodie', lastName: 'Martin', editionIds: [state.editions[0].id], active: true, publicVisible: false, notes: 'Une ligne;\nUne autre "ligne"' };
  const csv = exportContacts([volunteer], 'volunteers', 'csv');
  const result = prepareContactImport(csv, 'volunteers.csv', 'volunteers', state, state.editions[0].id);
  assert.equal(result.added, 1);
  assert.equal(result.next.volunteers[0].notes, volunteer.notes);
  assert.equal(result.next.volunteers[0].publicVisible, false);
  const update = prepareContactImport(csv, 'volunteers.csv', 'volunteers', result.next, state.editions[0].id);
  assert.equal(update.added, 0); assert.equal(update.updated, 1);
});

test('Local recovery prefers v3, leaves browser storage unchanged and never masks invalid JSON', () => {
  const values = new Map([['gaubretrail-organization-v3', '{"schemaVersion":3}'], ['gaubretrail-management-v1', '{"version":1}']]);
  const storage = { getItem: key => values.get(key) || null };
  assert.equal(readLocalBackup(storage).key, 'gaubretrail-organization-v3');
  assert.equal(values.size, 2);
  values.set('gaubretrail-organization-v3', 'broken');
  assert.throws(() => readLocalBackup(storage));
});
