import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
export function publicIPv4(address:string){
 const a=address.split('.').map(Number);
 if(a.length!==4||a.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 return !(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||a[0]===169&&a[1]===254||
  a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&(a[1]===168||a[1]===0||a[1]===2)||
  a[0]===100&&a[1]>=64&&a[1]<=127||a[0]===198&&[18,19,51].includes(a[1])||a[0]===203&&a[1]===0&&a[2]===113);
}
export async function publicHost(hostname:string){
 if(!hostname||hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local'))throw Error('unsafe_destination');
 let timer:ReturnType<typeof setTimeout>|undefined;
 const addresses=await Promise.race([lookup(hostname,{all:true,family:4}),new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),5000)})]).finally(()=>clearTimeout(timer));
 if(!addresses.length||addresses.some(x=>!publicIPv4(x.address)))throw Error('unsafe_destination');
 return addresses[0].address;
}
export async function signedWebhookPost(url:string,body:string,headers:Record<string,string>){
 const u=new URL(url);
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443')throw Error('unsafe_destination');
 const address=await publicHost(u.hostname);
 return new Promise<number>((resolve,reject)=>{
  const req=request({hostname:u.hostname,port:443,path:u.pathname+u.search,method:'POST',
   lookup:((_h:unknown,_o:unknown,cb:any)=>cb(null,address,4)) as any,
   headers:{...headers,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
    let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>8192)req.destroy(Error('response_too_large'))});
    res.on('end',()=>resolve(res.statusCode??0));res.on('error',reject);
   });
  const timer=setTimeout(()=>req.destroy(Error('timeout')),7000);timer.unref();
  req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end(body);
 });
}
