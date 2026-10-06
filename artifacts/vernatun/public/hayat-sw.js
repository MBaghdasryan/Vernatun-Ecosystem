/* Cache the app shell/assets only. Auth/API/private photos are never cached here. */
const CACHE='hayat-shell-v1';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function safe(url){
 return url.origin===self.location.origin&&!url.pathname.startsWith('/api')&&
  !url.pathname.startsWith('/__')&&!url.pathname.includes('hot-update')&&
  url.pathname!=='/hayat-sw.js';
}
self.addEventListener('message',event=>{
 if(event.data?.type!=='HAYAT_WARM')return;
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  let failed=false;
  for(const entry of event.data.urls??[]){
   const url=new URL(entry,self.location.origin);
   if(!safe(url))continue;
   try{const r=await fetch(url);if(!r.ok)throw new Error('asset_unavailable');await cache.put(url,r)}catch{failed=true}
  }
  event.ports[0]?.postMessage({ok:!failed});
 })());
});
self.addEventListener('fetch',event=>{
 const r=event.request,url=new URL(r.url);
 if(r.method!=='GET'||!safe(url))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   const response=await fetch(r);
   if(response.ok)await cache.put(r,response.clone());
   return response;
  }catch(error){
   const cached=await cache.match(r);
   if(cached)return cached;
   if(r.mode==='navigate'&&url.pathname.startsWith('/hayat')){
    const shell=await cache.match(new URL('/hayat',self.location.origin));
    if(shell)return shell;
   }
   throw error;
  }
 })());
});
