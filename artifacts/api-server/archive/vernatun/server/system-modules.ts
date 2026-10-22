import type {Request,Router} from 'express';
import {pool} from './db.js';
import {moduleKeys} from './subscription-policy.js';
import {moduleForPermission} from './roles.js';

const moduleCategory:Record<string,string>={
 requests:'resident_services',finance:'finance',handover:'handover',access:'access_control',
 community:'community',maintenance:'maintenance',meters:'metering',documents:'documents',
};

export function registerSystemModules(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 router.get('/system/modules',async(req,res)=>{
  await permit(req,'plugins.read');
  const [entitlements,plans,permissions]=await Promise.all([
   pool.query(`SELECT module,count(*) FILTER(WHERE enabled)::int AS enabled_organizations,
    count(*) FILTER(WHERE override_state='enabled')::int AS forced_enabled,
    count(*) FILTER(WHERE override_state='disabled')::int AS forced_disabled
    FROM module_entitlements GROUP BY module`),
   pool.query('SELECT id,name,allowed_modules FROM subscription_plans ORDER BY name'),
   pool.query('SELECT key FROM permissions ORDER BY key'),
  ]);
  const byModule=new Map(entitlements.rows.map(r=>[r.module,r]));
  const modules=moduleKeys.map(moduleId=>{
   const counts=byModule.get(moduleId);
   return {moduleId,name:moduleId,version:null,type:'core',category:moduleCategory[moduleId]??'other',
    description:null,status:'installed',requiredCoreVersion:null,dependencies:[],
    capabilities:permissions.rows.filter(p=>moduleForPermission(p.key)===moduleId).map(p=>p.key),
    configurable:true,organizationEnableable:true,globallyAvailable:true,
    enabledOrganizations:counts?.enabled_organizations??0,forcedEnabled:counts?.forced_enabled??0,
    forcedDisabled:counts?.forced_disabled??0,
    planIncludedBy:plans.rows.filter(p=>p.allowed_modules.includes(moduleId)).map(p=>({id:p.id,name:p.name})),
   };
  });
  res.set('Cache-Control','private, no-store').json({
   coreVersion:null,modules,extensions:[],
   extensionPolicy:{arbitraryPackagesAllowed:false,installationSupported:false,
    message:'Only source-registered core modules are available. Extension code is not uploaded or executed.'},
   management:{planEntitlements:'existing_subscription_management',organizationOverrides:'existing_module_entitlements',
    dependencyConflicts:modules.filter(m=>m.dependencies.length>0).length},
  });
 });
}
