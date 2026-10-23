import {z} from 'zod';

// vPOS 3.1 section 9. Read-only: no order, authorization, binding activation,
// capture or refund is performed. Production Help independently confirms this
// route: https://services.ameriabank.am/VPOS/Help/Api/POST-api-VPOS-GetBindings
const endpoints={
 sandbox:'https://servicestest.ameriabank.am/VPOS/api/VPOS/GetBindings',
 production:'https://services.ameriabank.am/VPOS/api/VPOS/GetBindings',
} as const;
const credentials=z.object({clientId:z.string().min(1).max(200),username:z.string().min(1).max(200),password:z.string().min(1).max(2000)}).strict();
export type AmeriaConnectionResult={status:'connected'|'failed';onlineAvailable:false;reason:string};
export async function checkAmeriaConnection(
 input:unknown,environment:'sandbox'|'production',transport:typeof fetch=fetch,
):Promise<AmeriaConnectionResult>{
 const parsed=credentials.safeParse(input);
 const result=(reason:string,status:'connected'|'failed'='failed'):AmeriaConnectionResult=>({status,onlineAvailable:false,reason});
 if(!parsed.success)return result('invalid_saved_credentials');
 const c=parsed.data;
 try{
  const response=await transport(endpoints[environment],{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
   headers:{'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({ClientID:c.clientId,Username:c.username,Password:c.password,PaymentType:5}),
  });
  if(response.status===401||response.status===403){await response.body?.cancel();return result('authentication_rejected')}
  if(!response.ok){await response.body?.cancel();return result('bank_http_error')}
  // Never log/store/return raw bank content: GetBindings can include card data.
  if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')){
   await response.body?.cancel();return result('invalid_bank_response');
  }
  const reader=response.body?.getReader();if(!reader)return result('invalid_bank_response');
  const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;
   if(length>262144){await reader.cancel();return result('bank_response_too_large')}chunks.push(next.value);
  }}finally{reader.releaseLock()}
  const body:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const code=z.object({ResponseCode:z.string()}).safeParse(body);
  if(!code.success)return result('invalid_bank_response');
  if(code.data.ResponseCode==='00')return result('authenticated_no_charge','connected');
  if(code.data.ResponseCode==='20')return result('authentication_rejected');
  // Binding permission may not be included in the merchant contract. Do not
  // call unknown/error codes either a successful login or invalid credentials.
  return result('bank_rejected_connection_check');
 }catch{return result('bank_unreachable_or_invalid_response')}
}
