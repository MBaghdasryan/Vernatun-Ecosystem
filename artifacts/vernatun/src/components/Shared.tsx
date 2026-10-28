import {lt} from '../landing-i18n';
import {useEffect,useState,type CSSProperties,type ReactNode} from 'react';
import { ArrowUpRight } from 'lucide-react';
import {apiUrl} from '../api-base';
import './brand-cms.css';
type PublicBrand={brandName:string;primaryColor:string;accentColor:string;logoUrl:string|null};
let publicBrandRequest:Promise<PublicBrand|null>|undefined;
function loadPublicBrand(){
 if(!publicBrandRequest)publicBrandRequest=fetch(apiUrl('/api/public/site/branding'),{headers:{Accept:'application/json'}})
  .then(async response=>{
   if(!response.ok)return null;
   const data=await response.json(),brand=data?.branding as PublicBrand|null;
   if(brand&&typeof document!=='undefined'){
    document.documentElement.style.setProperty('--color-navy',brand.primaryColor);
    document.documentElement.style.setProperty('--color-orange',brand.accentColor);
   }
   return brand;
  })
  .catch(()=>null);
 return publicBrandRequest;
}
export function Logo({href='#top'}:{href?:string}){
 const [brand,setBrand]=useState<PublicBrand|null>(null);
 useEffect(()=>{let active=true;void loadPublicBrand().then(value=>{if(active)setBrand(value)});return()=>{active=false}},[]);
 return <a className="brand" href={href} aria-label={brand?.brandName??lt('s235')} style={brand?{'--cms-brand-primary':brand.primaryColor,'--cms-brand-accent':brand.accentColor} as CSSProperties:undefined}>
  <span className={'brand-mark'+(brand?.logoUrl?' brand-mark-cms':'')}><img src={brand?.logoUrl??'/assets/vernatun-original.png'} alt="" width="1024" height="1024"/></span>
  {brand?<span className="brand-word brand-word-cms">{brand.brandName}</span>:<span className="brand-word"><img src="/assets/vernatun-original.png" alt="Vernatun" width="1024" height="1024"/></span>}
 </a>
}
export function Eyebrow({children}:{children:ReactNode}){return <p className="eyebrow">{children}</p>}
export function Heading({eyebrow,title,text}:{eyebrow?:string,title:string,text?:string}){return <div className="section-heading"><div>{eyebrow&&<Eyebrow>{eyebrow}</Eyebrow>}<h2>{title}</h2></div>{text&&<p>{text}</p>}</div>}
export function Badge({children}:{children:ReactNode}){return <span className={'badge '+(children===lt('s070')?'blue':children===lt('s071')?'green':'')}>{children}</span>}
export function PilotLink({children=lt('s060')}:{children?:ReactNode}){return <a className="button primary" href="#lead-form">{children}<ArrowUpRight size={17}/></a>}
