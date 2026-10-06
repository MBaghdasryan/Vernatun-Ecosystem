// Pure finance parsing helpers: no React, no client imports.
// Money: strict decimal text -> minor units through BigInt, never floats.
export function toMinor(raw:string,decimal:'.'|','='.',signed=false):string|null{
 let s=raw.trim();let neg=false;if(signed&&(s.startsWith('-')||s.startsWith('+'))){neg=s[0]==='-';s=s.slice(1)}
 const sep=decimal==='.'?'\\.':',';const m=new RegExp('^([0-9]{1,14})(?:'+sep+'([0-9]{1,2}))?$').exec(s);if(!m)return null;
 const v=BigInt(m[1])*100n+BigInt((m[2]??'').padEnd(2,'0'));if(v===0n||v>99999999999999n)return null;return (neg?'-':'')+v.toString()}
export function toMinorUnits(raw:string):string|null{const s=raw.trim().replace(/^\+/,'');return /^-?[1-9][0-9]{0,13}$/.test(s)?s:null}
export function fromMinor(v:string):string{const n=BigInt(v);const a=n<0n?-n:n;return (n<0n?'-':'')+(a/100n).toString()+'.'+(a%100n).toString().padStart(2,'0')}
export function validDay(y:number,m:number,d:number){const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d}
export function toDay(raw:string,fmt:'iso'|'dmy'):string|null{const s=raw.trim();let y,m,d;let r;
 if(fmt==='iso'){r=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);if(!r)return null;[y,m,d]=[+r[1],+r[2],+r[3]]}else{r=/^(\d{2})[./](\d{2})[./](\d{4})$/.exec(s);if(!r)return null;[d,m,y]=[+r[1],+r[2],+r[3]]}
 if(!validDay(y,m,d))return null;return String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
// RFC 4180 style parser: BOM, CRLF/LF/CR, quoted fields with doubled quotes, delimiter , ; or tab.
export function detectDelimiter(text:string):string{let inQ=false,c=0,s=0,t=0;for(const ch of text){if(ch==='"')inQ=!inQ;else if(!inQ){if(ch==='\n'||ch==='\r')break;if(ch===',')c++;else if(ch===';')s++;else if(ch==='\t')t++}}return s>c&&s>=t?';':t>c?'\t':','}
export function parseCsv(input:string,delimiter?:string):{rows:string[][];error?:'quote'}{
 const text=input.charCodeAt(0)===0xFEFF?input.slice(1):input;const d=delimiter||detectDelimiter(text);const rows:string[][]=[];let row:string[]=[],f='',q=false,any=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(q){if(ch==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=ch;continue}
  if(ch==='"'&&f===''){q=true;any=true}
  else if(ch===d){row.push(f);f='';any=true}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(f);f='';if(any||row.length>1||row[0]!=='')rows.push(row);row=[];any=false}
  else{f+=ch;any=true}}
 if(q)return {rows:[],error:'quote'};
 if(any||f!==''||row.length){row.push(f);if(row.length>1||row[0]!=='')rows.push(row)}
 return {rows}}
