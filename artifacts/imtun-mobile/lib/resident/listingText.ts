import type {Language} from './text';
import {L,type T} from './text';

export const LT={
 area:['Մակերես (մ²)','Площадь (м²)','Area (m²)'] as T,rooms:['Սենյակներ','Комнаты','Rooms'] as T,floor:['Հարկ','Этаж','Floor'] as T,
 currency:['Արժույթ','Валюта','Currency'] as T,price:['Գին','Цена','Price'] as T,type:['Տեսակ','Тип','Type'] as T,
 sale:['Վաճառք','Продажа','Sale'] as T,rent:['Վարձակալություն','Аренда','Rent'] as T,any:['Բոլորը','Любой','Any'] as T,
 min:['Գին՝ սկսած','Цена от','Min price'] as T,max:['Գին՝ մինչև','Цена до','Max price'] as T,reset:['Մաքրել','Сбросить','Reset'] as T,
 details:['Մանրամասներ','Подробности','Details'] as T,hide:['Թաքցնել','Скрыть','Hide'] as T,
 photos:['Լուսանկարներ','Фотографии','Photos'] as T,upload:['Ավելացնել լուսանկար','Добавить фото','Add photo'] as T,
 delPhoto:['Ջնջել լուսանկարը','Удалить фото','Delete photo'] as T,noPhotos:['Լուսանկար չկա','Фотографий нет','No photos yet'] as T,
 photoRules:['JPEG, PNG կամ WebP, մինչև 6 ՄԲ, առավելագույնը 10','JPEG, PNG или WebP, до 6 МБ, не более 10','JPEG, PNG or WebP, up to 6 MB, max 10'] as T,
 badFile:['Ֆայլը չի համապատասխանում պահանջներին','Файл не подходит по формату или размеру','File type or size not allowed'] as T,
 tooMany:['Առավելագույնը 10 լուսանկար','Не более 10 фотографий','At most 10 photos'] as T,
 uploaded:['Լուսանկարը պահպանվեց','Фото загружено','Photo uploaded'] as T,removed:['Լուսանկարը ջնջվեց','Фото удалено','Photo removed'] as T,
 saved:['Պահպանվեց','Сохранено','Saved'] as T,badNum:['Ստուգեք թվային դաշտերը','Проверьте числовые поля','Check the numeric fields'] as T,
 perm:['Պետք է թույլատրել մուտքը լուսանկարներին','Нужен доступ к фотографиям','Photo library access is needed'] as T,settings:['Բացել կարգավորումները','Открыть настройки','Open settings'] as T,retry:['Կրկնել','Повторить','Retry'] as T,
 reqView:['Դիտման հարցում','Запрос на просмотр','Request a viewing'] as T,when:['Ամսաթիվ և ժամ','Дата и время','Date and time'] as T,
 consent:['Համաձայն եմ, որ իմ դիտման հարցումը տեսնի հարևանս՝ սեփականատերը','Согласен, что владелец-сосед увидит мой запрос на просмотр','I agree the owner, my neighbor, will see this viewing request'] as T,
 confirmSend:['Ուղարկե՞լ դիտման հարցումը','Отправить запрос на просмотр?','Send this viewing request?'] as T,
 sent:['Հարցումն ուղարկվեց','Запрос отправлен','Viewing request sent'] as T,
  changed:['Հայտարարությունը փոխվել է և այլևս հասանելի չէ։ Վերադարձեք ընթացիկ հայտարարություններին։','Объявление изменилось и больше недоступно. Вернитесь к актуальным объявлениям.','This listing has changed and is no longer available. Return to current results.'] as T,
  currentResults:['Վերադառնալ հայտարարություններին','Вернуться к объявлениям','Back to current results'] as T,
 vs:{requested:['Սպասում է','Ожидает ответа','Requested'] as T,confirmed:['Հաստատված','Подтверждён','Confirmed'] as T,declined:['Մերժված','Отклонён','Declined'] as T,cancelled:['Չեղարկված','Отменён','Cancelled'] as T} as Record<string,T>,
 done:{confirm_viewing:['Դիտումը հաստատվեց','Просмотр подтверждён','Viewing confirmed'] as T,decline_viewing:['Դիտումը մերժվեց','Просмотр отклонён','Viewing declined'] as T,cancel_viewing:['Դիտումը չեղարկվեց','Просмотр отменён','Viewing cancelled'] as T} as Record<string,T>,
 priceReq:['Գինը պարտադիր է','Укажите цену','Price is required'] as T,
 viewing:['Դիտում','Просмотр','Viewing'] as T,
 act:{confirm_viewing:['Հաստատել դիտումը','Подтвердить просмотр','Confirm viewing'] as T,decline_viewing:['Մերժել դիտումը','Отклонить просмотр','Decline viewing'] as T,cancel_viewing:['Չեղարկել դիտումը','Отменить просмотр','Cancel viewing'] as T} as Record<string,T>,
};
export const minorToMajor=(v:unknown)=>{const s=String(v??'');if(!/^\d+$/.test(s))return '';const n=BigInt(s);const f=(n%100n).toString().padStart(2,'0');return (n/100n).toString()+(f==='00'?'':'.'+f)};
export const majorToMinor=(s:string):string|null=>{const m=/^(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(s.trim());return m?(BigInt(m[1])*100n+BigInt((m[2]??'').padEnd(2,'0')||'0')).toString():null};
export const optInt=(s:string,min:number,max:number):number|undefined|null=>{if(!s.trim())return undefined;const n=Number(s);return Number.isInteger(n)&&n>=min&&n<=max?n:null};
export const optNum=(s:string,min:number,max:number):number|undefined|null=>{if(!s.trim())return undefined;const n=Number(s.replace(',','.'));return Number.isFinite(n)&&n>=min&&n<=max?n:null};
export const verifiedListingCoordinates=(d:Record<string,unknown>):{latitude:number;longitude:number}|null=>{
 if(d.locationVerificationStatus!=='verified')return null;
 const {latitude,longitude}=d;
 if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
 return {latitude,longitude};
};
export const fmtView=(d:Record<string,unknown>,l:Language)=>d.viewingAt?L(l,LT.viewing)+': '+new Date(String(d.viewingAt)).toLocaleString(l)+(d.viewingStatus?' · '+L(l,LT.vs[String(d.viewingStatus)]??LT.viewing):''):'';
export const parseViewingLocal=(value:string):Date|null=>{
 const m=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
 if(!m)return null;
 const [year,month,day,hour,minute]=m.slice(1).map(Number);
 const date=new Date(year,month-1,day,hour,minute);
 return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day&&date.getHours()===hour&&date.getMinutes()===minute?date:null;
};
export const CURRENCIES=['AMD','RUB','USD'];
export const listingSummary=(d:Record<string,unknown>,l:Language)=>[
 L(l,d.saleType==='rent'?LT.rent:LT.sale),
 `${L(l,LT.price)}: ${minorToMajor(d.priceMinor)} ${String(d.currency??'')}`,
 ...(['area','rooms','floor'] as const).filter(k=>d[k]!=null).map(k=>`${L(l,LT[k])}: ${String(d[k])}`),
].join(' · ');
