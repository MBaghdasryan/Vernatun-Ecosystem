import {Router} from 'express';
import {pool} from './db.js';
import {requireAuth} from './access.js';
import {ownScope} from './resident-continuity-store.js';
import {eligiblePeople} from './core-operation-store.js';
import {activeLeasePredicate} from './lease-policy.js';
export const residentHousehold=Router();residentHousehold.use(requireAuth);
residentHousehold.get('/household',async(req,res)=>{
 const s=await ownScope(req),canManageDelegations=s.c.permissions.includes('residents.delegate'),
  canManageLeases=s.c.permissions.includes('leases.manage'),canManage=canManageDelegations||canManageLeases;
 const people=await eligiblePeople(pool,s.organizationId,s.buildingId,s.unitId!,'resident');
 const members=(await pool.query(`SELECT a.id,a.user_id AS "userId",u.name,a.role_key AS role,a.expires_at AS "expiresAt"
  FROM role_assignments a JOIN users u ON u.id=a.user_id WHERE a.organization_id=$1 AND a.unit_id=$2 AND a.active
  AND a.role_key IN('unit_owner','renter','family') AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
  AND ${activeLeasePredicate('a')} AND NOT EXISTS(SELECT 1 FROM resident_delegations d WHERE d.assignment_id=a.id AND(d.revoked_at IS NOT NULL OR d.expires_at<=now()))
  AND a.user_id=ANY($3::uuid[]) AND ($4 OR a.user_id=$5) ORDER BY u.name,a.id`,
  [s.organizationId,s.unitId,people.map(p=>p.id),canManage,req.user!.id])).rows;
 const leases=(await pool.query(`SELECT l.id,l.renter_id AS "renterId",u.name,l.starts_on::text AS "startsOn",
  l.ends_on::text AS "endsOn",l.cancelled_at IS NOT NULL AS cancelled,l.version
  FROM leases l JOIN users u ON u.id=l.renter_id WHERE l.organization_id=$1 AND l.unit_id=$2
  AND ($3 OR l.renter_id=$4) ORDER BY l.starts_on DESC,l.id LIMIT 100`,
  [s.organizationId,s.unitId,canManageLeases,req.user!.id])).rows;
 res.json({unitId:s.unitId,canManageDelegations,canManageLeases,members,leases});
});
