import type {Language} from './i18n';
const messages:Record<string,[string,string,string]>={
 mfa_enrollment_required:['Այս դերի համար MFA-ն պարտադիր է։ Բացեք կարգավորումները և միացրեք երկգործոն պաշտպանությունը։','Для этой роли обязательна MFA. Откройте настройки и подключите двухфакторную защиту.','MFA is required for this role. Open settings and enroll in two-factor authentication.'],
 mfa_verification_required:['Շարունակելու համար կարգավորումներում հաստատեք գաղտնաբառը և MFA կոդը։','Для продолжения подтвердите пароль и код MFA в настройках.','To continue, verify your password and MFA code in settings.'],
 mfa_policy_required:['MFA-ն չի կարող անջատվել, քանի դեռ դերի քաղաքականությունը պահանջում է այն։','Нельзя отключить MFA, пока политика роли требует её.','MFA cannot be disabled while a role policy requires it.'],
};
export function phase8Error(code:string,language:Language){return messages[code]?.[language==='hy'?0:language==='ru'?1:2]}
