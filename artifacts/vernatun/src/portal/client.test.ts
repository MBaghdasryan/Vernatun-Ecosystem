import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request,ApiClientError,uploadDocument,syncPhoto,syncTransition,verifySyncScope} from './client';
import {identityKey,identity} from '../hayat/offline-store';

test('API client distinguishes outages, proxy HTML, errors and empty responses',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw new TypeError('offline')};
  await assert.rejects(request('/auth/session'),e=>e instanceof ApiClientError&&e.code==='connection'&&e.status===0);
  globalThis.fetch=async()=>new Response('<html>Bad gateway</html>',{status:502,headers:{'Content-Type':'text/html'}});
  await assert.rejects(request('/auth/session'),e=>e instanceof ApiClientError&&e.code==='service_unavailable');
  // A proxy must never masquerade as a successful anonymous session.
  globalThis.fetch=async()=>new Response('<html>Landing</html>',{status:200,headers:{'Content-Type':'text/html'}});
  await assert.rejects(request('/auth/session'),e=>e instanceof ApiClientError&&e.code==='service_unavailable');
  globalThis.fetch=async()=>new Response('{"error":"forbidden"}',{status:403,headers:{'Content-Type':'application/json'}});
  await assert.rejects(request('/units'),e=>e instanceof ApiClientError&&e.code==='forbidden'&&e.status===403);
  globalThis.fetch=async()=>new Response(null,{status:204});
  assert.equal(await request('/auth/logout','POST'),null);
  globalThis.fetch=async()=>{throw new TypeError('offline')};
  await assert.rejects(uploadDocument(new URLSearchParams(),new File(['document'],'test.txt')),e=>e instanceof ApiClientError&&e.code==='connection');
 }finally{globalThis.fetch=original}
});

test('bootstrap shares StrictMode request and subsequent mutation uses issued CSRF',async()=>{
 const original=globalThis.fetch;
 let count=0;
 try{
  globalThis.fetch=async(_url,init)=>{
   count++;
   if(init?.method==='GET')return new Response('{"csrf":"test-csrf","user":null,"contexts":[]}',{headers:{'Content-Type':'application/json'}});
   assert.equal((init?.headers as Record<string,string>)['X-CSRF-Token'],'test-csrf');
   assert.equal(init?.credentials,'same-origin');
   return new Response(null,{status:204});
  };
  await Promise.all([request('/auth/session'),request('/auth/session')]);
  assert.equal(count,1);
  await request('/auth/logout','POST');
  assert.equal(count,2);
 }finally{globalThis.fetch=original}
});

test('offline synchronization pins user/context and refuses changed identity or revoked access',async()=>{
 const originalFetch=globalThis.fetch,priorStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const entries=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
  getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>entries.set(key,value),removeItem:(key:string)=>entries.delete(key),
 }});
 const scope={userId:'user-a',contextId:'context-a'};
 entries.set(identityKey,JSON.stringify(scope));
 let posts=0;
 try{
  globalThis.fetch=async(_url,init)=>{
   if(init?.method==='GET')return new Response(JSON.stringify({user:{id:scope.userId},contextId:scope.contextId,contexts:[{id:scope.contextId}],csrf:'fixture-token'}),{headers:{'Content-Type':'application/json'}});
   posts++;
   const h=init?.headers as Record<string,string>;
   assert.equal(h['X-Hayat-User'],scope.userId);assert.equal(h['X-Hayat-Context'],scope.contextId);
   assert.equal(h['X-CSRF-Token'],'fixture-token');
   if(h['Content-Type']==='application/octet-stream'){
    assert.equal(h['X-Operation-Key'],'immutable-photo-key');assert.equal(h['X-Work-Version'],'3');
   }
   return new Response('{"id":"result"}',{headers:{'Content-Type':'application/json'}});
  };
  await verifySyncScope(scope);
  await syncTransition(scope,'requests','work',{key:'immutable-report-key',version:3,action:'report',note:'Report'});
  await syncPhoto(scope,'requests','work',new File(['bytes'],'photo.png',{type:'image/png'}),'immutable-photo-key',3);
  assert.equal(posts,2);
  entries.set(identityKey,JSON.stringify({userId:'user-b',contextId:'context-b'}));
  assert.throws(()=>syncTransition(scope,'requests','work',{}),e=>e instanceof ApiClientError&&e.code==='scope_changed');
  await assert.rejects(verifySyncScope(scope),e=>e instanceof ApiClientError&&e.code==='scope_changed');
  assert.equal(posts,2);
  entries.set(identityKey,JSON.stringify(scope));
  globalThis.fetch=async()=>new Response('{"error":"forbidden"}',{status:403,headers:{'Content-Type':'application/json'}});
  await assert.rejects(request('/requests/33333333-3333-4333-8333-333333333333'));
  assert.equal(identity(),undefined);
 }finally{
  globalThis.fetch=originalFetch;
  if(priorStorage)Object.defineProperty(globalThis,'localStorage',priorStorage);else Reflect.deleteProperty(globalThis,'localStorage');
 }
});
