let pending:any;
const listeners=new Set<(value:any)=>void>();
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pending=event;for(const listener of listeners)listener(pending)});
window.addEventListener('appinstalled',()=>{pending=undefined;for(const listener of listeners)listener(undefined)});
export function installPrompt(){return pending}
export function listenInstall(listener:(value:any)=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
export function clearInstallPrompt(){pending=undefined;for(const listener of listeners)listener(undefined)}
const link=document.createElement('link');link.rel='manifest';link.href=import.meta.env.BASE_URL+'manifest.webmanifest';document.head.appendChild(link);
