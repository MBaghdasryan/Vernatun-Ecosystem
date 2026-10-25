import {z} from 'zod';

// Python's datetime.isoformat() uses offsets and may include microseconds.
// Validate RFC3339 before Date parsing (Date alone also accepts non-ISO strings).
// Persist UTC at JavaScript/PostgreSQL transport precision, without changing
// receipt timestamps used for heartbeat freshness.
export const edgeTimestamp=z.string().datetime({offset:true})
 .refine(value=>Number.isFinite(Date.parse(value)),'Invalid timestamp')
 .transform(value=>new Date(value).toISOString());

export const edgeTimestampedRecord=z.object({
 timestamp:edgeTimestamp.optional(),
 ts:z.union([edgeTimestamp,z.number().finite()]).optional(),
}).passthrough();

export function edgeSourceTime(value:unknown){
 // Preserve the legacy optional/numeric `ts` behavior; RFC3339 strings must be
 // valid instead of silently losing a malformed source timestamp.
 return typeof value==='string'?edgeTimestamp.parse(value):null;
}
