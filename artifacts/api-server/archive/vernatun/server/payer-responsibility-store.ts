import type {PoolClient} from 'pg';

// Call only after locking canonical payer assignments during posting. A separate
// statement is essential: a SELECT projection evaluated before waiting for a row
// lock could otherwise retain the pre-acceptance READ COMMITTED snapshot.
export async function resolvePayers(db:PoolClient,ids:string[],period:string,lock=false){
 if(lock)await db.query(`SELECT pol.building_id FROM resident_payer_policy pol WHERE EXISTS(
  SELECT 1 FROM payer_assignments p JOIN units u ON u.id=p.unit_id
  WHERE p.id=ANY($1::uuid[]) AND pol.building_id=u.building_id AND pol.service_id=p.service_id
  AND pol.organization_id=p.organization_id) ORDER BY pol.building_id,pol.service_id FOR SHARE OF pol`,[ids]);
 return (await db.query(`SELECT p.id,resident_effective_payer(p.id,$2::date) AS "payerId",
  resident_effective_delegation(p.id,$2::date) AS "delegationId"
  FROM payer_assignments p WHERE p.id=ANY($1::uuid[])`,[ids,period])).rows as {id:string;payerId:string;delegationId:string|null}[];
}
