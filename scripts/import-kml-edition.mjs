import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalize, profile, routePosition, validate } from '../domain.js';
import { getStorage } from '../server/state-storage.mjs';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const file = option('--file');
const editionName = option('--edition');
const apply = args.includes('--apply');

if (!file || !editionName) {
  throw Error('Usage : node scripts/import-kml-edition.mjs --file "Parcours hiver 2026.kml" --edition "Hiver 2027" [--apply]');
}

const source = 'Parcours hiver 2026.kml';
const decodeXml = value => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]);
const tag = (markup, name) => decodeXml(markup.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1]).trim();
const coordinates = value => String(value || '').trim().split(/\s+/).filter(Boolean).map(part => part.split(',').map(Number)).filter(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])).map(point => point.length > 2 && Number.isFinite(point[2]) ? point.slice(0, 3) : point.slice(0, 2));
const placemarks = markup => [...markup.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)].map(match => match[1]);
const slug = value => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'point';
const pointCenter = ring => {
  const points = ring.slice(0, ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? -1 : undefined);
  return { lng: points.reduce((total, point) => total + point[0], 0) / points.length, lat: points.reduce((total, point) => total + point[1], 0) / points.length };
};
const postCode = value => {
  const name = value.replace(/^point\s+/i, '').trim();
  if (normalize(name) === 'depart') return 'DÉP';
  if (normalize(name) === 'arrivee') return 'ARR';
  return name || 'POSTE';
};

function parseKml(markup) {
  const folders = [...markup.matchAll(/<Folder\b[^>]*>\s*<name\b[^>]*>([\s\S]*?)<\/name>([\s\S]*?)<\/Folder>/gi)].map(match => ({ name: decodeXml(match[1]).trim(), markup: match[2] }));
  const routeFolders = folders.filter(folder => /^parcours\s+\d+\s*km$/i.test(folder.name));
  const routes = routeFolders.map(folder => {
    const distance = Number(folder.name.match(/\d+/)?.[0]);
    const route = placemarks(folder.markup).find(item => /<LineString\b/i.test(item));
    const line = coordinates(tag(route, 'coordinates'));
    if (line.length < 2) throw Error(`Trace invalide : ${folder.name}.`);
    return { distance, name: folder.name, coordinates: line, kmPoints: placemarks(folder.markup).filter(item => /<Point\b/i.test(item)).map(item => ({ name: tag(item, 'name'), coordinates: coordinates(tag(item, 'coordinates'))[0] })).filter(point => point.name && point.coordinates) };
  });
  const commissioners = folders.find(folder => normalize(folder.name) === 'commissaires');
  const posts = commissioners ? placemarks(commissioners.markup).filter(item => /<Point\b/i.test(item)).map(item => ({ name: tag(item, 'name'), coordinates: coordinates(tag(item, 'coordinates'))[0] })).filter(point => point.name && point.coordinates) : [];
  const parkingFolder = folders.find(folder => normalize(folder.name) === 'parkings');
  const parkingMarkup = parkingFolder && placemarks(parkingFolder.markup).find(item => /<Polygon\b/i.test(item));
  const parking = parkingMarkup ? { name: tag(parkingMarkup, 'name') || 'Parking bénévoles', coordinates: coordinates(tag(parkingMarkup, 'coordinates')) } : null;
  if (!routes.length || !posts.length) throw Error('Le KML doit contenir au moins un parcours et les points Commissaires.');
  if (parking && parking.coordinates.length < 4) throw Error('Le polygone du parking est invalide.');
  return { routes, posts, parking };
}

function importKml(state, edition, parsed) {
  const next = structuredClone(state);
  const prefix = `kml-${edition.id}-`;
  const courseIds = new Map();
  const colors = new Map([[20, '#8759d7'], [10, '#e2a321']]);
  for (const route of parsed.routes) {
    let course = next.courses.find(item => item.editionId === edition.id && Math.round(Number(item.distance)) === route.distance);
    if (!course) {
      course = { id: `${prefix}course-${route.distance}`, editionId: edition.id, name: `${route.distance} km hiver`, distance: route.distance, color: colors.get(route.distance) || '#6e3ea0', visible: true };
      next.courses.push(course);
    }
    course.geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { source }, geometry: { type: 'LineString', coordinates: route.coordinates } }] };
    course.distance = Math.round(profile(route.coordinates).distance * 100) / 100;
    course.visible = true;
    courseIds.set(route.distance, course.id);
  }

  // Re-running an import must only replace the previous KML items in the
  // selected edition; the same source file can be used by another edition.
  next.posts = next.posts.filter(item => item.editionId !== edition.id || item.importSource !== source);
  next.mapElements = next.mapElements.filter(item => item.editionId !== edition.id || item.importSource !== source);
  const claimedNumbers = new Set(next.posts.filter(item => item.editionId === edition.id).map(item => String(item.number)));
  const usedIds = new Set(next.posts.map(item => item.id));
  for (const [index, point] of parsed.posts.entries()) {
    let number = postCode(point.name);
    if (claimedNumbers.has(number)) number = `${number}-${index + 1}`;
    claimedNumbers.add(number);
    let id = `${prefix}post-${slug(number)}`;
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    const linkedCourses = parsed.routes.filter(route => routePosition(route.coordinates, { lng: point.coordinates[0], lat: point.coordinates[1] })?.distanceKm <= .08).map(route => courseIds.get(route.distance));
    next.posts.push({ id, editionId: edition.id, number, name: point.name, postType: 'Commissaire', lat: point.coordinates[1], lng: point.coordinates[0], required: 1, courseIds: linkedCourses, publicVisible: true, instructions: `Point importé depuis ${source}.`, importSource: source });
  }

  for (const route of parsed.routes) for (const point of route.kmPoints) {
    next.mapElements.push({ id: `${prefix}km-${route.distance}-${slug(point.name)}`, editionId: edition.id, name: `${route.name} · ${point.name}`, kind: 'Repère kilométrique', lat: point.coordinates[1], lng: point.coordinates[0], courseIds: [courseIds.get(route.distance)], visible: true, importSource: source });
  }
  if (parsed.parking) {
    const center = pointCenter(parsed.parking.coordinates);
    next.mapElements.push({ id: `${prefix}parking`, editionId: edition.id, name: parsed.parking.name, kind: 'Parking', ...center, geometry: { type: 'Polygon', coordinates: [parsed.parking.coordinates] }, courseIds: [], visible: true, importSource: source });
  }
  validate(next);
  return next;
}

const parsed = parseKml(readFileSync(resolve(file), 'utf8'));
const storage = await getStorage();
try {
  const current = await storage.read();
  const edition = current.state.editions.find(item => normalize(item.name) === normalize(editionName));
  if (!edition) throw Error(`Édition introuvable : ${editionName}.`);
  const next = importKml(current.state, edition, parsed);
  const summary = `${parsed.routes.length} tracés, ${parsed.posts.length} postes commissaires, ${parsed.routes.reduce((count, route) => count + route.kmPoints.length, 0)} repères km${parsed.parking ? ', 1 parking' : ''}`;
  if (!apply) {
    console.log(`Simulation pour ${edition.name} : ${summary}. Ajoutez --apply pour enregistrer.`);
  } else {
    const saved = await storage.save(next, current.revision);
    console.log(`Import terminé dans ${edition.name} (révision ${saved.revision}) : ${summary}.`);
  }
} finally {
  await storage.close();
}
