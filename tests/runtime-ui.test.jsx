import './dom-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, fireEvent, within, waitFor } from '@testing-library/react';
import { startPortal } from '../portal.js';
import { seedState } from './helpers.mjs';

test('Full admin bootstrap: legacy navigation, React save and return to assignments share the same repository', async () => {
  history.replaceState(null, '', '/?admin=1');
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
  document.body.innerHTML = markup;
  let state = seedState();
  state.volunteers = [{ id: 'v', firstName: 'Alice', lastName: 'Martin', active: true, publicVisible: false, editionIds: [state.editions[0].id] }];
  let revision = 1;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (url === './api/session') return Response.json({ available: true, configured: true, admin: true, capabilities: ['state'], user: { name: 'Test', role: 'organizer' } });
    if (url === './api/state') {
      if (options.method === 'PUT') { state = JSON.parse(options.body); revision++; return Response.json({ revision }); }
      return Response.json({ state, revision });
    }
    if (url === './data/forms.json') return Response.json(JSON.parse(readFileSync(new URL('../data/forms.json', import.meta.url), 'utf8')));
    if (/^\.\/data\/routes\/\d+\.geojson$/.test(String(url))) return Response.json(JSON.parse(readFileSync(new URL(`../${url.slice(2)}`, import.meta.url), 'utf8')));
    throw Error(`Unexpected fetch: ${url}`);
  };
  try {
    const portal = await startPortal();
    assert.equal(document.querySelectorAll('#organization').length, 1);
    await act(async () => document.querySelector('[data-nav="volunteers"]').click());
    const area = document.querySelector('[data-react-feature="volunteers"]');
    assert.ok(area);
    fireEvent.click(within(area).getByRole('button', { name: 'Modifier Martin Alice' }));
    const dialog = document.querySelector('dialog.react-dialog');
    fireEvent.change(within(dialog).getByLabelText('Nom *'), { target: { value: 'Durand' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => assert.ok(!document.querySelector('dialog.react-dialog')));
    assert.equal(state.volunteers[0].lastName, 'Durand');
    assert.equal(portal.repo.state.volunteers[0].lastName, 'Durand');
    await act(async () => document.querySelector('[data-nav="assignments"]').click());
    assert.ok(!document.querySelector('[data-react-feature="volunteers"]'));
    assert.ok(document.getElementById('orgContent').textContent.includes('Planning'));
    await act(async () => document.querySelector('[data-nav="volunteers"]').click());
    assert.ok(within(document.querySelector('[data-react-feature="volunteers"]')).getByRole('button', { name: 'Modifier Durand Alice' }));
    await act(async () => document.querySelector('[data-nav="dashboard"]').click());
  } finally {
    globalThis.fetch = originalFetch;
    document.body.replaceChildren();
    history.replaceState(null, '', '/');
  }
});
