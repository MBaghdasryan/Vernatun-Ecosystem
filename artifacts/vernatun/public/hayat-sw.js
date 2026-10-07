/* Static shell only. Never intercept or cache API, private files or user data. */
const CACHE='vernatun-static-v2';
const ROOT=new URL(self.registration.scope);
const asset=(path)=>new URL(path,ROOT).href;
function safeStatic(url){
 if(url.username||url.password||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname)||url.search)return false;
 const p=url.pathname.slice(ROOT.pathname.length);
 return p==='offline.html'||p==='manifest.webmanifest'||/^assets\/[\w./-]+\.(?:js|css|png|jpe?g|webp|svg|ico|woff2?|ttf)$/i.test(p);
}
function cacheable(r){return r.ok&&!r.redirected&&!/private|no-store/i.test(r.headers.get('cache-control')||'')}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 for(const p of ['offline.html','manifest.webmanifest','assets/pwa-192.png','assets/pwa-512.png']){
  try{const r=await fetch(asset(p));if(cacheable(r))await cache.put(asset(p),r)}catch{}
 }
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const k of await caches.keys())if(k.startsWith('hayat-shell-')||k.startsWith('vernatun-static-')&&k!==CACHE)await caches.delete(k);
 await self.clients.claim();
})()));
self.addEventListener('message',event=>{
 if(event.data?.type!=='HAYAT_WARM')return;
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);let failed=false;
  // This is the public SPA HTML, not a personalized/financial page response.
  try{const r=await fetch(ROOT.href);if(!cacheable(r)||!r.headers.get('content-type')?.includes('text/html'))throw new Error('shell_unavailable');await cache.put(ROOT.href,r)}catch{failed=true}
  for(const entry of event.data.urls??[]){
   let url;try{url=new URL(entry,ROOT)}catch{continue}
   if(!safeStatic(url))continue;
   try{const r=await fetch(url);if(!cacheable(r))throw new Error('asset_unavailable');await cache.put(url.href,r)}catch{failed=true}
  }
  event.ports[0]?.postMessage({ok:!failed});
 })());
});
self.addEventListener('fetch',event=>{
 const r=event.request,url=new URL(r.url);
 if(r.method!=='GET'||url.origin!==ROOT.origin)return;
 if(r.mode==='navigate'&&url.pathname.startsWith(ROOT.pathname)){
  const p=url.pathname.slice(ROOT.pathname.length);
  if(/^(?:api|__|storage|private)(?:\/|$)/.test(p))return;
  event.respondWith((async()=>{
   try{return await fetch(r)}catch{
    const cache=await caches.open(CACHE);
    const shell=/^(?:hayat|imtun)(?:\/|$)/.test(p)?await cache.match(ROOT.href):null;
    return shell||await cache.match(asset('offline.html'))||new Response('Offline — no private data cached',{status:503,headers:{'Content-Type':'text/plain'}});
   }
  })());return;
 }
 if(!safeStatic(url))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{const response=await fetch(r);if(cacheable(response))await cache.put(r,response.clone());return response}
  catch(error){const cached=await cache.match(r);if(cached)return cached;throw error}
 })());
});
