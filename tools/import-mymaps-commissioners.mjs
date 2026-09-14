import fs from 'node:fs';

const [kmlPath='imports/mymaps-points.kml',organizationPath='data/organization.json',bundlePath='imports/benevoles-ete-2026.json']=process.argv.slice(2);
const readJson=path=>JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const decode=value=>value.replace(/<!\[CDATA\[([\s\S]*?)]]>/g,'$1').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&apos;',"'").trim();
const tag=(xml,name)=>decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]||'');
const folder=(kml,name)=>[...kml.matchAll(/<Folder>([\s\S]*?)<\/Folder>/gi)].map(m=>m[1]).find(xml=>tag(xml,'name')===name);
const points=xml=>[...xml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/gi)].flatMap(match=>{const body=match[1],coordinates=tag(body.match(/<Point>([\s\S]*?)<\/Point>/i)?.[1]||'','coordinates').split(',').map(Number);return coordinates.length>=2&&coordinates.slice(0,2).every(Number.isFinite)?[{label:tag(body,'name'),lng:coordinates[0],lat:coordinates[1]}]:[];});
const codeOf=label=>label.match(/^\s*((?:\d+)?[A-Z]\d*)\s*[-–]/u)?.[1].toUpperCase();
const nameOf=label=>label.replace(/^\s*(?:\d+)?[A-Z]\d*\s*[-–]\s*/u,'').trim();
const slug=value=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const kml=fs.readFileSync(kmlPath,'utf8');
const commissionerPoints=points(folder(kml,'Commissaires')||'').map(point=>({...point,number:codeOf(point.label)}));
if(commissionerPoints.length!==39||commissionerPoints.some(point=>!point.number))throw Error(`39 postes de commissaires attendus, ${commissionerPoints.length} trouvés.`);
const aidPoints=points(folder(kml,'Ravitaillements')||'');
if(aidPoints.length!==4)throw Error(`4 ravitaillements attendus, ${aidPoints.length} trouvés.`);

const organization=readJson(organizationPath),bundle=readJson(bundlePath);
const specialId={A1:'summer-2026-post-a','26A':'summer-2026-post-26a-saint-martin','26B':'summer-2026-post-26a'};
const courseIds=(state,distances)=>distances.map(distance=>(state.courses||organization.courses).find(course=>course.editionId==='summer-2026'&&course.distance===distance)?.id).filter(Boolean);
const routeDistances=label=>[8,17,26,42].filter(distance=>new RegExp(`(?:^|\\D)${distance}(?:\\D|$)`).test(label));

function applyPosts(target,fallback){
  const originalA=target.posts.find(post=>post.id==='summer-2026-post-a')||fallback.posts.find(post=>post.id==='summer-2026-post-a');
  for(const point of commissionerPoints){
    let post=target.posts.find(item=>item.id===(specialId[point.number]||`summer-2026-post-${slug(point.number)}`))||target.posts.find(item=>item.editionId==='summer-2026'&&String(item.number)===point.number);
    const source=post||fallback.posts.find(item=>item.id===(specialId[point.number]||''))||fallback.posts.find(item=>item.editionId==='summer-2026'&&String(item.number)===point.number);
    if(!post){post=structuredClone(source||originalA||{});post.id=specialId[point.number]||`summer-2026-post-${slug(point.number)}`;target.posts.push(post);}
    Object.assign(post,{editionId:'summer-2026',number:point.number,name:nameOf(point.label),lat:point.lat,lng:point.lng});
    if(/^A[1-6]$/.test(point.number)){post.required=1;post.description='Départ des courses · emplacement importé depuis Google My Maps';post.courseIds=courseIds(target,routeDistances(point.label));}
    if(point.number==='B2'){post.required=post.required||1;post.description='Réunion des parcours · emplacement importé depuis Google My Maps';post.courseIds=courseIds(target,[8,17,42]);}
  }
  target.posts.sort((a,b)=>a.editionId.localeCompare(b.editionId)||String(a.number).localeCompare(String(b.number),'fr',{numeric:true}));
}

applyPosts(bundle,organization);
applyPosts(organization,bundle);

const aIds=['A1','A2','A3','A4','A5','A6'].map(number=>bundle.posts.find(post=>post.editionId==='summer-2026'&&post.number===number).id);
bundle.assignments.filter(assignment=>assignment.postId==='summer-2026-post-a').forEach((assignment,index)=>{assignment.postId=aIds[index%aIds.length];});

const aidPostNumbers=['E','I','M','S'];
const aidCourseDistances=[[17,42],[26,42],[26,42],[17,26,42]];
const aidNames=['Ravito 1','Ravito 2','Ravito 3','Ravito 4'];
function applyAidStations(target){
  target.aidStations??=[];
  aidPoints.forEach((point,index)=>{
    const number=String(index+1),id=`summer-2026-aid-${number}`,post=target.posts.find(item=>item.editionId==='summer-2026'&&item.number===aidPostNumbers[index]);
    let aid=target.aidStations.find(item=>item.id===id)||target.aidStations.find(item=>item.editionId==='summer-2026'&&String(item.number)===number);
    if(!aid){aid={id,editionId:'summer-2026',number,name:aidNames[index],visible:true};target.aidStations.push(aid);}
    Object.assign(aid,{name:aidNames[index],lat:point.lat,lng:point.lng,courseIds:courseIds(target,aidCourseDistances[index]),postId:post?.id||'',visible:true,information:point.label});
  });
}
applyAidStations(bundle);
applyAidStations(organization);

bundle.sourceMap={type:'google-mymaps',mid:'1aCmqYlCmXDHeDepBTVeD0zIs27s-H14',name:tag(kml,'name'),importedAt:new Date().toISOString()};
fs.writeFileSync(organizationPath,JSON.stringify(organization,null,2)+'\n');
fs.writeFileSync(bundlePath,'\uFEFF'+JSON.stringify(bundle,null,2)+'\n');
console.log(`${commissionerPoints.length} postes et ${aidPoints.length} ravitaillements importés depuis My Maps.`);
