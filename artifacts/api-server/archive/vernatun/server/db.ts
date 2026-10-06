import pg from 'pg';
import {config} from './config.js';
export const pool=new pg.Pool({connectionString:config.DATABASE_URL,max:10});
export async function audit(actor:string|null,organization:string|null,action:string,type:string,id:string|null,details:Record<string,unknown>={}){await pool.query('INSERT INTO audit_events(actor_user_id,organization_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',[actor,organization,action,type,id,JSON.stringify(details)]);}
