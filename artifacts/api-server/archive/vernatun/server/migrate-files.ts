import {resolve} from 'node:path';
import {pool} from './db.js';
import {migratePrivateFiles} from './file-migration.js';
import {logger} from '../../../src/lib/logger.js';

const args=process.argv.slice(2);
const sourceIndex=args.indexOf('--source-root');
const source=sourceIndex<0?resolve('.local'):resolve(args[sourceIndex+1]??'');
if(args.some((arg,i)=>!['--apply','--source-root'].includes(arg)&&!(sourceIndex>=0&&i===sourceIndex+1))||sourceIndex>=0&&(!args[sourceIndex+1]||args[sourceIndex+1]!.startsWith('--'))){
  throw new Error('Usage: storage:migrate [--apply] [--source-root directory-containing-private-photos-and-private-documents]');
}
try{
  // Preflight the entire inventory before copying any bytes.
  const preflight=await migratePrivateFiles(source);
  logger.info({report:preflight},'Private file migration preflight');
  if(preflight.missing)throw new Error('Referenced files are missing locally and in App Storage; restore source bytes before continuing');
  if(args.includes('--apply')){
    const report=await migratePrivateFiles(source,true);
    logger.info({report},'Private file migration verified');
    if(report.missing||report.pending)throw new Error('Private file migration is incomplete');
  }
}catch(error){
  logger.error({message:error instanceof Error?error.message:'Migration failed'},'Private file migration stopped');
  process.exitCode=1;
}finally{await pool.end()}
