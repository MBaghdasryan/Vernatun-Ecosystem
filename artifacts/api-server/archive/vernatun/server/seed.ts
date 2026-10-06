import {pool} from './db.js';
import {config} from './config.js';
import {roleCatalog,roleKeys,type RoleKey} from './roles.js';
import {randomBytes} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {mkdir,writeFile} from 'node:fs/promises';
if(config.NODE_ENV==='production'||config.DEMO_SEED_ENABLED!=='true')throw new Error('Demo seed requires development/test and DEMO_SEED_ENABLED=true');
const output=config.NODE_ENV==='test'?'.local/test':'.local';
const client=await pool.connect();
try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(6172922)');if((await client.query("SELECT id FROM users WHERE email='platform.admin@vernatun.test'")).rowCount){console.log('Demo seed already exists; data preserved.');await client.query('ROLLBACK')}else{
for(const key of roleKeys){const role=roleCatalog[key];await client.query('INSERT INTO roles(key,shell) VALUES($1,$2) ON CONFLICT DO NOTHING',[key,role.shell]);for(const p of role.permissions){await client.query('INSERT INTO permissions(key) VALUES($1) ON CONFLICT DO NOTHING',[p]);await client.query('INSERT INTO role_permissions(role_key,permission_key) VALUES($1,$2) ON CONFLICT DO NOTHING',[key,p])}}
const orgA=(await client.query("INSERT INTO organizations(name,is_demo) VALUES('Դեմո կառավարում · Հյուսիս',true) RETURNING id")).rows[0].id;
const orgB=(await client.query("INSERT INTO organizations(name,is_demo) VALUES('Դեմո կառավարում · Հարավ',true) RETURNING id")).rows[0].id;
const ba=(await client.query("INSERT INTO buildings(organization_id,name,address,is_demo) VALUES($1,'Demo Park','Երևան · ցուցադրական հասցե',true) RETURNING id",[orgA])).rows[0].id;
const bb=(await client.query("INSERT INTO buildings(organization_id,name,address,is_demo) VALUES($1,'Demo Residence','Երևան · ցուցադրական հասցե',true) RETURNING id",[orgB])).rows[0].id;
const ua=(await client.query("INSERT INTO units(organization_id,building_id,number,area,is_demo) VALUES($1,$2,'102',56.4,true) RETURNING id",[orgA,ba])).rows[0].id;
const ua2=(await client.query("INSERT INTO units(organization_id,building_id,number,area,is_demo) VALUES($1,$2,'103',72.1,true) RETURNING id",[orgA,ba])).rows[0].id;
const ub=(await client.query("INSERT INTO units(organization_id,building_id,number,area,is_demo) VALUES($1,$2,'201',62,true) RETURNING id",[orgB,bb])).rows[0].id;
for(const org of [orgA,orgB])for(const module of ['requests','finance','handover','access','community','maintenance','meters','documents'])await client.query('INSERT INTO module_entitlements(organization_id,module) VALUES($1,$2)',[org,module]);
const emails:Record<RoleKey,string>={platform_admin:'platform.admin',support:'support',org_admin:'org.admin',portfolio_owner:'portfolio.owner',developer:'developer',manager:'manager',accountant:'accountant',dispatcher:'dispatcher',technician:'technician',contractor:'contractor',security:'security',unit_owner:'unit.owner',renter:'renter',family:'family'};
const names=['Իվան Պետրով','Դավիթ Մինասյան','Աննա Հարությունյան','Սերգեյ Պետրով','Արմեն Սարգսյան','Իվան Հարությունյան','Բորիս Սարգսյան','Մարիա Կովալևա','Արտեմ Գրիգորյան','Նարեկ Ավետիսյան','Սամվել Պետրոսյան','Աննա Պետրոսյան','Միքայել Սարգսյան','Արման Պետրոսյան'];
const accounts:Record<string,{id:string;email:string;password:string;role:string}>={};
for(const [i,key] of roleKeys.entries()){const email=emails[key]+'@vernatun.test',password=randomBytes(18).toString('base64url');const id=(await client.query('INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING id',[email,names[i],await bcrypt.hash(password,12)])).rows[0].id;const org=key==='platform_admin'||key==='support'?null:orgA;const unit=['unit_owner','renter','family'].includes(key)?ua:null;const building=unit||['portfolio_owner','technician','contractor','security'].includes(key)?ba:null;if(org)await client.query('INSERT INTO memberships(user_id,organization_id) VALUES($1,$2)',[id,org]);await client.query('INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,org,key,building,unit,key==='renter'?new Date(Date.now()+30*86400000):null]);accounts[key]={id,email,password,role:key};}
// A real second context, not a role switch that grants privileges.
await client.query("INSERT INTO role_assignments(user_id,organization_id,role_key) VALUES($1,$2,'manager')",[accounts.org_admin.id,orgA]);
const password=randomBytes(18).toString('base64url');const second=(await client.query("INSERT INTO users(email,name,password_hash) VALUES('second.org@vernatun.test','Երկրորդ կազմակերպության օգտատեր',$1) RETURNING id",[await bcrypt.hash(password,12)])).rows[0].id;
await client.query('INSERT INTO memberships(user_id,organization_id) VALUES($1,$2)',[second,orgB]);await client.query("INSERT INTO role_assignments(user_id,organization_id,role_key) VALUES($1,$2,'org_admin')",[second,orgB]);accounts.second_org={id:second,email:'second.org@vernatun.test',password,role:'org_admin'};
for(const [payer,amount] of [[accounts.unit_owner.id,2450000],[accounts.renter.id,1250000]] as const)await client.query("INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status,is_demo) VALUES($1,$2,$3,'2026-09-01',$4,'AMD','published',true)",[orgA,ua,payer,amount]);
await client.query("INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status,is_demo) VALUES($1,$2,$3,'2026-09-01',3200000,'AMD','published',true)",[orgB,ub,second]);
await client.query("INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject,is_demo) VALUES($1,$2,$3,'Մուտքի լուսավորությունը չի աշխատում',true)",[orgA,ua,accounts.unit_owner.id]);
await client.query("INSERT INTO audit_events(actor_user_id,action,entity_type,details) VALUES($1,'demo.seed','system','{\"demo\":true}')",[accounts.platform_admin.id]);
await mkdir(output,{recursive:true});await writeFile(output+'/demo-accounts.json',JSON.stringify({accounts,fixtures:{orgA,orgB,ba,bb,ua,ua2,ub}},null,2),{mode:0o600});await writeFile(output+'/demo-accounts.md','# Local demo credentials\n\nDevelopment only. Do not publish or share this file.\n\n'+Object.values(accounts).map(a=>`- ${a.email} — ${a.password}`).join('\n')+'\n',{mode:0o600});await client.query('COMMIT');console.log('Created 15 demo accounts across 2 organizations. Credentials: .local/demo-accounts.md (not logged).');}
}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();await pool.end()}
