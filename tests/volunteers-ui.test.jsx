import './dom-environment.mjs';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React, { StrictMode } from 'react';
import VolunteersPage from '../features/volunteers/VolunteersPage.jsx';
import { mountVolunteers } from '../features/volunteers/mount.jsx';
import { createStateStore } from '../lib/state-store.mjs';
import { validate } from '../domain.js';
import { seedState } from './helpers.mjs';

afterEach(cleanup);

function fixture() {
  const state = seedState();
  const editionId = state.editions[0].id;
  state.volunteers = [{ id: 'v', firstName: 'Élodie', lastName: 'Martin', active: true, editionIds: [editionId], email: 'elodie@example.test', history: [{ year: 2025, role: 'Accueil' }] }];
  let saved;
  const store = createStateStore(state, async next => { validate(next); saved = next; });
  const repository = { store, get state() { return store.getSnapshot(); } };
  return { repository, editionId, onSave: store.save, onReload: async () => {}, get saved() { return saved; } };
}

test('React form edits and saves, keeps search/focus and preserves history', async () => {
  const props = fixture();
  render(<StrictMode><VolunteersPage {...props}/></StrictMode>);
  const search = screen.getByRole('searchbox');
  search.focus();
  fireEvent.change(search, { target: { value: 'elodie' } });
  assert.equal(document.activeElement, search);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier Martin Élodie' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Nom *'), { target: { value: 'Durand' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => assert.ok(!screen.queryByRole('dialog')));
  assert.equal(props.saved.volunteers[0].lastName, 'Durand');
  assert.deepEqual(props.saved.volunteers[0].history, [{ year: 2025, role: 'Accueil' }]);
  assert.equal(search.value, 'elodie');
  assert.ok(screen.getByRole('button', { name: 'Modifier Durand Élodie' }));
});

test('React create, status filter, toggle and edition switch use the shared snapshot', async () => {
  const props = fixture();
  const view = render(<VolunteersPage key={props.editionId} {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: '+ Ajouter' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Prénom *'), { target: { value: 'Paul' } });
  fireEvent.change(within(dialog).getByLabelText('Nom *'), { target: { value: 'Bernard' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => assert.ok(!screen.queryByRole('dialog')));
  assert.equal(props.repository.state.volunteers.length, 2);
  fireEvent.click(screen.getByRole('button', { name: 'Désactiver Bernard Paul' }));
  await waitFor(() => assert.equal(props.repository.state.volunteers.find(v => v.firstName === 'Paul').active, false));
  fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: 'inactive' } });
  assert.equal(screen.queryByRole('button', { name: 'Modifier Martin Élodie' }), null);
  assert.ok(screen.getByRole('button', { name: 'Modifier Bernard Paul' }));
  const winter = props.repository.state.editions[1].id;
  view.rerender(<VolunteersPage key={winter} {...props} editionId={winter}/>);
  assert.equal(screen.getByLabelText('Filtrer par statut').value, '');
  assert.equal(screen.queryByRole('button', { name: 'Modifier Bernard Paul' }), null);
});

test('Failed saves retain the open form and draft; linked volunteers cannot be deleted', async () => {
  const props = fixture();
  render(<VolunteersPage {...props} onSave={async () => { throw Error('Serveur indisponible'); }}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier Martin Élodie' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Nom *'), { target: { value: 'Brouillon' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => assert.match(within(dialog).getByRole('alert').textContent, /Serveur indisponible/));
  assert.equal(within(dialog).getByLabelText('Nom *').value, 'Brouillon');
  assert.equal(props.repository.state.volunteers[0].lastName, 'Martin');
  cleanup();
  const linked = structuredClone(props.repository.state);
  linked.assignments.push({ id: 'a', editionId: props.editionId, volunteerId: 'v', postId: linked.posts.find(p => p.editionId === props.editionId).id, date: '2026-07-01' });
  await props.repository.store.save(linked);
  render(<VolunteersPage {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer Martin Élodie' }));
  const confirmation = screen.getByRole('dialog');
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Supprimer', exact: true }));
  await waitFor(() => assert.match(within(confirmation).getByRole('alert').textContent, /Relation introuvable/));
  assert.equal(props.repository.state.volunteers.length, 1);
});

test('Legacy adapter rerenders without resetting filters, then releases its DOM on navigation', async () => {
  const props = fixture();
  const container = document.createElement('div');
  document.body.append(container);
  const adapter = mountVolunteers(container);
  try {
    await act(async () => adapter.render(props));
    fireEvent.change(within(container).getByRole('searchbox'), { target: { value: 'elodie' } });
    await act(async () => adapter.render({ ...props }));
    assert.equal(within(container).getByRole('searchbox').value, 'elodie');
    await act(async () => adapter.unmount());
    container.textContent = 'Écran historique';
    assert.equal(container.querySelector('[data-react-feature]'), null);
    assert.equal(container.textContent, 'Écran historique');
  } finally { container.remove(); }
});
