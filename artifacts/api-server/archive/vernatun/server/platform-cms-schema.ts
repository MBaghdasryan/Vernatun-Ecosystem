import {z} from 'zod';

const translation=z.object({
 title:z.string().trim().min(1).max(160),
 summary:z.string().trim().max(500).default(''),
 body:z.string().trim().max(30000),
}).strict();

export const cmsPageContentSchema=z.object({
 hy:translation,ru:translation,en:translation,
}).strict();

export const cmsBrandSchema=z.object({
 brandName:z.string().trim().min(1).max(80),
 primaryColor:z.string().regex(/^#[0-9a-f]{6}$/i),
 accentColor:z.string().regex(/^#[0-9a-f]{6}$/i),
 logoUrl:z.string().url().max(500).refine(value=>{
  const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;
 }).nullable(),
}).strict();

export const cmsSlugSchema=z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
