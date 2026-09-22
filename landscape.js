import * as THREE from 'three';

const MAX_TREES = 6500;
const MAX_BUILDINGS = 2200;

function randomFactory(seed){
  let value=seed>>>0;
  return ()=>((value=(value*1664525+1013904223)>>>0)/4294967296);
}

function metersBetween(a,b){
  const lat=(a[1]+b[1])*Math.PI/360;
  return Math.hypot((b[0]-a[0])*111320*Math.cos(lat),(b[1]-a[1])*111320);
}

function polygonAreaMeters(points){
  if(points.length<3)return 0;
  const lat0=points.reduce((s,p)=>s+p[1],0)/points.length*Math.PI/180;
  let area=0;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=[points[j][0]*111320*Math.cos(lat0),points[j][1]*111320];
    const b=[points[i][0]*111320*Math.cos(lat0),points[i][1]*111320];
    area+=a[0]*b[1]-b[0]*a[1];
  }
  return Math.abs(area/2);
}

function pointInPolygon(point,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if(((a[1]>point[1])!==(b[1]>point[1])) && point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}

function buildingFromWay(way,rand){
  const points=(way.geometry||[]).map(p=>[p.lon,p.lat]);
  if(points.length<4)return null;
  const center=points.reduce((p,v)=>[p[0]+v[0]/points.length,p[1]+v[1]/points.length],[0,0]);
  let edge=[points[0],points[1]],longest=0;
  for(let i=1;i<points.length;i++){
    const length=metersBetween(points[i-1],points[i]);
    if(length>longest){longest=length;edge=[points[i-1],points[i]];}
  }
  const area=polygonAreaMeters(points);
  const width=Math.max(4,Math.min(45,longest));
  const depth=Math.max(4,Math.min(35,area/Math.max(width,1)));
  const taggedHeight=parseFloat(way.tags?.height);
  const levels=parseFloat(way.tags?.['building:levels']);
  const height=Number.isFinite(taggedHeight)?taggedHeight:Number.isFinite(levels)?levels*3:5+rand()*7;
  const rotation=Math.atan2(edge[1][1]-edge[0][1],(edge[1][0]-edge[0][0])*Math.cos(center[1]*Math.PI/180));
  return {id:way.id,name:way.tags?.name||'',lon:center[0],lat:center[1],width,depth,height:Math.max(3,Math.min(35,height)),rotation,footprint:points};
}

function treesFromWood(way,rand,remaining){
  const polygon=(way.geometry||[]).map(p=>[p.lon,p.lat]);
  if(polygon.length<4)return [];
  const xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]);
  const count=Math.min(remaining,Math.max(3,Math.round(polygonAreaMeters(polygon)/850)));
  const trees=[];
  for(let attempts=0;trees.length<count && attempts<count*12;attempts++){
    const point=[Math.min(...xs)+rand()*(Math.max(...xs)-Math.min(...xs)),Math.min(...ys)+rand()*(Math.max(...ys)-Math.min(...ys))];
    if(pointInPolygon(point,polygon)){
      const height=6+rand()*10;
      trees.push({lon:point[0],lat:point[1],height,radius:height*(.22+rand()*.1),tone:rand()});
    }
  }
  return trees;
}

export async function fetchLandscape(bounds,focus){
  const [[west,south],[east,north]]=bounds;
  const [focusLon,focusLat]=focus||[(west+east)/2,(south+north)/2];
  const buildingBounds=[Math.max(south,focusLat-.016),Math.max(west,focusLon-.025),Math.min(north,focusLat+.016),Math.min(east,focusLon+.025)];
  const query=`[out:json][timeout:25];(way[building](${buildingBounds.join(',')});node[natural=tree](around:250,${focusLat},${focusLon});way[natural=wood](${south},${west},${north},${east});way[landuse=forest](${south},${west},${north},${east}););out tags geom;`;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),22000);
  try{
    const response=await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(query),{signal:controller.signal});
    if(!response.ok)throw new Error(`Overpass ${response.status}`);
    const json=await response.json();
    const rand=randomFactory(85130),buildings=[],trees=[];
    for(const way of json.elements||[]){
      if(way.type==='node'&&way.tags?.natural==='tree'&&trees.length<MAX_TREES){
        const height=Number.parseFloat(way.tags.height)||9+rand()*5;
        trees.push({lon:way.lon,lat:way.lat,height,radius:height*(.23+rand()*.08),tone:rand(),mapped:true});
        continue;
      }
      if(way.tags?.building && buildings.length<MAX_BUILDINGS){
        const building=buildingFromWay(way,rand);
        const distance=building?metersBetween([building.lon,building.lat],[focusLon,focusLat]):0;
        const isDetailedLandmark=building && (distance<38 || building.id===76929118 || /Salle polyvalente de Landebaudière/i.test(building.name));
        if(building&&!isDetailedLandmark)buildings.push(building);
      }else if((way.tags?.natural==='wood'||way.tags?.landuse==='forest') && trees.length<MAX_TREES){
        trees.push(...treesFromWood(way,rand,MAX_TREES-trees.length));
      }
    }
    if(!buildings.length&&!trees.length)throw new Error('Aucun élément paysager reçu');
    return {trees,buildings,approximateTrees:true};
  }finally{clearTimeout(timeout);}
}

export function fallbackLandscape(){
  // Keep the mapped local site, but never invent geographic features on failure.
  return {trees:[],buildings:[],approximateTrees:false,fallback:true};
}

function addBox(group,material,w,d,h,x=0,y=0,z=0,rotation=0){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,d,h),material);
  mesh.position.set(x,y,z);mesh.rotation.z=rotation;group.add(mesh);return mesh;
}

function offsetMeters(origin,coordinate){
  const meanLat=(origin[1]+coordinate[1])*Math.PI/360;
  return [(coordinate[0]-origin[0])*111320*Math.cos(meanLat),(coordinate[1]-origin[1])*111320];
}

function shapeFromCoordinates(coordinates,origin){
  const shape=new THREE.Shape();
  coordinates.forEach((coordinate,index)=>{
    const [x,y]=offsetMeters(origin,coordinate);
    if(index===0)shape.moveTo(x,y);else shape.lineTo(x,y);
  });
  shape.closePath();return shape;
}

function extrudeFootprint(group,coordinates,origin,height,material,z=0){
  const geometry=new THREE.ExtrudeGeometry(shapeFromCoordinates(coordinates,origin),{depth:height,bevelEnabled:false,steps:1});
  const mesh=new THREE.Mesh(geometry,material);mesh.position.z=z;group.add(mesh);return mesh;
}

function hippedRoofGeometry(w,d,h,inset){
  const x=w/2,y=d/2,tx=Math.max(0.2,x-inset),ty=Math.max(0.2,y-inset);
  const vertices=new Float32Array([-x,-y,0,x,-y,0,x,y,0,-x,y,0,-tx,-ty,h,tx,-ty,h,tx,ty,h,-tx,ty,h]);
  const indices=[0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7,4,5,6,4,6,7,0,3,2,0,2,1];
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function pedimentGeometry(w,d,h){
  const x=w/2,y=d/2;
  const vertices=new Float32Array([-x,-y,0,x,-y,0,0,-y,h,-x,y,0,x,y,0,0,y,h]);
  const indices=[0,1,2,3,5,4,0,3,4,0,4,1,1,4,5,1,5,2,2,5,3,2,3,0];
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function addTent(group,x,y,w,d,color,rotation=0){
  const canvas=new THREE.MeshStandardMaterial({color,roughness:.82,flatShading:true});
  const frame=new THREE.MeshStandardMaterial({color:0xe9eee8,roughness:.7});
  addBox(group,frame,w,.12,.12,x,y-d/2,2.25,rotation);addBox(group,frame,w,.12,.12,x,y+d/2,2.25,rotation);
  for(const sx of [-1,1])for(const sy of [-1,1])addBox(group,frame,.12,.12,2.3,x+sx*w*.48,y+sy*d*.48,1.15,rotation);
  const roof=new THREE.Mesh(new THREE.ConeGeometry(1,1,4),canvas);roof.geometry.rotateX(Math.PI/2);roof.geometry.rotateZ(Math.PI/4);roof.scale.set(w*.72,d*.72,1.25);roof.position.set(x,y,2.85);roof.rotation.z=rotation;group.add(roof);
}

function createCastleModel(){
  const group=new THREE.Group();group.name='Château de Landebaudière';group.rotation.z=THREE.MathUtils.degToRad(64.35);
  const wall=new THREE.MeshStandardMaterial({color:0xe5dcc6,roughness:.94,flatShading:true});
  const stone=new THREE.MeshStandardMaterial({color:0xb9aa8e,roughness:1,flatShading:true});
  const slate=new THREE.MeshStandardMaterial({color:0x39454c,roughness:.9,flatShading:true});
  const glass=new THREE.MeshStandardMaterial({color:0x9db6bd,roughness:.35,metalness:.08});
  const door=new THREE.MeshStandardMaterial({color:0xdce8e7,roughness:.55});
  addBox(group,stone,46,14,1.5,0,0,.75);addBox(group,wall,46,14,9.3,0,0,6.15);
  addBox(group,stone,46.6,14.6,.28,0,0,3.25);addBox(group,stone,46.8,14.8,.3,0,0,10.7);
  const lowerRoof=new THREE.Mesh(hippedRoofGeometry(47,15,3.6,2.8),slate);lowerRoof.position.z=10.85;group.add(lowerRoof);
  const upperRoof=new THREE.Mesh(hippedRoofGeometry(41.4,9.4,1.45,3.9),slate);upperRoof.position.z=14.42;group.add(upperRoof);
  const pediment=new THREE.Mesh(pedimentGeometry(10,1.25,2.5),stone);pediment.position.set(0,-7.65,10.9);group.add(pediment);
  const bays=[-20,-15,-10,-5,0,5,10,15,20];
  for(const x of bays){
    for(const y of [-7.08,7.08]){
      if(x!==0)addBox(group,glass,1.65,.16,2.55,x,y,3.05);
      addBox(group,glass,1.65,.16,2.55,x,y,7.25);
      addBox(group,glass,1.35,.17,1.05,x,y,1.0);
    }
  }
  for(const x of [-23,-12.5,0,12.5,23])for(const y of [-7.12,7.12])addBox(group,stone,.5,.24,9.1,x,y,6.1);
  addBox(group,door,2.25,.2,3.45,0,-7.14,3.45);addBox(group,stone,3.0,.32,.35,0,-7.28,5.25);
  for(let step=0;step<6;step++)addBox(group,stone,12.75-step*1.15,1.0,.28,0,-11.6+step*.72,.14+step*.25);
  for(const x of [-18,-12,-6,0,6,12,18]){
    addBox(group,slate,2.25,1.45,2.15,x,-5.72,12.55);addBox(group,glass,1.25,.16,1.45,x,-6.47,12.5);
    addBox(group,slate,2.25,1.45,2.15,x,5.72,12.55);addBox(group,glass,1.25,.16,1.45,x,6.47,12.5);
  }
  for(const x of [-16,-4,9,18])addBox(group,stone,1.2,1.2,3.6,x,0,15.2);
  for(const x of [-21.5,21.5])for(const y of [-5.1,5.1]){
    const spire=new THREE.Mesh(new THREE.ConeGeometry(.28,1.8,8),slate);spire.geometry.rotateX(Math.PI/2);spire.position.set(x,y,16.5);group.add(spire);
  }
  return group;
}

function createLandebaudiereHall(){
  const origin=[-1.0711116,46.9462587];
  const footprint=[
    [-1.0711304,46.9464769],[-1.0713662,46.9462856],[-1.0712925,46.9462433],
    [-1.0712704,46.9462611],[-1.0709113,46.9460563],[-1.0706986,46.9462288]
  ];
  const group=new THREE.Group();group.name='Salle polyvalente de Landebaudière';
  const walls=new THREE.MeshStandardMaterial({color:0xe8e2d6,roughness:.9});
  const roof=new THREE.MeshStandardMaterial({color:0x4d565b,roughness:.85});
  const wood=new THREE.MeshStandardMaterial({color:0xa77b51,roughness:.88});
  const glass=new THREE.MeshStandardMaterial({color:0x78a9b6,roughness:.25,metalness:.1,transparent:true,opacity:.82});
  const paving=new THREE.MeshStandardMaterial({color:0xb7b6ae,roughness:1});
  extrudeFootprint(group,footprint,origin,6.6,walls);
  extrudeFootprint(group,footprint,origin,.65,roof,6.6);
  const angle=THREE.MathUtils.degToRad(-26.09);
  addBox(group,glass,23,.22,2.25,2,-12.5,3.4,angle);
  addBox(group,wood,12,.3,3.4,-13,-5.7,3.1,angle);
  addBox(group,paving,29,9,.12,-2,-20,.08,angle);
  for(let i=-4;i<=4;i++)addBox(group,glass,1.45,.2,2.4,i*2.45+2,-12.7,3.35,angle);
  return group;
}

function createLandebaudiereParking(){
  const origin=[-1.0721457,46.9464085];
  const footprint=[
    [-1.0720818,46.9470579],[-1.0731305,46.9462431],[-1.0721354,46.9457890],[-1.0712349,46.9465439]
  ];
  const group=new THREE.Group();group.name='Parking de Landebaudière';
  const asphalt=new THREE.MeshStandardMaterial({color:0x777b78,roughness:1,side:THREE.DoubleSide});
  const marking=new THREE.MeshStandardMaterial({color:0xf2f0dd,roughness:.9});
  const curb=new THREE.MeshStandardMaterial({color:0xc7c5b9,roughness:1});
  const carColors=[0x32699a,0xdbe2df,0xaa473b,0x343c3e,0xd6b04b];
  const surface=new THREE.Mesh(new THREE.ShapeGeometry(shapeFromCoordinates(footprint,origin)),asphalt);surface.position.z=.12;group.add(surface);
  const angle=THREE.MathUtils.degToRad(45.69),cos=Math.cos(angle),sin=Math.sin(angle);
  const point=(u,v)=>[u*cos-v*sin,u*sin+v*cos];
  for(const v of [-28,0,28]){
    for(let u=-48;u<=48;u+=6){const [x,y]=point(u,v);addBox(group,marking,.16,5,.035,x,y,.17,angle);}
    const [x,y]=point(0,v);addBox(group,curb,104,.16,.14,x,y,.19,angle);
  }
  for(let i=0;i<16;i++){
    const row=i%2===0?-14:14,u=-42+(i%8)*12,[x,y]=point(u,row);
    const car=new THREE.MeshStandardMaterial({color:carColors[i%carColors.length],roughness:.7});
    addBox(group,car,4.2,1.8,1.25,x,y,.85,angle+(i%3===0?Math.PI:0));
    addBox(group,new THREE.MeshStandardMaterial({color:0xa9cbd1,roughness:.3}),2.1,1.5,.45,x,y,1.62,angle+(i%3===0?Math.PI:0));
  }
  return group;
}

function createEventModel(){
  const group=new THREE.Group();group.name='Village départ et arrivée';group.rotation.z=THREE.MathUtils.degToRad(-17);
  const orange=new THREE.MeshStandardMaterial({color:0xf36c21,roughness:.75});
  const blue=new THREE.MeshStandardMaterial({color:0x1769d2,roughness:.75});
  const dark=new THREE.MeshStandardMaterial({color:0x4d5559,roughness:.9});
  const straw=new THREE.MeshStandardMaterial({color:0xc9a85e,roughness:1});
  addBox(group,dark,10,6,1.1,-53,58,.55);addBox(group,dark,7,1.2,2.5,-53,60.5,2.35);
  addTent(group,-5,67,18,6,0x1769d2);addTent(group,15,67,18,6,0x1769d2);addTent(group,42,62,6,3,0xf4f0df);
  addTent(group,66,40,4,4,0xf4f0df);addTent(group,66,34,4,4,0xf4f0df);addTent(group,70,16,4,4,0xf4f0df);addTent(group,70,7,3,3,0xf4f0df);addTent(group,72,-8,6,4,0x1769d2);
  addTent(group,-35,-7,3,3,0xf4f0df);addTent(group,-15,-8,3,3,0xf4f0df);addTent(group,1,-8,3,3,0xf4f0df);addTent(group,-65,-36,8,4,0xf4f0df);addTent(group,-6,-48,6,3,0xf4f0df);addTent(group,-20,-62,4,4,0xf4f0df);
  addBox(group,orange,.8,.8,5.8,-3,0,2.9);addBox(group,orange,.8,.8,5.8,3,0,2.9);addBox(group,orange,6.8,.8,.9,0,0,5.45);
  addBox(group,orange,1.8,.4,.4,0,0,6.25,0);addBox(group,straw,34,38,.14,-45,-25,.07);
  for(const x of [-1,9])addBox(group,orange,.18,92,.12,x,-19,.09);
  for(let i=0;i<14;i++){
    const angle=i*.85,radius=8+(i%4)*4,x=-10+Math.cos(angle)*radius,y=30+Math.sin(angle)*radius;
    const table=new THREE.Mesh(new THREE.CylinderGeometry(1.05,1.05,.12,12),dark);table.geometry.rotateX(Math.PI/2);table.position.set(x,y,1.05);group.add(table);addBox(group,dark,.18,.18,1,x,y,.5);
  }
  addBox(group,blue,22,.6,1.2,8,70,1.1);addBox(group,orange,18,.35,.75,25,-55,.6);
  return group;
}

export function createLandscapeLayer(data,maplibregl,landmarks){
  const trees=data.trees.slice(0,MAX_TREES),buildings=data.buildings.slice(0,MAX_BUILDINGS);
  return {
    id:'three-landscape',type:'custom',renderingMode:'3d',treesVisible:true,buildingsVisible:true,eventVisible:true,
    onAdd(map,gl){
      this.map=map;this.camera=new THREE.Camera();this.scene=new THREE.Scene();
      this.origin=maplibregl.MercatorCoordinate.fromLngLat(map.getCenter());
      this.unit=this.origin.meterInMercatorCoordinateUnits();
      this.scene.add(new THREE.HemisphereLight(0xe9f3ff,0x4c5734,1.65));
      const sun=new THREE.DirectionalLight(0xffefd0,2.45);sun.position.set(-280,-420,700);this.scene.add(sun);
      this.castle=createCastleModel();this.eventVillage=createEventModel();this.hall=createLandebaudiereHall();this.parking=createLandebaudiereParking();
      this.scene.add(this.castle,this.eventVillage,this.hall,this.parking);
      const trunkGeometry=new THREE.CylinderGeometry(.2,.38,1,5);trunkGeometry.rotateX(Math.PI/2);
      const trunkMaterial=new THREE.MeshStandardMaterial({color:0x675040,roughness:1});
      const crownGeometry=new THREE.IcosahedronGeometry(1,1);
      const crownMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true});
      this.trunks=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,trees.length);
      this.crowns=new THREE.InstancedMesh(crownGeometry,crownMaterial,trees.length*3);
      const wallMaterial=new THREE.MeshStandardMaterial({color:0xc9c0d4,roughness:1,flatShading:true});
      const roofMaterial=new THREE.MeshStandardMaterial({color:0x89769f,roughness:1,flatShading:true});
      this.walls=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),wallMaterial,buildings.length);
      const roofGeometry=new THREE.ConeGeometry(1,1,4);roofGeometry.rotateX(Math.PI/2);roofGeometry.rotateZ(Math.PI/4);
      this.roofs=new THREE.InstancedMesh(roofGeometry,roofMaterial,buildings.length);
      for(const mesh of [this.trunks,this.crowns,this.walls,this.roofs]){mesh.frustumCulled=false;this.scene.add(mesh);}
      this.object=new THREE.Object3D();this.lastElevations=[];
      this.update=()=>this.updateInstances();map.on('idle',this.update);map.on('terrain',this.update);
      this.renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl,antialias:true});
      this.renderer.autoClear=false;this.updateInstances();
    },
    localPosition(lon,lat,elevation){
      const at=maplibregl.MercatorCoordinate.fromLngLat([lon,lat],elevation||0);
      return [(at.x-this.origin.x)/this.unit,(this.origin.y-at.y)/this.unit,at.z/this.unit];
    },
    updateInstances(){
      const o=this.object,color=new THREE.Color();let changed=false,index=0;
      trees.forEach((tree,i)=>{
        const elevation=this.map.queryTerrainElevation([tree.lon,tree.lat]);
        if(this.lastElevations[index]!==elevation){changed=true;this.lastElevations[index]=elevation;}index++;
        const [x,y,z]=this.localPosition(tree.lon,tree.lat,elevation);
        const h=elevation===null?0:tree.height,r=tree.radius;
        o.position.set(x,y,z+h*.28);o.rotation.set(0,0,0);o.scale.set(1,1,h*.56);o.updateMatrix();this.trunks.setMatrixAt(i,o.matrix);
        for(let j=0;j<3;j++){
          const angle=i*2.39996+j*2.094,size=j===0?1:.78;
          o.position.set(x+Math.cos(angle)*r*.28,y+Math.sin(angle)*r*.28,z+h*(.59+j*.11));o.rotation.set(0,0,angle);o.scale.set(r*size,r*.9*size,h*.25*size);if(!h)o.scale.set(0,0,0);o.updateMatrix();this.crowns.setMatrixAt(i*3+j,o.matrix);
          color.setHSL(.25+tree.tone*.06,.35+tree.tone*.18,.24+tree.tone*.1);this.crowns.setColorAt(i*3+j,color);
        }
      });
      buildings.forEach((building,i)=>{
        const elevation=this.map.queryTerrainElevation([building.lon,building.lat]);
        if(this.lastElevations[index]!==elevation){changed=true;this.lastElevations[index]=elevation;}index++;
        const [x,y,z]=this.localPosition(building.lon,building.lat,elevation),h=elevation===null?0:building.height;
        o.position.set(x,y,z+h/2);o.rotation.set(0,0,building.rotation);o.scale.set(building.width,building.depth,h);if(!h)o.scale.set(0,0,0);o.updateMatrix();this.walls.setMatrixAt(i,o.matrix);
        const roofH=Math.min(4,Math.max(1.5,h*.28));o.position.set(x,y,z+h+roofH/2);o.rotation.set(0,0,building.rotation);o.scale.set(building.width*.72,building.depth*.72,roofH);if(!h)o.scale.set(0,0,0);o.updateMatrix();this.roofs.setMatrixAt(i,o.matrix);
      });
      const placeLandmark=(group,coordinate)=>{
        const elevation=this.map.queryTerrainElevation(coordinate);
        if(this.lastElevations[index]!==elevation){changed=true;this.lastElevations[index]=elevation;}index++;
        const [x,y,z]=this.localPosition(coordinate[0],coordinate[1],elevation);group.position.set(x,y,z);group.userData.terrainReady=elevation!==null;
      };
      placeLandmark(this.castle,landmarks.castle);placeLandmark(this.eventVillage,landmarks.event);
      placeLandmark(this.hall,landmarks.hall);placeLandmark(this.parking,landmarks.parking);
      for(const mesh of [this.trunks,this.crowns,this.walls,this.roofs])mesh.instanceMatrix.needsUpdate=true;
      if(this.crowns.instanceColor)this.crowns.instanceColor.needsUpdate=true;
      if(changed)this.map.triggerRepaint();
    },
    render(gl,args){
      this.trunks.visible=this.crowns.visible=this.treesVisible;
      this.walls.visible=this.roofs.visible=this.buildingsVisible;
      this.castle.visible=this.buildingsVisible&&this.castle.userData.terrainReady!==false;
      this.hall.visible=this.buildingsVisible&&this.hall.userData.terrainReady!==false;
      this.parking.visible=this.buildingsVisible&&this.parking.userData.terrainReady!==false;
      this.eventVillage.visible=this.eventVisible&&this.eventVillage.userData.terrainReady!==false;
      if(!this.map.getTerrain())return;
      const projection=new THREE.Matrix4().fromArray(args.defaultProjectionData?.mainMatrix||args);
      const transform=new THREE.Matrix4().makeTranslation(this.origin.x,this.origin.y,0).scale(new THREE.Vector3(this.unit,-this.unit,this.unit));
      this.camera.projectionMatrix=projection.multiply(transform);
      this.renderer.resetState();this.renderer.render(this.scene,this.camera);
    },
    onRemove(){
      this.map.off('idle',this.update);this.map.off('terrain',this.update);
      for(const mesh of [this.trunks,this.crowns,this.walls,this.roofs]){mesh.geometry.dispose();mesh.material.dispose();mesh.dispose();}
      for(const group of [this.castle,this.eventVillage,this.hall,this.parking])group.traverse(object=>{if(object.isMesh){object.geometry.dispose();object.material.dispose();}});
      this.renderer.dispose();
    }
  };
}
