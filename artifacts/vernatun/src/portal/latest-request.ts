export function createLatestRequestGuard() {
 let generation=0;
 return {
  begin(){return ++generation},
  isLatest(request:number){return request===generation},
  invalidate(){generation++},
 };
}
