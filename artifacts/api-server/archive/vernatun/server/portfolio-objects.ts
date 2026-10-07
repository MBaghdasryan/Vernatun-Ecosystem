import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {context,requireAuth,requirePermission,ApiError} from './access.js';
import {transaction,record} from './operations.js';
export const portfolioObjects=Router();portfolioObjects.use(requireAuth);
const uid=z.string().uuid(),fields=z.object({name:z.string().trim().min(1).max(120),kind:z.enum(['residential','commercial','mixed','other']),address:z.string().trim().max(300).default('')});
async function scope(req:any,write=false){const c=await requirePermission(req,write?'properties.manage':'properties.read');if(!c.organization_id||c.unit_id||write&&c.building_id)throw new ApiError(403,'forbidden');return c}
portfolioObjects.get('/portfolio/objects',async(req,res)=>{
 const c=await scope(req);res.json((await pool.query(`SELECT p.*,COALESCE(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) ORDER BY b.name) FILTER(WHERE b.id IS NOT NULL),'[]') AS buildings
 FROM portfolio_objects p LEFT JOIN buildings b ON b.portfolio_object_id=p.id AND b.organization_id=p.organization_id AND ($2::uuid IS NULL OR b.id=$2)
 WHERE p.organization_id=$1 AND ($2::uuid IS NULL OR b.id IS NOT NULL) GROUP BY p.id ORDER BY p.name`,[c.organization_id,c.building_id])).rows);
});
portfolioObjects.post('/portfolio/objects',async(req,res)=>{const c=await scope(req,true),f=fields.parse(req.body);
 res.status(201).json(await transaction(async db=>{const r=(await db.query('INSERT INTO portfolio_objects(organization_id,name,kind,address) VALUES($1,$2,$3,$4) RETURNING *',[c.organization_id,f.name,f.kind,f.address])).rows[0];await record(db,req,c,'portfolio.created','portfolio_object',r.id);return r}));
});
portfolioObjects.patch('/portfolio/objects/:id',async(req,res)=>{const c=await scope(req,true),id=uid.parse(req.params.id),f=fields.extend({version:z.number().int().positive()}).parse(req.body);
 res.json(await transaction(async db=>{const old=(await db.query('SELECT * FROM portfolio_objects WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,c.organization_id])).rows[0];if(!old)throw new ApiError(404,'not_found');if(old.version!==f.version)throw new ApiError(409,'version_conflict');
 const r=(await db.query('UPDATE portfolio_objects SET name=$2,kind=$3,address=$4,version=version+1 WHERE id=$1 RETURNING *',[id,f.name,f.kind,f.address])).rows[0];await record(db,req,c,'portfolio.updated','portfolio_object',id);return r}));
});
portfolioObjects.put('/portfolio/objects/:id/buildings',async(req,res)=>{const c=await scope(req,true),id=uid.parse(req.params.id),f=z.object({version:z.number().int().positive(),buildingIds:z.array(uid).max(500).refine(v=>new Set(v).size===v.length)}).parse(req.body);
 res.json(await transaction(async db=>{
 // Organization-level lock prevents concurrent moves across two groups.
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['portfolio:'+c.organization_id]);
 const p=(await db.query('SELECT * FROM portfolio_objects WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,c.organization_id])).rows[0];if(!p)throw new ApiError(404,'not_found');if(p.version!==f.version)throw new ApiError(409,'version_conflict');
 const bs=(await db.query('SELECT id,portfolio_object_id FROM buildings WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[c.organization_id,f.buildingIds])).rows;if(bs.length!==f.buildingIds.length)throw new ApiError(404,'building_not_found');
 // Moving from another group must be explicit via unassign there first.
 if(bs.some(b=>b.portfolio_object_id&&b.portfolio_object_id!==id))throw new ApiError(409,'building_already_grouped');
 await db.query('UPDATE buildings SET portfolio_object_id=NULL WHERE organization_id=$1 AND portfolio_object_id=$2 AND NOT(id=ANY($3::uuid[]))',[c.organization_id,id,f.buildingIds]);
 await db.query('UPDATE buildings SET portfolio_object_id=$1 WHERE organization_id=$2 AND id=ANY($3::uuid[])',[id,c.organization_id,f.buildingIds]);
 const r=(await db.query('UPDATE portfolio_objects SET version=version+1 WHERE id=$1 RETURNING *',[id])).rows[0];await record(db,req,c,'portfolio.buildings_changed','portfolio_object',id,{buildingIds:f.buildingIds});return r;
 }));
});
portfolioObjects.delete('/portfolio/objects/:id',async(req,res)=>{const c=await scope(req,true),id=uid.parse(req.params.id),v=z.coerce.number().int().positive().parse(req.query.version);
 await transaction(async db=>{await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['portfolio:'+c.organization_id]);const p=(await db.query('SELECT * FROM portfolio_objects WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,c.organization_id])).rows[0];if(!p)throw new ApiError(404,'not_found');if(p.version!==v)throw new ApiError(409,'version_conflict');
 if((await db.query('SELECT 1 FROM buildings WHERE portfolio_object_id=$1 LIMIT 1',[id])).rowCount)throw new ApiError(409,'portfolio_not_empty');
 await db.query('DELETE FROM portfolio_objects WHERE id=$1',[id]);await record(db,req,c,'portfolio.deleted','portfolio_object',id)});
 res.json({ok:true});
});
