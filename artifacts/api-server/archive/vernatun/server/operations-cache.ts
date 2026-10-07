export interface CacheProvider{
 readonly name:string;
 get<T>(namespace:string,key:string):Promise<T|undefined>;
 set<T>(namespace:string,key:string,value:T,ttlSeconds:number):Promise<void>;
 clear(namespace:string):Promise<number>;
}
export class MemoryCacheProvider implements CacheProvider{
 readonly name='memory';
 private entries=new Map<string,{value:unknown;until:number}>();
 async get<T>(namespace:string,key:string):Promise<T|undefined>{
  const k=namespace+':'+key,e=this.entries.get(k);
  if(!e)return;
  if(e.until<=Date.now()){this.entries.delete(k);return}
  return e.value as T;
 }
 async set<T>(namespace:string,key:string,value:T,ttlSeconds:number){
  this.entries.set(namespace+':'+key,{value,until:Date.now()+ttlSeconds*1000});
 }
 async clear(namespace:string){
  let n=0;for(const k of this.entries.keys())if(k.startsWith(namespace+':')){this.entries.delete(k);n++}
  return n;
 }
 count(namespace:string){
  let n=0;for(const [k,e] of this.entries){if(e.until<=Date.now())this.entries.delete(k);else if(k.startsWith(namespace+':'))n++}return n;
 }
}
// Adapter boundary for a future configured Redis client. No Redis connection is
// implied by defining it. Namespace clearing must be prefix-scoped by the client.
export interface RedisCacheClient{
 get(key:string):Promise<string|null>;
 set(key:string,value:string,options:{EX:number}):Promise<unknown>;
 deletePrefix(prefix:string):Promise<number>;
}
export class RedisCacheProvider implements CacheProvider{
 readonly name='redis';
 constructor(private client:RedisCacheClient,private prefix='vernatun-cache:'){}
 async get<T>(ns:string,key:string){const v=await this.client.get(this.prefix+ns+':'+key);return v===null?undefined:JSON.parse(v) as T}
 async set<T>(ns:string,key:string,value:T,ttlSeconds:number){await this.client.set(this.prefix+ns+':'+key,JSON.stringify(value),{EX:ttlSeconds})}
 async clear(ns:string){return this.client.deletePrefix(this.prefix+ns+':')}
}
export const operationsCache=new MemoryCacheProvider();
let generation=0;
let pending:Promise<StorageObservation>|undefined;
type StorageObservation={status:'healthy'|'down'|'degraded'|'unavailable';value:string|null};
export async function clearHealthCache(){
 generation++;return operationsCache.clear('storage-health');
}
export async function cachedStorageHealth(load:()=>Promise<StorageObservation>){
 const cached=await operationsCache.get<StorageObservation>('storage-health','probe');
 if(cached)return cached;
 if(pending)return pending;
 const current=generation;
 pending=(async()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const result=await Promise.race([load(),new Promise<StorageObservation>(resolve=>{
    timer=setTimeout(()=>resolve({status:'degraded',value:'probe_timeout'}),3000);
   })]).catch(()=>({status:'down' as const,value:'probe_failed'}));
   if(current===generation)await operationsCache.set('storage-health','probe',result,60);
   return result;
  }finally{clearTimeout(timer);pending=undefined}
 })();
 return pending;
}
