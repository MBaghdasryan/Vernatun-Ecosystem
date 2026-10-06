import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ApiError,type Context} from './access.js';
export const uuid=z.string().uuid(),version=z.number().int().positive();
export const minor=z.string().regex(/^[1-9]\d{0,13}$/),currency=z.enum(['AMD','RUB','USD']);
export const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const allocations=z.array(z.object({invoiceId:uuid,amountMinor:minor}).strict()).max(100).refine(rows=>new Set(rows.map(r=>r.invoiceId)).size===rows.length,'Duplicate invoice');
export function orgFinance(c:Context){if(c.building_id||c.unit_id)throw new ApiError(403,'organization_scope_required');return c}
export const amountLimit=99999999999999n;
