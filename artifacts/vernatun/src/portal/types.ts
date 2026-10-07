import type {Currency,Language} from './i18n';
export type User={id:string;email:string;name:string;locale:Language;currency:Currency};
export type RoleContext={id:string;role_key:string;shell:string;organization_id:string|null;organization_name:string|null;brand_color?:string;branding?:Branding|null;building_id:string|null;building_name?:string|null;unit_id:string|null;unit_number?:string|null;expires_at:string|null;permissions:string[];product?:string;products?:string[];startRoute?:string;modules?:string[];subscription?:{enforced:boolean;state:string;readOnly:boolean;grace:boolean}|null};
export type AuthState={user:User|null;contexts:RoleContext[];contextId:string|null;csrf:string;demo?:boolean;mfaAvailable?:boolean};
export type Dashboard={context:RoleContext;metrics:Record<string,number>;stage:number};

export type Branding={brand_name:string|null;primary_color:string|null;accent_color:string|null;support_email:string|null;support_phone:string|null;website_url:string|null;privacy_url:string|null;terms_url:string|null;logo_key:string|null};
