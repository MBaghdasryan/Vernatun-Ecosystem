import {useState} from 'react';
import type {Language} from '../../portal/i18n';
import {safeError} from './text';
export function useAct(l:Language,refresh:()=>void){const [busy,setBusy]=useState(false),[err,setErr]=useState('');return {busy,err,run:async(fn:()=>Promise<unknown>)=>{setBusy(true);setErr('');try{await fn()}catch(e){setErr(safeError(l,e))}finally{setBusy(false);refresh()}}}}
