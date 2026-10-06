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
 let response:Response;
 try{response=await fetch('/api'+path,{...init,credentials:'same-origin',signal:AbortSignal.timeout(30000)})}
 catch{throw new ApiClientError('connection',0)}
 return decode<T>(response);
}
async function send<T>(path:string,method:string,body?:unknown):Promise<T>{
 return fetchApi<T>(path,{method,headers:{'Content-Type':'application/json',...(method==='GET'?{}:{'X-CSRF-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
export function request<T=unknown>(path:string,method='GET',body?:unknown):Promise<T>{
 // React StrictMode can mount twice. A single bootstrap avoids racing two
 // anonymous sessions and pairing the CSRF token with the wrong cookie.
 if(path==='/auth/session'&&method==='GET'){
  sessionRequest??=send(path,method,body).finally(()=>{sessionRequest=undefined});
  return sessionRequest as Promise<T>;
 }
 return send<T>(path,method,body);
}

export async function uploadPhoto(id:string,file:File,kind:'requests'|'defects'='requests'){return fetchApi<any>(`/${kind}/${id}/photos`,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf},body:file});}

export async function uploadImport(query:URLSearchParams,file:File){return fetchApi<any>("/imports/preview?"+query,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf},body:file});}

export async function uploadDocument(query:URLSearchParams,file:File){return fetchApi<any>("/documents?"+query,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-CSRF-Token":csrf},body:file});}
