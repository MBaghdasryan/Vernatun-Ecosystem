import type {PoolClient} from 'pg';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
export async function meetingResult(db:PoolClient,m:any){
 const eligible=(await db.query('SELECT * FROM meeting_eligibility WHERE meeting_id=$1',[m.id])).rows;
 const agenda=(await db.query('SELECT * FROM agenda_items WHERE meeting_id=$1 ORDER BY id',[m.id])).rows;
 const ballots=(await db.query(`SELECT v.*,e.share_basis_points FROM meeting_ballots v JOIN meeting_eligibility e ON e.id=v.eligibility_id
 JOIN agenda_items a ON a.id=v.agenda_item_id WHERE a.meeting_id=$1`,[m.id])).rows;
 const total=eligible.reduce((s,r)=>s+r.share_basis_points,0),seen=new Set(ballots.map(r=>r.eligibility_id));
 const participation=eligible.filter(r=>seen.has(r.id)).reduce((s,r)=>s+r.share_basis_points,0);
 return {totalEligibleShare:total,participationShare:participation,quorum:total>0&&participation*10000>=total*m.quorum_basis_points,
 agenda:agenda.map(a=>{
 const rows=ballots.filter(b=>b.agenda_item_id===a.id),part=rows.reduce((s,r)=>s+r.share_basis_points,0);
 const byOption=Object.fromEntries(a.options.map((o:string)=>[o,rows.filter(r=>r.selected_option===o).reduce((s,r)=>s+r.share_basis_points,0)]));
 const quorum=total>0&&part*10000>=total*m.quorum_basis_points;
 return {id:a.id,title:a.title,participationShare:part,quorum,byOption,passed:quorum&&part>0&&byOption[a.pass_option]*10000>=part*a.pass_basis_points};
 })};
}
export async function protocolPdf(m:any,result:any){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const local=resolve('server/assets/DejaVuSans.ttf'),path=existsSync(local)?local:resolve('archive/vernatun/server/assets/DejaVuSans.ttf');
 const font=await pdf.embedFont(await readFile(path),{subset:true});let page=pdf.addPage([595,842]),y=797;
 function line(text:string){
  // Wrap by actual glyph width; retain Armenian/Russian rather than transliteration.
  const clean=text.replace(/[\u0000-\u001f]/g,' ');let rest=clean;
  while(rest.length){let n=rest.length;while(n>1&&font.widthOfTextAtSize(rest.slice(0,n),10)>495)n--;
   if(y<55){page=pdf.addPage([595,842]);y=797}
   page.drawText(rest.slice(0,n),{x:50,y,size:10,font,color:rgb(.04,.12,.16)});y-=16;rest=rest.slice(n);}
  y-=4;
 }
 line('Vernatun — Meeting protocol');line(m.title);line(m.description);
 line(`Meeting: ${m.id}`);line(`Voting: ${new Date(m.starts_at).toISOString()} — ${new Date(m.ends_at).toISOString()}`);
 line('Weights: recorded ownership basis points, eligibility frozen at publication for voting-start calendar date.');
 line(`Quorum rule: ${m.quorum_basis_points}/10000. Eligible share: ${result.totalEligibleShare}. Participation: ${result.participationShare}.`);
 for(const a of result.agenda){line(a.title);line(`Participation: ${a.participationShare}; quorum: ${a.quorum}; passed: ${a.passed}`);for(const [option,weight] of Object.entries(a.byOption))line(`${option}: ${weight}`)}
 line('No legal electronic signature or statutory legal validity is asserted by this document.');
 pdf.setTitle(m.title);pdf.setProducer('Vernatun');return Buffer.from(await pdf.save());
}
