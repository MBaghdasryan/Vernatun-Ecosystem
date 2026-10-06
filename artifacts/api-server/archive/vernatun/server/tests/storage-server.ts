import {app} from '../app.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated test database required');
const server=app.listen(0,'127.0.0.1',()=>{
  process.send?.({port:(server.address() as {port:number}).port});
});
