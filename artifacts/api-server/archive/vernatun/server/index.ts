import {app} from './app.js';
import {config} from './config.js';
import {pool} from './db.js';
await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
const server=app.listen(config.PORT,'127.0.0.1',()=>console.log(`Vernatun API: http://127.0.0.1:${config.PORT} (role-based modules)`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{void pool.end().then(()=>process.exit(0))}));
