import {Router} from 'express';
import {z} from 'zod';
import {rateLimit} from 'express-rate-limit';
import {PostgresRateStore} from './rate-limit.js';
import {pool} from './db.js';
import {requirePermission,ApiError} from './access.js';
const contact=z.string().trim().max(254).refine(s=>z.string().email().safeParse(s).success||
 (/^\+?[\d\s()\-]+$/.test(s)&&s.replace(/\D/g,'').length>=7&&s.replace(/\D/g,'').length<=15));
export const leads=Router();
leads.post('/leads',rateLimit({windowMs:60*60000,limit:5,store:new PostgresRateStore('leads'),
 standardHeaders:'draft-7',legacyHeaders:false,message:{error:'rate_limited'}}),async(req,res)=>{
 const b=z.object({name:z.string().trim().min(2).max(120),contact,organization:z.string().trim().max(160).optional(),
  productInterest:z.string().trim().min(1).max(80),audience:z.string().trim().max(160),
  message:z.string().trim().max(2000).optional(),consent:z.literal(true),language:z.enum(['hy','ru','en']),
  website:z.string().max(0).optional()}).strict().parse(req.body);
 const r=(await pool.query(`INSERT INTO leads(name,contact,organization,product_interest,audience,message,consent,language)
  VALUES($1,$2,$3,$4,$5,$6,true,$7) RETURNING id`,[b.name,b.contact,b.organization||null,b.productInterest,b.audience,b.message||null,b.language])).rows[0];
 res.status(201).json({received:true,id:r.id});
});
leads.get('/leads',async(req,res)=>{
 const c=await requirePermission(req,'leads.read');if(c.organization_id!==null||c.role_key!=='platform_admin')throw new ApiError(403,'forbidden');
 const b=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25),
  q:z.string().trim().max(160).default(''),sort:z.enum(['created_at','name']).default('created_at'),
  direction:z.enum(['asc','desc']).default('desc'),language:z.enum(['hy','ru','en']).optional()}).strict().parse(req.query);
 const pattern='%'+b.q.replace(/[\\%_]/g,'\\$&')+'%';
 const where="($1='' OR name ILIKE $2 OR contact ILIKE $2 OR COALESCE(organization,'') ILIKE $2) AND ($3::text IS NULL OR language=$3)";
 const args=[b.q,pattern,b.language??null];
 const total=Number((await pool.query('SELECT count(*) FROM leads WHERE '+where,args)).rows[0].count);
 const rows=(await pool.query(`SELECT * FROM leads WHERE ${where} ORDER BY ${b.sort} ${b.direction},id ${b.direction} LIMIT $4 OFFSET $5`,[...args,b.pageSize,(b.page-1)*b.pageSize])).rows;
 res.json({rows,total,page:b.page,pageSize:b.pageSize});
});
