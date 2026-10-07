import {pool} from './db.js';
import type {Context} from './access.js';
import {permissionDecision} from './iam-evaluator.js';

// One scope predicate for production endpoints and IAM diagnostics. Do not
// loosen it for platform administrators: IAM authority is not tenant access.
export async function scopedUnitRow(c:Context,id:string){
 if(!c.organization_id)return null;
 return (await pool.query(`SELECT * FROM units WHERE id=$1 AND organization_id=$2
 AND ($3::uuid IS NULL OR building_id=$3) AND ($4::uuid IS NULL OR id=$4)`,
 [id,c.organization_id,c.building_id,c.unit_id])).rows[0]??null;
}
export async function unitReadDecision(c:Context|undefined,id:string){
 if(!c)return {allowed:false,reason:'inactive_context',unit:null};
 const permission=c.permissions.includes('properties.read')?'properties.read':'properties.own';
 const permissionResult=await permissionDecision(c,permission,'GET');
 if(!permissionResult.allowed)return {...permissionResult,unit:null};
 const unit=await scopedUnitRow(c,id);
 return unit?{allowed:true,reason:'unit_read_allowed',unit}:{allowed:false,reason:'not_found',unit:null};
}
