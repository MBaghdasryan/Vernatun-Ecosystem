import {useQuery} from '@tanstack/react-query';
import {getResidentContinuity} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import type {T} from '../superapp/text';
export {L,safeError} from '../superapp/text';
export type {T};
export const newId=():string=>crypto.randomUUID();
export const contKey=(ctx:string)=>['resident-continuity',ctx] as const;
export function useContinuity(ctx:string){return useQuery({queryKey:contKey(ctx),queryFn:()=>getResidentContinuity()})}
export const tt=(l:Language,hy:string,ru:string,en:string)=>l==='hy'?hy:l==='ru'?ru:en;
export const fmtTime=(l:Language,v:string)=>new Date(v).toLocaleString(l==='hy'?'hy-AM':l==='ru'?'ru-RU':'en-GB');
export const status=(e:unknown)=>Number((e as {status?:unknown})?.status);
export const needsReauth=(e:unknown):boolean=>{const s=status(e);if(s!==401&&s!==403)return false;try{return JSON.stringify((e as {data?:unknown}).data??'').includes('recent_auth')}catch{return false}};
