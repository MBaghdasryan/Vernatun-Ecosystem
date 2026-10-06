import {app} from '../app.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!/^\/vernatun_restore_[a-f0-9]{20}$/.test(new URL(config.DATABASE_URL).pathname)
  ||!/^qa_[a-f0-9]{20}$/.test(process.env.PRIVATE_FILES_TEST_RUN||''))throw new Error('Isolated restore target required');
const server=app.listen(0,'127.0.0.1',()=>{
  process.send?.({port:(server.address() as {port:number}).port});
});
