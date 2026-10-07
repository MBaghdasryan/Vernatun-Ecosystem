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
