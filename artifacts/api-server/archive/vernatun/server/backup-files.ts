import 'dotenv/config';
import {createPrivateBackup} from './file-backup.js';
import {withIsolatedRestore} from './file-restore.js';
import {pool} from './db.js';

try{
  const [action,id,...extra]=process.argv.slice(2);
  if(extra.length||!['create','drill'].includes(action||'')||(action==='create'&&id)||(action==='drill'&&!id))
    throw new Error('Usage: backup-files.ts create | drill backup_<20 hex characters>');
  if(action==='create'){
    const m=await createPrivateBackup();
    process.stdout.write(JSON.stringify({id:m.id,files:m.files.length,tables:m.tables.length,retainUntil:m.retainUntil})+'\n');
  }else{
    await withIsolatedRestore(id!,async({manifest})=>{
      process.stdout.write(JSON.stringify({id:manifest.id,verifiedFiles:manifest.files.length,verifiedTables:manifest.tables.length,isolated:true})+'\n');
    });
  }
}catch{
  // Do not print provider exceptions or SQL values from private backups.
  process.stderr.write('Backup/restore failed. No working database or source bytes were changed. Check the complete manifest, storage access, checksums, pg tools and database-create permission.\n');
  process.exitCode=1;
}finally{await pool.end()}
