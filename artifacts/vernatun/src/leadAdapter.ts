import {lt} from './landing-i18n';
export type Lead = {name:string;contact:string;role:string;message:string;consent:boolean;organization?:string;productInterest?:string;audience?:string};
export const DEMO_FORM_MESSAGE = lt('s134');
// Replace this adapter with an approved first-party endpoint before enabling lead collection.
// No contacts are transmitted, logged, or persisted in demo mode.
export async function submitLead(_lead: Lead): Promise<{sent:false;message:string}> {
  return {sent:false,message:DEMO_FORM_MESSAGE};
}
export function validateLead(lead:Lead){const errors:Partial<Record<keyof Lead,string>>={};if(!lead.name.trim())errors.name=lt('s135');const contact=lead.contact.trim();const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);const phone=/^\+?[\d\s()\-]+$/.test(contact)&&contact.replace(/\D/g,'').length>=7&&contact.replace(/\D/g,'').length<=15;if(!email&&!phone)errors.contact=lt('s136');if(!lead.consent)errors.consent=lt('s138');return errors;}
