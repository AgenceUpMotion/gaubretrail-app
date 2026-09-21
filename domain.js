// Shared by the browser and server. No DOM, storage or network dependencies.
export const collections=['editions','courses','volunteers','assignments','posts','aidStations','owners','parcels','equipmentTypes','equipment','providerTypes','providers','messages','mapElements'];
export const uid=()=>crypto.randomUUID();
export const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const label=v=>v?.name||v?.company||[v?.firstName,v?.lastName].filter(Boolean).join(' ')||'—';
export const scoped=(s,key,e)=>s[key].filter(r=>r.editionId===e);
export const coordinates=r=>Number.isFinite(r.lat)&&Number.isFinite(r.lng)&&Math.abs(r.lat)<=90&&Math.abs(r.lng)<=180;
// Compare event wall-clock slots consistently on every device, irrespective of its timezone.
// Date.parse is deliberately guarded: some engines interpret strings containing
// "undefined" as a valid date around the year 2000.
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const validTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const validDuration=value=>typeof value==='string'&&/^\d{1,3}:[0-5]\d$/.test(value)&&durationMinutes(value)>0;
export function durationMinutes(value){const match=String(value??'').match(/^(\d{1,3}):([0-5]\d)$/);return match?Number(match[1])*60+Number(match[2]):NaN;}
export function clockMinutes(value){if(!validTime(value))return NaN;const [hours,minutes]=value.split(':').map(Number);return hours*60+minutes;}
export function formatClock(totalMinutes){if(!Number.isFinite(totalMinutes))return '';const rounded=Math.round(totalMinutes),dayOffset=Math.floor(rounded/1440),withinDay=((rounded%1440)+1440)%1440;return {time:`${String(Math.floor(withinDay/60)).padStart(2,'0')}:${String(withinDay%60).padStart(2,'0')}`,dayOffset};}
// Planning simulation only: it estimates a constant pace, never GPS tracking.
export function runnerProgressAt(course,atMinutes,durationField){
  const departure=clockMinutes(course?.departureTime),duration=durationMinutes(course?.[durationField]);
  if(!Number.isFinite(atMinutes)||!Number.isFinite(departure)||!Number.isFinite(duration))return null;
  const raw=(atMinutes-departure)/duration;
  return {state:raw<0?'before':raw>1?'finished':'running',progress:Math.max(0,Math.min(1,raw)),departure,duration};
}
const segmentKm=(a,b)=>{const rad=Math.PI/180,h=Math.sin((b[1]-a[1])*rad/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin((b[0]-a[0])*rad/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));};
export function coordinateAtProgress(coords,progress){
  if(!Array.isArray(coords)||coords.length<2||!Number.isFinite(progress))return null;
  const lengths=[];let total=0;
  for(let i=1;i<coords.length;i++){const length=segmentKm(coords[i-1],coords[i]);lengths.push(length);total+=length;}
  if(!total)return coords[0]?.slice(0,2)||null;
  let target=Math.max(0,Math.min(1,progress))*total;
  for(let i=1;i<coords.length;i++){const length=lengths[i-1];if(target<=length||i===coords.length-1){const ratio=length?target/length:0,a=coords[i-1],b=coords[i];return [a[0]+(b[0]-a[0])*ratio,a[1]+(b[1]-a[1])*ratio];}target-=length;}
  return coords.at(-1)?.slice(0,2)||null;
}
// Return the progress (0..1) and distance of the closest point on a course trace.
export function routePosition(coords,point){
  if(!Array.isArray(coords)||coords.length<2||!coordinates(point))return null;
  const lengths=[],cumulative=[0];let total=0;
  for(let i=1;i<coords.length;i++){const length=segmentKm(coords[i-1],coords[i]);lengths.push(length);total+=length;cumulative.push(total);}
  if(!total)return null;
  const latRad=point.lat*Math.PI/180,scaleX=Math.cos(latRad),px=point.lng*scaleX,py=point.lat;
  let bestDistance=Infinity,bestTravelled=0;
  for(let i=1;i<coords.length;i++){
    const a=coords[i-1],b=coords[i],ax=a[0]*scaleX,ay=a[1],bx=b[0]*scaleX,by=b[1],dx=bx-ax,dy=by-ay,denominator=dx*dx+dy*dy;
    const ratio=denominator?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/denominator)):0,qx=ax+dx*ratio,qy=ay+dy*ratio,distance=(px-qx)**2+(py-qy)**2;
    if(distance<bestDistance){bestDistance=distance;bestTravelled=cumulative[i-1]+lengths[i-1]*ratio;}
  }
  return {progress:bestTravelled/total,distanceKm:Math.sqrt(bestDistance)*111.32};
}
export function routeProgress(coords,point){return routePosition(coords,point)?.progress??NaN;}
export function estimatePresence(coursesWithCoords,point,{leadMinutes=15,tailMinutes=15}={}){
  const passages=[];
  for(const {course,coords} of coursesWithCoords||[]){
    const progress=routeProgress(coords,point),departure=clockMinutes(course?.departureTime),first=durationMinutes(course?.firstDuration),last=durationMinutes(course?.lastDuration);
    if(!Number.isFinite(progress)||!Number.isFinite(departure)||!Number.isFinite(first)||!Number.isFinite(last)||last<first)continue;
    passages.push({courseId:course.id,name:course.name,progress,first:departure+first*progress,last:departure+last*progress,leadMinutes:Number.isInteger(course.volunteerLeadMinutes)?course.volunteerLeadMinutes:leadMinutes,tailMinutes:Number.isInteger(course.volunteerTailMinutes)?course.volunteerTailMinutes:tailMinutes});
  }
  if(!passages.length)return null;
  const starts=passages.map(p=>p.first-p.leadMinutes);
  const ends=passages.map(p=>p.last+p.tailMinutes);
  return {start:formatClock(Math.min(...starts)),end:formatClock(Math.max(...ends)),passages};
}
export function interval(a){if(!validDate(a?.date)||!validTime(a?.start)||!validTime(a?.end)||a.endDate&&!validDate(a.endDate))return [NaN,NaN];return [Date.parse(`${a.date}T${a.start}:00Z`),Date.parse(`${a.endDate||a.date}T${a.end}:00Z`)];}
export function conflicts(s,a){const [start,end]=interval(a);return s.assignments.filter(b=>{const [bs,be]=interval(b);return b.id!==a.id&&b.volunteerId===a.volunteerId&&start<be&&bs<end;});}
export function coverage(s,p){
  const assignments=s.assignments.filter(a=>a.postId===p.id),[start,end]=interval(p);
  if(!Number.isFinite(start)||!Number.isFinite(end)){const assigned=new Set(assignments.map(a=>a.volunteerId)).size,required=p.required||0;return {assigned,required,status:assigned>=required?'Complet':assigned?'Incomplet':'Sans bénévole'};}
  const slices=[start,end,...assignments.flatMap(a=>interval(a)).filter(t=>t>start&&t<end)].sort((a,b)=>a-b);
  let assigned=Infinity;
  for(let i=1;i<slices.length;i++){if(slices[i]===slices[i-1])continue;const mid=(slices[i]+slices[i-1])/2;assigned=Math.min(assigned,new Set(assignments.filter(a=>{const [as,ae]=interval(a);return as<=mid&&ae>mid;}).map(a=>a.volunteerId)).size);}
  assigned=Number.isFinite(assigned)?assigned:0;
  return {assigned,required:p.required||0,status:assigned>=(p.required||0)?'Complet':assigned?'Incomplet':'Sans bénévole'};
}
export function inventory(s,editionId,zone='',typeId=''){
  const totals=new Map();let tables=0,chairs=0;
  for(const r of s.equipment.filter(r=>(!zone||r.zone===zone)&&(!typeId||r.typeId===typeId))){const name=s.equipmentTypes.find(t=>t.id===r.typeId)?.name||r.typeId;totals.set(name,(totals.get(name)||0)+r.quantity);tables+=r.tables||0;chairs+=r.chairs||0;}
  return [...totals].map(([name,quantity])=>({name,quantity})).concat([{name:'Tables',quantity:tables},{name:'Chaises',quantity:chairs}]);
}
export function validate(s){
  if(s?.schemaVersion!==3)throw Error('Version de données non reconnue.');
  for(const key of collections){if(!Array.isArray(s[key]))throw Error(`Collection manquante : ${key}`);const ids=new Set();for(const r of s[key]){if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id))throw Error(`Identifiant absent ou dupliqué : ${key}`);ids.add(r.id);}}
  if(!s.editions.length)throw Error('Une édition au minimum est nécessaire.');
  const ref=(key,id)=>{if(!s[key].some(r=>r.id===id))throw Error(`Relation introuvable : ${key} / ${id}`);};
  const required=(r,fields)=>{for(const f of fields)if(r[f]===undefined||r[f]===null||r[f]==='')throw Error(`Champ obligatoire : ${f}`);};
  const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
  const time=r=>{const [a,b]=interval(r);if(!date(r.date)||(r.endDate&&!date(r.endDate))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.end)||!Number.isFinite(a)||!Number.isFinite(b)||b<=a)throw Error('Les horaires doivent former un intervalle valide (date de fin pour la nuit).');};
  const geometry=g=>{if(!g||!['LineString','Polygon','MultiPolygon'].includes(g.type))throw Error('Géométrie non reconnue.');const lines=g.type==='LineString'?[g.coordinates]:g.type==='Polygon'?g.coordinates:g.coordinates?.flat();if(!Array.isArray(lines)||!lines.length)throw Error('Géométrie vide.');for(const line of lines){if(!Array.isArray(line)||line.length<(g.type==='LineString'?2:4)||line.some(c=>!Array.isArray(c)||!coordinates({lng:c[0],lat:c[1]})||c.slice(2).some(n=>!Number.isFinite(n))))throw Error('Coordonnées de géométrie invalides.');if(g.type!=='LineString'&&(line[0][0]!==line.at(-1)[0]||line[0][1]!==line.at(-1)[1]))throw Error('Le contour de parcelle doit être fermé.');}};
  for(const key of collections)for(const r of s[key]){
    if(['courses','assignments','posts','aidStations','messages','mapElements','parcels'].includes(key)){required(r,['editionId']);ref('editions',r.editionId);}
    if(r.lat!==undefined&&r.lat!==null&&r.lat!==''||r.lng!==undefined&&r.lng!==null&&r.lng!==''){if(!coordinates(r))throw Error('Coordonnées GPS invalides.');}
    if(r.color&&!/^#[0-9a-f]{6}$/i.test(r.color))throw Error('Couleur hexadécimale invalide.');
    if(r.geometry)geometry(r.geometry);
    if(r.geojson){if(r.geojson.type!=='FeatureCollection'||!Array.isArray(r.geojson.features)||!r.geojson.features.length)throw Error('Trace GeoJSON invalide.');for(const f of r.geojson.features){geometry(f.geometry);if(f.geometry.type!=='LineString')throw Error('Une trace doit être une ligne.');}}
    if(key==='courses'){if(!Number.isFinite(r.distance)||r.distance<0)throw Error('Distance invalide.');if(r.source&&!/^\.\/data\/routes\/\d+\.geojson$/.test(r.source))throw Error('Source de parcours non autorisée.');if(r.departureTime&&!validTime(r.departureTime))throw Error('Heure de départ invalide.');if(r.firstDuration&&!validDuration(r.firstDuration)||r.lastDuration&&!validDuration(r.lastDuration))throw Error('Les temps de parcours doivent être saisis au format HH:MM.');if(r.firstDuration&&r.lastDuration&&durationMinutes(r.lastDuration)<durationMinutes(r.firstDuration))throw Error('Le temps du dernier participant doit être supérieur au temps du premier.');for(const field of ['volunteerLeadMinutes','volunteerTailMinutes'])if(r[field]!==undefined&&(!Number.isInteger(r[field])||r[field]<0))throw Error('Les marges de présence doivent être des minutes entières positives.');}
    if(r.courseIds){if(!Array.isArray(r.courseIds))throw Error('Liste de parcours invalide.');for(const id of r.courseIds){ref('courses',id);if(s.courses.find(c=>c.id===id).editionId!==r.editionId)throw Error('Le parcours appartient à une autre édition.');}}
    if(['courses','posts','aidStations','equipmentTypes','providerTypes','editions'].includes(key))required(r,['name']);
    if(key==='editions'&&!['summer','winter'].includes(r.season))throw Error('Saison invalide.');
    if(key==='volunteers'){required(r,['firstName','lastName']);if(r.editionIds!==undefined){if(!Array.isArray(r.editionIds)||!r.editionIds.length)throw Error('Sélectionnez au moins une édition pour le bénévole.');for(const id of r.editionIds)ref('editions',id);}}
    if(key==='owners'){required(r,['lastName']);if(r.landRole&&!['owner','operator'].includes(r.landRole))throw Error('Statut foncier invalide.');if(r.referentId)ref('volunteers',r.referentId);if(r.agreementStatus&&!['to_contact','pending','approved'].includes(r.agreementStatus))throw Error('Statut d’accord propriétaire invalide.');if(r.thankedStatus&&!['todo','done'].includes(r.thankedStatus))throw Error('Statut de remerciement propriétaire invalide.');}
    if(key==='providers'){required(r,['company','typeId']);ref('providerTypes',r.typeId);}
    if(key==='equipment'){ref('equipmentTypes',r.typeId);for(const f of ['quantity','tables','chairs'])if(!Number.isInteger(r[f]??0)||(r[f]??0)<(f==='quantity'?1:0))throw Error('Quantités entières positives attendues.');}
    if(key==='equipmentTypes'){if(r.equipmentGroup!==undefined&&!['Sur site','Commissaire','Parcours','Ravitaillement'].includes(r.equipmentGroup))throw Error('Groupe de matériel invalide.');for(const f of ['width','depth','height'])if(r[f]!==undefined&&(!Number.isFinite(r[f])||r[f]<=0))throw Error('Dimensions positives attendues.');if(r.availableQuantity!==undefined&&(!Number.isInteger(r.availableQuantity)||r.availableQuantity<0))throw Error('La quantité disponible doit être un entier positif.');}
    if(key==='parcels'){ref('owners',r.ownerId);if(!['Polygon','MultiPolygon'].includes(r.geometry?.type))throw Error('Une géométrie de parcelle est nécessaire.');}
    if(key==='posts'){required(r,['number']);if(!Number.isInteger(r.required)||r.required<1)throw Error('Effectif requis : entier supérieur à zéro.');if(r.equipmentNeeds!==undefined){if(!Array.isArray(r.equipmentNeeds))throw Error('Liste de matériel invalide.');for(const need of r.equipmentNeeds){ref('equipmentTypes',need.typeId);if(!Number.isInteger(need.quantity)||need.quantity<1)throw Error('Quantité de matériel invalide.');}}if(r.date)time(r);else if(r.start||r.end){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.end)||r.end<=r.start)throw Error('Les horaires du poste sont invalides.');}if(r.timeSlots!==undefined&&(!Array.isArray(r.timeSlots)||!r.timeSlots.length||r.timeSlots.some(slot=>!Array.isArray(slot)||slot.length!==2||!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot[0])||!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot[1])||slot[1]<=slot[0])))throw Error('Les créneaux du poste sont invalides.');}
    if(key==='assignments'){required(r,['volunteerId','postId','date']);ref('volunteers',r.volunteerId);ref('posts',r.postId);const volunteer=s.volunteers.find(v=>v.id===r.volunteerId);if(Array.isArray(volunteer.editionIds)&&!volunteer.editionIds.includes(r.editionId))throw Error('Le bénévole ne participe pas à cette édition.');if(s.posts.find(p=>p.id===r.postId).editionId!==r.editionId)throw Error('Le poste appartient à une autre édition.');if(r.start||r.end)time(r);else if(!date(r.date))throw Error('La date de l’affectation est invalide.');}
    if(key==='aidStations'&&r.postId){ref('posts',r.postId);if(s.posts.find(p=>p.id===r.postId).editionId!==r.editionId)throw Error('Le poste appartient à une autre édition.');}
    if(key==='messages'){ref('volunteers',r.volunteerId);ref('posts',r.postId);if(s.posts.find(p=>p.id===r.postId).editionId!==r.editionId)throw Error('Conversation et poste : éditions différentes.');if(!['nouveau','lu','répondu','clôturé'].includes(r.status)||!Array.isArray(r.entries))throw Error('Conversation invalide.');}
  }
  for(const e of s.editions){const numbers=new Set();for(const p of scoped(s,'posts',e.id)){if(numbers.has(String(p.number)))throw Error('Numéro de poste déjà utilisé dans cette édition.');numbers.add(String(p.number));}}
  return s;
}
export function publicData(s){
  // Explicit allowlists: private data never leaves the server via this endpoint.
  const pick=(r,keys)=>Object.fromEntries(keys.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
  const postIds=new Set(s.posts.filter(p=>p.publicVisible).map(p=>p.id)),assignedVolunteerIds=new Set(s.assignments.filter(a=>postIds.has(a.postId)).map(a=>a.volunteerId));
  const volunteers=s.volunteers.filter(v=>v.active&&assignedVolunteerIds.has(v.id)).map(v=>pick(v,['id','firstName','lastName','editionIds','active']));
  const ids=new Set(volunteers.map(v=>v.id));
  return {schemaVersion:3,editions:s.editions.map(r=>pick(r,['id','season','year','name','date','site','lat','lng'])),courses:s.courses.map(r=>pick(r,['id','editionId','name','distance','gain','loss','departureTime','firstDuration','lastDuration','volunteerLeadMinutes','volunteerTailMinutes','color','visible','source','geojson'])),volunteers,
    assignments:s.assignments.filter(a=>ids.has(a.volunteerId)&&postIds.has(a.postId)).map(r=>pick(r,['id','volunteerId','postId','editionId','date','endDate','start','end','instructions'])),
    posts:s.posts.filter(r=>r.publicVisible).map(r=>pick(r,['id','editionId','number','postType','name','lat','lng','date','endDate','start','end','timeSlots','required','equipmentNeeds','equipmentNeeded','instructions','courseIds','publicVisible'])),
    aidStations:s.aidStations.filter(r=>r.visible).map(r=>pick(r,['id','editionId','number','name','lat','lng','courseIds','km','information','start','end','visible'])),
    mapElements:[...s.mapElements.filter(r=>r.visible).map(r=>pick(r,['id','editionId','name','kind','lat','lng','courseIds','visible'])),...s.editions.flatMap(e=>(s.operations?.[e.id]?.signs||[]).map(p=>({id:`sign-${e.id}-${p.id}`,editionId:e.id,name:p.label,kind:'panneau',lat:Number(p.lat),lng:Number(p.lng),visible:true})).filter(coordinates))],owners:[],parcels:[],equipment:[],equipmentTypes:s.equipmentTypes.map(r=>pick(r,['id','name','equipmentGroup'])),providerTypes:s.providerTypes.map(r=>pick(r,['id','name'])),providers:s.providers.filter(r=>coordinates(r)&&normalize(`${r.typeId} ${s.providerTypes.find(t=>t.id===r.typeId)?.name}`).includes('photo')).map(r=>pick(r,['id','company','typeId','lat','lng'])),messages:[],settings:{}};
}
export function migrate(raw,seed){
  if(raw?.schemaVersion===3){const next=structuredClone(raw);for(const key of ['equipment','providers'])for(const record of next[key]||[])delete record.editionId;return validate(next);}
  const s=structuredClone(seed);if(!raw)return s;
  if(!raw.editions?.summer||!raw.editions?.winter)throw Error('Sauvegarde historique non reconnue.');
  s.legacy=structuredClone(raw);s.migrationNotes=[];s.operations={};
  for(const season of ['summer','winter']){const old=raw.editions[season],e=s.editions.find(e=>e.season===season);if(old.name)e.name=old.name;const year=Number(old.name?.match(/\b(20\d{2})\b/)?.[1]);if(year){const previousId=e.id;e.year=year;e.id=`${season}-${year}`;for(const c of s.courses)if(c.editionId===previousId)c.editionId=e.id;}
    s.operations[e.id]={};for(const k of ['signs','brushZones','markingSections'])s.operations[e.id][k]=structuredClone(old[k]||[]);
    for(const [i,v] of (old.volunteers||[]).entries()){
      // Never merge homonyms automatically. Historical records are kept verbatim.
      const name=String(v.name||'Bénévole').trim().split(/\s+/),id=`legacy-${season}-${v.id||i}`,postId=`post-${id}`;
      s.volunteers.push({id,firstName:name.shift(),lastName:name.join(' ')||'À compléter',editionIds:[e.id],phone:v.phone||'',email:v.email||'',notes:[v.instruction,v.equipment].filter(Boolean).join('\n'),active:true,publicVisible:false,history:v.history||[]});
      s.posts.push({id:postId,editionId:e.id,number:`L${i+1}`,name:v.role||'Poste historique',lat:Number(v.lat),lng:Number(v.lng),required:1,instructions:v.instruction||'',courseIds:[],publicVisible:false,legacyVolunteerId:id});
      s.migrationNotes.push(`${label(s.volunteers.at(-1))} : poste conservé ; date et horaires à compléter avant affectation.`);
    }
    for(const [i,r] of (old.routes||[]).entries())s.courses.push({id:`legacy-${season}-route-${r.id||i}`,editionId:e.id,name:r.name||'Parcours importé',distance:r.distanceKm||0,color:/^#[0-9a-f]{6}$/i.test(r.color)?r.color:'#16875f',geojson:r.geojson,visible:true});
    for(const [i,a] of (old.aidStations||[]).entries())s.aidStations.push({id:`legacy-${season}-aid-${a.id||i}`,editionId:e.id,name:a.name||'Ravitaillement',number:String(i+1),lat:Number(a.lat),lng:Number(a.lng),start:a.open||'',end:a.close||'',information:a.supplies||'',notes:a.manager||'',courseIds:[],visible:true});
  }
  return validate(s);
}
export function legacyState(s,editionId){
  const base=structuredClone(s.legacy||{version:2,settings:{volunteersVisible:true},editions:{summer:{},winter:{}}});
  const selected=s.editions.find(e=>e.id===editionId)||s.editions[0];base.activeEdition=selected.season;
  for(const season of ['summer','winter']){const e=season===selected.season?selected:s.editions.find(e=>e.season===season);const target=base.editions[season]||{};target.name=e?.name||season;
    for(const key of ['volunteers','routes','aidStations'])target[key]=[];
    for(const key of ['signs','brushZones','markingSections'])target[key]=(s.operations?.[e?.id]?.[key]||[]);
    base.editions[season]=target;
  }return base;
}
export function acceptLegacy(s,raw,editionId){const next=structuredClone(s);next.operations||={};const e=s.editions.find(e=>e.id===editionId);next.operations[e.id]={};for(const k of ['signs','brushZones','markingSections'])next.operations[e.id][k]=structuredClone(raw.editions[e.season][k]);return next;}
export function profile(coords){let distance=0,gain=0,loss=0;const points=coords.map((c,i)=>{if(i){const a=coords[i-1],rad=Math.PI/180,h=Math.sin((c[1]-a[1])*rad/2)**2+Math.cos(a[1]*rad)*Math.cos(c[1]*rad)*Math.sin((c[0]-a[0])*rad/2)**2;distance+=12742*Math.asin(Math.min(1,Math.sqrt(h)));if(Number.isFinite(c[2])&&Number.isFinite(a[2])){const d=c[2]-a[2];gain+=Math.max(0,d);loss+=Math.max(0,-d);}}return {distance,elevation:Number.isFinite(c[2])?c[2]:null,coordinate:c};});return {points,distance,gain:points.every(p=>p.elevation!==null)?Math.round(gain):null,loss:points.every(p=>p.elevation!==null)?Math.round(loss):null};}
