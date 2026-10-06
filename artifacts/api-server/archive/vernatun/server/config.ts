import 'dotenv/config';
import { z } from 'zod';
const origin = process.env.APP_ORIGIN ?? (process.env.NODE_ENV !== 'production'
  ? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5173')
  : undefined);
export const config=z.object({NODE_ENV:z.enum(['development','test','production']).default('development'),PORT:z.coerce.number().default(3001),DATABASE_URL:z.string().min(1),SESSION_SECRET:z.string().min(32),APP_ORIGIN:z.string().url(),DEMO_SEED_ENABLED:z.enum(['true','false']).default('false')}).parse({...process.env,APP_ORIGIN:origin});
if(config.NODE_ENV==='production'&&(!config.APP_ORIGIN.startsWith('https://')||config.DEMO_SEED_ENABLED==='true'))throw new Error('Production requires HTTPS and disabled demo seed');
