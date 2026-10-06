export async function prepareOfflineShell(){
 if(!('serviceWorker' in navigator))throw new Error('offline_shell_unavailable');
 await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}hayat-sw.js`,{scope:import.meta.env.BASE_URL});
 const registration=await navigator.serviceWorker.ready;
 const urls=[location.href,new URL('hayat',new URL(import.meta.env.BASE_URL,location.origin)).href,
  ...performance.getEntriesByType('resource').map(r=>r.name),...Array.from(document.images).map(i=>i.currentSrc||i.src)];
 await new Promise<void>((resolve,reject)=>{
  const channel=new MessageChannel(),timeout=setTimeout(()=>reject(new Error('offline_shell_timeout')),30000);
  channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();event.data?.ok?resolve():reject(new Error('offline_shell_unavailable'))};
  registration.active?.postMessage({type:'HAYAT_WARM',urls:[...new Set(urls)]},[channel.port2]);
 });
}
