import {createHash} from 'node:crypto';
import {pool} from './db.js';

const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function authenticateEdgeToken(token:string){
 const result=await pool.query(`SELECT c.id AS credential_id,c.version AS credential_version,c.status AS credential_status,
  n.id,n.edge_id,n.organization_id,n.building_id,n.block_id,n.protocol_version,n.name,n.site_code
  FROM edge_credentials c JOIN edge_nodes n ON n.id=c.edge_node_id
  WHERE c.credential_hash=$1 AND c.status IN ('active','pending') AND c.revoked_at IS NULL
   AND (c.expires_at IS NULL OR c.expires_at>now())
   AND n.registration_state='REGISTERED' AND n.status<>'DISABLED'`,
 [digest(token)]);
 const node=result.rows[0];
 if(!node)return null;
 if(node.credential_status==='pending'){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const locked=await client.query(`SELECT status,expires_at FROM edge_credentials
    WHERE id=$1 FOR UPDATE`,[node.credential_id]);
   if(!locked.rowCount||locked.rows[0].status!=='pending'||new Date(locked.rows[0].expires_at).getTime()<=Date.now()){
    await client.query('ROLLBACK');return null;
   }
   await client.query(`UPDATE edge_credentials SET status='revoked',revoked_at=now()
    WHERE edge_node_id=$1 AND status='active' AND version<$2`,[node.id,node.credential_version]);
   const activated=await client.query(`UPDATE edge_credentials SET status='active',expires_at=NULL
    WHERE id=$1 AND status='pending' RETURNING id`,[node.credential_id]);
   if(!activated.rowCount){await client.query('ROLLBACK');return null}
   await client.query('UPDATE edge_nodes SET credential_version=$2,updated_at=now() WHERE id=$1',
    [node.id,node.credential_version]);
   await client.query(`INSERT INTO audit_events(organization_id,action,entity_type,entity_id,details)
    VALUES($1,'edge.credential.rotation_activated','edge_node',$2,$3)`,
    [node.organization_id,node.id,JSON.stringify({credentialVersion:node.credential_version})]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
 }
 return node;
}
