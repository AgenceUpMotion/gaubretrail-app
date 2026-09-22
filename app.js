import * as maplibregl from 'maplibre-gl';
import {createLandscapeLayer,fetchLandscape,fallbackLandscape} from './landscape.js';
import {applySeasonTheme} from './theme.js';



const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const FALLBACK_STYLE = {
  version: 8,
  sources: {
    'openstreetmap-raster': {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'fallback-background', type: 'background', paint: { 'background-color': '#dfe9d7' } },
    { id: 'openstreetmap-raster', type: 'raster', source: 'openstreetmap-raster', paint: { 'raster-opacity': 0.92 } },
  ],
};

async function loadBaseStyle() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(OPENFREEMAP_STYLE_URL, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw Error(`OpenFreeMap indisponible (${response.status})`);
    const style = await response.json();
    console.info('Fond cartographique : OpenFreeMap Liberty.');
    return style;
  } catch (error) {
    console.warn('OpenFreeMap indisponible, utilisation du fond de secours.', error);
    return FALLBACK_STYLE;
  } finally {
    clearTimeout(timeout);
  }
}

const baseStyle = await loadBaseStyle();
// Next/Turbopack renames the main bundle. Without this explicit URL, MapLibre
// requests a non-existent worker chunk and Next answers with its HTML 404 page.
maplibregl.setWorkerUrl(new URL('/maplibre-gl-worker.mjs', location.origin).href);
window.__maplibreWorkerUrl=maplibregl.getWorkerUrl();
const SATELLITE_TILES = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image%2Fjpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
const EVENT_CENTER = [-1.0715847, 46.9452378];
const CASTLE = [-1.0720354, 46.9452262];
const LANDEBAUDIERE_HALL = [-1.0711116, 46.9462587];
const LANDEBAUDIERE_PARKING = [-1.0721457, 46.9464085];
const COURSE_BOUNDS = [[-1.0995306, 46.9117739], [-0.9960511, 46.9708749]];
const EVENT_ROTATION_DEG = -17;
const ROUTES = {
  42: {color:'#111111', outline:'#ffffff', width:5.3},
  26: {color:'#ef3340', outline:'#ffffff', width:5.0},
  17: {color:'#2088ff', outline:'#ffffff', width:5.0},
  8:  {color:'#24a148', outline:'#ffffff', width:5.0}
};
async function fetchJsonRequired(url,label='fichier JSON'){const response=await fetch(url,{cache:'no-store'}),text=await response.text();if(!response.ok)throw Error(`${label} introuvable : ${url} (${response.status}).`);try{return JSON.parse(text);}catch{throw Error(`${label} invalide : ${url} renvoie du HTML au lieu de JSON.`);}}

const map = new maplibregl.Map({
  container:'map',
  style:baseStyle,
  center:EVENT_CENTER,
  zoom:13.2,
  pitch:62,
  bearing:-28,
  maxPitch:75,
  maxZoom:19,
  antialias:true,
  hash:true
});
window.__gaubretrailMap=map;

map.on('error', event => {
  const message=event?.error?.message||event?.message;
  if(message)console.warn('Ressource cartographique indisponible :',message);
});

map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'bottom-right');
map.addControl(new maplibregl.FullscreenControl(), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({maxWidth:120, unit:'metric'}), 'bottom-left');

let selectedRoute = new URLSearchParams(location.search).get('route') || '42';
let eventEnabled = true;
let terrainEnabled = true;
// The Vendée is naturally gentle: a stronger vertical scale keeps valleys and
// rises readable from the 3D camera without changing the underlying terrain.
let terrainExaggeration = 4;
let landscapeLayer = null;
let management = null;
let activeEdition = 'summer';
let siteBuildingIds=new Set();

let resolveReady,rejectReady;
export const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
export {map,maplibregl};
export function connectOrganization(org){management=org;applyEdition(org.getEdition().season,org.getEdition());}
export function raiseOperationalLayers(){
  for(const layer of map.getStyle().layers||[]){
    if(/^route-|^org-course-/.test(layer.id)){
      try{map.moveLayer(layer.id);}catch(_error){}
    }
  }
}
// Do not wait for every remote tile: the style is enough to install local routes.
map.once('style.load', async () => {
  try{
  // The base style ships with its own 3D buildings. Hide them before adding
  // our controlled Three.js / local layers, otherwise the same buildings stack.
  stylizeDiorama();
  addTerrain();
  await addSiteContext();
  await addRoutes();
  await fitRoute(selectedRoute, false);
  loadLandscape();
  raiseOperationalLayers();
  resolveReady();
  console.info('Carte prête : style, relief et parcours initialisés.');
  }catch(error){rejectReady(error);}
});

function applyEdition(edition,details){
  activeEdition=edition;
  applySeasonTheme(edition);
  const routesPanel=document.querySelector('#editionRoutes,#summerRoutes');
  if(routesPanel)routesPanel.hidden=false;
  const editionHint=document.querySelector('#editionHint'),mapHeading=document.querySelector('#mapHeading'),routeTitle=document.querySelector('#routeTitle');
  if(editionHint)editionHint.textContent=edition==='winter'?'Parcours nocturnes de cette édition.':'Parcours estivaux et village de départ.';
  if(mapHeading)mapHeading.textContent=edition==='winter'?'Édition hiver · nocturne':'Les parcours en relief';
  if(routeTitle)routeTitle.textContent=edition==='winter'?'HIVER':`${selectedRoute} KM`;
  Object.keys(ROUTES).forEach(distance=>{
    const visibility=edition==='summer'&&distance===selectedRoute?'visible':'none';
    if(map.getLayer(`route-${distance}`))map.setLayoutProperty(`route-${distance}`,'visibility',visibility);
    if(map.getLayer(`route-${distance}-outline`))map.setLayoutProperty(`route-${distance}-outline`,'visibility',visibility);
  });
  if(landscapeLayer){landscapeLayer.eventVisible=eventEnabled&&edition==='summer';map.triggerRepaint();}
  if(details?.site&&editionHint)editionHint.textContent=details.site;
}

async function loadLandscape(){
  const status=document.querySelector('#landscapeStatus');
  if(status)status.textContent='Chargement des arbres et bâtiments 3D…';
  let data,fromCache=false;
  try{
    const cached=JSON.parse(localStorage.getItem('gaubretrail-landscape-v6'));
    if(cached?.savedAt>Date.now()-7*86400000 && cached.data){data=cached.data;fromCache=true;}
  }catch(_error){}
  try{
    if(!data){
      data=await fetchLandscape(COURSE_BOUNDS,EVENT_CENTER);
      try{localStorage.setItem('gaubretrail-landscape-v6',JSON.stringify({savedAt:Date.now(),data}));}catch(_error){}
    }
  }catch(error){
    console.warn('Données paysagères OSM indisponibles, conservation du site cartographié localement.',error);
    data=fallbackLandscape();
  }
  // Building geometry is rendered exclusively by the Three.js custom layer.
  // Rendering the same OSM footprints as MapLibre extrusions caused two 3D
  // buildings to occupy the same location.
  landscapeLayer=createLandscapeLayer(data,maplibregl,{castle:CASTLE,event:EVENT_CENTER,hall:LANDEBAUDIERE_HALL,parking:LANDEBAUDIERE_PARKING});
  landscapeLayer.eventVisible=eventEnabled&&activeEdition==='summer';
  landscapeLayer.treesVisible=document.querySelector('#treesToggle').checked;
  landscapeLayer.buildingsVisible=document.querySelector('#buildingsToggle').checked;
  map.addLayer(landscapeLayer,findFirstLabelLayer());
  raiseOperationalLayers();
  if(status){
    const suffix=data.fallback?' · données OSM supplémentaires indisponibles':'';
    const cache=fromCache?' · données mémorisées':'';
    status.textContent=`Site principal détaillé sur 250 m · ${data.trees.length.toLocaleString('fr-FR')} arbres · ${data.buildings.length.toLocaleString('fr-FR')} bâtiments${suffix}${cache}`;
  }
}

async function addSiteContext(){
  try{const response=await fetch('./data/sites.geojson');if(!response.ok)return;const data=await response.json();siteBuildingIds=new Set(data.features.filter(f=>f.properties.kind==='building').map(f=>f.properties.osmId));map.addSource('site-context',{type:'geojson',data,attribution:'© OpenStreetMap contributors · ODbL 1.0'});
    map.addLayer({id:'site-surfaces',type:'fill',source:'site-context',filter:['all',['==',['geometry-type'],'Polygon'],['!=',['get','kind'],'building']],paint:{'fill-color':['match',['get','kind'],'parking','#aaa99e','water','#a9d4df','wood','#6f8c58','#a9bd85'],'fill-opacity':.9}},findFirstLabelLayer());
    map.addLayer({id:'site-roads',type:'line',source:'site-context',filter:['==',['get','kind'],'road'],paint:{'line-color':'#fff7e5','line-width':['interpolate',['linear'],['zoom'],14,2,19,12]}},findFirstLabelLayer());
    map.addLayer({id:'site-hedges',type:'line',source:'site-context',filter:['==',['get','kind'],'hedge'],paint:{'line-color':'#526c3f','line-width':3}},findFirstLabelLayer());
  }catch(e){console.warn('Contexte des Tourelles indisponible',e);}
}

function stylizeDiorama(){
  const layers=map.getStyle().layers || [];
  const paint=(id,property,value)=>{ try{ map.setPaintProperty(id,property,value); }catch(_err){} };
  for(const layer of layers){
    const id=layer.id.toLowerCase();
    if(layer.type==='background') paint(layer.id,'background-color','#dfe9d7');
    if(layer.type==='fill'){
      if(/water|ocean|lake|river/.test(id)){
        paint(layer.id,'fill-color','#a9d4df');
        paint(layer.id,'fill-opacity',0.94);
      }else if(/wood|forest/.test(id)){
        paint(layer.id,'fill-color','#71905f');
        paint(layer.id,'fill-opacity',0.72);
      }else if(/park|grass|meadow|farmland|landcover/.test(id)){
        paint(layer.id,'fill-color','#a8be82');
        paint(layer.id,'fill-opacity',0.68);
      }else if(/residential|industrial|landuse/.test(id)){
        paint(layer.id,'fill-color','#dfe5d4');
        paint(layer.id,'fill-opacity',0.76);
      }else if(/building/.test(id)){
        paint(layer.id,'fill-color','#d9b19d');
        paint(layer.id,'fill-outline-color','#c7947c');
      }
    }
    if(layer.type==='line'){
      if(/water|river|stream/.test(id)) paint(layer.id,'line-color','#85bccb');
      if(/road|street|highway|motorway|path/.test(id)){
        paint(layer.id,'line-color',/motorway|highway/.test(id)?'#fffaf0':'#f8f2e5');
        paint(layer.id,'line-opacity',0.96);
      }
    }
    if(layer.type==='fill-extrusion' && /building/.test(id)){
      try{ map.setLayoutProperty(layer.id,'visibility','none'); }catch(_err){}
    }
    if(layer.type==='symbol'){
      if(layer.paint?.['text-color']!==undefined) paint(layer.id,'text-color','#405448');
      if(layer.paint?.['text-halo-color']!==undefined) paint(layer.id,'text-halo-color','#f2f5eb');
      try{const current=map.getFilter(layer.id),withoutTown=['!=',['coalesce',['get','name:fr'],['get','name'],''],'La Gaubretière'];map.setFilter(layer.id,current?['all',current,withoutTown]:withoutTown);}catch(_err){}
    }
  }
}

function addTerrain(){
  if (!map.getSource('gaubre-terrain')) {
    map.addSource('gaubre-terrain', {
      type:'raster-dem',
      tiles:['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
      encoding:'terrarium', tileSize:256, maxzoom:15,
      attribution:'Relief : <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen / sources altimétriques</a>',
    });
  }
  map.setTerrain({source:'gaubre-terrain', exaggeration:terrainExaggeration});
  if (!map.getLayer('gaubre-hillshade')) {
    map.addLayer({
      id:'gaubre-hillshade', type:'hillshade', source:'gaubre-terrain',
      paint:{'hillshade-exaggeration':0.3,'hillshade-shadow-color':'#182016','hillshade-highlight-color':'#ffffff'}
    }, findFirstLabelLayer());
  }
}

async function addRoutes(){
  for (const [distance, cfg] of Object.entries(ROUTES)) {
    let data;try{data=await fetchJsonRequired(`./data/routes/${distance}.geojson`,`trace ${distance} km`);}catch(error){console.warn(error.message);continue;}
    const routeCoordinates=data.features[0]?.geometry?.coordinates;
    // Preserve the imported coordinates, including actual start and finish.
    map.addSource(`route-${distance}`, {type:'geojson', data});
    map.addLayer({
      id:`route-${distance}-outline`, type:'line', source:`route-${distance}`,
      layout:{'line-join':'round','line-cap':'round'},
      paint:{'line-color':cfg.outline,'line-width':['interpolate',['linear'],['zoom'],10,4,17,10],'line-opacity':0.86}
    });
    map.addLayer({
      id:`route-${distance}`, type:'line', source:`route-${distance}`,
      layout:{'line-join':'round','line-cap':'round'},
      paint:{'line-color':cfg.color,'line-width':['interpolate',['linear'],['zoom'],10,2.2,17,6.7],'line-opacity':1}
    });
  }
  setRouteVisibility(selectedRoute);
}

function setRouteVisibility(distance){
  selectedRoute = String(distance);
  Object.keys(ROUTES).forEach(d=>{
    const v = activeEdition==='summer' && d===selectedRoute ? 'visible' : 'none';
    if (map.getLayer(`route-${d}`)) map.setLayoutProperty(`route-${d}`,'visibility',v);
    if (map.getLayer(`route-${d}-outline`)) map.setLayoutProperty(`route-${d}-outline`,'visibility',v);
  });
  document.querySelectorAll('.route').forEach(b=>b.classList.toggle('active',b.dataset.route===selectedRoute));
  const routeTitle=document.querySelector('#routeTitle');
  if(routeTitle && activeEdition==='summer') routeTitle.textContent=`${selectedRoute} KM`;
}

async function fitRoute(distance, animate=true){
  let data;try{data=await fetchJsonRequired(`./data/routes/${distance}.geojson`,`trace ${distance} km`);}catch(error){console.warn(error.message);if(!animate)flyEvent();return;}
  const coords = data.features[0].geometry.coordinates;
  const b = coords.reduce((bb,c)=>bb.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(b,{padding:{top:70,bottom:70,left:innerWidth>800?70:55,right:55}, pitch:52, bearing:-18, duration:animate?1600:0, maxZoom:14});
}

function findFirstLabelLayer(){
  const layers = map.getStyle().layers || [];
  const l = layers.find(x=>x.type==='symbol' && x.layout && x.layout['text-field']);
  return l ? l.id : undefined;
}

function metersToLngLat(center, east, north, rotationDeg=0){
  const a=rotationDeg*Math.PI/180;
  const x=east*Math.cos(a)-north*Math.sin(a);
  const y=east*Math.sin(a)+north*Math.cos(a);
  const lat=center[1] + y/111320;
  const lon=center[0] + x/(111320*Math.cos(center[1]*Math.PI/180));
  return [lon,lat];
}

function rectFeature(name, center, east, north, w, h, height, color, rot=0, base=0){
  const hw=w/2, hh=h/2;
  const pts=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh],[-hw,-hh]].map(([x,y])=>metersToLngLat(center,east+x,north+y,rot));
  return {type:'Feature',properties:{name,height,base,color},geometry:{type:'Polygon',coordinates:[pts]}};
}

function addExtrusionSource(id, features, beforeId){
  map.addSource(id,{type:'geojson',data:{type:'FeatureCollection',features}});
  map.addLayer({
    id, type:'fill-extrusion', source:id,
    paint:{
      'fill-extrusion-color':['get','color'],
      'fill-extrusion-base':['get','base'],
      'fill-extrusion-height':['get','height'],
      'fill-extrusion-opacity':0.96,
      'fill-extrusion-vertical-gradient':true
    }
  },beforeId);
}

function addEventVillage(){
  const r=EVENT_ROTATION_DEG;
  const f=[];
  // Château : volumes simples néoclassiques, calés sur les coordonnées réelles.
  f.push(rectFeature('Château - corps central',CASTLE,0,0,31,14,13,'#d9d3c5',8));
  f.push(rectFeature('Château - aile ouest',CASTLE,-19,0,10,18,10,'#cfc8ba',8));
  f.push(rectFeature('Château - aile est',CASTLE,19,0,10,18,10,'#cfc8ba',8));
  f.push(rectFeature('Château - fronton',CASTLE,0,-9,11,4,16,'#e5dfd2',8));
  // Village événement : implantation relative au plan fourni.
  f.push(rectFeature('Podium',EVENT_CENTER,-53,58,9,5,1.6,'#6c7175',r));
  f.push(rectFeature('Bar 1',EVENT_CENTER,-4,67,18,6,3.5,'#1267ff',r));
  f.push(rectFeature('Bar 2',EVENT_CENTER,15,67,18,6,3.5,'#1267ff',r));
  f.push(rectFeature('Friterie',EVENT_CENTER,42,62,6,3,3.0,'#ffffff',r));
  f.push(rectFeature('Retrait 1',EVENT_CENTER,66,40,4,4,3.0,'#ffffff',r));
  f.push(rectFeature('Retrait 2',EVENT_CENTER,66,34,4,4,3.0,'#ffffff',r));
  f.push(rectFeature('Atelier La Chouette',EVENT_CENTER,70,16,4,4,3.0,'#f7f7f7',r));
  f.push(rectFeature('Ballersocks',EVENT_CENTER,70,7,3,3,3.0,'#f7f7f7',r));
  f.push(rectFeature('Consigne',EVENT_CENTER,72,-8,6,4,3.0,'#1d63ff',r));
  f.push(rectFeature('Sono',EVENT_CENTER,-15,-8,3,3,3.0,'#f7f7f7',r));
  f.push(rectFeature('Chrono',EVENT_CENTER,1,-8,3,3,3.0,'#f7f7f7',r));
  f.push(rectFeature('Puces + T-shirt',EVENT_CENTER,-35,-7,3,3,3.0,'#f7f7f7',r));
  f.push(rectFeature('Ravito final',EVENT_CENTER,-65,-36,8,4,3.0,'#f7f7f7',r));
  f.push(rectFeature('Kiné',EVENT_CENTER,-6,-48,6,3,3.0,'#f7f7f7',r));
  f.push(rectFeature('Médecin',EVENT_CENTER,-20,-62,4,4,3.0,'#f7f7f7',r));
  // Arche arrivée : deux poteaux + traverse.
  f.push(rectFeature('Arche gauche',EVENT_CENTER,-7,-2,0.7,0.7,5.0,'#ff4b2b',r));
  f.push(rectFeature('Arche droite',EVENT_CENTER,-1,-2,0.7,0.7,5.0,'#ff4b2b',r));
  f.push(rectFeature('Arche traverse',EVENT_CENTER,-4,-2,6.7,0.7,5.7,'#ff4b2b',r,5.0));
  addExtrusionSource('event-structures',f,findFirstLabelLayer());

  // Couloir arrivée / zone finisher en transparence.
  const zones=[];
  zones.push(rectFeature('Couloir arrivée',EVENT_CENTER,15,-18,10,88,0.12,'#ff7a00',r));
  zones.push(rectFeature('Zone finisher',EVENT_CENTER,-45,-25,34,38,0.1,'#d7b36b',r));
  addExtrusionSource('event-zones',zones,'event-structures');
}

function setSatelliteVisibility(visible){
  if(!map.getSource('ign-satellite')){
    map.addSource('ign-satellite',{type:'raster',tiles:[SATELLITE_TILES],scheme:'xyz',tileSize:256,minzoom:0,maxzoom:19,bounds:[-5.5,41,9.8,51.5],attribution:'© IGN · Orthophotographies'});
    map.addLayer({id:'ign-satellite',type:'raster',source:'ign-satellite',layout:{visibility:visible?'visible':'none'},paint:{'raster-opacity':1,'raster-fade-duration':150}},findFirstLabelLayer());
  }else map.setLayoutProperty('ign-satellite','visibility',visible?'visible':'none');
  document.body.classList.toggle('satellite-view',visible);
}

function setEventVisibility(on){
  eventEnabled=on;
  if(landscapeLayer){landscapeLayer.eventVisible=on&&activeEdition==='summer';map.triggerRepaint();}
}

// UI
for(const btn of document.querySelectorAll('.route[data-route]')) btn.addEventListener('click',()=>{if(management){selectedRoute=btn.dataset.route;return;}setRouteVisibility(btn.dataset.route);fitRoute(btn.dataset.route)});
document.querySelector('#satelliteToggle')?.addEventListener('change',e=>setSatelliteVisibility(e.target.checked));
document.querySelector('#treesToggle').addEventListener('change',e=>{if(landscapeLayer){landscapeLayer.treesVisible=e.target.checked;map.triggerRepaint();}});
document.querySelector('#buildingsToggle').addEventListener('change',e=>{if(landscapeLayer){landscapeLayer.buildingsVisible=e.target.checked;map.triggerRepaint();}});
document.querySelector('#eventToggle').addEventListener('change',e=>setEventVisibility(e.target.checked));
document.querySelector('#terrainToggle').addEventListener('change',e=>{terrainEnabled=e.target.checked;map.setTerrain(terrainEnabled?{source:'gaubre-terrain',exaggeration:terrainExaggeration}:null); if(map.getLayer('gaubre-hillshade'))map.setLayoutProperty('gaubre-hillshade','visibility',terrainEnabled?'visible':'none');if(landscapeLayer)map.triggerRepaint();});
const dlg=document.querySelector('#planDialog');
document.querySelector('#planButton').addEventListener('click',()=>dlg.showModal());
document.querySelector('#closePlan').addEventListener('click',()=>dlg.close());
document.querySelector('#menuButton').addEventListener('click',()=>document.querySelector('#panel').classList.toggle('closed'));
