import 'dotenv/config';
import {z} from 'zod';
import {pool} from './db.js';
import {drillEncryptedBackup} from './operations-restore.js';
try{
 const [action,rawId,confirmation,...extra]=process.argv.slice(2);
 if(action!=='drill'||confirmation!=='--confirm=ISOLATED'||extra.length)throw new Error('Invalid command');
 const id=z.string().uuid().parse(rawId);
 await pool.query("INSERT INTO audit_events(action,entity_type,entity_id) VALUES('system.backup.drill.started','backup',$1)",[id]);
 try{
  const result=await drillEncryptedBackup(id);
  await pool.query("INSERT INTO audit_events(action,entity_type,entity_id,details) VALUES('system.backup.drill.completed','backup',$1,$2)",[id,JSON.stringify(result)]);
  console.log(JSON.stringify({id,isolated:true,...result,workingDataChanged:false}));
 }catch{
  await pool.query("INSERT INTO audit_events(action,entity_type,entity_id) VALUES('system.backup.drill.failed','backup',$1)",[id]);throw new Error('Drill failed');
 }
}catch{console.error('Isolated recovery did not complete. Check verified backup, schema version, pg tools and temporary database permissions. Working data was not a restore target.');process.exitCode=1}
finally{await pool.end()}
