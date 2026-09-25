import { runnerProgressAt } from '../domain.js';

function contrastingTextColor(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!match) return '#fff';
  const rgb = [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  return luminance > .179 ? '#171535' : '#fff';
}

export function liveRunnerPairAt(course, atMinutes) {
  const first = runnerProgressAt(course, atMinutes, 'firstDuration');
  const last = runnerProgressAt(course, atMinutes, 'lastDuration');
  return first && last && last.state === 'running' ? { first, last } : null;
}

export function createLiveMarkerElement(course, kind, runner) {
  const first = kind === 'first';
  const element = document.createElement('div');
  element.className = `live-map-marker ${kind}`;
  element.style.setProperty('--live-course-color', course.color || '#333399');
  element.style.setProperty('--live-marker-text-color', contrastingTextColor(course.color || '#333399'));
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-expanded', 'false');
  const symbol = document.createElement('span');
  symbol.className = 'live-map-marker-symbol';
  symbol.textContent = first ? '1' : 'D';
  symbol.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  copy.className = 'live-map-marker-copy';
  const distance = document.createElement('strong');
  distance.className = 'live-map-marker-distance';
  distance.textContent = `${Number(course.distance).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
  const detail = document.createElement('span');
  detail.className = 'live-map-marker-detail';
  const name = document.createElement('strong');
  name.textContent = course.name;
  const state = runner.state === 'finished' ? 'arrivé' : `${Math.round(runner.progress * 100)} %`;
  const status = document.createElement('small');
  status.textContent = `${first ? '1er' : 'Dernier'} · ${state}`;
  detail.append(name, status);
  copy.append(distance, detail);
  element.append(symbol, copy);
  element.title = `${first ? 'Premier' : 'Dernier'} concurrent · ${course.name} · ${state}`;
  element.setAttribute('aria-label', element.title);
  return element;
}

export function toggleLiveMarkerDetails(element, elements) {
  const expanded = element.getAttribute('aria-expanded') === 'true';
  for (const marker of elements) {
    marker.classList.remove('is-expanded');
    marker.setAttribute('aria-expanded', 'false');
  }
  if (!expanded) {
    element.classList.add('is-expanded');
    element.setAttribute('aria-expanded', 'true');
  }
}
