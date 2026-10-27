import type {Language} from '../../portal/i18n';
import {tt} from './core';
export const validCoords=(lat:unknown,lon:unknown):lat is number=>typeof lat==='number'&&typeof lon==='number'&&
 Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
export default function ListingMap({lat,lon,l,title}:{lat?:number|null;lon?:number|null;l:Language;title:string}){
 if(!validCoords(lat,lon)||typeof lon!=='number')return <small>{tt(l,'Տեղադրությունը նշված չէ','Местоположение не задано','Location not set')}</small>;
 const d=0.004,bbox=[lon-d,lat-d,lon+d,lat+d].join(',');
 return <figure style={{margin:0}}><iframe title={tt(l,'Քարտեզ՝ ','Карта: ','Map: ')+title} loading="lazy" referrerPolicy="no-referrer" style={{width:'100%',height:200,border:0,borderRadius:8}} src={`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lon}`}/>
 <figcaption><small>© <a className="sx-link" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`}>OpenStreetMap</a> contributors</small></figcaption></figure>}
