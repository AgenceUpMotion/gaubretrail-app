const SOURCE_ID = 'event-village';

// Georeferencing from the 2026 plan. The castle centre and the common finish
// point of the four routes are used as control points so scale and rotation
// come from the plan instead of hand-tuned map offsets.
const PLAN_CASTLE_PIXEL = [180, 350];
const PLAN_FINISH_PIXEL = [775, 714];
const PLAN_SCALE_METERS_PER_PIXEL = 0.0808;
const PLAN_ROTATION_DEGREES = -61.7;

const LAYER_IDS = [
  'event-village-zones', 'event-village-zone-outlines', 'event-village-corridors',
  'event-village-structures', 'event-village-structure-outlines', 'event-village-labels',
  'event-village-utilities', 'event-village-utility-labels',
];

function rotate(east, north, degrees) {
  const angle = degrees * Math.PI / 180;
  return [east * Math.cos(angle) - north * Math.sin(angle), east * Math.sin(angle) + north * Math.cos(angle)];
}

function offsetCoordinate(anchor, east, north) {
  return [anchor[0] + east / (111320 * Math.cos(anchor[1] * Math.PI / 180)), anchor[1] + north / 111320];
}

function planCoordinate(anchor, pixel) {
  const eastOnPlan = (pixel[0] - PLAN_CASTLE_PIXEL[0]) * PLAN_SCALE_METERS_PER_PIXEL;
  const southOnPlan = (pixel[1] - PLAN_CASTLE_PIXEL[1]) * PLAN_SCALE_METERS_PER_PIXEL;
  const [east, north] = rotate(eastOnPlan, southOnPlan, PLAN_ROTATION_DEGREES);
  return offsetCoordinate(anchor, east, north);
}

function feature(item, geometry) {
  const { pixel, points, width, depth, rotation, ...properties } = item;
  return { type: 'Feature', properties, geometry };
}

function rectangle(anchor, item) {
  const pixelsPerMeter = 1 / PLAN_SCALE_METERS_PER_PIXEL;
  const halfWidth = item.width * pixelsPerMeter / 2;
  const halfDepth = item.depth * pixelsPerMeter / 2;
  const angle = (item.rotation || 0) * Math.PI / 180;
  const corners = [[-halfWidth,-halfDepth],[halfWidth,-halfDepth],[halfWidth,halfDepth],[-halfWidth,halfDepth],[-halfWidth,-halfDepth]].map(([x,y]) => planCoordinate(anchor, [
    item.pixel[0] + x * Math.cos(angle) - y * Math.sin(angle),
    item.pixel[1] + x * Math.sin(angle) + y * Math.cos(angle),
  ]));
  return feature(item, { type: 'Polygon', coordinates: [corners] });
}

function polygon(anchor, item) {
  const coordinates = item.points.map(pixel => planCoordinate(anchor, pixel));
  coordinates.push(coordinates[0]);
  return feature(item, { type: 'Polygon', coordinates: [coordinates] });
}

function line(anchor, item) {
  return feature(item, { type: 'LineString', coordinates: item.points.map(pixel => planCoordinate(anchor, pixel)) });
}

function point(anchor, item) {
  return feature(item, { type: 'Point', coordinates: planCoordinate(anchor, item.pixel) });
}

function villageData(castle) {
  const structures = [
    { name: 'Podium', detail: 'Podium principal', pixel: [400,340], width: 10, depth: 6, category: 'podium', rotation: -4 },
    { name: 'Lot podium', detail: 'Tente 3 × 3 m', pixel: [520,294], width: 3, depth: 3, category: 'service' },
    { name: 'Bar', detail: '2 structures de 10 × 6 m', pixel: [805,286], width: 20, depth: 6, category: 'main', rotation: 3 },
    { name: 'Friterie', detail: '6 × 3 m', pixel: [1060,330], width: 6, depth: 3, category: 'service', rotation: 8 },
    { name: 'Retrait des dossards', detail: '2 tentes de 4 × 4 m', pixel: [1220,442], width: 4, depth: 9, category: 'service', rotation: -8 },
    { name: 'Atelier La Chouette', detail: '4 × 4 m', pixel: [1261,588], width: 4, depth: 4, category: 'service' },
    { name: 'Ballersocks', detail: '3 × 3 m', pixel: [1268,668], width: 3, depth: 3, category: 'service' },
    { name: 'Consigne', detail: '6 × 4 m avec étagères', pixel: [1277,756], width: 6, depth: 4, category: 'main', rotation: 90 },
    { name: 'Puces + T-shirts', detail: '3 × 3 m', pixel: [574,817], width: 3, depth: 3, category: 'service' },
    { name: 'Sono', detail: '3 × 3 m', pixel: [716,783], width: 3, depth: 3, category: 'service' },
    { name: 'Chrono', detail: 'Chronométrage · ligne d’arrivée', pixel: [810,714], width: 3, depth: 3, category: 'timing' },
    { name: 'Ravito final', detail: '8 × 4 m', pixel: [391,985], width: 8, depth: 4, category: 'service', rotation: 8 },
    { name: 'Kiné', detail: '6 × 3 m', pixel: [810,1072], width: 6, depth: 3, category: 'medical' },
    { name: 'Médecin', detail: '4 × 4 m', pixel: [713,1170], width: 4, depth: 4, category: 'medical' },
    { name: 'Arche en bois', detail: 'Entrée du village', pixel: [1738,1138], width: 1, depth: 8, category: 'arrival', rotation: 12 },
  ].map(item => rectangle(castle, item));

  const zones = [
    { name: 'Zone finisher', detail: 'Espace paillé après la ligne d’arrivée', category: 'finisher', points: [[72,850],[172,684],[335,628],[566,700],[548,823],[445,958],[274,1048],[98,967]] },
    { name: 'Expo + totems', detail: 'Espace partenaires', category: 'expo', points: [[1030,505],[1328,505],[1320,792],[1075,735]] },
    { name: 'Mange-debout + tables', detail: 'Espace convivialité', category: 'tables', points: [[244,475],[785,695],[570,812],[170,610]] },
  ].map(item => polygon(castle, item));

  const corridors = [
    { name: 'Couloir arrivée', detail: 'Circulation coureurs', category: 'corridor', points: [[228,480],[775,714],[1410,965]] },
    { name: 'Couloir arrivée', detail: 'Circulation coureurs', category: 'corridor', points: [[170,679],[335,628],[775,752],[1368,1038]] },
    { name: 'Accès ambulances', detail: 'À maintenir libre', category: 'emergency', points: [[62,852],[385,1042],[850,1238]] },
    { name: 'Ligne d’arrivée', detail: 'Arrivée commune aux 4 parcours', category: 'finish', points: [[746,681],[804,747]] },
  ].map(item => line(castle, item));

  const utilities = [
    { name: 'WC', detail: 'Sanitaires', label: 'WC', pixel: [506,68], category: 'utility' },
    { name: 'Eau', detail: 'Point d’eau', label: 'EAU', pixel: [806,216], category: 'utility' },
    { name: 'Électricité', detail: 'Branchement électrique', label: '⚡', pixel: [846,216], category: 'electricity' },
    { name: 'Eau', detail: 'Point d’eau', label: 'EAU', pixel: [320,965], category: 'utility' },
  ].map(item => point(castle, item));

  return { type: 'FeatureCollection', features: [...zones, ...corridors, ...structures, ...utilities] };
}

export function installEventVillage(map, maplibregl, { castle }, beforeId) {
  if (map.getSource(SOURCE_ID)) return;
  map.addSource(SOURCE_ID, { type: 'geojson', data: villageData(castle) });

  map.addLayer({ id: 'event-village-zones', type: 'fill', source: SOURCE_ID, minzoom: 14.5,
    filter: ['in', ['get', 'category'], ['literal', ['finisher','expo','tables']]],
    paint: { 'fill-color': ['match', ['get','category'], 'finisher','#e9cf8c', 'expo','#a88ad1', '#f3e6c4'], 'fill-opacity': ['match', ['get','category'], 'finisher',.3, 'expo',.14, .12] } }, beforeId);
  map.addLayer({ id: 'event-village-zone-outlines', type: 'line', source: SOURCE_ID, minzoom: 14.5,
    filter: ['in', ['get','category'], ['literal', ['finisher','expo','tables']]],
    paint: { 'line-color': ['match', ['get','category'], 'finisher','#b58827', 'expo','#7653a8', '#b89b55'], 'line-width': 2, 'line-dasharray': [2,1.5] } }, beforeId);
  map.addLayer({ id: 'event-village-corridors', type: 'line', source: SOURCE_ID, minzoom: 14.5,
    filter: ['in', ['get','category'], ['literal', ['corridor','emergency','finish']]],
    layout: { 'line-cap':'round', 'line-join':'round' },
    paint: { 'line-color': ['match', ['get','category'], 'emergency','#dc2626', 'finish','#d900ae', '#f97316'], 'line-width': ['interpolate',['linear'],['zoom'],14.5,2,18,5], 'line-dasharray': [2,1] } }, beforeId);
  map.addLayer({ id: 'event-village-structures', type: 'fill', source: SOURCE_ID, minzoom: 14.5,
    filter: ['in', ['get','category'], ['literal', ['podium','main','service','medical','arrival','timing']]],
    paint: { 'fill-color': ['match', ['get','category'], 'main','#2563eb', 'podium','#6b7280', 'medical','#ef4444', 'arrival','#f97316', 'timing','#d900ae', '#fffdf7'], 'fill-opacity': .94 } }, beforeId);
  map.addLayer({ id: 'event-village-structure-outlines', type: 'line', source: SOURCE_ID, minzoom: 14.5,
    filter: ['in', ['get','category'], ['literal', ['podium','main','service','medical','arrival','timing']]],
    paint: { 'line-color':'#312e38', 'line-width':['interpolate',['linear'],['zoom'],14.5,1,18,2.5] } }, beforeId);
  map.addLayer({ id: 'event-village-labels', type: 'symbol', source: SOURCE_ID, minzoom: 16,
    filter: ['all', ['==',['geometry-type'],'Polygon'], ['has','name']],
    layout: { 'text-field':['get','name'], 'text-font':['Noto Sans Bold'], 'text-size':['interpolate',['linear'],['zoom'],16,10,18,12], 'text-anchor':'top', 'text-offset':[0,.8], 'text-max-width':12, 'text-optional':true },
    paint: { 'text-color':'#21172d', 'text-halo-color':'rgba(255,255,255,.98)', 'text-halo-width':2 } }, beforeId);
  map.addLayer({ id: 'event-village-utilities', type: 'circle', source: SOURCE_ID, minzoom: 15,
    filter: ['==',['geometry-type'],'Point'],
    paint: { 'circle-color':['match',['get','category'],'electricity','#ef4444','#2563eb'], 'circle-radius':['interpolate',['linear'],['zoom'],15,9,18,13], 'circle-stroke-color':'#fff', 'circle-stroke-width':2.5 } }, beforeId);
  map.addLayer({ id: 'event-village-utility-labels', type: 'symbol', source: SOURCE_ID, minzoom: 15,
    filter: ['==',['geometry-type'],'Point'],
    layout: { 'text-field':['get','label'], 'text-size':['interpolate',['linear'],['zoom'],15,8,18,10], 'text-font':['Noto Sans Bold'], 'text-allow-overlap':true },
    paint: { 'text-color':'#fff' } }, beforeId);

  const interactiveLayers = ['event-village-structures','event-village-zones','event-village-corridors','event-village-utilities'];
  const popup = new maplibregl.Popup({ closeButton:false, closeOnClick:true, offset:12, className:'event-village-popup' });
  for (const layer of interactiveLayers) {
    map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
    map.on('click',layer,event=>{
      const properties=event.features?.[0]?.properties;if(!properties)return;
      const content=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span');
      title.textContent=properties.name;detail.textContent=properties.detail||'';content.append(title,detail);
      popup.setLngLat(event.lngLat).setDOMContent(content).addTo(map);
    });
  }
}

export function setEventVillageVisibility(map, visible) {
  const visibility=visible?'visible':'none';
  for(const id of LAYER_IDS)if(map.getLayer(id))map.setLayoutProperty(id,'visibility',visibility);
}

export const eventVillageCalibration = { castlePixel:PLAN_CASTLE_PIXEL, finishPixel:PLAN_FINISH_PIXEL, scale:PLAN_SCALE_METERS_PER_PIXEL, rotation:PLAN_ROTATION_DEGREES };
export const eventVillagePlanCoordinate = planCoordinate;
