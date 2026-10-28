import {lt} from '../landing-i18n';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
export function Logo({href='#top'}:{href?:string}){return <a className="brand" href={href} aria-label={lt('s235')}><span className="brand-mark"><img src="/assets/vernatun-original.png" alt="" width="1024" height="1024"/></span><span className="brand-word"><img src="/assets/vernatun-original.png" alt="Vernatun" width="1024" height="1024"/></span></a>}
export function Eyebrow({children}:{children:ReactNode}){return <p className="eyebrow">{children}</p>}
export function Heading({eyebrow,title,text}:{eyebrow?:string,title:string,text?:string}){return <div className="section-heading"><div>{eyebrow&&<Eyebrow>{eyebrow}</Eyebrow>}<h2>{title}</h2></div>{text&&<p>{text}</p>}</div>}
export function Badge({children}:{children:ReactNode}){return <span className={'badge '+(children===lt('s070')?'blue':children===lt('s071')?'green':'')}>{children}</span>}
export function PilotLink({children=lt('s060')}:{children?:ReactNode}){return <a className="button primary" href="#lead-form">{children}<ArrowUpRight size={17}/></a>}
