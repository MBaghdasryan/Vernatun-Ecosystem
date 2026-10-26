import type {Language} from '../../portal/i18n';
import {tt} from './core';
export const coordsFromText=(la:string,lo:string):{latitude:number;longitude:number}|null|'invalid'=>{
 const a=la.trim(),b=lo.trim();if(!a&&!b)return null;if(!a||!b)return 'invalid';
 const x=Number(a),y=Number(b);return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x)<=90&&Math.abs(y)<=180?{latitude:x,longitude:y}:'invalid'};
export function CoordInputs({l,lat,lon,onLat,onLon}:{l:Language;lat:string;lon:string;onLat:(v:string)=>void;onLon:(v:string)=>void}){
 const bad=coordsFromText(lat,lon)==='invalid';
 return <fieldset className="sx-form"><legend>{tt(l,'Կոորդինատներ (կամընտիր, երկուսն էլ կամ ոչ մեկը)','Координаты (необязательно, обе или ни одной)','Coordinates (optional, both or neither)')}</legend>
 <label>{tt(l,'Լայնություն (−90…90)','Широта (−90…90)','Latitude (−90…90)')}<input inputMode="decimal" value={lat} onChange={e=>onLat(e.target.value)} aria-invalid={bad}/></label>
 <label>{tt(l,'Երկայնություն (−180…180)','Долгота (−180…180)','Longitude (−180…180)')}<input inputMode="decimal" value={lon} onChange={e=>onLon(e.target.value)} aria-invalid={bad}/></label>
 {bad&&<small role="alert">{tt(l,'Լրացրեք երկու ճիշտ արժեք կամ թողեք դատարկ։','Укажите оба корректных значения или оставьте пустыми.','Enter two valid values or leave both empty.')}</small>}</fieldset>}
