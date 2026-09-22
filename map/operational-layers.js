// The operational map deliberately uses MapLibre sources and layers instead of
// a React/HTML marker per record.  Keeping the feature contract here makes the
// admin, volunteer and future public maps share the same visual vocabulary.
export const POST_STATUS = {
  complete: { color: '#39ff14', label: 'Équipe complète' },
  needs_people: { color: '#ff7a00', label: 'Bénévoles nécessaires' },
  empty: { color: '#ff1744', label: 'Sans bénévole' },
};

const pointFeature = (record, type, properties = {}) => ({
  type: 'Feature',
  properties: { id: record.id, type, name: record.name || record.company || '', ...properties },
  geometry: { type: 'Point', coordinates: [record.lng, record.lat] },
});

export function postStatus(assigned, required) {
  if (assigned >= required) return 'complete';
  return assigned > 0 ? 'needs_people' : 'empty';
}

export function operationalFeatureCollections({ posts = [], aidStations = [], photographers = [], points = [] }) {
  return {
    posts: {
      type: 'FeatureCollection',
      features: posts.map(({ record, assigned, required }) => pointFeature(record, 'volunteer_post', {
        code: record.number || '', status: postStatus(assigned, required), assigned, required,
      })),
    },
    aidStations: { type: 'FeatureCollection', features: aidStations.map(record => pointFeature(record, 'aid_station', { code: record.number || '' })) },
    photographers: { type: 'FeatureCollection', features: photographers.map(record => pointFeature(record, 'photographer')) },
    points: { type: 'FeatureCollection', features: points.map(record => pointFeature(record, 'point_of_interest', { code: record.number || '', kind: record.kind || '' })) },
  };
}

const addSource = (map, id, options) => {
  if (!map.getSource(id)) map.addSource(id, options);
};
const addLayer = (map, layer) => {
  if (!map.getLayer(layer.id)) map.addLayer(layer);
};

const loadingIcons = new Set();
const svgDataUri = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const cameraSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="white" d="M14 20h10l3-6h10l3 6h10a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V26a6 6 0 0 1 6-6Zm18 7a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/></svg>';
const burgerSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="white" d="M10 28c1-10 10-17 22-17s21 7 22 17H10Zm3 5h38v6H13zm-3 11h44v7H10zm5 12h34v-5H15z"/><path fill="#ff7a00" d="M15 36h34v3H15z"/></svg>';

function addOperationalIcons(map) {
  if (globalThis.navigator?.userAgent?.includes('jsdom') || !globalThis.Image) return false;
  const icon = (id, svg) => {
    if (map.hasImage?.(id)) return true;
    if (loadingIcons.has(id)) return false;
    loadingIcons.add(id);
    const image = new Image();
    image.onload = () => {
      loadingIcons.delete(id);
      if (!map.hasImage?.(id)) map.addImage(id, image, { pixelRatio: 2 });
      ensureOperationalLayers(map);
    };
    image.onerror = () => loadingIcons.delete(id);
    image.src = svgDataUri(svg);
    return false;
  };
  return icon('gt-camera-icon', cameraSvg) && icon('gt-burger-icon', burgerSvg);
}

export function ensureOperationalLayers(map) {
  const hasOperationalIcons = addOperationalIcons(map);
  addSource(map, 'gt-posts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 48, clusterMaxZoom: 11 });
  addSource(map, 'gt-aid-stations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  addSource(map, 'gt-photographers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  addSource(map, 'gt-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  addLayer(map, { id: 'gt-post-clusters', type: 'circle', source: 'gt-posts', filter: ['has', 'point_count'], maxzoom: 12, paint: { 'circle-color': '#5c2497', 'circle-radius': ['step', ['get', 'point_count'], 17, 10, 21, 30, 26], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
  addLayer(map, { id: 'gt-post-cluster-count', type: 'symbol', source: 'gt-posts', filter: ['has', 'point_count'], maxzoom: 12, layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });
  const statusColor = ['match', ['get', 'status'], 'complete', POST_STATUS.complete.color, 'needs_people', POST_STATUS.needs_people.color, POST_STATUS.empty.color];
  addLayer(map, { id: 'gt-post-points', type: 'circle', source: 'gt-posts', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': statusColor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 14, 18, 18, 22], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3.5, 'circle-blur': .03 } });
  addLayer(map, { id: 'gt-post-labels', type: 'symbol', source: 'gt-posts', filter: ['!', ['has', 'point_count']], layout: { 'text-field': ['get', 'code'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 12, 15, 15], 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-anchor': 'center', 'text-allow-overlap': true, 'text-ignore-placement': true, 'symbol-sort-key': ['get', 'required'] }, paint: { 'text-color': '#17111e', 'text-halo-color': '#fff', 'text-halo-width': .6 } });
  addLayer(map, { id: 'gt-aid-stations', type: 'circle', source: 'gt-aid-stations', minzoom: 9, paint: { 'circle-color': '#ff7a00', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 15, 14], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
  if (hasOperationalIcons) addLayer(map, { id: 'gt-aid-station-icons', type: 'symbol', source: 'gt-aid-stations', minzoom: 9, layout: { 'icon-image': 'gt-burger-icon', 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, .78, 15, 1], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
  addLayer(map, { id: 'gt-aid-station-labels', type: 'symbol', source: 'gt-aid-stations', minzoom: 12, layout: { 'text-field': ['concat', 'R ', ['get', 'code']], 'text-size': 11, 'text-offset': [0, 1.55], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#7b3600', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
  addLayer(map, { id: 'gt-photographers', type: 'circle', source: 'gt-photographers', minzoom: 11, paint: { 'circle-color': '#6e3ea0', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 11, 15, 14], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
  if (hasOperationalIcons) addLayer(map, { id: 'gt-photographer-icons', type: 'symbol', source: 'gt-photographers', minzoom: 11, layout: { 'icon-image': 'gt-camera-icon', 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, .78, 15, 1], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
  addLayer(map, { id: 'gt-points', type: 'circle', source: 'gt-points', minzoom: 11, paint: { 'circle-color': '#4b5563', 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
}

export function setOperationalData(map, collections) {
  for (const [name, data] of Object.entries(collections)) map.getSource(`gt-${name === 'aidStations' ? 'aid-stations' : name}`)?.setData(data);
}
