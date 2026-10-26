import type {Language} from '../../portal/i18n';
import {L,type T} from './text';
const values:Record<string,T>={
 management:['Կառավարում','Управление','Management'],security:['Անվտանգություն','Охрана','Security'],
 concierge:['Դռնապան','Консьерж','Concierge'],technician:['Տեխնիկ','Техник','Technician'],
 cleaning:['Մաքրություն','Уборка','Cleaning'],emergency:['Արտակարգ կապ','Экстренная связь','Emergency'],
 other:['Այլ','Другое','Other'],general:['Ընդհանուր','Общее','General'],
 terms:['Օգտագործման պայմաններ','Условия использования','Terms of use'],
 privacy:['Գաղտնիություն','Конфиденциальность','Privacy'],hoa:['Համատիրություն','Товарищество','Association'],
 marketing:['Մարքեթինգ','Маркетинг','Marketing'],notifications:['Ծանուցումներ','Уведомления','Notifications'],
 ai:['Արհեստական բանականություն','Искусственный интеллект','AI'],biometric:['Կենսաչափություն','Биометрия','Biometrics'],
 idea:['Գաղափար','Идея','Idea'],improvement:['Բարելավում','Улучшение','Improvement'],problem:['Խնդիր','Проблема','Problem'],
 sale:['Վաճառք','Продажа','For sale'],rent:['Վարձակալություն','Аренда','For rent'],
 car:['Ավտոմեքենա','Автомобиль','Car'],motorcycle:['Մոտոցիկլ','Мотоцикл','Motorcycle'],bicycle:['Հեծանիվ','Велосипед','Bicycle'],
 hy:['Հայերեն','Армянский','Armenian'],ru:['Ռուսերեն','Русский','Russian'],en:['Անգլերեն','Английский','English'],
};
export function metaValue(key:string,value:unknown,l:Language){
 const s=String(value);
 if(['category','saleType','vehicleType'].includes(key)&&values[s])return L(l,values[s]);
 if(key==='priceMinor'&&/^\d+$/.test(s)){
  const n=BigInt(s),decimal=new Intl.NumberFormat(l).formatToParts(1.1).find(p=>p.type==='decimal')?.value??'.';
  return new Intl.NumberFormat(l).format(n/100n)+decimal+(n%100n).toString().padStart(2,'0');
 }
 return s;
}
