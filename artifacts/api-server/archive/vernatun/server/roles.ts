export const roleCatalog={
 platform_admin:{shell:'platform',permissions:['organizations.read','organizations.manage','platform.audit','platform.invite','subscriptions.manage','onboarding.manage']},
 support:{shell:'platform',permissions:['support.queue','support.access.request','support.cases','onboarding.manage']},
 org_admin:{shell:'workspace',permissions:['properties.read','properties.manage','people.read','people.invite','roles.assign','modules.read','modules.manage','audit.read','support.access.approve','imports.manage','support.cases.create','documents.read','documents.manage','organization.settings']},
 portfolio_owner:{shell:'workspace',permissions:['properties.read','billing.read','reports.read','expenses.read','expenses.approve','reports.export','leases.read']},
 developer:{shell:'workspace',permissions:['properties.read','defects.read','defects.manage','defects.accept','handover.read','handover.manage']},
 manager:{shell:'workspace',permissions:['properties.read','people.read','requests.read','requests.assign','workorders.accept','announcements.read','billing.read','announcements.manage','assets.read','assets.manage','meters.manage','meetings.read','meetings.manage','expenses.read','expenses.manage','reports.export','documents.read','documents.manage','leases.read','leases.manage']},
 accountant:{shell:'workspace',permissions:['properties.read','billing.read','billing.calculate','billing.publish','payments.reconcile','expenses.read','expenses.manage','reports.export']},
 dispatcher:{shell:'workspace',permissions:['properties.read','requests.read','requests.assign']},
 technician:{shell:'field',permissions:['workorders.assigned','workorders.execute']},
 contractor:{shell:'field',permissions:['defects.assigned','defects.execute']},
 security:{shell:'field',permissions:['access.validate','access.events','incidents.create']},
 unit_owner:{shell:'home',permissions:['properties.own','billing.own','requests.own','requests.create','announcements.read','residents.delegate','access.create','meters.own','meetings.read','meetings.vote','documents.read','leases.own']},
 renter:{shell:'home',permissions:['properties.own','billing.own','requests.own','requests.create','announcements.read','access.create','meters.own','documents.read','leases.own']},
 family:{shell:'home',permissions:['properties.own','requests.own','requests.create','announcements.read','documents.read']}
} as const;
export type RoleKey=keyof typeof roleCatalog;
export const roleKeys=Object.keys(roleCatalog) as RoleKey[];
// Delegation authority is explicit, not inferred from UI role labels.
export const organizationDelegableRoles:RoleKey[]=['org_admin','portfolio_owner','developer','manager','accountant','dispatcher','technician','contractor','security','unit_owner','renter','family'];
export const moduleForPermission=(p:string)=>p.startsWith('billing.')||p.startsWith('payments.')?'finance':p.startsWith('requests.')||p.startsWith('workorders.')?'requests':p.startsWith('defects.')||p.startsWith('handover.')?'handover':p.startsWith('announcements.')||p.startsWith('meetings.')?'community':p.startsWith('assets.')?'maintenance':p.startsWith('meters.')?'meters':p.startsWith('expenses.')||p.startsWith('leases.')?'finance':p.startsWith('documents.')?'documents':p.startsWith('access.')||p.startsWith('incidents.')?'access':null;
