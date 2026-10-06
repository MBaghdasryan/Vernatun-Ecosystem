import {ApiClientError} from './client';
import {ct} from './console-i18n';
import type {Language} from './i18n';
export const errText=(l:Language,e:unknown)=>{const code=e instanceof ApiClientError?e.code:'';const m=code?ct(l,'error_'+code):'';return (m&&!m.startsWith('error_')?m:ct(l,'error'))+(code?' ('+code+')':'')};
export function toMinor(v:string){if(!/^\d+(\.\d{1,2})?$/.test(v))throw new Error('amount');const [n,d='']=v.split('.');return (BigInt(n)*100n+BigInt(d.padEnd(2,'0'))).toString()}
export const fromMinor=(m:string)=>{const b=BigInt(m);return (b/100n)+'.'+String(b%100n).padStart(2,'0')}
export const fmtDate=(v:string|null|undefined,l:Language)=>v?new Date(v).toLocaleString(l==='hy'?'hy-AM':l,{timeZone:'Asia/Yerevan',dateStyle:'medium',timeStyle:v.length>10?'short':undefined}):'—';
const wallClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const wallParts=(date:Date)=>Object.fromEntries(wallClock.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
export function yerevanInput(instant:string){
 const p=wallParts(new Date(instant));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function yerevanInstant(local:string){
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
 if(!m)throw new Error('invalid_datetime');
 const desired=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]??0));
 let instant=desired;
 for(let i=0;i<3;i++){
  const p=wallParts(new Date(instant));
  const actual=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  const difference=desired-actual;if(!difference)break;instant+=difference;
 }
 return new Date(instant).toISOString();
}
