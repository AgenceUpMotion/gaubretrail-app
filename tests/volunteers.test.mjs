import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateStore } from '../lib/state-store.mjs';
import { selectVolunteers, saveVolunteer, editionIds } from '../features/volunteers/model.mjs';
import { prepareContactImport, exportContacts } from '../contacts.js';
import { validate, runnerPassageAt, runnerProgressAt, coordinateAtProgress, estimatePresence, publicData } from '../domain.js';
import { brandLogoUrl } from '../theme.js';

test('Branding accepts safe colors and logo, and exposes only public visual settings', () => {
  const state=seedState(),logo='data:image/png;base64,iVBORw0KGgo=';
  state.settings={cadastreUrl:'private.example',branding:{primaryColor:'#123ABC',secondaryColor:'#FF7700',logo}};
  assert.doesNotThrow(()=>validate(state));
  assert.deepEqual(publicData(state).settings,{branding:{primaryColor:'#123ABC',secondaryColor:'#FF7700',logo}});
  assert.equal(brandLogoUrl(state.settings),logo);
  state.settings.branding.primaryColor='red';
  assert.throws(()=>validate(state),/couleurs de personnalisation/);
  state.settings.branding.primaryColor='#123ABC';
  state.settings.branding.logo='data:image/svg+xml;base64,PHN2Zz4=';
  assert.throws(()=>validate(state),/Logo invalide/);
  assert.equal(brandLogoUrl(state.settings),'./assets/logo-gaubretrail.svg');
});

test('Live simulation positions the first and last runner along a route', () => {
  const course = { departureTime: '08:00', firstDuration: '01:00', lastDuration: '02:00' };
  assert.deepEqual(runnerProgressAt(course, 510, 'firstDuration').progress, 0.5);
  assert.equal(runnerProgressAt(course, 510, 'lastDuration').progress, 0.25);
  assert.equal(runnerProgressAt(course, 450, 'firstDuration').state, 'before');
  assert.deepEqual(coordinateAtProgress([[0, 0], [2, 0]], 0.25), [0.5, 0]);
});
test('Intermediate course times drive segment positions and passage estimates', () => {
  const course = { id:'course', name:'20 km', distance:20, departureTime:'08:00', firstDuration:'02:00', lastDuration:'04:00', intermediateTimes:[
    { km:5, firstDuration:'00:20', lastDuration:'00:50' },
    { km:15, firstDuration:'01:20', lastDuration:'02:40' },
  ] };
  assert.equal(runnerProgressAt(course, 530, 'firstDuration').progress, .5);
  assert.equal(runnerProgressAt(course, 530, 'lastDuration').progress, .25);
  assert.equal(runnerPassageAt(course, .5, 'firstDuration'), 530);
  assert.equal(runnerPassageAt(course, .5, 'lastDuration'), 585);
  const presence=estimatePresence([{course,coords:[[0,0],[2,0]]}],{lng:1,lat:0});
  assert.equal(presence.passages[0].first, 530);
  assert.equal(presence.passages[0].last, 585);
});

test('A course accepts at most two ordered and coherent timing checkpoints', () => {
  const state=seedState(),course=state.courses[0];
  Object.assign(course,{distance:20,departureTime:'08:00',firstDuration:'02:00',lastDuration:'04:00',intermediateTimes:[
    {km:5,firstDuration:'00:20',lastDuration:'00:50'},
    {km:15,firstDuration:'01:20',lastDuration:'02:40'},
  ]});
  assert.doesNotThrow(()=>validate(state));
  assert.deepEqual(publicData(state).courses.find(item=>item.id===course.id).intermediateTimes,course.intermediateTimes);
  course.intermediateTimes.push({km:18,firstDuration:'01:45',lastDuration:'03:35'});
  assert.throws(()=>validate(state),/Deux temps intermédiaires maximum/);
  course.intermediateTimes.pop();
  course.intermediateTimes[1].firstDuration='00:10';
  assert.throws(()=>validate(state),/temps intermédiaires doivent progresser/);
  course.intermediateTimes[1].firstDuration='01:20';
  course.intermediateTimes[1].km=4;
  assert.throws(()=>validate(state),/kilomètres intermédiaires doivent être croissants/);
});
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

test('Organization team is global while its post assignments remain edition-specific', () => {
  const state = seedState();
  const [summer, winter] = state.editions;
  const winterPost = { ...state.posts[0], id: 'winter-post', editionId: winter.id, courseIds: [] };
  state.posts.push(winterPost);
  state.volunteers = [
    { id: 'team', firstName: 'Alice', lastName: 'Martin', active: true, organizationMember: true, editionIds: [summer.id] },
    { id: 'new-team', firstName: 'Paul', lastName: 'Durand', active: true, organizationMember: true },
    { id: 'volunteer', firstName: 'Léa', lastName: 'Petit', active: true, editionIds: [summer.id] },
  ];
  state.assignments = [{ id: 'winter-team', editionId: winter.id, volunteerId: 'team', postId: winterPost.id, date: '2026-12-01' }];
  assert.doesNotThrow(() => validate(state));
  assert.deepEqual(selectVolunteers(state, summer.id, { organizationOnly: true }).items.map(row => row.volunteer.id), ['new-team', 'team']);
  const winterTeam = selectVolunteers(state, winter.id, { organizationOnly: true });
  assert.deepEqual(winterTeam.items.map(row => row.volunteer.id), ['new-team', 'team']);
  assert.equal(winterTeam.assigned, 1);
  assert.equal(selectVolunteers(state, summer.id, { organizationOnly: true }).assigned, 0);
  assert.deepEqual(selectVolunteers(state, winter.id).items, []);
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
