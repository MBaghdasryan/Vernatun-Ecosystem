import {lt,landingLanguage} from './landing-i18n';
export type Lead = {name:string;contact:string;role:string;message:string;consent:boolean;organization?:string;productInterest?:string;audience?:string;website?:string};
import {request} from './portal/client';
export const LEAD_LIMITS={name:120,contact:254,organization:160,message:2000} as const;
const savedText=['Հայտը պահպանվել է։ Մենք կուսումնասիրենք այն և կապ կհաստատենք։ Էլ. նամակ չի ուղարկվել։','Заявка сохранена. Мы рассмотрим её и свяжемся с вами. Письмо не отправлялось.','Your request is SAVED. We will review it and get in touch. No email was sent.'];
export async function submitLead(lead: Lead): Promise<{sent:false;saved:true;id:string;message:string}> {
  // Landing does not mount Portal's session bootstrap. Get an anonymous
  // session/CSRF token before the first public mutation, preserving normal CSRF.
  await request('/auth/session');
  const r=await request<{received:boolean;id:string}>('/leads','POST',{name:lead.name.trim(),contact:lead.contact.trim(),organization:lead.organization?.trim()||undefined,productInterest:lead.productInterest??'',audience:lead.audience??'',message:lead.message.trim()||undefined,consent:lead.consent,language:landingLanguage,website:lead.website??''});
  if(!r?.received)throw new Error('not_saved');
  return {sent:false,saved:true,id:r.id,message:savedText[landingLanguage==='hy'?0:landingLanguage==='ru'?1:2]};
}
export function validateLead(lead:Lead){const errors:Partial<Record<keyof Lead,string>>={};if(!lead.name.trim())errors.name=lt('s135');const contact=lead.contact.trim();const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);const phone=/^\+?[\d\s()\-]+$/.test(contact)&&contact.replace(/\D/g,'').length>=7&&contact.replace(/\D/g,'').length<=15;if(!email&&!phone)errors.contact=lt('s136');if(!lead.consent)errors.consent=lt('s138');return errors;}
