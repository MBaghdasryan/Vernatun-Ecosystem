import type {QueryConfig} from 'pg';
import {pool} from './db.js';
// pg supports per-query client read timeout; its current typings omit this key.
export const systemQuery=(query:QueryConfig & {query_timeout:number})=>pool.query(query);
