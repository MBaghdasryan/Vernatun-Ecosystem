import {cacheKey,forgetSession,get,identity,logoutKey,offlineSession,rememberSession,sameScope,update,type Scope} from '../hayat/offline-store';
import type {AuthState} from './types';
let csrf='';
let sessionRequest:Promise<unknown>|undefined;
export class ApiClientError extends Error{constructor(public code:string,public status:number,public fields?:Record<string,string>){super(code)}}
async function decode<T>(response:Response):Promise<T>{
 if(response.status===204)return null as T;
 if(!response.headers.get('Content-Type')?.includes('application/json'))
  throw new ApiClientError('service_unavailable',response.status);
 const data=await response.json().catch(()=>{throw new ApiClientError('service_unavailable',response.status)});
 if(!response.ok)throw new ApiClientError(data?.error??(response.status>=500?'service_unavailable':'generic'),response.status,data?.fields);
 if(data?.csrf)csrf=data.csrf;
 return data as T;
}
async function fetchApi<T>(path:string,init:RequestInit):Promise<T>{
 if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new ApiClientError('connection',0);
 let response:Response;
 try{response=await fetch('/api'+path,{...init,credentials:'same-origin',signal:AbortSignal.timeout(30000)})}
 catch{throw new ApiClientError('connection',0)}
 return decode<T>(response);
}
async function send<T>(path:string,method:string,body?:unknown):Promise<T>{
 return fetchApi<T>(path,{method,headers:{'Content-Type':'application/json',...(method==='GET'?{}:{'X-CSRF-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function managed<T>(path:string,method:string,body?:unknown):Promise<T>{
 const scope=identity();
 const storage=typeof localStorage==='undefined'?undefined:localStorage;
 if(path==='/auth/logout'){
  storage?.setItem(logoutKey,'true');forgetSession();
  if(typeof window!=='undefined')window.dispatchEvent(new Event('hayat-identity'));
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return null as T;
 }
 const cacheable=method==='GET'&&(/^\/hayat\/queue\?/.test(path)||/^\/(requests|defects)\/[a-f0-9-]{36}$/.test(path));
 try{
  if(path==='/auth/session'&&storage?.getItem(logoutKey)){
   // An offline logout must not be undone by the still-live server cookie.
   const prior=await send<AuthState>('/auth/session','GET');
   if(prior.user)await send('/auth/logout','POST');
   storage.removeItem(logoutKey);
  }
  const result=await send<T>(path,method,body);
  if(path==='/auth/logout'||path==='/auth/login')storage?.removeItem(logoutKey);
  if(path==='/auth/session'||path==='/auth/login'){
   if(!storage?.getItem(logoutKey))await rememberSession(result as AuthState).catch(()=>{});
  }else if(path==='/auth/context'){
   // Re-read server identity after a successful context switch.
   const session=await send<AuthState>('/auth/session','GET');
   await rememberSession(session);
  }else if(cacheable&&scope&&sameScope(scope,identity())){
   await update(cacheKey(scope,path),()=>result).catch(()=>{});
  }
  return result;
 }catch(e){
  if(e instanceof ApiClientError&&(e.status===401||e.status===403)&&path!=='/auth/login'){
   forgetSession();
   if(typeof window!=='undefined')window.dispatchEvent(new Event('hayat-identity'));
  }
  // Authorization and server errors must NEVER be replaced by cached access.
  if(e instanceof ApiClientError&&e.code==='connection'){
   if(path==='/auth/session'){
    const saved=await offlineSession().catch(()=>undefined);
    if(saved)return saved as T;
   }
   if(cacheable&&scope&&sameScope(scope,identity())){
    const cached=await get<T>(cacheKey(scope,path)).catch(()=>undefined);
    if(cached!==undefined){window.dispatchEvent(new Event('hayat-offline-cache'));return cached}
   }
  }
  throw e;
 }
}
export function request<T=unknown>(path:string,method='GET',body?:unknown):Promise<T>{
 // React StrictMode can mount twice. A single bootstrap avoids racing two
 // anonymous sessions and pairing the CSRF token with the wrong cookie.
 if(path==='/auth/session'&&method==='GET'){
  sessionRequest??=managed(path,method,body).finally(()=>{sessionRequest=undefined});
  return sessionRequest as Promise<T>;
 }
 return managed<T>(path,method,body);
}

// The server also checks these headers: a cookie/context change in another tab
// cannot send a queued operation under the wrong account.
export async function verifySyncScope(scope:Scope){
 if(!sameScope(scope,identity()))throw new ApiClientError('scope_changed',403);
 const s=await request<AuthState>('/auth/session');
 if(!s.csrf)throw new ApiClientError('connection',0);
 if(s.user?.id!==scope.userId||s.contextId!==scope.contextId||!s.contexts.some(c=>c.id===scope.contextId)){
  throw new ApiClientError('scope_changed',403);
 }
}
function scopedHeaders(scope:Scope){
 if(!sameScope(scope,identity()))throw new ApiClientError('scope_changed',403);
 return {'X-Hayat-User':scope.userId,'X-Hayat-Context':scope.contextId,'X-CSRF-Token':csrf};
}
export function syncTransition(scope:Scope,kind:string,id:string,body:unknown){
 return fetchApi<any>(`/${kind}/${id}/transition`,{method:'POST',headers:{'Content-Type':'application/json',...scopedHeaders(scope)},body:JSON.stringify(body)});
}
export function syncPhoto(scope:Scope,kind:string,id:string,file:File,key:string,version:number){
 return fetchApi<any>(`/${kind}/${id}/photos`,{method:'POST',headers:{'Content-Type':'application/octet-stream',...scopedHeaders(scope),'X-Operation-Key':key,'X-Work-Version':String(version)},body:file});
}

export async function uploadIncidentAttachment(id:string,file:File,opts?:{key:string;version?:number}){return fetchApi<any>(`/incidents/${id}/attachments`,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf,...(opts?{"X-Operation-Key":opts.key,...(opts.version!=null?{"X-Work-Version":String(opts.version)}:{})}:{})},body:file});}

export async function uploadPhoto(id:string,file:File,kind:'requests'|'defects'='requests',photoType?:'before'|'during'|'after'|'evidence',opts?:{key:string;version?:number}){return fetchApi<any>(`/${kind}/${id}/photos${photoType?'?photoType='+photoType:''}`,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf,...(opts?{"X-Operation-Key":opts.key,...(opts.version!=null?{"X-Work-Version":String(opts.version)}:{})}:{})},body:file});}

export async function uploadImport(query:URLSearchParams,file:File){return fetchApi<any>("/imports/preview?"+query,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf},body:file});}

export async function uploadDocumentVersion(id:string,query:URLSearchParams,file:File){return fetchApi<any>("/documents/"+encodeURIComponent(id)+"/versions?"+query,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf},body:file});}
export async function uploadDocument(query:URLSearchParams,file:File){return fetchApi<any>("/documents?"+query,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf},body:file});}
