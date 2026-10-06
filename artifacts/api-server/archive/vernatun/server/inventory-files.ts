import {readFile,writeFile} from 'node:fs/promises';
import {pool} from './db.js';
import {inventoryPrivateFiles,cleanPrivateFiles,defaultGraceHours} from './file-inventory.js';

const usage='Usage: storage:inventory --report new-report.json [--grace-hours 72] | storage:inventory --apply reviewed-report.json --confirm-delete';
try{
  const args=process.argv.slice(2);
  const options=new Map<string,string>();
  let confirm=false;
  for(let i=0;i<args.length;i++){
    const flag=args[i]!;
    if(flag==='--confirm-delete'){if(confirm)throw new Error(usage);confirm=true;continue}
    if(!['--report','--apply','--grace-hours'].includes(flag)||options.has(flag)||!args[i+1]||args[i+1]!.startsWith('--'))throw new Error(usage);
    options.set(flag,args[++i]!);
  }
  if(options.has('--apply')){
    if(!confirm||options.size!==1)throw new Error(usage);
    const report=JSON.parse(await readFile(options.get('--apply')!,'utf8'));
    console.log(JSON.stringify({mode:'cleanup',result:await cleanPrivateFiles(report)},null,2));
  }else{
    if(confirm||!options.has('--report'))throw new Error(usage);
    const report=await inventoryPrivateFiles(options.has('--grace-hours')?Number(options.get('--grace-hours')):defaultGraceHours);
    // Never overwrite a reviewed report accidentally.
    await writeFile(options.get('--report')!,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({mode:'inventory',report:options.get('--report'),graceHours:report.graceHours,
      counts:report.objects.reduce<Record<string,number>>((counts,e)=>{counts[e.status]=(counts[e.status]??0)+1;return counts},{}),ignored:report.ignored},null,2));
  }
}catch(error){
  console.error(error instanceof Error?error.message:'Private file inventory failed');
  process.exitCode=1;
}finally{await pool.end()}
