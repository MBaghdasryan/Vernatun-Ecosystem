export function intervalCovered(from:number,to:number,shifts:ReadonlyArray<{starts_at:Date|string;ends_at:Date|string}>){
 let end=from;
 for(const s of [...shifts].sort((a,b)=>+new Date(a.starts_at)-+new Date(b.starts_at))){
  const a=+new Date(s.starts_at),b=+new Date(s.ends_at);
  if(b<=end)continue;
  if(a>end)return false;
  end=b;if(end>=to)return true;
 }
 return false;
}
