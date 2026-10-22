import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {z} from 'zod';

export const updateArchiveLimit=32*1024*1024;
const updateExpandedLimit=128*1024*1024;
const updateEntryLimit=1000;
const updateFileLimit=32*1024*1024;

const manifestSchema=z.object({
 packageFormatVersion:z.literal(1),
 product:z.literal('vernatun'),
 version:z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
 fromVersions:z.array(z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)).min(1).max(100),
 createdAt:z.string().datetime(),
 checksum:z.string().regex(/^[a-f0-9]{64}$/i),
 databaseMigrationRequired:z.boolean(),
 restartRequired:z.boolean(),
 minimumNodeVersion:z.string().regex(/^\d+\.\d+\.\d+$/),
 files:z.array(z.object({path:z.string().min(1).max(512),sha256:z.string().regex(/^[a-f0-9]{64}$/i),sizeBytes:z.number().int().nonnegative().max(updateFileLimit)}).strict()).min(1).max(updateEntryLimit),
 releaseNotes:z.string().max(10000),
}).strict();
export type VernatunUpdateManifest=z.infer<typeof manifestSchema>;

type Entry={path:string;bytes:Buffer;sha256:string;directory:boolean};
type Validation={valid:boolean;compatible:boolean|null;compatibility:'compatible'|'incompatible'|'unknown';issues:string[];manifest:VernatunUpdateManifest|null;archiveChecksum:string;files:number;expandedBytes:number};

function fail(code:string):never{throw new Error(code)}
function crc32(bytes:Buffer){
 let crc=0xffffffff;
 for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
 return (crc^0xffffffff)>>>0;
}
function zipPath(name:string){
 if(!name||name.length>512||name.startsWith('/')||/^[a-z]:/i.test(name)||name.includes('\\')||/[\u0000-\u001f\u007f]/.test(name))fail('unsafe_archive_path');
 const directory=name.endsWith('/'),parts=name.split('/');
 if(directory)parts.pop();
 if(!parts.length||parts.some(p=>!p||p==='.'||p==='..'))fail('unsafe_archive_path');
 const lower=parts.map(p=>p.toLowerCase());
 if(lower.some(p=>['.env','.git','.ssh','id_rsa','id_ed25519','secrets','proc','sys','dev','etc','root'].includes(p))||
  /\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(name))fail('sensitive_archive_path');
 if(/\.(?:exe|dll|so|dylib|bat|cmd|ps1|sh)$/i.test(name))fail('unexpected_executable');
 return {path:name,directory};
}
function readZip(bytes:Buffer):Entry[]{
 if(bytes.length<22||bytes.length>updateArchiveLimit)fail('invalid_archive_size');
 const start=Math.max(0,bytes.length-65557);let eocd=-1;
 for(let i=bytes.length-22;i>=start;i--)if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break}
 if(eocd<0)fail('invalid_archive');
 const disk=bytes.readUInt16LE(eocd+4),centralDisk=bytes.readUInt16LE(eocd+6),
  diskEntries=bytes.readUInt16LE(eocd+8),count=bytes.readUInt16LE(eocd+10),
  centralSize=bytes.readUInt32LE(eocd+12),centralOffset=bytes.readUInt32LE(eocd+16),
  commentLength=bytes.readUInt16LE(eocd+20);
 if(disk||centralDisk||diskEntries!==count||count===0xffff||count>updateEntryLimit||
  centralOffset+centralSize!==eocd||eocd+22+commentLength!==bytes.length)fail('invalid_archive_directory');
 let offset=centralOffset,total=0;const entries:Entry[]=[],seen=new Set<string>(),ranges:[number,number][]=[];
 const decoder=new TextDecoder('utf-8',{fatal:true});
 for(let i=0;i<count;i++){
  if(offset+46>eocd||bytes.readUInt32LE(offset)!==0x02014b50)fail('invalid_archive_directory');
  const madeBy=bytes.readUInt16LE(offset+4),flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),
   expectedCrc=bytes.readUInt32LE(offset+16),compressed=bytes.readUInt32LE(offset+20),
   uncompressed=bytes.readUInt32LE(offset+24),nameLength=bytes.readUInt16LE(offset+28),
   extraLength=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),
   startDisk=bytes.readUInt16LE(offset+34),external=bytes.readUInt32LE(offset+38),local=bytes.readUInt32LE(offset+42);
  const end=offset+46+nameLength+extraLength+comment;if(end>eocd||startDisk!==0)fail('invalid_archive_directory');
  let rawName:string;try{rawName=decoder.decode(bytes.subarray(offset+46,offset+46+nameLength))}catch{fail('invalid_archive_path')}
  const safe=zipPath(rawName);if(seen.has(safe.path))fail('duplicate_archive_path');seen.add(safe.path);
  if(flags&1||![0,8].includes(method))fail('unsupported_archive_encoding');
  for(let x=offset+46+nameLength;x<offset+46+nameLength+extraLength;){
   if(x+4>end)fail('invalid_archive_directory');const id=bytes.readUInt16LE(x),size=bytes.readUInt16LE(x+2);
   if(x+4+size>end||id===1)fail('zip64_or_invalid_archive');x+=4+size;
  }
  const mode=(madeBy>>>8)===3?external>>>16:0,kind=mode&0xf000;
  if(![0,0o100000,0o040000].includes(kind))fail('unexpected_file_type');
  if(mode&0o111)fail('unexpected_executable');
  if((safe.directory&&kind===0o100000)||(!safe.directory&&kind===0o040000))fail('unexpected_file_type');
  if(uncompressed>updateFileLimit||compressed>updateArchiveLimit||(!compressed&&uncompressed))fail('archive_entry_too_large');
  total+=uncompressed;if(total>updateExpandedLimit)fail('archive_expanded_limit');
  if(compressed&&uncompressed/compressed>200)fail('archive_expansion_ratio');
  if(safe.directory){if(compressed||uncompressed)fail('invalid_archive_directory_entry');entries.push({path:safe.path,bytes:Buffer.alloc(0),sha256:createHash('sha256').update('').digest('hex'),directory:true});offset=end;continue}
  if(local+30>centralOffset||bytes.readUInt32LE(local)!==0x04034b50)fail('invalid_archive_local_header');
  const localFlags=bytes.readUInt16LE(local+6),localMethod=bytes.readUInt16LE(local+8),
   localNameLength=bytes.readUInt16LE(local+26),localExtraLength=bytes.readUInt16LE(local+28),
   dataStart=local+30+localNameLength+localExtraLength,dataEnd=dataStart+compressed;
  if(localFlags!==flags||localMethod!==method||dataEnd>centralOffset||dataStart<local)fail('invalid_archive_local_header');
  let localName:string;try{localName=decoder.decode(bytes.subarray(local+30,local+30+localNameLength))}catch{fail('invalid_archive_path')}
  if(localName!==safe.path)fail('invalid_archive_local_header');
  if(ranges.some(([a,b])=>dataStart<b&&dataEnd>a))fail('overlapping_archive_entries');ranges.push([local,dataEnd]);
  const payload=bytes.subarray(dataStart,dataEnd);let content:Buffer;
  try{content=method===0?Buffer.from(payload):inflateRawSync(payload,{maxOutputLength:updateFileLimit})}catch{fail('invalid_archive_compression')}
  if(content.length!==uncompressed||crc32(content)!==expectedCrc)fail('archive_checksum_mismatch');
  entries.push({path:safe.path,bytes:content,sha256:createHash('sha256').update(content).digest('hex'),directory:false});offset=end;
 }
 if(offset!==centralOffset+centralSize)fail('invalid_archive_directory');
 return entries;
}
function compareVersion(a:string,b:string){
 const parse=(v:string)=>v.split('-')[0].split('.').map(Number),x=parse(a),y=parse(b);
 for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]!>y[i]!?1:-1}
 return a===b?0:a.includes('-')?-1:1;
}
function compatibleNode(current:string,minimum:string){return compareVersion(current.replace(/^v/,''),minimum)>=0}

export function validateUpdateArchive(bytes:Buffer,currentVersion=process.env.VERNATUN_APP_VERSION??null):Validation{
 const archiveChecksum=createHash('sha256').update(bytes).digest('hex'),issues:string[]=[];
 let entries:Entry[];
 try{entries=readZip(bytes)}catch(e){return {valid:false,compatible:null,compatibility:'unknown',issues:[e instanceof Error?e.message:'invalid_archive'],manifest:null,archiveChecksum,files:0,expandedBytes:0}}
 const files=entries.filter(e=>!e.directory),manifestEntry=files.find(e=>e.path==='vernatun-update.json');
 if(!manifestEntry)return {valid:false,compatible:null,compatibility:'unknown',issues:['manifest_missing'],manifest:null,archiveChecksum,files:files.length,expandedBytes:files.reduce((n,e)=>n+e.bytes.length,0)};
 let manifest:VernatunUpdateManifest;
 try{manifest=manifestSchema.parse(JSON.parse(manifestEntry.bytes.toString('utf8')))}catch{return {valid:false,compatible:null,compatibility:'unknown',issues:['manifest_invalid'],manifest:null,archiveChecksum,files:files.length,expandedBytes:files.reduce((n,e)=>n+e.bytes.length,0)}}
 const payload=files.filter(e=>e.path!=='vernatun-update.json').sort((a,b)=>a.path.localeCompare(b.path));
 const declared=[...manifest.files].sort((a,b)=>a.path.localeCompare(b.path));
 if(payload.length!==declared.length||payload.some((f,i)=>f.path!==declared[i]?.path||f.sha256!==declared[i]?.sha256.toLowerCase()||f.bytes.length!==declared[i]?.sizeBytes))issues.push('file_manifest_mismatch');
 const canonical=declared.map(f=>`${f.path}\0${f.sha256.toLowerCase()}\n`).join('');
 if(createHash('sha256').update(canonical).digest('hex')!==manifest.checksum.toLowerCase())issues.push('manifest_checksum_mismatch');
 if(!payload.some(e=>e.path==='artifacts/api-server/dist/index.mjs')||
  !payload.some(e=>e.path==='artifacts/vernatun/dist/index.html'))issues.push('application_structure_incomplete');
 for(const file of manifest.files)try{zipPath(file.path)}catch{issues.push('unsafe_manifest_path');break}
 let compatibility:'compatible'|'incompatible'|'unknown'='unknown';
 if(currentVersion&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(currentVersion)){
  compatibility=manifest.fromVersions.includes(currentVersion)&&compareVersion(manifest.version,currentVersion)>0&&compatibleNode(process.version,manifest.minimumNodeVersion)?'compatible':'incompatible';
  if(!manifest.fromVersions.includes(currentVersion))issues.push('current_version_not_supported');
  if(compareVersion(manifest.version,currentVersion)<=0)issues.push('version_not_newer');
  if(!compatibleNode(process.version,manifest.minimumNodeVersion))issues.push('minimum_node_version_not_met');
 }
 if(issues.length)compatibility='incompatible';
 return {valid:issues.length===0,compatible:compatibility==='compatible'?true:compatibility==='incompatible'?false:null,compatibility,issues,manifest,archiveChecksum,files:files.length,expandedBytes:files.reduce((n,e)=>n+e.bytes.length,0)};
}
