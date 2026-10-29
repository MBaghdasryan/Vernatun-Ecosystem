import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLatestRequestGuard} from './latest-request';

function deferred<T>(){
 let resolve!:(value:T)=>void;
 const promise=new Promise<T>(done=>{resolve=done});
 return {promise,resolve};
}

test('a slower analytics response cannot replace the current period or monthly values',async()=>{
 const guard=createLatestRequestGuard();
 const oldRequest=deferred<{period:string;monthly:number[]}>();
 const currentRequest=deferred<{period:string;monthly:number[]}>();
 let visible:{period:string;monthly:number[]}|undefined;
 const commit=(id:number,result:{period:string;monthly:number[]})=>{
  if(guard.isLatest(id))visible=result;
 };

 const oldId=guard.begin();
 const oldLoad=oldRequest.promise.then(result=>commit(oldId,result));
 const currentId=guard.begin();
 const currentLoad=currentRequest.promise.then(result=>commit(currentId,result));

 currentRequest.resolve({period:'2026-02 · USD',monthly:[230,410]});
 await currentLoad;
 oldRequest.resolve({period:'2026-01 · AMD',monthly:[75]});
 await oldLoad;

 assert.deepEqual(visible,{period:'2026-02 · USD',monthly:[230,410]});
});
