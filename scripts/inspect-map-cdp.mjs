import {writeFileSync} from 'node:fs';
const port=process.argv[2];
const targets=await fetch(`http://localhost:${port}/json/list`).then(response=>response.json());
const target=targets.find(item=>item.type==='page'&&item.url.startsWith('http://localhost:3000/'));
if(!target)throw Error('Page locale introuvable.');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
let id=0;const pending=new Map();
socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const task=pending.get(message.id);if(!task)return;pending.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});socket.send(JSON.stringify({id:requestId,method,params}));});
await send('Runtime.enable');
const result=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const map=window.__gaubretrailMap;return JSON.stringify({
  workerUrl:window.__maplibreWorkerUrl,
  map:map?{loaded:map.loaded(),styleLoaded:map.isStyleLoaded(),tilesLoaded:map.areTilesLoaded(),sources:Object.fromEntries(Object.keys(map.getStyle().sources).map(id=>[id,map.isSourceLoaded(id)])),routeFeatures:map.querySourceFeatures('route-42').length}:null
})})()`});
process.stdout.write(result.result.value+'\n');
const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
writeFileSync('map-cdp-fixed.png',Buffer.from(screenshot.data,'base64'));
socket.close();
