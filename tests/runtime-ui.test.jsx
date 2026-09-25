import './dom-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, fireEvent, within, waitFor } from '@testing-library/react';
import { startPortal } from '../portal.js';
import { seedState } from './helpers.mjs';
import { createLiveMarkerElement, liveRunnerPairAt, toggleLiveMarkerDetails } from '../map/live-markers.js';

test('Customization saves brand colors and updates the shared visual theme', async () => {
  history.replaceState(null, '', '/?admin=1');
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
  document.body.innerHTML = markup;
  let state = seedState();
  let revision = 1;
  const originalFetch = globalThis.fetch;
  const originalFileReader = globalThis.FileReader;
  globalThis.FileReader = window.FileReader;
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
    await startPortal();
    await act(async () => document.querySelector('[data-nav="customization"]').click());
    const form = document.getElementById('customizationForm');
    assert.ok(form);
    fireEvent.input(form.elements.primaryColor, { target: { value: '#1255aa' } });
    fireEvent.input(form.elements.secondaryColor, { target: { value: '#ee6600' } });
    fireEvent.change(document.getElementById('customizationFile'), { target: { files: [new window.File(['logo'], 'logo.png', { type: 'image/png' })] } });
    await waitFor(() => assert.ok(document.getElementById('customizationLogo').src.startsWith('data:image/png;base64,')));
    assert.equal(document.getElementById('primaryHex').textContent, '#1255AA');
    fireEvent.submit(form);
    await waitFor(() => assert.deepEqual(state.settings.branding, { primaryColor: '#1255aa', secondaryColor: '#ee6600', logo: 'data:image/png;base64,bG9nbw==' }));
    assert.equal(document.documentElement.style.getPropertyValue('--gt-indigo'), '#1255aa');
    assert.equal(document.documentElement.style.getPropertyValue('--gt-magenta'), '#ee6600');
    assert.ok(document.querySelector('[data-brand-logo]').src.startsWith('data:image/png;base64,'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.FileReader = originalFileReader;
    document.documentElement.style.removeProperty('--gt-indigo');
    document.documentElement.style.removeProperty('--gt-magenta');
    document.body.replaceChildren();
    history.replaceState(null, '', '/');
  }
});

test('Live map keeps a visible leader when the first runner has finished and uses distinct readable badges', () => {
  const course = { name: 'Trail 20 km', distance: 20, color: '#f8fafc', departureTime: '08:00', firstDuration: '01:00', lastDuration: '02:00' };
  const pair = liveRunnerPairAt(course, 570);
  assert.equal(pair.first.state, 'finished');
  assert.equal(pair.last.state, 'running');
  const first = createLiveMarkerElement(course, 'first', pair.first);
  const last = createLiveMarkerElement(course, 'last', pair.last);
  assert.equal(first.style.getPropertyValue('--live-course-color'), '#f8fafc');
  assert.equal(first.style.getPropertyValue('--live-marker-text-color'), '#171535');
  assert.equal(createLiveMarkerElement({ ...course, color: '#111111' }, 'first', pair.first).style.getPropertyValue('--live-marker-text-color'), '#fff');
  assert.equal(first.querySelector('.live-map-marker-symbol').textContent, '1');
  assert.equal(first.querySelector('.live-map-marker-distance').textContent, '20 km');
  assert.equal(last.querySelector('.live-map-marker-symbol').textContent, 'D');
  assert.equal(last.querySelector('.live-map-marker-detail small').textContent, 'Dernier · 75 %');
  assert.equal(first.querySelector('.live-map-marker-detail strong').textContent, course.name);
  assert.equal(first.getAttribute('aria-label'), 'Premier concurrent · Trail 20 km · arrivé');
  toggleLiveMarkerDetails(first, [first, last]);
  assert.equal(first.getAttribute('aria-expanded'), 'true');
  toggleLiveMarkerDetails(last, [first, last]);
  assert.equal(first.getAttribute('aria-expanded'), 'false');
  assert.equal(last.getAttribute('aria-expanded'), 'true');
  assert.equal(liveRunnerPairAt(course, 610), null);
});

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

test('Course form saves two intermediate timing points', async () => {
  history.replaceState(null, '', '/?admin=1');
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
  document.body.innerHTML = markup;
  let state = seedState();
  const courseId = state.courses[0].id;
  let revision = 1;
  const originalFetch = globalThis.fetch;
  const originalFormData = globalThis.FormData;
  globalThis.FormData = window.FormData;
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
    await startPortal();
    await act(async () => document.querySelector('[data-nav="courses"]').click());
    await act(async () => document.querySelector(`[data-field-edit="${courseId}"]`).click());
    const form = document.getElementById('entityForm');
    assert.ok(form);
    fireEvent.change(form.elements.distance, { target: { value: '20' } });
    fireEvent.change(form.elements.departureTime, { target: { value: '08:00' } });
    fireEvent.change(form.elements.firstDuration, { target: { value: '02:00' } });
    fireEvent.change(form.elements.lastDuration, { target: { value: '04:00' } });
    const points = form.querySelectorAll('[data-course-checkpoint]');
    assert.equal(points.length, 2);
    for (const [index, values] of [[5, '00:20', '00:50'], [15, '01:20', '02:40']].entries()) {
      const inputs = points[index].querySelectorAll('input');
      values.forEach((value, position) => fireEvent.input(inputs[position], { target: { value } }));
    }
    fireEvent.submit(form);
    await waitFor(() => assert.equal(document.getElementById('orgDialog').open, false));
    assert.deepEqual(state.courses.find(course => course.id === courseId).intermediateTimes, [
      { km: 5, firstDuration: '00:20', lastDuration: '00:50' },
      { km: 15, firstDuration: '01:20', lastDuration: '02:40' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.FormData = originalFormData;
    document.body.replaceChildren();
    history.replaceState(null, '', '/');
  }
});
