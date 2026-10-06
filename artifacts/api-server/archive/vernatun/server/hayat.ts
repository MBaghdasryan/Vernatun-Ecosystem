import {Router} from 'express';
import {z} from 'zod';
import {context,requireAuth,requirePermission,ApiError} from './access.js';
import {pool} from './db.js';

// Reconstructed from the supplied HAYAT contract; never grants permissions.
export const hayat=Router();
hayat.use(requireAuth);
const querySchema=z.object({
 search:z.string().trim().max(200).default(''),
 status:z.string().max(40).default(''),
 priority:z.enum(['','low','normal','high','urgent','emergency']).default(''),
 sort:z.enum(['created','priority','due']).default('priority'),
 building:z.string().uuid().optional(),
 page:z.coerce.number().int().min(0).max(100000).default(0)
});

hayat.get('/hayat/queue',async(req,res)=>{
 const c=await context(req);
 if(!['manager','dispatcher','technician','contractor','security'].includes(c.role_key)||!c.organization_id)
  throw new ApiError(403,'forbidden');
 const contractor=c.role_key==='contractor';
 const security=c.role_key==='security';
 const technician=c.role_key==='technician';
 await requirePermission(req,contractor?'defects.assigned':security?'access.validate':technician?'workorders.assigned':'requests.read');
 const q=querySchema.parse(req.query);
 const source=contractor?`
  SELECT d.id,d.subject,d.description,d.status,d.version,d.created_at,d.due_on,d.location,
   u.number,u.building_id,b.name AS building_name,t.name AS technician_name,NULL::uuid AS work_order_id
  FROM defects d JOIN units u ON u.id=d.unit_id JOIN buildings b ON b.id=u.building_id
  LEFT JOIN users t ON t.id=d.contractor_id
  WHERE d.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2)
   AND ($3::uuid IS NULL OR u.id=$3) AND d.contractor_id=$4
 `:security?`
  SELECT p.id,p.visitor AS subject,p.vehicle AS description,
   CASE WHEN p.revoked_at IS NOT NULL THEN 'revoked'
    WHEN p.valid_until<=now() THEN 'expired'
    WHEN p.valid_from>now() THEN 'waiting' ELSE p.state END AS status,
   0 AS version,p.created_at,p.valid_from,p.valid_until,
   u.number,u.building_id,b.name AS building_name,NULL::text AS technician_name,NULL::uuid AS work_order_id
  FROM visitor_passes p JOIN units u ON u.id=p.unit_id JOIN buildings b ON b.id=u.building_id
  WHERE p.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2)
   AND ($3::uuid IS NULL OR u.id=$3) AND $4::uuid IS NOT NULL
 `:`
  SELECT r.id,r.subject,r.description,COALESCE(w.status,r.status) AS status,
   r.version,r.created_at,u.number,COALESCE(r.building_id,u.building_id) AS building_id,b.name AS building_name,
    t.name AS technician_name,w.id AS work_order_id,w.checklist,r.priority,r.source,r.category_id,w.accepted_at,w.paused_at,w.blocked_reason,
    (SELECT min(d.due_at) FROM request_sla_deadlines d WHERE d.request_id=r.id AND d.satisfied_at IS NULL AND NOT(d.kind='resolution' AND w.paused_at IS NOT NULL AND COALESCE((r.sla_snapshot->>'pause_resolution')::boolean,false))) AS due_at,
    EXISTS(SELECT 1 FROM request_sla_deadlines d WHERE d.request_id=r.id AND d.satisfied_at IS NULL AND d.due_at<now() AND NOT(d.kind='resolution' AND w.paused_at IS NOT NULL AND COALESCE((r.sla_snapshot->>'pause_resolution')::boolean,false))) AND r.status<>'closed' AS overdue,
    (SELECT starts_at FROM request_visits v WHERE v.request_id=r.id AND v.status IN('proposed','confirmed') LIMIT 1) AS visit_start,
    (SELECT ends_at FROM request_visits v WHERE v.request_id=r.id AND v.status IN('proposed','confirmed') LIMIT 1) AS visit_end,
    (SELECT status FROM request_visits v WHERE v.request_id=r.id AND v.status IN('proposed','confirmed') LIMIT 1) AS visit_status
  FROM resident_requests r LEFT JOIN units u ON u.id=r.unit_id JOIN buildings b ON b.id=COALESCE(r.building_id,u.building_id)
  LEFT JOIN work_orders w ON w.request_id=r.id LEFT JOIN users t ON t.id=w.technician_id
  WHERE r.organization_id=$1 AND ($2::uuid IS NULL OR COALESCE(r.building_id,u.building_id)=$2)
   AND ($3::uuid IS NULL OR u.id=$3)
   AND (${technician?'w.technician_id=$4':'$4::uuid IS NOT NULL'})
 `;
 const operational=!contractor&&!security;
 const cte=`WITH scoped AS (${source}), filtered AS (
  SELECT * FROM scoped WHERE
   ($5::text='' OR position(lower($5) in lower(concat_ws(' ',id,work_order_id,
    'WO-'||left(work_order_id::text,8),'R-'||left(id::text,8),
    '#-'||left(id::text,8),'#'||left(id::text,8),
    subject,description,building_name,number,technician_name)))>0)
   AND ($6::uuid IS NULL OR building_id=$6)
    ${operational?"AND ($7::text='' OR priority=$7)":''}
 )`;
 const values=[c.organization_id,c.building_id,c.unit_id,req.user!.id,q.search,q.building??null,...(operational?[q.priority]:[])];
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const stats=(await db.query(`${cte} SELECT status,count(*)::int AS count FROM filtered GROUP BY status ORDER BY status`,values)).rows;
    const filtered=`${cte} SELECT * FROM filtered WHERE ($${values.length+1}::text='' OR status=$${values.length+1})`;
    const filterValues=[...values,q.status];
   const total=(await db.query(`SELECT count(*)::int AS total FROM (${filtered}) x`,filterValues)).rows[0].total;
  const rows=(await db.query(`${filtered}
   ORDER BY CASE WHEN status IN ('closed','accepted','exited','expired','revoked') THEN 1 ELSE 0 END,
    ${operational&&q.sort==='due'?'due_at ASC NULLS LAST,':operational&&q.sort==='priority'?"CASE priority WHEN 'emergency' THEN 5 WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,":''}
    created_at DESC,id LIMIT 24 OFFSET $${filterValues.length+1}`,[...filterValues,q.page*24])).rows;
  const buildings=(await db.query(contractor||technician?
   `WITH scoped AS (${source}) SELECT DISTINCT building_id AS id,building_name AS name FROM scoped ORDER BY name`:
   `SELECT b.id,b.name FROM buildings b WHERE b.organization_id=$1
    AND ($2::uuid IS NULL OR b.id=$2)
    AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM units u WHERE u.id=$3 AND u.building_id=b.id))
    AND $4::uuid IS NOT NULL ORDER BY b.name`,
   values.slice(0,4))).rows;
  const serverTime=(await db.query('SELECT now() AS time')).rows[0].time;
  await db.query('COMMIT');
  res.json({rows,total,stats,buildings,pageSize:24,serverTime});
 }catch(error){await db.query('ROLLBACK');throw error}
 finally{db.release()}
});
