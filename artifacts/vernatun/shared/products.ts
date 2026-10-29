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
const osViews=['resident','roles','ownership','analytics','scorecard','meetings','finance','budgets','expenses','leases','handovers','defects','subscriptions','properties','units','people','invitations','modules','audit','imports','documents','invoices','payments','support','support-cases','incidents','edge','edge-inventory','edge-health'];
const hayatViews=['calendar','ownership','analytics','scorecard','budgets','support-cases','requests','properties','units','people','assets','meters','announcements','meetings','passes','defects','documents','audit','incidents','edge','edge-health'];
const imtunViews=['online-payments','utilities','ownership','support-cases','finance','invoices','requests','meters','announcements','documents','passes','delegations','meetings','leases','properties','edge-devices','building','vehicles','devices','agreements','contacts','directory','services','community','marketplace','help','feedback','preferences'];
const consoleViews=['resident','users','roles','permissions','organizations','invitations','subscriptions','payments','onboarding','tasks','support-cases','support','audit','properties','units','requests','imports','email','system','edge','edge-inventory','edge-health'];
export function viewInProduct(product:Product,view:string){return ['overview','settings','notifications','broadcasts'].includes(view)||(product==='os'?osViews:product==='hayat'?hayatViews:product==='imtun'?imtunViews:consoleViews).includes(view)}
const aliases:Record<string,string>={payments:'finance',access:'passes',team:'people','work-orders':'requests',maintenance:'assets',reports:'invoices','edge-inventory':'edge','edge-health':'edge'};
export function routeView(path:string,query:string,role:string){const q=new URLSearchParams(query).get('view');if(q)return q==='edge-inventory'||q==='edge-health'?'edge':q;const slug=path.split('/')[2];if(slug==='onboarding')return 'onboarding';if(slug==='payments'&&!path.startsWith('/imtun'))return 'payments';if(!slug||path===startRoute(role)||Object.values(roleRoutes).some(x=>x[1]===slug))return 'overview';return aliases[slug]??slug}
export function viewRoute(product:Product,view:string,role:string,c?:RouteContext){if(view==='overview')return product===primaryProduct(role)?startRoute(role,c):'/'+product+'/finance';if(product==='imtun'&&view==='online-payments')return '/imtun/payments?view=online-payments';const slug=product==='imtun'?(view==='finance'?'payments':view==='passes'?'access':view):view;return '/'+product+'/'+slug}

// Edge administration is permission-gated and global for platform admins; the API applies tenant module entitlement to organization-scoped users.
export const viewModules:Record<string,string>={'online-payments':'finance',utilities:'finance',calendar:'requests',analytics:'finance',scorecard:'handover',finance:'finance',invoices:'finance',expenses:'finance',budgets:'finance',leases:'finance',requests:'requests',defects:'handover',handovers:'handover',passes:'access',announcements:'community',meetings:'community',assets:'maintenance',meters:'meters',documents:'documents',incidents:'access','edge-devices':'smart_building'};
