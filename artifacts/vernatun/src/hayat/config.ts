import type {RoleContext} from '../portal/types';
export type BrandConfig={name:string;signature:string;logo:string;primary:string;navy:string;background:string};
export type AppBuildProfile={environment:'development'|'staging'|'production';brand:BrandConfig;packageId:string;bundleId:string;deepLinkDomains:string[];icon:string;splash:string;storeMetadata:{name:string;description:string}};
export const defaultHayatBrand:BrandConfig={name:'HAYAT',signature:'by Vernatun',logo:'/assets/hayat-original.png',primary:'#FF6B0A',navy:'#0B2230',background:'#F7F5F0'};
export function hayatBrand(c:RoleContext):BrandConfig{return {...defaultHayatBrand,primary:/^#[0-9a-f]{6}$/i.test(c.brand_color??'')?c.brand_color!:defaultHayatBrand.primary}}
// Build metadata only. Native packaging and push providers are not configured.
export function hayatBuildProfile(environment:AppBuildProfile['environment'],brand=defaultHayatBrand):AppBuildProfile{return {environment,brand,packageId:'am.vernatun.hayat'+(environment==='production'?'':'.'+environment),bundleId:'am.vernatun.hayat'+(environment==='production'?'':'.'+environment),deepLinkDomains:[],icon:'/assets/favicon.png',splash:brand.logo,storeMetadata:{name:brand.name,description:brand.signature}}}
