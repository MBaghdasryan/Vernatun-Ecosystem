import {pool} from '../db.js';
import {config} from '../config.js';
import {storedFiles} from '../file-migration.js';
import {deletePrivateFile} from '../private-files.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated test database required');
try{for(const file of await storedFiles())await deletePrivateFile(file.kind,file.key)}
finally{await pool.end()}
