import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request,ApiClientError,uploadDocument} from './client';

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
