import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,requireAuth,requirePermission,type Context} from './access.js';
import {globalAdmin,globalQueueLead} from './platform-ops-shared.js';
import type {Request} from 'express';

export const implementationTools=Router();
implementationTools.use(requireAuth);
async function authority(req:Request):Promise<Context>{
 const c=await requirePermission(req,'onboarding.manage');
 if(c.organization_id)throw new ApiError(403,'forbidden');
 return c;
}
implementationTools.get('/platform/implementation-diagnostics',async(req,res)=>{
 const c=await authority(req),all=globalAdmin(c)||globalQueueLead(c);
 // This intentionally does not inspect customer files, secrets, backups,
 // arbitrary SQL or third-party services on behalf of a support operator.
 const schema=(await pool.query(`SELECT
  to_regclass('onboarding_steps') IS NOT NULL
  AND to_regclass('onboarding_events') IS NOT NULL
  AND to_regclass('support_cases') IS NOT NULL AS ready,
  current_timestamp AS checked_at`)).rows[0];
 const stages=(await pool.query(`SELECT count(*)::int AS pending,
  count(*) FILTER(WHERE s.due_on<(now() AT TIME ZONE o.timezone)::date)::int AS overdue
  FROM onboarding_steps s JOIN organizations o ON o.id=s.organization_id
  WHERE s.status<>'completed' AND ($1::boolean OR s.assigned_to=$2)`,[all,req.user!.id])).rows[0];
 res.set('Cache-Control','private, no-store').json({
  checkedAt:schema.checked_at,database:'reachable',schema:schema.ready?'ready':'incomplete',
  pendingStages:stages.pending,overdueStages:stages.overdue,scope:all?'platform':'assigned'
 });
});

// This is authored product documentation, not sample operational data.
// Articles ship with the application; changes follow the normal review/release process.
const articles=[
 {slug:'support-access',
  title:['Աջակցման հասանելիություն','Доступ поддержки','Support access'],
  body:[
   'Գլոբալ աջակցման դերը ինքնին չի բացում կազմակերպության տվյալները։ Նախ խնդրեք ժամանակավոր հասանելիություն, նշեք նպատակը և սպասեք կազմակերպության հաստատմանը։ Ընտրեք հաստատված համատեքստը։ Ժամկետի ավարտից կամ հետ կանչելուց հետո վերադարձրեք հարցումը կազմակերպության ադմինիստրատորին։',
   'Глобальная роль поддержки не открывает данные организации. Запросите временный доступ с целью работы, дождитесь одобрения организации и выберите выданный контекст. После истечения срока или отзыва повторно запросите разрешение. Права разных контекстов не объединяются.',
   'Global support does not grant customer data access. Request temporary access with a purpose, wait for organization approval and select the approved context. After expiry or revocation request approval again. Permissions from different contexts are never merged.']},
 {slug:'import-review',
  title:['Ներմուծման նախադիտում','Предпросмотр импорта','Import preview'],
  body:[
   'Օգտագործեք ներմուծման համապատասխան տեսակը և հաստատված համատեքստը։ Վերբեռնեք ֆայլը, ստուգեք տողերի սխալները և համապատասխանությունները։ Նախադիտումը չի հրապարակում տվյալները։ Սխալները շտկելուց հետո հաստատեք ներմուծումը առանձին գործողությամբ և ստուգեք արդյունքների պատմությունը։',
   'Выберите нужный тип импорта в одобренном контексте. Загрузите файл и проверьте ошибки строк и сопоставления. Предпросмотр не публикует данные. Исправьте ошибки, отдельно подтвердите применение и проверьте историю результата. Финансовый импорт требует финансового разрешения.',
   'Choose the correct import type in an approved context. Upload the file and review row errors and mappings. Preview does not publish records. Correct errors, explicitly confirm application and review the result history. Financial imports require the financial permission.']},
 {slug:'roles-and-scope',
  title:['Դերեր և սահմաններ','Роли и границы доступа','Roles and access scope'],
  body:[
   'Աշխատակցի քարտում ստուգեք նշանակման կազմակերպությունը, շենքը, տարածքը և ժամկետը։ Անհատական դերը չի կարող ընդլայնել բազային դերի սահմանները։ Հասանելիության բացատրիչում ընտրեք թույլտվությունը, HTTP գործողությունը և անհրաժեշտ ռեսուրսը։ Արգելքը կարող է պայմանավորված լինել մոդուլով, բաժանորդագրությամբ, MFA-ով կամ նշանակման վիճակով։',
   'В карточке сотрудника проверьте организацию, здание, помещение и срок назначения. Пользовательский профиль не расширяет базовую роль. В отладчике доступа укажите разрешение, HTTP-метод и ресурс. Причиной отказа могут быть модуль, подписка, MFA или состояние назначения. Не устраняйте отказ выдачей глобальной роли.',
   'Check the assignment organization, building, unit and validity dates in the employee card. A custom profile cannot widen its base role. In the access debugger select the permission, HTTP method and resource. Modules, subscriptions, MFA and assignment state can deny access. Do not resolve a denial by granting a global role.']},
 {slug:'delivery-evidence',
  title:['Նամակների առաքման ապացույց','Подтверждение доставки писем','Email delivery evidence'],
  body:[
   'Պրովայդերի ընդունումը դեռ առաքում չէ։ Ստուգեք accepted, sent, delivered, delayed, bounced, complained կամ failed ապացույցները էլփոստի գործողությունների բաժնում։ Նորից ուղարկելուց առաջ ստուգեք հասցեն և դոմենի կարգավորումը։ Գաղտնի բանալիները և հրավերի հղումները մի ավելացրեք աջակցման նշումներում։',
   'Принятие провайдером не означает доставку адресату. Проверяйте отдельные события accepted, sent, delivered, delayed, bounced, complained и failed в почтовых операциях. Перед повторной отправкой проверьте адрес и готовность домена. Не копируйте ключи, секреты и приглашения в заметки поддержки.',
   'Provider acceptance is not recipient delivery. Check separate accepted, sent, delivered, delayed, bounced, complained and failed evidence in email operations. Before retrying, verify the address and domain readiness. Never copy keys, secrets or invitation links into support notes.']},
 {slug:'bank-reconciliation',
  title:['Բանկային համադրում','Банковская сверка','Bank reconciliation'],
  body:[
   'Ներմուծեք բանկային քաղվածքը CSV ձևաչափով, ստուգեք տողերի վավերացումը և կրկնությունները։ Համադրեք վճարողին ու տարածքը, ապա բաշխեք հասանելի գումարը հաշիվներին։ Ներմուծված տողը ինքնին չի նշանակում փակված պարտք։ Բնակիչը տեսնում է միայն իր հասանելի հրապարակված հաշվարկները։',
   'Импортируйте CSV-выписку, проверьте валидацию и дубли. Сопоставьте плательщика и помещение, затем распределите доступную сумму по счетам. Сам импорт строки не означает погашение долга. Житель видит только доступные ему опубликованные начисления. Автоматическая связь с банком настраивается отдельно.',
   'Import a CSV statement and review validation and duplicates. Match the payer and unit, then allocate available credit to invoices. Importing a row does not itself settle an invoice. A resident sees only their authorized published charges. A direct bank connection is configured separately.']}
] as const;
implementationTools.get('/platform/knowledge-base',async(req,res)=>{
 await authority(req);
 const language=z.enum(['hy','ru','en']).default('hy').parse(req.query.language);
 const index=language==='hy'?0:language==='ru'?1:2;
 res.set('Cache-Control','private, no-store').json(articles.map(a=>({slug:a.slug,title:a.title[index],body:a.body[index]})));
});
