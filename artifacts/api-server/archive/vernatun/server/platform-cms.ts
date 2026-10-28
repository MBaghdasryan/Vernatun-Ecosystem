import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,requireAuth,requirePermission} from './access.js';
import {transaction} from './operations.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {cmsBrandSchema,cmsPageContentSchema,cmsSlugSchema} from './platform-cms-schema.js';

export const platformCms=Router();
const versionSchema=z.number().int().min(0);

async function admin(req:any,permission='platform.cms.manage'){
 const c=await requirePermission(req,permission);
 if(c.role_key!=='platform_admin'||c.organization_id!==null)throw new ApiError(403,'forbidden');
 return c;
}

// Public reads expose only published text/brand data. Drafts are never returned here.
platformCms.get('/public/site/branding',async(_req,res)=>{
 const row=(await pool.query('SELECT published_settings,published_version,published_at FROM platform_cms_brand_settings WHERE id=1')).rows[0];
 res.json({branding:row?.published_settings??null,version:row?.published_version??null,publishedAt:row?.published_at??null});
});
platformCms.get('/public/site/pages/:slug',async(req,res)=>{
 const slug=cmsSlugSchema.parse(req.params.slug);
 const row=(await pool.query('SELECT slug,published_content,published_version,published_at FROM platform_cms_pages WHERE slug=$1',[slug])).rows[0];
 if(!row?.published_content)throw new ApiError(404,'not_found');
 res.json({slug,content:row.published_content,version:row.published_version,publishedAt:row.published_at});
});

platformCms.use(requireAuth);
platformCms.get('/platform/cms',async(req,res)=>{
 await admin(req);
 const [brand,pages]=await Promise.all([
  pool.query('SELECT draft_settings AS draft,published_settings AS published,draft_version AS version,published_version AS "publishedVersion",updated_at AS "updatedAt",published_at AS "publishedAt" FROM platform_cms_brand_settings WHERE id=1'),
  pool.query('SELECT slug,draft_content AS draft,published_content AS published,draft_version AS version,published_version AS "publishedVersion",updated_at AS "updatedAt",published_at AS "publishedAt" FROM platform_cms_pages ORDER BY updated_at DESC,slug'),
 ]);
 res.json({brand:brand.rows[0]??null,pages:pages.rows});
});

platformCms.put('/platform/cms/brand',async(req,res)=>{
 await admin(req);const body=z.object({version:versionSchema,branding:cmsBrandSchema}).strict().parse(req.body);
 const result=await transaction(async db=>{
  const current=(await db.query('SELECT draft_version FROM platform_cms_brand_settings WHERE id=1 FOR UPDATE')).rows[0];
  if(!current)throw new ApiError(503,'cms_not_initialized');
  if(current.draft_version!==body.version)throw new ApiError(409,'version_conflict');
  const saved=(await db.query(`UPDATE platform_cms_brand_settings SET draft_settings=$1,draft_version=draft_version+1,
   updated_by=$2,updated_at=now() WHERE id=1 RETURNING draft_settings AS draft,published_settings AS published,
   draft_version AS version,published_version AS "publishedVersion",updated_at AS "updatedAt",published_at AS "publishedAt"`,
   [body.branding,req.user!.id])).rows[0];
  await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,details) VALUES($1,'platform.cms.brand.saved','platform_brand',$2)`,
   [req.user!.id,JSON.stringify({version:saved.version})]);
  return saved;
 });
 res.json(result);
});

platformCms.post('/platform/cms/brand/publish',async(req,res)=>{
 await admin(req);requireRecentAuthentication(req);
 const body=z.object({version:versionSchema,confirmation:z.literal('PUBLISH')}).strict().parse(req.body);
 const result=await transaction(async db=>{
  const row=(await db.query('SELECT draft_settings,draft_version FROM platform_cms_brand_settings WHERE id=1 FOR UPDATE')).rows[0];
  if(!row)throw new ApiError(503,'cms_not_initialized');
  if(row.draft_version!==body.version)throw new ApiError(409,'version_conflict');
  const published=(await db.query(`UPDATE platform_cms_brand_settings SET published_settings=draft_settings,
   published_version=draft_version,published_at=now(),updated_by=$1,updated_at=now() WHERE id=1
   RETURNING draft_settings AS draft,published_settings AS published,draft_version AS version,
   published_version AS "publishedVersion",updated_at AS "updatedAt",published_at AS "publishedAt"`,
   [req.user!.id])).rows[0];
  await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,details) VALUES($1,'platform.cms.brand.published','platform_brand',$2)`,
   [req.user!.id,JSON.stringify({version:published.publishedVersion})]);
  return published;
 });
 res.json(result);
});

platformCms.put('/platform/cms/pages/:slug',async(req,res)=>{
 await admin(req);
 const slug=cmsSlugSchema.parse(req.params.slug);
 const body=z.object({version:versionSchema,content:cmsPageContentSchema}).strict().parse(req.body);
 const saved=await transaction(async db=>{
  const current=(await db.query('SELECT draft_version FROM platform_cms_pages WHERE slug=$1 FOR UPDATE',[slug])).rows[0];
  if(!current){
   if(body.version!==0)throw new ApiError(409,'version_conflict');
   const inserted=(await db.query(`INSERT INTO platform_cms_pages(slug,draft_content,created_by,updated_by)
    VALUES($1,$2,$3,$3) RETURNING slug,draft_content AS draft,published_content AS published,draft_version AS version,
    published_version AS "publishedVersion",updated_at AS "updatedAt",published_at AS "publishedAt"`,
    [slug,body.content,req.user!.id])).rows[0];
   await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,details) VALUES($1,'platform.cms.page.created','cms_page',$2)`,
    [req.user!.id,JSON.stringify({slug,version:inserted.version})]);
   return inserted;
  }
  if(current.draft_version!==body.version)throw new ApiError(409,'version_conflict');
  const updated=(await db.query(`UPDATE platform_cms_pages SET draft_content=$2,draft_version=draft_version+1,
   updated_by=$3,updated_at=now() WHERE slug=$1 RETURNING slug,draft_content AS draft,published_content AS published,
   draft_version AS version,published_version AS "publishedVersion",updated_at AS "updatedAt",published_at AS "publishedAt"`,
   [slug,body.content,req.user!.id])).rows[0];
  await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,details) VALUES($1,'platform.cms.page.saved','cms_page',$2)`,
   [req.user!.id,JSON.stringify({slug,version:updated.version})]);
  return updated;
 });
 res.json(saved);
});

platformCms.post('/platform/cms/pages/:slug/publish',async(req,res)=>{
 await admin(req);requireRecentAuthentication(req);
 const slug=cmsSlugSchema.parse(req.params.slug);
 const body=z.object({version:versionSchema,confirmation:z.literal('PUBLISH')}).strict().parse(req.body);
 const result=await transaction(async db=>{
  const row=(await db.query('SELECT draft_version FROM platform_cms_pages WHERE slug=$1 FOR UPDATE',[slug])).rows[0];
  if(!row)throw new ApiError(404,'not_found');
  if(row.draft_version!==body.version)throw new ApiError(409,'version_conflict');
  const published=(await db.query(`UPDATE platform_cms_pages SET published_content=draft_content,
   published_version=draft_version,published_at=now(),updated_by=$2,updated_at=now() WHERE slug=$1
   RETURNING slug,draft_content AS draft,published_content AS published,draft_version AS version,
   published_version AS "publishedVersion",updated_at AS "updatedAt",published_at AS "publishedAt"`,
   [slug,req.user!.id])).rows[0];
  await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,details) VALUES($1,'platform.cms.page.published','cms_page',$2)`,
   [req.user!.id,JSON.stringify({slug,version:published.publishedVersion})]);
  return published;
 });
 res.json(result);
});

platformCms.post('/platform/cms/pages/:slug/unpublish',async(req,res)=>{
 await admin(req);requireRecentAuthentication(req);
 const slug=cmsSlugSchema.parse(req.params.slug);
 const body=z.object({publishedVersion:z.number().int().positive(),confirmation:z.literal('UNPUBLISH')}).strict().parse(req.body);
 const result=await transaction(async db=>{
  const row=(await db.query('SELECT published_version FROM platform_cms_pages WHERE slug=$1 FOR UPDATE',[slug])).rows[0];
  if(!row)throw new ApiError(404,'not_found');
  if(row.published_version!==body.publishedVersion)throw new ApiError(409,'version_conflict');
  await db.query('UPDATE platform_cms_pages SET published_content=NULL,published_version=NULL,published_at=NULL,updated_by=$2,updated_at=now() WHERE slug=$1',[slug,req.user!.id]);
  await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,details) VALUES($1,'platform.cms.page.unpublished','cms_page',$2)`,
   [req.user!.id,JSON.stringify({slug,publishedVersion:body.publishedVersion})]);
  return {slug,published:false};
 });
 res.json(result);
});
