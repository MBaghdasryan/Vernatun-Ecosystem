import test from 'node:test';
import assert from 'node:assert/strict';
import {assertMigrationPlanApplicable,createMigrationStatus} from '../migration-plan.js';

const files=[{name:'001_foundation.sql',checksum:'expected-checksum'}];
const expectedSession={migration:'001_foundation.sql',kind:'relation' as const,name:'session',idempotent:false};

test('migration plan blocks application when an applied checksum has drifted',()=>{
 const status=createMigrationStatus(files,[{name:'001_foundation.sql',checksum:'stored-checksum'}],[{...expectedSession,present:true}]);
 assert.deepEqual(status.checksumDrift,['001_foundation.sql']);
 assert.throws(()=>assertMigrationPlanApplicable(status),/Migration checksum mismatch: 001_foundation\.sql/);
});

test('migration plan blocks application when a recorded migration object is missing',()=>{
 const status=createMigrationStatus(files,[{name:'001_foundation.sql',checksum:'expected-checksum'}],[{...expectedSession,present:false}]);
 assert.deepEqual(status.missingObjects,['Recorded 001_foundation.sql, but relation session is missing']);
 assert.throws(()=>assertMigrationPlanApplicable(status),/relation session is missing/);
});

test('migration plan allows a matching complete schema',()=>{
 const status=createMigrationStatus(files,[{name:'001_foundation.sql',checksum:'expected-checksum'}],[{...expectedSession,present:true}]);
 assert.doesNotThrow(()=>assertMigrationPlanApplicable(status));
});
