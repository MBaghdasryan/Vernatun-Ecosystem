import {createHmac} from 'node:crypto';
import type {Store,Options} from 'express-rate-limit';
import {pool} from './db.js';
import {config} from './config.js';
export class PostgresRateStore implements Store{
 localKeys=false;windowMs=900000;
 init(options:Options){this.windowMs=options.windowMs}
 key(value:string){return createHmac('sha256',config.SESSION_SECRET).update('auth-rate:'+value).digest('hex')}
 async increment(key:string){const r=(await pool.query(`INSERT INTO auth_rate_limits(key,hits,reset_at) VALUES($1,1,now()+$2*interval '1 millisecond') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN auth_rate_limits.reset_at<=now() THEN 1 ELSE auth_rate_limits.hits+1 END,reset_at=CASE WHEN auth_rate_limits.reset_at<=now() THEN now()+$2*interval '1 millisecond' ELSE auth_rate_limits.reset_at END RETURNING hits,reset_at`,[this.key(key),this.windowMs])).rows[0];return {totalHits:r.hits,resetTime:r.reset_at}}
 async decrement(key:string){await pool.query('UPDATE auth_rate_limits SET hits=GREATEST(0,hits-1) WHERE key=$1',[this.key(key)])}
 async resetKey(key:string){await pool.query('DELETE FROM auth_rate_limits WHERE key=$1',[this.key(key)])}
}
