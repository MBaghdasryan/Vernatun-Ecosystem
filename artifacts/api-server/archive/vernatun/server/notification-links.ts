import {Router,type Request} from 'express';
import {pool} from './db.js';
import {contexts,requireAuth,ApiError,type Context} from './access.js';
import {z} from 'zod';
export const notificationLinks=Router();notificationLinks.use(requireAuth);
function allowed(c:Context,r:any,userId:string){
 return c.organization_id===r.organization_id&&(!c.building_id||c.building_id===r.building_id)&&(!c.unit_id||c.unit_id===r.unit_id)&&
 c.modules?.includes('requests')&&(
 c.permissions.includes('requests.read')||
 c.permissions.includes('requests.own')&&(r.author_user_id===userId||r.reported_for_user_id===userId||!!c.unit_id&&!r.reported_for_user_id&&r.source!=='resident_app'&&c.unit_id===r.unit_id)||
 c.permissions.includes('workorders.assigned')&&r.technician_id===userId);
}
async function available(req:Request,id?:string){
 const options=await contexts(req.user!.id);
 const rows=(await pool.query(`SELECT n.*,r.unit_id,COALESCE(r.building_id,u.building_id,b.building_id) AS building_id,
  r.author_user_id,r.reported_for_user_id,r.source,w.technician_id
  FROM notifications n LEFT JOIN resident_requests r ON r.id=n.entity_id
  LEFT JOIN units u ON u.id=r.unit_id LEFT JOIN work_orders w ON w.request_id=r.id
  LEFT JOIN platform_notification_batches b ON b.id=n.manual_batch_id
  WHERE n.user_id=$1 AND ($2::uuid IS NULL OR n.id=$2)
   AND (n.manual_batch_id IS NOT NULL OR r.id IS NOT NULL)
  ORDER BY n.created_at DESC LIMIT 100`,[req.user!.id,id??null])).rows;
 return rows.map(r=>({row:r,targets:options.filter(c=>r.manual_batch_id
  ?c.organization_id===r.organization_id&&(!r.building_id||c.building_id===r.building_id)
  :allowed(c,r,req.user!.id))}));
}
notificationLinks.get('/notifications',async(req,res)=>{
 res.json((await available(req)).map(({row:r,targets})=>({
  id:r.id,kind:r.kind,created_at:r.created_at,read_at:r.read_at,access_denied:!targets.length,
  manual_batch_id:r.manual_batch_id,custom_title:r.custom_title,custom_body:r.custom_body,
  targets:targets.map(c=>({id:c.id,role_key:c.role_key,organization_name:c.organization_name,building_name:c.building_name,unit_number:c.unit_number})),
 })));
});
notificationLinks.get('/notifications/:id/destination',async(req,res)=>{
 const item=(await available(req,z.string().uuid().parse(req.params.id)))[0];
 if(!item)throw new ApiError(404,'not_found');
 const desired=req.query.contextId?z.string().uuid().parse(req.query.contextId):req.session.contextId;
 const c=item.targets.find(c=>c.id===desired)??(!req.query.contextId?item.targets[0]:undefined);
 if(!c)throw new ApiError(403,'forbidden');
 // This is an authorized suggestion, NOT a grant or automatic context switch.
 const product=c.permissions.includes('requests.own')?'imtun':c.product;
 if(!['imtun','os','hayat','console'].includes(product??''))throw new ApiError(403,'forbidden');
 res.json({targetContextId:c.id,requiresSwitch:c.id!==req.session.contextId,destination:`/${product}/requests?requestId=${item.row.entity_id}`});
});
notificationLinks.post('/notifications/:id/read',async(req,res)=>{
 const id=z.string().uuid().parse(req.params.id);
 const result=await pool.query('UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id',[id,req.user!.id]);
 if(!result.rowCount)throw new ApiError(404,'not_found');
 res.json(result.rows[0]);
});
