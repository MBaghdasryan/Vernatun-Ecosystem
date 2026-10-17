import {readdirSync} from 'node:fs';
import {config} from './config.js';

declare const __VERNATUN_BUILD_ID__:string;
declare const __VERNATUN_SOURCE_NAMES__:string[];
export const apiBuildId=typeof __VERNATUN_BUILD_ID__==='undefined'?null:__VERNATUN_BUILD_ID__;
export const eventEnvironment=config.NODE_ENV;
// Source execution has no compiled build ID. Its trusted filenames come only
// from our code directory, never from an exception, request or environment input.
const names=new Set(typeof __VERNATUN_SOURCE_NAMES__==='undefined'
 ? readdirSync(new URL('.',import.meta.url)).filter(n=>/^[a-zA-Z0-9_-]+\.ts$/.test(n))
 : __VERNATUN_SOURCE_NAMES__);

/** Central diagnostics redaction: keep only allowlisted basename:line:column.
 * No exception message, function name, full path, URI, headers or nested causes.
 * This is a reduced call-location list, not an unredacted stack trace.
 */
export function safeErrorStack(error:unknown):string|null{
 if(!(error instanceof Error))return null;
 let stack:unknown;
 try{stack=error.stack}catch{return null}
 if(typeof stack!=='string')return null;
 const frames:string[]=[];
 for(const line of stack.slice(0,24000).split('\n').slice(1,81)){
  // Accept normal V8 file frames only. Drop remote URLs and query/hash suffixes.
  if(!/^\s+at /.test(line)||/https?:\/\/|[?#]/i.test(line))continue;
  const m=/(?:[/\\])([a-zA-Z0-9_-]+\.(?:ts|mjs)):(\d{1,7}):(\d{1,7})\)?$/.exec(line);
  if(!m||!names.has(m[1])||Number(m[2])<1||Number(m[3])<1)continue;
  frames.push(`${m[1]}:${Number(m[2])}:${Number(m[3])}`);
  if(frames.length===12)break;
 }
 return frames.length?frames.join('\n'):null;
}

/** Log only PostgreSQL's SQLSTATE and a tightly allowlisted missing object name.
 * Never persist the full message, query, detail, parameters or connection data.
 */
export function safeDatabaseFailure(error:unknown):{databaseCode:string;missingObject?:string}|null{
 if(!error||typeof error!=='object')return null;
 const value=error as {code?:unknown;message?:unknown};
 if(typeof value.code!=='string'||!/^[0-9A-Z]{5}$/.test(value.code))return null;
 const result:{databaseCode:string;missingObject?:string}={databaseCode:value.code};
 if(typeof value.message!=='string')return result;
 if(value.code==='42P01'){
  const relation=/^relation "([a-zA-Z_][a-zA-Z0-9_.$-]{0,127})" does not exist$/i.exec(value.message);
  if(relation)result.missingObject=`relation ${relation[1]}`;
 }else if(value.code==='42883'){
  const fn=/^(function|procedure) ([a-zA-Z_][a-zA-Z0-9_$.]*)\([^()\r\n]{1,200}\) does not exist$/i.exec(value.message);
  if(fn)result.missingObject=`${fn[1].toLowerCase()} ${fn[2]}`;
 }
 return result;
}
