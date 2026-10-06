import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,stat,unlink} from 'node:fs/promises';
import {deliverEmail,emailProviderState} from '../email.js';
import {createEmailProvider,ResendEmailProvider,DevelopmentOutboxProvider,type EmailMessage,type EmailSettings} from '../email-providers/index.js';

const message:EmailMessage={to:'recipient@example.test',subject:'QA only',text:'Invitation: https://example.test/?token=fixture-only',url:'https://example.test/?token=fixture-only'};
const resend:EmailSettings={mode:'production',provider:'resend',from:'noreply@example.test'};
const smtp:EmailSettings={mode:'production',provider:'smtp',host:'smtp.example.test',port:587,from:'noreply@example.test',user:'fake-qa-user',password:'fake-qa-password'};
const key=()=>`invitation-${randomUUID()}`;
const failed=(e:any)=>e.code==='email_delivery_failed'&&e.status===503;
const unconfigured=(e:any)=>e.code==='email_not_configured'&&e.status===503;

test('Factory selects replaceable adapters, rejects unknown providers and never falls back from Resend to local outbox',()=>{
 assert.equal(createEmailProvider(resend).name,'resend');
 assert.equal(createEmailProvider(smtp).name,'smtp');
 assert.equal(createEmailProvider({mode:'development',provider:'outbox'}).name,'outbox');
 assert.equal(emailProviderState({...resend,from:undefined}),'not_configured');
 assert.equal(emailProviderState({...resend,provider:'unknown'}),'not_configured');
 assert.equal(emailProviderState({mode:'production',provider:'outbox'}),'not_configured');
});

test('Resend uses the connector transport, accepts a valid API receipt and never returns token/URL',async()=>{
 let request:any;
 const messageId=randomUUID();
 const result=await deliverEmail(message,key(),{settings:resend,dependencies:{resendFetch:async(path,init)=>{
  request={path,init};return Response.json({id:messageId},{status:200});
 }}});
 assert.equal(request.path,'/emails');assert.equal(request.init.method,'POST');
 assert.deepEqual(JSON.parse(request.init.body),{from:resend.from,to:[message.to],subject:message.subject,text:message.text});
 assert.ok(request.init.signal instanceof AbortSignal);
 assert.equal(result.delivery,'resend_accepted');assert.equal(result.provider,'resend');
 assert.equal('url' in result,false);assert.equal(JSON.stringify(result).includes('fixture-only'),false);
 assert.equal('messageId' in result&&result.messageId,messageId);
});

test('Retrying identical content is idempotent; a rotated invitation/reset URL gets a different key',async()=>{
 const keys:string[]=[];const id=key();
 const provider=new ResendEmailProvider(resend,async(_path,init)=>{
  keys.push((init.headers as Record<string,string>)['Idempotency-Key']);
  return Response.json({id:randomUUID()});
 });
 await provider.send(message,id);await provider.send(message,id);
 await provider.send({...message,text:'Rotated: https://example.test/?token=rotated-only',url:'https://example.test/?token=rotated-only'},id);
 assert.equal(keys[0],keys[1]);assert.notEqual(keys[0],keys[2]);
 assert.ok(keys.every(k=>k.length<=256&&!k.includes('fixture-only')&&!k.includes('rotated-only')));
});

test('Resend errors, malformed success and network failure cannot masquerade as accepted delivery',async()=>{
 for(const status of [400,401,403,429,500]){
  await assert.rejects(deliverEmail(message,key(),{settings:resend,dependencies:{resendFetch:async()=>Response.json({message:'private provider error'},{status})}}),failed);
 }
 for(const body of [{},{id:''},{id:'invalid'},{success:true}]){
  await assert.rejects(deliverEmail(message,key(),{settings:resend,dependencies:{resendFetch:async()=>Response.json(body)}}),failed);
 }
 await assert.rejects(deliverEmail(message,key(),{settings:resend,dependencies:{resendFetch:async()=>{throw new Error('private transport error')}}}),failed);
});

test('Missing sender fails before any Resend API call',async()=>{
 let calls=0;
 await assert.rejects(deliverEmail(message,key(),{settings:{...resend,from:undefined},dependencies:{resendFetch:async()=>{
  calls++;return Response.json({id:randomUUID()});
 }}}),unconfigured);
 assert.equal(calls,0);
});

test('SMTP remains independent and requires the actual recipient to be accepted',async()=>{
 const accepted=await deliverEmail(message,key(),{settings:smtp,transport:{sendMail:async()=>({accepted:[message.to],rejected:[]})}});
 assert.equal(accepted.delivery,'smtp_accepted');assert.equal(accepted.provider,'smtp');assert.equal('url' in accepted,false);
 for(const receipt of [{accepted:['other@example.test'],rejected:[]},{accepted:[message.to],rejected:[message.to]}]){
  await assert.rejects(deliverEmail(message,key(),{settings:smtp,transport:{sendMail:async()=>receipt}}),failed);
 }
});

test('Test mode forces private local delivery even when Resend/SMTP is selected, without networking',async()=>{
 let calls=0;
 for(const settings of [resend,smtp]){
  const id=key();const path=`.local/test/outbox/${id}.json`;
  try{
   const result=await deliverEmail(message,id,{settings:{...settings,mode:'test'},dependencies:{
    resendFetch:async()=>{calls++;return Response.json({id:randomUUID()})},
    smtpTransport:{sendMail:async()=>{calls++;return {accepted:[message.to]}}}
   }});
   assert.equal(result.delivery,'local_only');assert.equal(result.provider,'outbox');
   assert.equal(JSON.parse(await readFile(path,'utf8')).url,message.url);
   assert.equal((await stat(path)).mode&0o777,0o600);
  }finally{await unlink(path).catch(()=>{})}
 }
 assert.equal(calls,0);
});

test('Production outbox and unsafe keys are rejected without creating files',async()=>{
 await assert.rejects(new DevelopmentOutboxProvider({mode:'production',provider:'outbox'}).send(message,key()),unconfigured);
 await assert.rejects(deliverEmail(message,'../../not-safe',{settings:{mode:'test',provider:'outbox'}}),/Unsafe private outbox key/);
});
