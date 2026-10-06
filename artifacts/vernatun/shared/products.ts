// Interface routing only. Never use this mapping as authorization.
export const products={console:'Vernatun Console',os:'Vernatun OS',hayat:'HAYAT',imtun:'ImTun'} as const;
export type Product=keyof typeof products;
export const roleRoutes={
 platform_admin:['console','overview'],support:['console','onboarding'],
 org_admin:['os','organization'],portfolio_owner:['os','portfolio'],developer:['os','development'],accountant:['os','accounting'],
 manager:['hayat','management'],dispatcher:['hayat','dispatch'],technician:['hayat','my-work'],contractor:['hayat','contractor'],security:['hayat','security'],
 unit_owner:['imtun','owner'],renter:['imtun','renter'],family:['imtun','family']
} as const;
export function primaryProduct(role:string):Product{return roleRoutes[role as keyof typeof roleRoutes]?.[0]??'imtun'}
export type RouteContext={organization_id:string|null;permissions:readonly string[];modules?:readonly string[]};
export function startRoute(role:string,c?:RouteContext){
 if(role==='support'&&c?.organization_id){
  for(const [view,permission] of [['imports','imports.manage'],['requests','requests.read'],['properties','properties.read']]){
   if(c.permissions.includes(permission)&&(!viewModules[view]||!c.modules||c.modules.includes(viewModules[view])))return '/console/'+view;
  }
  return '/context';
 }
 const route=roleRoutes[role as keyof typeof roleRoutes];return route?'/'+route.join('/'):'/context';
}
export function allowedProducts(c:{role_key:string;permissions:readonly string[];modules?:readonly string[]}):Product[]{const result=[primaryProduct(c.role_key)];if(c.role_key==='manager'&&c.permissions.some(p=>['billing.read','expenses.read','reports.export'].includes(p))&&(!c.modules||c.modules.includes('finance')))result.push('os');return result}
const osViews=['finance','budgets','expenses','leases','handovers','defects','subscriptions','properties','units','people','invitations','modules','audit','imports','documents','invoices','support','support-cases','incidents'];
const hayatViews=['requests','properties','units','people','assets','announcements','meetings','passes','defects','documents','audit','incidents'];
const imtunViews=['finance','invoices','requests','meters','announcements','documents','passes','delegations','meetings','leases','properties'];
const consoleViews=['organizations','invitations','subscriptions','onboarding','support-cases','support','audit','properties','units','requests','imports','email'];
export function viewInProduct(product:Product,view:string){return ['overview','settings','notifications'].includes(view)||(product==='os'?osViews:product==='hayat'?hayatViews:product==='imtun'?imtunViews:consoleViews).includes(view)}
const aliases:Record<string,string>={payments:'finance',access:'passes',team:'people','work-orders':'requests',maintenance:'assets',reports:'invoices'};
export function routeView(path:string,query:string,role:string){const q=new URLSearchParams(query).get('view');if(q)return q;const slug=path.split('/')[2];if(!slug||path===startRoute(role)||Object.values(roleRoutes).some(x=>x[1]===slug))return 'overview';return aliases[slug]??slug}
export function viewRoute(product:Product,view:string,role:string,c?:RouteContext){if(view==='overview')return product===primaryProduct(role)?startRoute(role,c):'/'+product+'/finance';const slug=product==='imtun'?(view==='finance'?'payments':view==='passes'?'access':view):view;return '/'+product+'/'+slug}

export const viewModules:Record<string,string>={finance:'finance',invoices:'finance',expenses:'finance',budgets:'finance',leases:'finance',requests:'requests',defects:'handover',handovers:'handover',passes:'access',announcements:'community',meetings:'community',assets:'maintenance',meters:'meters',documents:'documents',incidents:'access'};
