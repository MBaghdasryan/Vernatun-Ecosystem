import type {AuthState} from '../portal/types';

// Browser-only durable data. No passwords, cookies or CSRF tokens are stored.
const DB = 'vernatun-hayat-offline';
export const identityKey = 'vernatun.hayat.identity';
export const logoutKey = 'vernatun.hayat.logout-pending';
export type Scope = {userId:string; contextId:string};
export type Check = {text:string; done:boolean};
export type Work = Record<string,any>;
export type Draft = {note:string; checklist:Check[]; version:number; key:string};
export type Pending = {key:string; action:'start'|'report'; version:number; note:string; checklist?:Check[]};
export type LocalWork = {
  snapshot:Work; draft:Draft; photos:{key:string; file:File; version:number; attempted?:boolean}[];
  pending?:Pending; pendingFailure?:string; savedAt:number;
};
let database:Promise<IDBDatabase>|undefined;
function open(){
  if(typeof indexedDB==='undefined')return Promise.reject(new Error('storage_unavailable'));
  database??=new Promise<IDBDatabase>((resolve,reject)=>{
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>r.result.createObjectStore('data');
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>{database=undefined;reject(r.error)};
  });
  return database;
}
export async function get<T>(key:string):Promise<T|undefined>{
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('data','readonly'),r=tx.objectStore('data').get(key);
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export async function update<T>(key:string,change:(old:T|undefined)=>T|undefined):Promise<T|undefined>{
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('data','readwrite'),store=tx.objectStore('data'),r=store.get(key);
    let value:T|undefined;
    r.onsuccess=()=>{try{value=change(r.result);if(value===undefined)store.delete(key);else store.put(value,key)}catch(e){tx.abort();reject(e)}};
    tx.oncomplete=()=>resolve(value);
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('storage_unavailable'));
  });
}
export const workKey=(s:Scope,kind:string,id:string)=>`work:${s.userId}:${s.contextId}:${kind}:${id}`;
export const cacheKey=(s:Scope,path:string)=>`cache:${s.userId}:${s.contextId}:${path}`;
export function identity():Scope|undefined{
  try{return JSON.parse(localStorage.getItem(identityKey)??'null')??undefined}catch{return undefined}
}
export function sameScope(a:Scope|undefined,b:Scope|undefined){
  return !!a&&!!b&&a.userId===b.userId&&a.contextId===b.contextId;
}
export async function rememberSession(s:AuthState){
  if(!s.user||!s.contextId){forgetSession();return}
  const scope={userId:s.user.id,contextId:s.contextId};
  // Store the marker before asynchronous IDB work, so stale tabs cannot sync.
  localStorage.setItem(identityKey,JSON.stringify(scope));
  await update('session',()=>({state:{...s,csrf:''},savedAt:Date.now(),scope}));
}
export function forgetSession(){
  if(typeof localStorage!=='undefined')localStorage.removeItem(identityKey);
  // Leave work drafts intact, but never bootstrap them after an explicit logout.
}
export async function offlineSession():Promise<AuthState|undefined>{
  if(typeof localStorage!=='undefined'&&localStorage.getItem(logoutKey))return;
  const saved=await get<{state:AuthState;savedAt:number;scope:Scope}>('session');
  if(!saved||!sameScope(saved.scope,identity())||Date.now()-saved.savedAt>24*60*60*1000)return;
  const contexts=saved.state.contexts.filter(c=>!c.expires_at||Date.parse(c.expires_at)>Date.now());
  if(!contexts.some(c=>c.id===saved.scope.contextId))return;
  return {...saved.state,contexts,csrf:''};
}
