import {pool} from './db.js';
import {readdir as listFiles,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {config} from './config.js';
async function readdir(path:URL){
 const through=process.argv.find(a=>a.startsWith('--through='))?.slice(10);
 if(through&&(!/^\d{3}$/.test(through)||config.NODE_ENV!=='test'))throw new Error('Partial migration is for isolated tests only');
 return (await listFiles(path)).filter(name=>!through||name.slice(0,3)<=through);
}
if(config.NODE_ENV==='production')throw new Error('Use the managed Publish schema flow for production, not this development migration command');
export async function migrate(){const client=await pool.connect();try{await client.query('SELECT pg_advisory_lock(6172921)');await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())');for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort()){const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');const previous=await client.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name]);if(previous.rowCount){if(previous.rows[0].checksum!==checksum)throw new Error('Migration checksum mismatch: '+name);continue;}await client.query('BEGIN');try{await client.query(sql);await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);await client.query('COMMIT');console.log('Applied migration:',name)}catch(e){await client.query('ROLLBACK');throw e}}}finally{await client.query('SELECT pg_advisory_unlock(6172921)');client.release()}}
await migrate();await pool.end();
