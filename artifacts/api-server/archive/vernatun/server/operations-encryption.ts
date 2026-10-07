import {createCipheriv,createDecipheriv,createHash,hkdfSync,randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';

// Separate key from auth/session signing. Never stored with ciphertext or in DB.
function configuredKey(){
 const value=process.env.VERNATUN_OPERATIONS_ENCRYPTION_KEY;
 if(!value||!/^[a-f0-9]{64}$/i.test(value))throw new Error('operations_encryption_not_configured');
 return Buffer.from(value,'hex');
}
export function operationsEncryptionState(){
 try{configuredKey();return 'configured' as const}catch{return 'not_configured' as const}
}
const envelope=z.object({
 version:z.literal(1),algorithm:z.literal('AES-256-GCM'),keyId:z.string().regex(/^[a-f0-9]{16}$/),
 nonce:z.string().regex(/^[a-f0-9]{24}$/),tag:z.string().regex(/^[a-f0-9]{32}$/),
 ciphertext:z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();
export type OperationsEnvelope=z.infer<typeof envelope>;
export class OperationsCipher{
 private key:Buffer;
 readonly keyId:string;
 constructor(root:Buffer){
  if(root.length!==32)throw new Error('Invalid operations key');
  this.key=Buffer.from(root);this.keyId=createHash('sha256').update(root).digest('hex').slice(0,16);
 }
 private material(purpose:string){
  // Callers bind purpose to record ID, organization and provider/backup domain.
  if(!/^[a-z0-9:_-]{1,240}$/i.test(purpose))throw new Error('Invalid encryption context');
  return Buffer.from(hkdfSync('sha256',this.key,Buffer.from('vernatun-operations-v1'),Buffer.from(purpose),32));
 }
 seal(bytes:Buffer,purpose:string):OperationsEnvelope{
  const nonce=randomBytes(12),key=this.material(purpose);
  try{
   const cipher=createCipheriv('aes-256-gcm',key,nonce);
   cipher.setAAD(Buffer.from('vernatun-operations-v1:'+purpose));
   const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
   return {version:1,algorithm:'AES-256-GCM',keyId:this.keyId,nonce:nonce.toString('hex'),
    tag:cipher.getAuthTag().toString('hex'),ciphertext:encrypted.toString('base64')};
  }finally{key.fill(0)}
 }
 open(input:unknown,purpose:string):Buffer{
  const e=envelope.parse(input);
  if(!timingSafeEqual(Buffer.from(e.keyId,'hex'),Buffer.from(this.keyId,'hex')))throw new Error('operations_key_unavailable');
  const key=this.material(purpose);
  try{
   const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.nonce,'hex'));
   cipher.setAAD(Buffer.from('vernatun-operations-v1:'+purpose));cipher.setAuthTag(Buffer.from(e.tag,'hex'));
   return Buffer.concat([cipher.update(Buffer.from(e.ciphertext,'base64')),cipher.final()]);
  }finally{key.fill(0)}
 }
}
export function operationsCipher(){return new OperationsCipher(configuredKey())}
