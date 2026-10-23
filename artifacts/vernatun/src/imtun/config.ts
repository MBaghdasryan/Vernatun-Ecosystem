import type {RoleContext} from '../portal/types';
export type BrandConfig={name:string;signature:string;logo:string;primary:string;navy:string;background:string;supportPhone?:string;supportEmail?:string;privacyUrl?:string;termsUrl?:string;websiteUrl?:string};
export type AppBuildProfile={environment:'development'|'staging'|'production';brand:BrandConfig;packageId:string;bundleId:string;deepLinkDomains:string[];icon:string;splash:string;storeMetadata:{name:string;description:string};pushConfigurationRef?:string};
export const defaultBrand:BrandConfig={name:'ImTun',signature:'by Vernatun',logo:'/assets/imtun-original.png',primary:'#FF6B0A',navy:'#0B2230',background:'#F7F5F0'};
// Runtime theme changes presentation only. Permissions always come from the session.
const hex=(v?:string|null)=>/^#[0-9a-f]{6}$/i.test(v??'')?v!:undefined;
export function tenantBrand(c:RoleContext):BrandConfig&{accent?:string}{const b=c.branding,k=b?.logo_key;return {...defaultBrand,name:b?.brand_name||defaultBrand.name,logo:k&&c.organization_id?`${import.meta.env.BASE_URL}api/organizations/${encodeURIComponent(c.organization_id)}/branding/logo?key=${encodeURIComponent(k)}`:defaultBrand.logo,primary:hex(b?.primary_color)??hex(c.brand_color)??defaultBrand.primary,navy:hex(b?.accent_color)??defaultBrand.navy,accent:hex(b?.accent_color),supportEmail:b?.support_email||undefined,supportPhone:b?.support_phone||undefined,websiteUrl:b?.website_url||undefined,privacyUrl:b?.privacy_url||undefined,termsUrl:b?.terms_url||undefined}}
export function buildProfile(environment:AppBuildProfile['environment'],brand=defaultBrand):AppBuildProfile{return {environment,brand,packageId:'am.vernatun.imtun'+(environment==='production'?'':'.'+environment),bundleId:'am.vernatun.imtun'+(environment==='production'?'':'.'+environment),deepLinkDomains:[],icon:'/assets/favicon.png',splash:brand.logo,storeMetadata:{name:brand.name,description:brand.signature}}}
export const features={
 ownership:{permission:'ownership.read'},
 finance:{permission:'billing.own',module:'finance'},'online-payments':{permission:'billing.own',module:'finance'},utilities:{permission:'billing.own',module:'finance'},requests:{permission:'requests.own',module:'requests'},meters:{permission:'meters.own',module:'meters'},announcements:{permission:'announcements.read',module:'community'},meetings:{permission:'meetings.read',module:'community'},documents:{permission:'documents.read',module:'documents'},passes:{permission:'access.create',module:'access'},delegations:{permission:'residents.delegate'},leases:{permission:'leases.own',module:'finance'},
} as const;
export function available(c:RoleContext,view:string){if(['overview','settings','notifications'].includes(view))return true;const f=features[view as keyof typeof features];return !!f&&c.permissions.includes(f.permission)&&(!('module' in f)||!!c.modules?.includes(f.module))}
export type ProductEvent='context_selected'|'payment_started'|'request_viewed'|'announcement_opened'|'meeting_opened';
// Disabled by default; adapters receive event names only, never resident payloads.
let analytics:((event:ProductEvent)=>void)|undefined;
export function configureAnalytics(adapter?:typeof analytics){analytics=adapter}
export function track(event:ProductEvent){try{analytics?.(event)}catch{/* Analytics never prevents an operation. */}}
