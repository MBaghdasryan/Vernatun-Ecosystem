export type MigrationFileStatus={name:string;checksum:string};
export type MigrationLedgerRow={name:string;checksum:string};
export type ExpectedObjectObservation={migration:string;kind:'relation'|'function';name:string;present:boolean;idempotent:boolean};
export type MigrationStatus={
 applied:string[];
 pending:string[];
 checksumDrift:string[];
 missingObjects:string[];
 unexpectedObjects:string[];
 historyDrift:string[];
};

export function createMigrationStatus(
 files:MigrationFileStatus[],
 rows:MigrationLedgerRow[],
 objects:ExpectedObjectObservation[],
):MigrationStatus{
 const byName=new Map(files.map(file=>[file.name,file]));
 const ledger=new Map(rows.map(row=>[row.name,row.checksum]));
 const historyDrift=rows.filter(row=>!byName.has(row.name)).map(row=>`Unknown migration record: ${row.name}`);
 const checksumDrift:string[]=[];
 let gap=false;
 for(const file of files){
  const checksum=ledger.get(file.name);
  if(checksum===undefined){gap=true;continue}
  if(gap)historyDrift.push(`Migration history is not a contiguous prefix; stopped at ${file.name}`);
  if(checksum!==file.checksum)checksumDrift.push(file.name);
 }
 const appliedSet=new Set(ledger.keys());
 const missingObjects:string[]=[],unexpectedObjects:string[]=[];
 for(const object of objects){
  if(appliedSet.has(object.migration)&&!object.present)
   missingObjects.push(`Recorded ${object.migration}, but ${object.kind} ${object.name} is missing`);
  if(!appliedSet.has(object.migration)&&object.present&&!object.idempotent)
   unexpectedObjects.push(`${object.kind} ${object.name} exists without its migration record ${object.migration}`);
 }
 return {
  applied:files.filter(file=>appliedSet.has(file.name)).map(file=>file.name),
  pending:files.filter(file=>!appliedSet.has(file.name)).map(file=>file.name),
  checksumDrift,missingObjects,unexpectedObjects,historyDrift,
 };
}

export function assertMigrationPlanApplicable(status:MigrationStatus,schemaDrift:string[]=[]){
 const blockers=[
  ...status.checksumDrift.map(name=>`Migration checksum mismatch: ${name}`),
  ...status.missingObjects,
  ...status.unexpectedObjects,
  ...status.historyDrift,
  ...schemaDrift,
 ];
 if(blockers.length)throw new Error(`Schema drift blocks automatic migration: ${blockers.join('; ')}`);
}
