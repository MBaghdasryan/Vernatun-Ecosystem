import {useEffect,useRef,useState} from 'react';
import type {BankEntryInput} from '@workspace/api-client-react';
import {request,ApiClientError} from './client';
import type {Language} from './i18n';
export type Row=Record<string,any>;
export const F={
 workspace:['Ֆինանսական աշխատանքային տարածք','Финансовое рабочее место','Finance workspace'],batches:['Հաշիվների փաթեթներ','Пакеты счетов','Billing batches'],bank:['Բանկային համադրում','Банковская сверка','Bank reconciliation'],credits:['Կրեդիտներ','Кредиты','Credits'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],retry:['Կրկնել','Повторить','Retry'],refresh:['Թարմացնել','Обновить','Refresh'],empty:['Տվյալներ չկան','Данных нет','Nothing here yet'],
 error:['Գործողությունը չհաջողվեց։','Действие не выполнено.','Action failed.'],
 stale_version:['Գրառումը փոխվել է։ Թարմացրեք և վերանայեք։','Запись изменена. Обновите и перепроверьте.','Record changed. Refresh and review.'],
 batch_preview_changed:['Նախադիտումը հնացել է։ Չեղարկեք փաթեթը և ստեղծեք նոր նախադիտում։','Расчёт устарел. Отмените пакет и создайте новый предпросмотр.','The preview is out of date. Cancel this batch and create a new preview.'],
 bank_reference_conflict:['Բանկային հղումը արդեն կա այլ տվյալներով։','Банковская ссылка уже есть с другими данными.','A bank reference already exists with different data.'],
 allocation_exceeds_payment:['Բաշխումը գերազանցում է վճարումը։','Распределение превышает платёж.','Allocation exceeds the payment.'],allocation_exceeds_invoice:['Բաշխումը գերազանցում է հաշվի մնացորդը։','Распределение превышает остаток счёта.','Allocation exceeds the invoice balance.'],
 uncertain:['Արդյունքը անհայտ է։ Նույն հարցումը կարելի է կրկնել նույն բանալիով, կամ լքել՝ թարմացնելուց հետո։','Результат неизвестен. Можно повторить тот же запрос с тем же ключом или отказаться после обновления.','Outcome unknown. Retry the same request with the same key, or abandon it after refreshing.'],
 retrySame:['Կրկնել նույն հարցումը','Повторить тот же запрос','Retry same request'],abandon:['Լքել և թարմացնել','Отказаться и обновить','Abandon and refresh'],
 building:['Շենք','Здание','Building'],period:['Ժամանակաշրջան','Период','Period'],tariff:['Սակագին','Тариф','Tariff'],preview:['Նախադիտում','Предпросмотр','Preview'],saveDraft:['Պահպանել սևագիր','Сохранить черновик','Save draft'],
 draftNote:['Սևագիրը հաշիվներ չի ստեղծում։','Черновик не создаёт счета.','A draft creates no invoices.'],units:['Տարածքներ','Помещения','Units'],charges:['Գանձումներ','Начисления','Charges'],total:['Ընդհանուր','Итого','Total'],unit:['Տարածք','Помещение','Unit'],amount:['Գումար','Сумма','Amount'],
 warnings:['Զգուշացումներ','Предупреждения','Warnings'],ackWarnings:['Հաստատում եմ զգուշացումները','Подтверждаю предупреждения','I acknowledge the warnings'],publish:['Հրապարակել','Опубликовать','Publish'],cancel:['Չեղարկել','Отменить','Cancel'],status:['Կարգավիճակ','Статус','Status'],
 useLatest:['Օգտագործել վերջին տարբերակը','Использовать последнюю версию','Use latest version'],publishedNote:['Հրապարակված գրառումները չեն խմբագրվում։','Опубликованные записи не редактируются.','Published records are not edited.'],
 account:['Բանկային հաշիվ','Банковский счёт','Bank account'],csv:['CSV քաղվածք','CSV-выписка','CSV statement'],csvFormat:['Պարտադիր վերնագրի տող։ Բաժանիչ՝ ստորակետ, կետ-ստորակետ կամ tab։ Գումարը՝ նշանով (մուտք +, ելք −), առավելագույնը 2 տասնորդական, առանց հազարների բաժանիչի։ Մինչև 1000 տող, 1 ՄԲ։ Ֆայլը չի պահվում։','Нужна строка заголовков. Разделитель: запятая, точка с запятой или tab. Сумма со знаком (приход +, расход −), до 2 знаков, без разделителей тысяч. До 1000 строк, 1 МБ. Файл не сохраняется.','Header row required. Delimiter: comma, semicolon or tab. Signed amounts (incoming +, outgoing −), up to 2 decimals, no thousands separators. Up to 1000 rows, 1 MB. The file is not stored.'],
 delimiter:['Բաժանիչ','Разделитель','Delimiter'],auto:['Ավտո','Авто','Auto'],decimal:['Տասնորդական նշան','Десятичный знак','Decimal mark'],dateFmt:['Ամսաթվի ձևաչափ','Формат даты','Date format'],defCur:['Արժույթ (եթե սյունակ չկա)','Валюта (если нет столбца)','Currency (if no column)'],
 cExternal:['Արտաքին համար','Внешний ID','External id'],cDate:['Ամսաթիվ','Дата','Date'],cAmount:['Գումար','Сумма','Amount'],cCurrency:['Արժույթի սյունակ','Столбец валюты','Currency column'],cPayer:['Վճարող','Плательщик','Payer'],cPurpose:['Նպատակ','Назначение','Purpose'],none:['—','—','—'],
 rowErrors:['Տողերի սխալներ։ Ոչինչ չի գուժվում, ուղղեք ֆայլը կամ համապատասխանեցումը։','Ошибки строк. Ничего не угадывается: исправьте файл или сопоставление.','Row errors. Nothing is guessed: fix the file or mapping.'],rows:['տող','строк','rows'],
 previewImport:['Ստուգել ներմուծումը','Проверить импорт','Preview import'],importBtn:['Ներմուծել քաղվածքը','Импортировать выписку','Import statement'],importNote:['Ներմուծումը միայն ապացույց է, վճար չի ստեղծում։','Импорт сохраняет только выписку и не создаёт платежи.','Import stores statement evidence only. It creates no payments.'],
 newRows:['Նոր','Новых','New'],dupRows:['Կրկնություն','Дубликатов','Duplicates'],confRows:['Հակասություն','Конфликтов','Conflicts'],outgoing:['Ելքային գործարքը չի համադրվում','Исходящая операция не сверяется','Outgoing is not reconcilable'],
 imports:['Ներմուծումներ','Импорты','Imports'],transactions:['Գործարքներ','Операции','Transactions'],all:['Բոլորը','Все','All'],matched:['Համադրված','Сверено','Matched'],partially_matched:['Մասնակի','Частично','Partially matched'],unmatched:['Չհամադրված','Не сверено','Unmatched'],ignored:['Անտեսված','Игнорировано','Ignored'],
 review:['Վերանայում','Проверка','Review'],suggestions:['Հուշումներ (խորհրդատու են, ավտոմատ չեն հաստատվում)','Подсказки (только совет, автоматически не подтверждаются)','Suggestions (advisory only, never auto-confirmed)'],payer:['Վճարող','Плательщик','Payer'],invoice:['Հաշիվ','Счёт','Invoice'],balance:['Մնացորդ','Остаток','Balance'],allocate:['Բաշխել','Распределить','Allocate'],
 openingBalance:['Սկզբնական մնացորդ','Начальное сальдо','Opening balance'],fullCredit:['Բաշխում չկա․ ամբողջ գումարը կդառնա հաշվի կրեդիտ։','Без распределения вся сумма станет кредитом лицевого счёта.','No allocation: the full amount becomes account credit.'],reviewed:['Ստուգել եմ տարածքը, վճարողին և գումարները','Я проверил помещение, плательщика и суммы','I reviewed unit, payer and amounts'],confirm:['Հաստատել վճարումը','Подтвердить платёж','Confirm payment'],
 ignore:['Անտեսել','Игнорировать','Ignore'],reason:['Պատճառ (առնվազն 3 նիշ)','Причина (не менее 3 символов)','Reason (min 3 characters)'],noCandidates:['Հուշումներ չկան','Подсказок нет','No suggestions'],orgOnly:['Բանկային գործիքները հասանելի են միայն կազմակերպության մակարդակի դերով։','Банковские инструменты доступны только в роли уровня организации.','Bank tools require an organization-wide role.'],
 credit:['Կրեդիտ','Кредит','Credit'],allocations:['Բաշխումներ','Распределения','Allocations'],noCredit:['Կրեդիտ չկա','Кредита нет','No credit'],zeroRO:['Զրոյական կրեդիտ՝ միայն դիտման համար','Нулевой кредит, только чтение','Zero credit, read only'],done:['Պահպանված է','Сохранено','Saved'],date:['Ամսաթիվ','Дата','Date'],purpose:['Նպատակ','Назначение','Purpose'],
 tooBig:['Ֆայլը մեծ է 1 ՄԲ-ից։','Файл больше 1 МБ.','File is larger than 1 MB.'],tooMany:['Թույլատրվում է 1–1000 տող։','Допустимо 1–1000 строк.','1 to 1000 rows are allowed.'],badMoney:['Անվավեր գումար','Некорректная сумма','Invalid amount'],badDate:['Անվավեր ամսաթիվ','Некорректная дата','Invalid date'],badCur:['Անվավեր արժույթ','Некорректная валюта','Invalid currency'],missing:['Դաշտը դատարկ է կամ երկար է','Поле пустое или слишком длинное','Field is empty or too long'],dupId:['Կրկնվող արտաքին համար ֆայլում','Повтор внешнего ID в файле','Duplicate external id in file'],cols:['Սյունակների քանակը չի համապատասխանում','Число столбцов не совпадает','Column count mismatch'],quote:['Չփակված չակերտ','Незакрытая кавычка','Unterminated quote'],noHeader:['Վերնագիր չկա','Нет заголовка','No header'],
 bankStatement:['Բանկային քաղվածքի ներմուծում','Импорт банковской выписки','Bank-statement import'],imported:['Ներմուծված','Импортировано','Imported'],duplicates:['Կրկնություն','Дубликатов','Duplicates'],minorMode:['Գումարի միավոր','Единицы суммы','Amount units'],major:['Հիմնական (օր. 12.50)','Основные (напр. 12.50)','Major units (e.g. 12.50)'],minor:['Փոքր միավոր (ամբողջ թիվ, չի բազմապատկվում)','Минорные (целое, не умножается)','Minor units (integer, not multiplied)'],discard:['Հեռացնել սևագիրը','Сбросить черновик','Discard draft'],searchBank:['Որոնում','Поиск','Search'],prev:['Նախորդ','Назад','Previous'],next:['Հաջորդ','Вперёд','Next'],pageLbl:['Էջ','Страница','Page'],mapReq:['Համապատասխանեցրեք սյունակները','Сопоставьте столбцы','Map the columns']} as const;
export const ft=(l:Language,k:keyof typeof F)=>F[k][l==='hy'?0:l==='ru'?1:2];
export const codeText=(l:Language,e:unknown)=>{if(e instanceof ApiClientError){if(e.code in F)return ft(l,e.code as keyof typeof F);return ft(l,'error')+' ('+e.code+')'}return ft(l,'error')};
export const isUncertain=(e:unknown)=>e instanceof ApiClientError&&(e.code==='connection'||e.code==='service_unavailable'||e.status>=500||e.status===0);
import {toMinor,toMinorUnits,toDay} from './finance-data';
export {toMinor,toMinorUnits,fromMinor,validDay,toDay,detectDelimiter,parseCsv} from './finance-data';
// One frozen intent per mutation: same UUID and payload until success or a definite 4xx.
// A generation counter invalidates in-flight work after reset/unmount so an old finally never touches a newer operation.
export function useIntent(){
 const ref=useRef<{key:string;path:string;body:Row}|null>(null);const [uncertain,setUncertain]=useState(false);const busy=useRef(false);const [pending,setPending]=useState(false);const gen=useRef(0);
 useEffect(()=>{return()=>{gen.current++;ref.current=null;busy.current=false}},[]);
 async function send<T>(path:string,make:(key:string)=>Row,live:()=>boolean):Promise<T|undefined>{
  if(busy.current)return;busy.current=true;setPending(true);const g=gen.current;const ok=()=>g===gen.current&&live();
  if(!ref.current){const key=crypto.randomUUID();ref.current={key,path,body:make(key)}}
  const cur=ref.current;
  try{const r=await request<T>(cur.path,'POST',cur.body);if(g!==gen.current)return;ref.current=null;if(ok())setUncertain(false);return ok()?r:undefined}
  catch(e){if(g!==gen.current)throw e;if(isUncertain(e)){if(ok())setUncertain(true)}else{ref.current=null;if(ok())setUncertain(false)}throw e}
  finally{if(g===gen.current){busy.current=false;setPending(false)}}}
 const reset=()=>{gen.current++;ref.current=null;busy.current=false;setUncertain(false);setPending(false)};
 return {send,uncertain,pending,reset};
}
export type BankMap={externalId:string;date:string;amount:string;currency:string;payer:string;purpose:string};
export type BankOpts={decimal:'.'|',';fmt:'iso'|'dmy';cur:string;mode:'major'|'minor'};
const CURS=['AMD','RUB','USD'];
export function buildBankEntries(rows:string[][],m:BankMap,o:BankOpts,l:Language){
 const [head,...body]=rows;const idx=(h:string)=>h===''?-1:head.indexOf(h);const ix={e:idx(m.externalId),d:idx(m.date),a:idx(m.amount),c:idx(m.currency),p:idx(m.payer),u:idx(m.purpose)};
 const errors:{row:number;msg:string}[]=[];const entries:BankEntryInput[]=[];const seen=new Set<string>();
 body.forEach((r,n)=>{const row=n+2;const err=(k:keyof typeof F)=>errors.push({row,msg:ft(l,k)});
  if(r.length!==head.length){err('cols');return}
  const ext=r[ix.e].trim(),pay=r[ix.p].trim(),pur=ix.u<0?'':r[ix.u].trim();
  if(!ext||ext.length>160||pay.length>200||pur.length>1000){err('missing');return}
  const day=toDay(r[ix.d],o.fmt);if(!day){err('badDate');return}
  const amt=o.mode==='minor'?toMinorUnits(r[ix.a]):toMinor(r[ix.a],o.decimal,true);if(!amt){err('badMoney');return}
  const cell=ix.c>=0?r[ix.c].trim():'';const cur=(cell||o.cur).toUpperCase();if(!CURS.includes(cur)){err('badCur');return}
  if(seen.has(ext)){err('dupId');return}seen.add(ext);
  const raw:Record<string,string>={};head.forEach((h,i)=>{if(h&&![ix.e,ix.d,ix.a,ix.c,ix.p,ix.u].includes(i)&&r[i]!=='')raw[h.slice(0,60)]=r[i].slice(0,300)});
  entries.push({externalId:ext,date:day,amountMinor:amt,currency:cur as BankEntryInput['currency'],payerText:pay,purpose:pur,...(Object.keys(raw).length?{rawPayload:raw}:{})})});
 return {entries,errors}}
