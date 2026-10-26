import type {PoolClient} from 'pg';

export type ResidentViewingEvent='viewing_requested'|'viewing_confirmed'|'viewing_declined'|'viewing_cancelled';

export async function notifyResidentViewing(
 db:PoolClient,userId:string,organizationId:string,conversationId:string,event:ResidentViewingEvent,
){
 await db.query('SELECT emit_notification($1,$2,$3,$4,$5,$6)',[
  userId,organizationId,event,'resident_conversation',conversationId,`resident-viewing:${conversationId}:${event}`,
 ]);
}
