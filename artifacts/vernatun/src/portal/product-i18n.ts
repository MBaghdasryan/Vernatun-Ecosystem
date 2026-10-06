import type {Language} from './i18n';
const words={product:['Արտադրանք և աշխատանքային համատեքստ','Продукт и рабочий контекст','Product and work context'],internal:['Ներքին կառավարման միջավայր','Внутренний контур платформы','Internal platform workspace'],switching:['Համատեքստի փոփոխում…','Смена контекста…','Switching context…']} as const;
export const productText=(key:keyof typeof words,l:Language)=>words[key][l==='hy'?0:l==='ru'?1:2];
