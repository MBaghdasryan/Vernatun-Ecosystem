let csrf='';
let sessionRequest:Promise<unknown>|undefined;
export class ApiClientError extends Error{constructor(public code:string,public status:number,public fields?:Record<string,string>){super(code)}}
async function send<T>(path:string,method:string,body?:unknown):Promise<T>{let response:Response;try{response=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method==='GET'?{}:{'X-CSRF-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})})}catch{throw new ApiClientError('generic',0)}const data=response.status===204?null:await response.json().catch(()=>({error:'generic'}));if(!response.ok)throw new ApiClientError(data?.error??'generic',response.status,data?.fields);if(data?.csrf)csrf=data.csrf;return data as T;}
export function request<T=unknown>(path:string,method='GET',body?:unknown):Promise<T>{
 // React StrictMode can mount twice. A single bootstrap avoids racing two
 // anonymous sessions and pairing the CSRF token with the wrong cookie.
 if(path==='/auth/session'&&method==='GET'){
  sessionRequest??=send(path,method,body).finally(()=>{sessionRequest=undefined});
  return sessionRequest as Promise<T>;
 }
 return send<T>(path,method,body);
}

export async function uploadPhoto(id:string,file:File,kind:'requests'|'defects'='requests'){const r=await fetch(`/api/${kind}/${id}/photos`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf},body:file});const data=await r.json();if(!r.ok)throw new ApiClientError(data.error,r.status);return data;}

export async function uploadImport(query:URLSearchParams,file:File){const r=await fetch("/api/imports/preview?"+query,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf},body:file});const data=await r.json();if(!r.ok)throw new ApiClientError(data.error,r.status);return data;}

export async function uploadDocument(query:URLSearchParams,file:File){const r=await fetch("/api/documents?"+query,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf},body:file});const data=await r.json();if(!r.ok)throw new ApiClientError(data.error,r.status);return data;}
