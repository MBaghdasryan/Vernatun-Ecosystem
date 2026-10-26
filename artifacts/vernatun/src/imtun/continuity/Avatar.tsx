import {useCallback,useEffect,useState} from 'react';
import {deleteResidentAvatar,getResidentAvatar,uploadResidentAvatar} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import {useAct} from '../superapp/useAct';
import {tt} from './core';
import './continuity.css';
const MAX=3*1024*1024,OK=['image/jpeg','image/png','image/webp'];
async function sanitize(f:File):Promise<Blob>{
 const bmp=await createImageBitmap(f),k=Math.min(1,512/Math.max(bmp.width,bmp.height)),cv=document.createElement('canvas');
 cv.width=Math.round(bmp.width*k);cv.height=Math.round(bmp.height*k);
 const g=cv.getContext('2d');if(!g)throw new Error('canvas');g.drawImage(bmp,0,0,cv.width,cv.height);bmp.close();
 return new Promise((res,rej)=>cv.toBlob(b=>b?res(b):rej(new Error('encode')),'image/jpeg',0.86));}
export default function Avatar({l,available,ctx,refresh}:{l:Language;available:boolean;ctx:string;refresh:()=>void}){
 const [url,setUrl]=useState(''),[msg,setMsg]=useState(''),a=useAct(l,refresh);
 useEffect(()=>{let live=true,obj='';setUrl('');if(!available)return;
  void getResidentAvatar().then(b=>{if(!live)return;obj=URL.createObjectURL(b);setUrl(obj)}).catch(()=>{if(live)setMsg(tt(l,'Նկարը չհաջողվեց բեռնել։','Не удалось загрузить фото.','Could not load the photo.'))});
  return()=>{live=false;if(obj)URL.revokeObjectURL(obj)}},[available,ctx,l]);
 const pick=useCallback((f:File|undefined)=>{setMsg('');if(!f)return;
  if(!OK.includes(f.type)){setMsg(tt(l,'Թույլատրվում են JPEG, PNG, WebP։','Допустимы JPEG, PNG, WebP.','Only JPEG, PNG or WebP are allowed.'));return}
  if(f.size>MAX){setMsg(tt(l,'Նկարը 3 ՄԲ-ից մեծ է։','Файл больше 3 МБ.','The file is larger than 3 MB.'));return}
  void a.run(async()=>{await uploadResidentAvatar(await sanitize(f))})},[a,l]);
 return <section className="im-card sx-form" aria-labelledby="cx-av"><h3 id="cx-av">{tt(l,'Պրոֆիլի նկար','Фото профиля','Profile photo')}</h3>
 {url?<img src={url} alt={tt(l,'Ձեր նկարը','Ваше фото','Your photo')} width={96} height={96} style={{borderRadius:'50%',objectFit:'cover'}}/>:<p>{tt(l,'Նկար չկա','Фото не загружено','No photo')}</p>}
 <label>{tt(l,'Ընտրել նկար','Выбрать фото','Choose a photo')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={a.busy} onChange={e=>{pick(e.target.files?.[0]);e.target.value=''}}/></label>
 {available&&<button type="button" className="im-button" disabled={a.busy} onClick={()=>void a.run(async()=>{await deleteResidentAvatar()})}>{tt(l,'Հեռացնել','Удалить','Remove')}</button>}
 <small>{tt(l,'Նկարը մասնավոր է և պատճենվում է նվազեցված չափով։','Фото приватное; перед отправкой оно пережимается и очищается от метаданных.','The photo is private; it is re-encoded and stripped of metadata before upload.')}</small>
 {msg&&<p role="alert" className="sx-err">{msg}</p>}{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</section>}
