import './dom-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fireEvent } from '@testing-library/react';
import { startPortal } from '../portal.js';
import { publicState } from '../server/public-state.mjs';
import { seedState } from './helpers.mjs';

test('Public home hides the wrapped map and searches published missions in either name order', async () => {
  history.replaceState(null, '', '/');
  localStorage.clear();
  const state = seedState();
  const [summer, winter] = state.editions;
  state.volunteers = [
    { id: 'visible', firstName: 'René', lastName: 'Dupont', active: true, publicVisible: true },
    { id: 'private', firstName: 'Secret', lastName: 'Dupont', active: true, publicVisible: false },
  ];
  state.posts = [{ id: 'post', editionId: summer.id, number: '1', name: 'Parking', publicVisible: true }];
  state.assignments = state.volunteers.map(v => ({ id: v.id, volunteerId: v.id, postId: 'post', editionId: summer.id, date: '2026-06-01', start: '08:00', end: '10:00' }));
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('../app/next.css', import.meta.url), 'utf8');
  document.head.append(style);
  document.body.className = '';
  document.body.innerHTML = `<div id="next-app-shell">${markup}</div>`;
  const originalFetch = globalThis.fetch;
  let mapLoads = 0;
  globalThis.fetch = async url => {
    if (url === './api/session') return Response.json({ admin: true, configured: true, capabilities: ['state'] });
    if (url === './api/public') return Response.json({ state: publicState(state), revision: 1 });
    throw Error(`Unexpected fetch: ${url}`);
  };
  try {
    await startPortal({ loadMap: () => { mapLoads++; throw Error('Unexpected map load'); } });
    assert.equal(mapLoads, 0);
    assert.equal(document.getElementById('portal').hidden, false);
    assert.equal(window.getComputedStyle(document.querySelector('.workspace')).display, 'none');
    assert.equal(window.getComputedStyle(document.querySelector('.topbar')).display, 'none');
    const input = document.getElementById('portalSearch');
    for (const query of ['rene dupont', 'DUPONT René', '  dupont   rene  ', 'Ren']) {
      fireEvent.input(input, { target: { value: query } });
      assert.equal(document.querySelectorAll('.public-person').length, 1);
      assert.match(document.getElementById('portalResults').textContent, /Parking/);
    }
    fireEvent.input(input, { target: { value: 'Secret' } });
    assert.equal(document.querySelectorAll('.public-person').length, 1);
    fireEvent.change(document.getElementById('publicEdition'), { target: { value: winter.id } });
    assert.match(document.getElementById('portalResults').textContent, /Aucune mission publiée pour cette édition/);
    fireEvent.change(document.getElementById('publicEdition'), { target: { value: summer.id } });
    fireEvent.input(input, { target: { value: 'Dupont René' } });
    assert.equal(document.querySelectorAll('.public-person').length, 1);
    document.body.classList.remove('portal-view');
    assert.notEqual(window.getComputedStyle(document.querySelector('.workspace')).display, 'none');
  } finally {
    globalThis.fetch = originalFetch;
    style.remove();
    document.body.replaceChildren();
    localStorage.clear();
  }
});
