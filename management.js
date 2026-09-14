const STORAGE_KEY='gaubretrail-management-v2';
const LEGACY_KEY='gaubretrail-management-v1';
const EVENT_CENTER=[-1.0715847,46.9452378];
const ROUTE_COLORS=['#111111','#ef3340','#2088ff','#24a148','#7755d9','#e1a619'];

const ROLES={
  commissaire:{label:'Commissaire',icon:'🚩',color:'#e84f35'},
  ravitaillement:{label:'Ravitaillement',icon:'🥤',color:'#16875f'},
  consigne:{label:'Consigne',icon:'🎒',color:'#3978d6'},
  retrait_dossard:{label:'Retrait dossard',icon:'🏷',color:'#8453c8'},
  retrait_puce:{label:'Retrait puce',icon:'⏱',color:'#d68d0a'},
  parking:{label:'Parking',icon:'P',color:'#167f9e'}
};
const MARKING_STATUS={
  to_mark:{label:'À baliser',color:'#e08c16'},marked:{label:'Balisé',color:'#16875f'},
  to_unmark:{label:'À débaliser',color:'#d75438'},unmarked:{label:'Débalisé',color:'#667a70'}
};
const mapSvg=content=>`<svg viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;
const MAP_ICONS={
  volunteer:mapSvg('<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4.6V21"/>'),
  aid:mapSvg('<path d="M7 3h10l-1 17H8L7 3Z"/><path d="M8 8h8M10 12h4"/>'),
  sign:mapSvg('<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>'),
  brush:mapSvg('<path d="M4 20c5-1 8-4 9-9l7-7M14 10l4 4M6 17l3 3"/>'),
  marking:mapSvg('<path d="M5 19c4-1 2-6 6-7s2-6 8-7"/><circle cx="5" cy="19" r="2"/><path d="m16 3 3 2-2 3"/>'),
  directions:mapSvg('<path d="m12 3 9 9-9 9-9-9z"/><path d="M9 12h6M13 9l3 3-3 3"/>'),
  streetView:mapSvg('<circle cx="12" cy="5" r="2"/><path d="M8 21l1-7-3-2 2-4 4 2 4-2 2 4-3 2 1 7M12 10v5"/>')
};

const emptyState=()=>({version:2,activeEdition:'summer',settings:{volunteersVisible:true},editions:{
  summer:{name:'Été 2026',volunteers:[],signs:[],aidStations:[],brushZones:[],markingSections:[],routes:[]},
  winter:{name:'Hiver · nocturne',volunteers:[],signs:[],aidStations:[],brushZones:[],markingSections:[],routes:[]}
}});
const uid=prefix=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const byId=id=>document.getElementById(id);
const safe=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const normalize=value=>String(value??'').toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');

function migrateState(raw){
  const base=raw?.editions?.summer&&raw?.editions?.winter?raw:emptyState();
  base.version=2;base.settings={volunteersVisible:true,...base.settings};
  for(const key of ['summer','winter']){
    const edition=base.editions[key];
    edition.name=edition.name||(key==='summer'?'Été 2026':'Hiver · nocturne');
    for(const field of ['volunteers','signs','aidStations','brushZones','markingSections','routes'])if(!Array.isArray(edition[field]))edition[field]=[];
    edition.volunteers=edition.volunteers.map(item=>({...item,phone:item.phone||'',email:item.email||'',history:Array.isArray(item.history)?item.history:[]}));
  }
  return base;
}

function loadState(){
  try{return migrateState(JSON.parse(localStorage.getItem(STORAGE_KEY)||localStorage.getItem(LEGACY_KEY)));}
  catch(error){console.warn('Sauvegarde locale illisible.',error);return emptyState();}
}

function validateImport(data){
  if(!data?.editions?.summer||!data?.editions?.winter)throw new Error('Format de sauvegarde non reconnu.');
  return migrateState(data);
}

function haversine(a,b){
  const r=6371,toRad=value=>value*Math.PI/180,dLat=toRad(b[1]-a[1]),dLng=toRad(b[0]-a[0]);
  const h=Math.sin(dLat/2)**2+Math.cos(toRad(a[1]))*Math.cos(toRad(b[1]))*Math.sin(dLng/2)**2;
  return 2*r*Math.asin(Math.sqrt(h));
}
function lineDistance(coords){let distance=0;for(let i=1;i<coords.length;i++)distance+=haversine(coords[i-1],coords[i]);return distance;}
function polygonArea(coords){
  if(coords.length<3)return 0;const lat=coords.reduce((sum,p)=>sum+p[1],0)/coords.length*Math.PI/180;
  const points=coords.map(p=>[p[0]*111320*Math.cos(lat),p[1]*111320]);let area=0;
  for(let i=0,j=points.length-1;i<points.length;j=i++)area+=points[j][0]*points[i][1]-points[i][0]*points[j][1];
  return Math.abs(area/2);
}
function elevationStats(elevations){
  const valid=elevations.map(Number).filter(Number.isFinite);if(valid.length<2)return {gain:null,loss:null,min:null,max:null,values:[]};
  const smooth=valid.map((_,index)=>{const slice=valid.slice(Math.max(0,index-2),Math.min(valid.length,index+3));return slice.reduce((a,b)=>a+b,0)/slice.length;});
  let gain=0,loss=0;for(let i=1;i<smooth.length;i++){const delta=smooth[i]-smooth[i-1];if(delta>.6)gain+=delta;if(delta<-.6)loss-=delta;}
  return {gain:Math.round(gain),loss:Math.round(loss),min:Math.round(Math.min(...smooth)),max:Math.round(Math.max(...smooth)),values:smooth};
}

export function initManagement({map,maplibregl,onEditionChange,initialState,onSave}){
  let state=initialState?migrateState(initialState):loadState(),markers=[],routeLayerIds=[],drawing=null,editingHistory=[],baseRoutes=[],operationalHandlersReady=false;
  const drawer=byId('managerDrawer'),editionSelect=byId('editionSelect');
  const edition=()=>state.editions[state.activeEdition];

  function save(){
    if(onSave){onSave(structuredClone(state));return;}
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
    catch(error){alert('La sauvegarde locale est pleine. Exportez vos données.');console.error(error);}
  }
  function setDrawer(open){drawer.classList.toggle('open',open);drawer.setAttribute('aria-hidden',String(!open));byId('drawerScrim').classList.toggle('open',open);}
  function setTab(tab){document.querySelectorAll('.manager-tab').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));document.querySelectorAll('.manager-pane').forEach(pane=>pane.classList.toggle('active',pane.dataset.pane===tab));if(tab==='profiles')enrichVisibleProfiles();}
  function osmUrl(lat,lng){return`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;}
  function styledPopup({eyebrow,title,icon,color,facts=[],description='',location=null,extra=''}){
    const factHtml=facts.filter(([,value])=>value!==undefined&&value!==null&&String(value).trim()&&value!=='—').map(([label,value])=>`<div><span>${safe(label)}</span><strong>${safe(value)}</strong></div>`).join('');
    const descriptionHtml=description?`<section class="post-popup-team point-popup-description"><span>Informations</span><p>${safe(description)}</p></section>`:'';
    const actions=location?`<div class="post-popup-actions point-popup-actions"><a href="${osmUrl(location[0],location[1])}" target="_blank" rel="noreferrer">${MAP_ICONS.directions}<span>Itinéraire</span></a><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${location[0]},${location[1]}" target="_blank" rel="noreferrer">${MAP_ICONS.streetView}<span>Street View</span></a></div>`:'';
    return `<article class="post-popup point-popup" style="--post-status:${color}"><header><span class="post-popup-number point-popup-icon">${icon}</span><div><small>${safe(eyebrow)}</small><h3>${safe(title)}</h3></div></header>${factHtml?`<div class="post-popup-hours point-popup-facts">${factHtml}</div>`:''}${descriptionHtml}${extra}${actions}</article>`;
  }

  function setVolunteersVisible(visible){
    state.settings.volunteersVisible=visible;save();
    byId('staffToggle').checked=visible;byId('adminStaffVisible').checked=visible;
    markers.filter(item=>item.kind==='volunteer').forEach(item=>item.marker.getElement().style.display=visible?'flex':'none');
  }

  function combinedHistory(item){
    const history=[...(item.history||[])],identity=normalize(item.email||item.phone||item.name);
    for(const [key,otherEdition]of Object.entries(state.editions)){
      if(otherEdition===edition())continue;
      for(const other of otherEdition.volunteers){
        if(normalize(other.email||other.phone||other.name)===identity)history.push({year:(otherEdition.name.match(/\d{4}/)||[])[0]||otherEdition.name,role:other.role,location:`${Number(other.lat).toFixed(5)}, ${Number(other.lng).toFixed(5)}`,edition:key});
      }
    }
    return history.sort((a,b)=>String(b.year).localeCompare(String(a.year)));
  }

  function showLocation(item,kind){
    const role=kind==='volunteer'?(ROLES[item.role]||ROLES.commissaire):null;
    map.easeTo({center:[Number(item.lng),Number(item.lat)],zoom:18.2,pitch:0,bearing:0,duration:900});
    let html='';
    if(kind==='volunteer'){
      const history=combinedHistory(item),historyHtml=history.length?`<details><summary>${history.length} affectation(s) précédente(s)</summary><ul>${history.map(entry=>`<li><b>${safe(entry.year)}</b> · ${safe(ROLES[entry.role]?.label||entry.role)} · ${safe(entry.location||'Lieu non renseigné')}</li>`).join('')}</ul></details>`:'';
      html=styledPopup({eyebrow:role.label,title:item.name,icon:MAP_ICONS.volunteer,color:role.color,facts:[['Téléphone',item.phone],['E-mail',item.email],['Matériel',item.equipment]],description:item.instruction,location:[item.lat,item.lng],extra:historyHtml?`<section class="point-popup-extra">${historyHtml}</section>`:''});
    }else if(kind==='aid'){
      html=styledPopup({eyebrow:'RAVITAILLEMENT',title:item.name,icon:MAP_ICONS.aid,color:'#087ea4',facts:[['Ouverture',item.open],['Fermeture',item.close],['Responsable',item.manager]],description:item.supplies,location:[item.lat,item.lng]});
    }else{
      html=styledPopup({eyebrow:'SIGNALISATION',title:item.label,icon:MAP_ICONS.sign,color:'#d44f31',description:item.note,location:[item.lat,item.lng]});
    }
    new maplibregl.Popup({offset:20,maxWidth:'390px',className:'post-popup-shell'}).setLngLat([Number(item.lng),Number(item.lat)]).setHTML(html).addTo(map);
  }

  function clearMarkers(){markers.forEach(item=>item.marker.remove());markers=[];}
  function addMarker(item,kind,element){
    element.addEventListener('click',event=>{event.stopPropagation();showLocation(item,kind);});
    const marker=new maplibregl.Marker({element,anchor:'bottom'}).setLngLat([Number(item.lng),Number(item.lat)]).addTo(map);
    markers.push({kind,marker});
  }
  function renderMarkers(){
    clearMarkers();
    for(const volunteer of edition().volunteers){
      const role=ROLES[volunteer.role]||ROLES.commissaire,element=document.createElement('button');element.type='button';element.className='staff-marker';element.style.setProperty('--role',role.color);element.title=`${volunteer.name} · ${role.label}`;element.innerHTML=`<span>${role.icon}</span><b>${safe(volunteer.name)}</b>`;if(!state.settings.volunteersVisible)element.style.display='none';addMarker(volunteer,'volunteer',element);
    }
    for(const sign of edition().signs){const element=document.createElement('button');element.type='button';element.className='org-marker org-marker-mapElements';element.title=sign.label;element.setAttribute('aria-label',sign.label);element.innerHTML=`<span class="org-marker-icon">${MAP_ICONS.sign}</span>`;addMarker(sign,'sign',element);}
    for(const aid of edition().aidStations){const element=document.createElement('button');element.type='button';element.className='org-marker org-marker-aidStations';element.title=aid.name;element.setAttribute('aria-label',aid.name);element.innerHTML=`<span class="org-marker-icon">${MAP_ICONS.aid}</span>`;addMarker(aid,'aid',element);}
  }

  function initOperationalLayers(){
    if(!map.getSource('management-brush'))map.addSource('management-brush',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    if(!map.getLayer('management-brush-fill'))map.addLayer({id:'management-brush-fill',type:'fill',source:'management-brush',paint:{'fill-color':['match',['get','priority'],'done','#16875f','high','#e54c32','low','#d7a62c','#ed7b2c'],'fill-opacity':.28}});
    if(!map.getLayer('management-brush-line'))map.addLayer({id:'management-brush-line',type:'line',source:'management-brush',paint:{'line-color':['match',['get','priority'],'done','#116d4c','high','#c63220','low','#a67c12','#d65d16'],'line-width':3,'line-dasharray':[2,1]}});
    if(!map.getSource('management-marking'))map.addSource('management-marking',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    if(!map.getLayer('management-marking-line'))map.addLayer({id:'management-marking-line',type:'line',source:'management-marking',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['match',['get','status'],'marked','#16875f','to_unmark','#d75438','unmarked','#667a70','#e08c16'],'line-width':6,'line-opacity':.88}});
    if(!map.getSource('management-drawing'))map.addSource('management-drawing',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    if(!map.getLayer('management-drawing-fill'))map.addLayer({id:'management-drawing-fill',type:'fill',source:'management-drawing',paint:{'fill-color':'#f36c21','fill-opacity':.24}});
    if(!map.getLayer('management-drawing-line'))map.addLayer({id:'management-drawing-line',type:'line',source:'management-drawing',paint:{'line-color':'#f36c21','line-width':5,'line-dasharray':[1.5,1]}});
    if(!operationalHandlersReady){
      operationalHandlersReady=true;
      map.on('click','management-brush-fill',event=>{const item=edition().brushZones.find(value=>value.id===event.features?.[0]?.properties?.id);if(!item)return;const html=styledPopup({eyebrow:'DÉBROUSSAILLAGE',title:item.name,icon:MAP_ICONS.brush,color:item.done?'#218b4d':'#d96b24',facts:[['État',item.done?'Travaux terminés':'À débroussailler'],['Surface',`${Math.round(item.area)} m²`],['Responsable',item.manager],['Avant le',item.deadline]],description:item.note});new maplibregl.Popup({maxWidth:'390px',className:'post-popup-shell'}).setLngLat(event.lngLat).setHTML(html).addTo(map);});
      map.on('click','management-marking-line',event=>{const item=edition().markingSections.find(value=>value.id===event.features?.[0]?.properties?.id);if(!item)return;const status=MARKING_STATUS[item.status]||{label:item.status,color:'#52606d'},html=styledPopup({eyebrow:'BALISAGE',title:item.name,icon:MAP_ICONS.marking,color:status.color,facts:[['État',status.label],['Distance',`${(Number(item.lengthKm)||0).toLocaleString('fr-FR',{maximumFractionDigits:2})} km`],['Responsable',item.manager],['Date',item.date]],description:item.note});new maplibregl.Popup({maxWidth:'390px',className:'post-popup-shell'}).setLngLat(event.lngLat).setHTML(html).addTo(map);});
      for(const layer of ['management-brush-fill','management-marking-line']){map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave',layer,()=>map.getCanvas().style.cursor='');}
    }
  }
  function renderOperationalLayers(){
    initOperationalLayers();
    map.getSource('management-brush').setData({type:'FeatureCollection',features:edition().brushZones.map(item=>({type:'Feature',properties:{id:item.id,name:item.name,priority:item.done?'done':item.priority},geometry:{type:'Polygon',coordinates:[[...item.coordinates,item.coordinates[0]]]}}))});
    map.getSource('management-marking').setData({type:'FeatureCollection',features:edition().markingSections.map(item=>({type:'Feature',properties:{id:item.id,name:item.name,status:item.status},geometry:{type:'LineString',coordinates:item.coordinates}}))});
  }

  function volunteerRow(item){
    const role=ROLES[item.role]||ROLES.commissaire,history=combinedHistory(item);
    return `<article class="admin-volunteer-row" data-volunteer="${safe(item.id)}"><div class="item-icon" style="--role:${role.color}">${role.icon}</div><div class="admin-person"><strong>${safe(item.name)}</strong><span>${safe(item.email)||'E-mail non renseigné'}</span><span>${safe(item.phone)||'Téléphone non renseigné'}</span></div><div class="admin-assignment"><span class="role-chip" style="--role:${role.color}">${role.label}</span><small>${Number(item.lat).toFixed(6)}, ${Number(item.lng).toFixed(6)}</small><small>${history.length} affectation(s) passée(s)</small></div><div class="item-actions"><button data-action="focus" title="Voir sur la carte">◎</button><button data-action="edit" title="Modifier">✎</button><button data-action="delete" title="Supprimer">×</button></div></article>`;
  }
  function simpleCard(item,kind){
    const configs={sign:{icon:'⚠',title:item.label,subtitle:item.note||'Sans note'},aid:{icon:'🥤',title:item.name,subtitle:`${item.open||'—'} → ${item.close||'—'} · ${item.manager||'Sans responsable'}`},brush:{icon:'✂',title:item.name,subtitle:`${item.done?'Terminé':'À faire'} · ${Math.round(item.area)} m² · ${item.manager||'Sans responsable'}`},marking:{icon:'◆',title:item.name,subtitle:`${MARKING_STATUS[item.status]?.label||item.status} · ${(Number(item.lengthKm)||0).toLocaleString('fr-FR',{maximumFractionDigits:2})} km`}};
    const progress=kind==='brush'?'<button data-action="done" title="Changer l’état">✓</button>':kind==='marking'?'<button data-action="advance" title="Passer à l’état suivant">✓</button>':'';
    const cfg=configs[kind];return `<article class="manager-item" data-kind="${kind}" data-item-id="${safe(item.id)}"><div class="item-icon ${kind}-icon">${cfg.icon}</div><div class="item-body"><strong>${safe(cfg.title)}</strong><span>${safe(cfg.subtitle)}</span></div><div class="item-actions"><button data-action="focus" title="Voir sur la carte">◎</button>${progress}<button data-action="delete" title="Supprimer">×</button></div></article>`;
  }
  function routeCard(item){const stats=elevationStats(item.elevations||[]);return`<article class="manager-item" data-route-id="${safe(item.id)}"><div class="route-swatch" style="--route:${item.color}"></div><div class="item-body"><strong>${safe(item.name)}</strong><span>${item.distanceKm.toLocaleString('fr-FR',{maximumFractionDigits:1})} km · D+ ${stats.gain??'—'} m · D− ${stats.loss??'—'} m</span></div><div class="item-actions"><button data-action="focus" title="Afficher le parcours">◎</button><button data-action="delete" title="Supprimer">×</button></div></article>`;}

  function filteredVolunteers(){const query=normalize(byId('adminVolunteerSearch').value),role=byId('adminRoleFilter').value;return edition().volunteers.filter(item=>(!role||item.role===role)&&(!query||normalize(`${item.name} ${item.email} ${item.phone}`).includes(query)));}
  function renderLists(){
    const volunteers=filteredVolunteers();byId('adminVolunteerCount').textContent=`${volunteers.length} affiché(s) sur ${edition().volunteers.length}`;byId('volunteerList').innerHTML=volunteers.length?volunteers.map(volunteerRow).join(''):'<p class="empty-state">Aucun bénévole ne correspond à la recherche.</p>';
    byId('signList').innerHTML=edition().signs.length?edition().signs.map(item=>simpleCard(item,'sign')).join(''):'<p class="empty-state">Aucun panneau positionné.</p>';
    byId('aidList').innerHTML=edition().aidStations.length?edition().aidStations.map(item=>simpleCard(item,'aid')).join(''):'<p class="empty-state">Aucun ravitaillement positionné.</p>';
    byId('brushList').innerHTML=edition().brushZones.length?edition().brushZones.map(item=>simpleCard(item,'brush')).join(''):'<p class="empty-state">Aucune zone à débroussailler.</p>';
    byId('markingList').innerHTML=edition().markingSections.length?edition().markingSections.map(item=>simpleCard(item,'marking')).join(''):'<p class="empty-state">Aucun secteur de balisage.</p>';
    byId('gpxList').innerHTML=edition().routes.length?edition().routes.map(routeCard).join(''):'<p class="empty-state">Aucun parcours GPX importé.</p>';
  }
  function operationItem(kind,id){
    const collection={sign:'signs',brush:'brushZones',marking:'markingSections'}[kind];
    return collection?{collection,item:edition()[collection].find(value=>value.id===id)}:null;
  }
  function focusOperation(kind,id){
    const target=operationItem(kind,id);if(!target?.item)return false;
    setDrawer(false);
    if(kind==='sign')showLocation(target.item,'sign');else fitCoordinates(target.item.coordinates);
    return true;
  }
  function actionOperation(kind,id,action){
    const target=operationItem(kind,id);if(!target?.item)return false;
    if(action==='done'&&kind==='brush')target.item.done=!target.item.done;
    else if(action==='advance'&&kind==='marking'){const cycle=['to_mark','marked','to_unmark','unmarked'];target.item.status=cycle[(cycle.indexOf(target.item.status)+1)%cycle.length];}
    else if(action==='delete')edition()[target.collection]=edition()[target.collection].filter(value=>value.id!==id);
    else return false;
    save();refresh();return true;
  }
  function stats(){byId('managerEditionName').textContent=edition().name;byId('volunteerCount').textContent=edition().volunteers.length;byId('terrainCount').textContent=edition().signs.length+edition().aidStations.length+edition().brushZones.length+edition().markingSections.length;byId('gpxCount').textContent=edition().routes.length+(state.activeEdition==='summer'?4:0);}

  function removeManagedRoutes(){for(const id of routeLayerIds){if(map.getLayer(id))map.removeLayer(id);if(map.getSource(id))map.removeSource(id);}routeLayerIds=[];}
  function renderManagedRoutes(){removeManagedRoutes();for(const route of edition().routes){const id=`managed-${route.id}`;map.addSource(id,{type:'geojson',data:route.geojson});map.addLayer({id,type:'line',source:id,layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':route.color,'line-width':['interpolate',['linear'],['zoom'],10,3,17,7],'line-opacity':.96}});routeLayerIds.push(id);}}
  function refresh(){stats();renderLists();renderMarkers();renderOperationalLayers();renderManagedRoutes();renderProfiles();renderFinderResults();}

  function resetVolunteerForm(){byId('volunteerForm').reset();byId('volunteerId').value='';byId('cancelVolunteerEdit').hidden=true;byId('volunteerLat').value=EVENT_CENTER[1];byId('volunteerLng').value=EVENT_CENTER[0];editingHistory=[];renderHistoryDraft();}
  function renderHistoryDraft(){byId('historyDraftList').innerHTML=editingHistory.length?editingHistory.map((entry,index)=>`<span>${safe(entry.year)} · ${safe(ROLES[entry.role]?.label||entry.role)} · ${safe(entry.location)} <button type="button" data-history-index="${index}">×</button></span>`).join(''):'<small>Aucune affectation antérieure renseignée.</small>';}

  function startPick(type){
    setDrawer(false);map.getCanvas().classList.add('picking-location');const button=byId(type==='volunteer'?'pickVolunteerLocation':type==='sign'?'pickSignLocation':'pickAidLocation');const previous=button.textContent;button.textContent='Cliquez maintenant sur la carte…';
    map.once('click',event=>{const prefix=type==='volunteer'?'volunteer':type==='sign'?'sign':'aid';byId(`${prefix}Lat`).value=event.lngLat.lat.toFixed(7);byId(`${prefix}Lng`).value=event.lngLat.lng.toFixed(7);button.textContent=previous;map.getCanvas().classList.remove('picking-location');setDrawer(true);});
  }

  function updateDrawingPreview(){
    const source=map.getSource('management-drawing');if(!source||!drawing)return;let geometry=null;
    if(drawing.kind==='brush'&&drawing.coordinates.length>=3)geometry={type:'Polygon',coordinates:[[...drawing.coordinates,drawing.coordinates[0]]]};
    else if(drawing.coordinates.length>=2)geometry={type:'LineString',coordinates:drawing.coordinates};
    else if(drawing.coordinates.length===1)geometry={type:'Point',coordinates:drawing.coordinates[0]};
    source.setData({type:'FeatureCollection',features:geometry?[{type:'Feature',properties:{},geometry}]:[]});byId('drawingHelp').textContent=`${drawing.coordinates.length} point(s) · ${drawing.kind==='brush'?'3 minimum':'2 minimum'}`;
  }
  function drawClick(event){drawing.coordinates.push([event.lngLat.lng,event.lngLat.lat]);updateDrawingPreview();}
  function startDrawing(kind,payload){
    drawing={kind,payload,coordinates:[]};setDrawer(false);byId('drawingToolbar').hidden=false;byId('drawingTitle').textContent=kind==='brush'?'Tracer la zone à débroussailler':'Tracer le secteur de balisage';map.getCanvas().classList.add('picking-location');map.doubleClickZoom.disable();map.on('click',drawClick);updateDrawingPreview();
  }
  function stopDrawing(saveDrawing){
    if(!drawing)return;const minimum=drawing.kind==='brush'?3:2;if(saveDrawing&&drawing.coordinates.length<minimum){alert(`Ajoutez au moins ${minimum} points sur la carte.`);return;}
    if(saveDrawing){if(drawing.kind==='brush')edition().brushZones.push({...drawing.payload,id:uid('brush'),coordinates:drawing.coordinates,area:polygonArea(drawing.coordinates),done:false});else edition().markingSections.push({...drawing.payload,id:uid('mark'),coordinates:drawing.coordinates,lengthKm:lineDistance(drawing.coordinates)});save();}
    map.off('click',drawClick);map.doubleClickZoom.enable();map.getCanvas().classList.remove('picking-location');byId('drawingToolbar').hidden=true;drawing=null;map.getSource('management-drawing')?.setData({type:'FeatureCollection',features:[]});setDrawer(true);refresh();
  }

  function fitCoordinates(coords){const bounds=coords.reduce((box,coord)=>box.extend(coord),new maplibregl.LngLatBounds(coords[0],coords[0]));setDrawer(false);map.fitBounds(bounds,{padding:70,pitch:48,bearing:-18,duration:1100,maxZoom:17});}
  function parseGpx(text,fileName){
    const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.querySelector('parsererror'))throw new Error('Le fichier GPX est invalide.');let points=[...xml.querySelectorAll('trkpt')];if(points.length<2)points=[...xml.querySelectorAll('rtept')];
    const pairs=points.map(node=>({coord:[Number(node.getAttribute('lon')),Number(node.getAttribute('lat'))],elevation:Number(node.querySelector('ele')?.textContent)})).filter(item=>item.coord.every(Number.isFinite));if(pairs.length<2)throw new Error('Aucune trace exploitable dans ce GPX.');const coords=pairs.map(item=>item.coord),hasElevation=pairs.filter(item=>Number.isFinite(item.elevation)).length>pairs.length*.8;
    return{id:uid('gpx'),name:xml.querySelector('trk > name, rte > name')?.textContent?.trim()||fileName.replace(/\.gpx$/i,''),color:ROUTE_COLORS[(edition().routes.length+4)%ROUTE_COLORS.length],distanceKm:lineDistance(coords),points:coords.length,elevations:hasElevation?pairs.map(item=>item.elevation):[],geojson:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}}]}};
  }

  function terrainElevations(coords){
    const step=Math.max(1,Math.ceil(coords.length/180)),sample=coords.filter((_,index)=>index%step===0||index===coords.length-1),values=[];
    for(const coordinate of sample){let elevation=null;try{elevation=map.queryTerrainElevation(coordinate,{exaggerated:false});}catch(_error){elevation=map.queryTerrainElevation(coordinate);}if(Number.isFinite(elevation))values.push(elevation);}
    return values.length>=sample.length*.7?values:[];
  }
  function profileSvg(values){
    if(values.length<2)return'<div class="profile-missing">Profil disponible après affichage du parcours sur la carte.</div>';const width=520,height=112,min=Math.min(...values),max=Math.max(...values),range=Math.max(1,max-min),points=values.map((value,index)=>`${(index/(values.length-1)*width).toFixed(1)},${(height-8-(value-min)/range*(height-22)).toFixed(1)}`).join(' ');
    return`<svg class="elevation-profile" viewBox="0 0 ${width} ${height}" role="img" aria-label="Profil altimétrique"><defs><linearGradient id="profileGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#198c86" stop-opacity=".55"/><stop offset="1" stop-color="#198c86" stop-opacity=".04"/></linearGradient></defs><polygon points="0,${height} ${points} ${width},${height}" fill="url(#profileGradient)"/><polyline points="${points}" fill="none" stroke="#167d76" stroke-width="3" vector-effect="non-scaling-stroke"/><text x="5" y="14">${Math.round(max)} m</text><text x="5" y="106">${Math.round(min)} m</text></svg>`;
  }
  function profileCard(route){const stats=elevationStats(route.elevations||[]);return`<article class="profile-card" data-profile-id="${safe(route.id)}"><header><div><span class="profile-color" style="--route:${route.color}"></span><strong>${safe(route.name)}</strong></div><button type="button" data-action="focus">Voir sur la carte</button></header><div class="profile-metrics"><span><b>${route.distanceKm.toLocaleString('fr-FR',{maximumFractionDigits:1})}</b> km</span><span><b>${stats.gain??'—'}</b> m D+</span><span><b>${stats.loss??'—'}</b> m D−</span><span><b>${stats.max??'—'}</b> m max</span></div>${profileSvg(stats.values)}</article>`;}
  function visibleProfiles(){return[...(state.activeEdition==='summer'?baseRoutes:[]),...edition().routes];}
  function renderProfiles(){const routes=visibleProfiles();byId('profileList').innerHTML=routes.length?routes.map(profileCard).join(''):'<p class="empty-state">Importez un GPX pour créer la fiche du parcours hiver.</p>';}
  async function loadBaseRoutes(){
    const configs={42:'#111111',26:'#ef3340',17:'#2088ff',8:'#24a148'};for(const distance of [42,26,17,8]){try{const geojson=await fetch(`./data/routes/${distance}.geojson`).then(response=>response.json()),coords=geojson.features[0].geometry.coordinates;baseRoutes.push({id:`base-${distance}`,name:geojson.features[0].properties?.name||`Gaubre'Trail ${distance} km`,color:configs[distance],distanceKm:lineDistance(coords),points:coords.length,elevations:[],geojson});}catch(error){console.warn('Fiche parcours indisponible',distance,error);}}renderProfiles();setTimeout(enrichVisibleProfiles,1800);
  }
  function enrichVisibleProfiles(){let changed=false;for(const route of visibleProfiles()){if(route.elevations?.length)continue;const coords=route.geojson.features[0].geometry.coordinates,elevations=terrainElevations(coords);if(elevations.length){route.elevations=elevations;changed=true;}}if(changed){for(const route of edition().routes)if(route.elevations?.length)save();renderProfiles();renderLists();}}

  function renderFinderResults(){
    const input=byId('publicVolunteerSearch'),container=byId('publicVolunteerResults'),query=normalize(input.value);if(query.length<2){container.innerHTML='';container.classList.remove('open');return;}
    const results=edition().volunteers.filter(item=>normalize(item.name).includes(query)).slice(0,8);container.innerHTML=results.length?results.map(item=>{const role=ROLES[item.role]||ROLES.commissaire;return`<button type="button" data-find-volunteer="${safe(item.id)}"><span>${role.icon}</span><span><strong>${safe(item.name)}</strong><small>${role.label}</small></span></button>`;}).join(''):'<p>Aucun bénévole trouvé pour cette édition.</p>';container.classList.add('open');
  }

  byId('managerButton').addEventListener('click',()=>setDrawer(true));byId('closeManager').addEventListener('click',()=>setDrawer(false));byId('drawerScrim').addEventListener('click',()=>setDrawer(false));document.querySelectorAll('.manager-tab').forEach(button=>button.addEventListener('click',()=>setTab(button.dataset.tab)));
  editionSelect.value=state.activeEdition;editionSelect.addEventListener('change',()=>{state.activeEdition=editionSelect.value;save();resetVolunteerForm();refresh();onEditionChange?.(state.activeEdition,edition());});
  byId('staffToggle').addEventListener('change',event=>setVolunteersVisible(event.target.checked));byId('adminStaffVisible').addEventListener('change',event=>setVolunteersVisible(event.target.checked));
  byId('adminVolunteerSearch').addEventListener('input',renderLists);byId('adminRoleFilter').addEventListener('change',renderLists);byId('publicVolunteerSearch').addEventListener('input',renderFinderResults);
  byId('publicVolunteerResults').addEventListener('click',event=>{const button=event.target.closest('[data-find-volunteer]');if(!button)return;const item=edition().volunteers.find(v=>v.id===button.dataset.findVolunteer);if(item){showLocation(item,'volunteer');byId('publicVolunteerSearch').value='';renderFinderResults();}});
  byId('pickVolunteerLocation').addEventListener('click',()=>startPick('volunteer'));byId('pickSignLocation').addEventListener('click',()=>startPick('sign'));byId('pickAidLocation').addEventListener('click',()=>startPick('aid'));

  byId('addHistory').addEventListener('click',()=>{const year=byId('historyYear').value,location=byId('historyLocation').value.trim();if(!year||!location)return;editingHistory.push({year,role:byId('historyRole').value,location});byId('historyYear').value='';byId('historyLocation').value='';renderHistoryDraft();});
  byId('historyDraftList').addEventListener('click',event=>{const button=event.target.closest('[data-history-index]');if(!button)return;editingHistory.splice(Number(button.dataset.historyIndex),1);renderHistoryDraft();});
  byId('volunteerForm').addEventListener('submit',event=>{
    event.preventDefault();const id=byId('volunteerId').value,item={id:id||uid('vol'),name:byId('volunteerName').value.trim(),phone:byId('volunteerPhone').value.trim(),email:byId('volunteerEmail').value.trim(),role:byId('volunteerRole').value,instruction:byId('volunteerInstruction').value.trim(),equipment:byId('volunteerEquipment').value.trim(),lat:Number(byId('volunteerLat').value),lng:Number(byId('volunteerLng').value),history:[...editingHistory]};if(!item.name||!Number.isFinite(item.lat)||!Number.isFinite(item.lng))return;
    const index=edition().volunteers.findIndex(v=>v.id===item.id);if(index>=0){const previous=edition().volunteers[index];if(previous.role!==item.role||haversine([previous.lng,previous.lat],[item.lng,item.lat])>.01){item.history.unshift({year:(edition().name.match(/\d{4}/)||[])[0]||new Date().getFullYear(),role:previous.role,location:`${Number(previous.lat).toFixed(5)}, ${Number(previous.lng).toFixed(5)}`});}edition().volunteers[index]=item;}else{const identity=normalize(item.email||item.phone||item.name);for(const otherEdition of Object.values(state.editions)){const previous=otherEdition.volunteers.find(v=>normalize(v.email||v.phone||v.name)===identity);if(previous&&previous!==item)item.history.push({year:(otherEdition.name.match(/\d{4}/)||[])[0]||otherEdition.name,role:previous.role,location:`${Number(previous.lat).toFixed(5)}, ${Number(previous.lng).toFixed(5)}`});}edition().volunteers.push(item);}save();resetVolunteerForm();refresh();showLocation(item,'volunteer');
  });
  byId('cancelVolunteerEdit').addEventListener('click',resetVolunteerForm);
  byId('volunteerList').addEventListener('click',event=>{const button=event.target.closest('button[data-action]'),card=event.target.closest('[data-volunteer]');if(!button||!card)return;const item=edition().volunteers.find(v=>v.id===card.dataset.volunteer);if(!item)return;if(button.dataset.action==='focus'){setDrawer(false);showLocation(item,'volunteer');}if(button.dataset.action==='edit'){byId('volunteerId').value=item.id;byId('volunteerName').value=item.name;byId('volunteerPhone').value=item.phone||'';byId('volunteerEmail').value=item.email||'';byId('volunteerRole').value=item.role;byId('volunteerInstruction').value=item.instruction||'';byId('volunteerEquipment').value=item.equipment||'';byId('volunteerLat').value=item.lat;byId('volunteerLng').value=item.lng;editingHistory=[...(item.history||[])];renderHistoryDraft();byId('cancelVolunteerEdit').hidden=false;byId('volunteerName').focus();}if(button.dataset.action==='delete'&&confirm(`Supprimer ${item.name} de cette édition ?`)){edition().volunteers=edition().volunteers.filter(v=>v.id!==item.id);save();refresh();}});

  byId('signForm').addEventListener('submit',event=>{event.preventDefault();const item={id:uid('sign'),label:byId('signLabel').value.trim(),note:byId('signNote').value.trim(),lat:Number(byId('signLat').value),lng:Number(byId('signLng').value)};if(!item.label||!Number.isFinite(item.lat)||!Number.isFinite(item.lng))return;edition().signs.push(item);save();event.target.reset();byId('signLabel').value='ATTENTION — COURSE À PIED';setDefaultCoordinates();refresh();showLocation(item,'sign');});
  byId('aidForm').addEventListener('submit',event=>{event.preventDefault();const item={id:uid('aid'),name:byId('aidName').value.trim(),open:byId('aidOpen').value,close:byId('aidClose').value,manager:byId('aidManager').value.trim(),supplies:byId('aidSupplies').value.trim(),lat:Number(byId('aidLat').value),lng:Number(byId('aidLng').value)};if(!item.name||!Number.isFinite(item.lat)||!Number.isFinite(item.lng))return;edition().aidStations.push(item);save();event.target.reset();setDefaultCoordinates();refresh();showLocation(item,'aid');});
  byId('brushForm').addEventListener('submit',event=>{event.preventDefault();startDrawing('brush',{name:byId('brushName').value.trim(),priority:byId('brushPriority').value,deadline:byId('brushDeadline').value,manager:byId('brushManager').value.trim(),note:byId('brushNote').value.trim()});});
  byId('markingForm').addEventListener('submit',event=>{event.preventDefault();startDrawing('marking',{name:byId('markingName').value.trim(),status:byId('markingStatus').value,date:byId('markingDate').value,manager:byId('markingManager').value.trim(),note:byId('markingNote').value.trim()});});
  byId('finishDrawing').addEventListener('click',()=>stopDrawing(true));byId('cancelDrawing').addEventListener('click',()=>stopDrawing(false));

  for(const listId of ['signList','aidList','brushList','markingList'])byId(listId).addEventListener('click',event=>{const button=event.target.closest('button[data-action]'),card=event.target.closest('[data-item-id]');if(!button||!card)return;const collection={sign:'signs',aid:'aidStations',brush:'brushZones',marking:'markingSections'}[card.dataset.kind],items=edition()[collection],item=items.find(value=>value.id===card.dataset.itemId);if(!item)return;if(button.dataset.action==='focus'){if(card.dataset.kind==='sign'||card.dataset.kind==='aid'){setDrawer(false);showLocation(item,card.dataset.kind);}else fitCoordinates(item.coordinates);}if(button.dataset.action==='done'){item.done=!item.done;save();refresh();}if(button.dataset.action==='advance'){const cycle=['to_mark','marked','to_unmark','unmarked'];item.status=cycle[(cycle.indexOf(item.status)+1)%cycle.length];save();refresh();}if(button.dataset.action==='delete'&&confirm(`Supprimer « ${item.name||item.label} » ?`)){edition()[collection]=items.filter(value=>value.id!==item.id);save();refresh();}});

  byId('gpxInput').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{const route=parseGpx(await file.text(),file.name);edition().routes.push(route);save();refresh();fitCoordinates(route.geojson.features[0].geometry.coordinates);map.once('idle',()=>{if(!route.elevations.length){route.elevations=terrainElevations(route.geojson.features[0].geometry.coordinates);save();renderProfiles();renderLists();}});}catch(error){alert(error.message);}event.target.value='';});
  byId('gpxList').addEventListener('click',routeListClick);byId('profileList').addEventListener('click',routeListClick);
  function routeListClick(event){const button=event.target.closest('button[data-action]'),card=event.target.closest('[data-route-id],[data-profile-id]');if(!button||!card)return;const id=card.dataset.routeId||card.dataset.profileId,route=[...baseRoutes,...edition().routes].find(item=>item.id===id);if(!route)return;if(button.dataset.action==='focus'){if(route.id.startsWith('base-'))document.querySelector(`.route[data-route="${route.id.replace('base-','')}"]`)?.click();else fitCoordinates(route.geojson.features[0].geometry.coordinates);setDrawer(false);map.once('idle',()=>{if(!route.elevations.length){route.elevations=terrainElevations(route.geojson.features[0].geometry.coordinates);if(!route.id.startsWith('base-'))save();renderProfiles();renderLists();}});}if(button.dataset.action==='delete'&&!route.id.startsWith('base-')&&confirm(`Supprimer le parcours « ${route.name} » ?`)){edition().routes=edition().routes.filter(item=>item.id!==route.id);save();refresh();}}

  byId('exportData').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`gaubretrail-organisation-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(url);byId('backupStatus').textContent='Sauvegarde exportée.';});
  byId('importData').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{state=validateImport(JSON.parse(await file.text()));editionSelect.value=state.activeEdition;save();refresh();onEditionChange?.(state.activeEdition,edition());byId('backupStatus').textContent='Sauvegarde restaurée.';}catch(error){byId('backupStatus').textContent=error.message;}event.target.value='';});

  function setDefaultCoordinates(){for(const prefix of ['sign','aid']){byId(`${prefix}Lat`).value=EVENT_CENTER[1];byId(`${prefix}Lng`).value=EVENT_CENTER[0];}}
  function registerWebMcp(){const context=document.modelContext;if(!context?.registerTool)return;try{context.registerTool({name:'list_gaubretrail_operations',title:'Lister les opérations Gaubre’Trail',description:'Retourne bénévoles, ravitaillements, débroussaillage et balisage de l’édition active.',inputSchema:{type:'object',additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({edition:edition().name,volunteers:edition().volunteers,aidStations:edition().aidStations,brushZones:edition().brushZones,markingSections:edition().markingSections})});}catch(error){console.warn('WebMCP indisponible.',error);}}

  resetVolunteerForm();setDefaultCoordinates();byId('staffToggle').checked=state.settings.volunteersVisible;byId('adminStaffVisible').checked=state.settings.volunteersVisible;initOperationalLayers();refresh();onEditionChange?.(state.activeEdition,edition());loadBaseRoutes();registerWebMcp();
  return{refresh,open:(tab='volunteers')=>{setTab(tab);setDrawer(true);},getState:()=>state,setVolunteersVisible,focusOperation,actionOperation,replaceState:next=>{state=migrateState(next);refresh();}};
}
