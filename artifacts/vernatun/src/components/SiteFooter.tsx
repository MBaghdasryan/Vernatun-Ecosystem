import {ecosystem,e} from '../ecosystem-content';
import {lt} from '../landing-i18n';
import {Logo} from './Shared';
import {ProductLogo} from './Ecosystem';

type SiteFooterProps={homePrefix?:string;onLogin?:()=>void;activeLegal?:'privacy'|'terms'};

export default function SiteFooter({homePrefix='',onLogin=()=>location.assign('/login'),activeLegal}:SiteFooterProps){
 return <footer className="site-footer"><div className="container footer-layout">
  <div><Logo href={homePrefix||'/'}/><p>Where owners meet decisions.</p></div>
  <nav aria-label={lt('s048')}>
   {ecosystem.products.map(p=><a key={p.id} href={`${homePrefix}#${p.id}`}>{p.brand==="Vernatun OS"?p.brand:<ProductLogo brand={p.brand}/>}</a>)}
   <button onClick={onLogin}>{e("Войти","Մուտք","Sign in")}</button>
   <a href={`${homePrefix}#lead-form`}>{lt('s049')}</a>
   <a href="/privacy" aria-current={activeLegal==='privacy'?'page':undefined}>{e("Конфиденциальность","Գաղտնիություն","Privacy")}</a>
   <a href="/terms" aria-current={activeLegal==='terms'?'page':undefined}>{e("Условия использования","Օգտագործման պայմաններ","Terms of use")}</a>
  </nav>
  <p>© {new Date().getFullYear()} Vernatun<br/>{lt('s051')}</p>
 </div></footer>;
}
