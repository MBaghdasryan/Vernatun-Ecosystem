import {test} from 'node:test';
import assert from 'node:assert/strict';
import {maintenanceDueOn} from '../maintenance-calendar.js';

test('maintenance recurrence is anchored, UTC and does not drift at month end',()=>{
 assert.equal(maintenanceDueOn('2026-01-31','monthly',1),'2026-02-28');
 assert.equal(maintenanceDueOn('2026-01-31','monthly',2),'2026-03-31');
 assert.equal(maintenanceDueOn('2024-02-29','annual',1),'2025-02-28');
 assert.equal(maintenanceDueOn('2024-02-29','annual',4),'2028-02-29');
 assert.equal(maintenanceDueOn('2026-11-30','quarterly',1),'2027-02-28');
 assert.equal(maintenanceDueOn('2026-08-31','semiannual',1),'2027-02-28');
 assert.equal(maintenanceDueOn('2026-10-06','daily',1),'2026-10-07');
 assert.equal(maintenanceDueOn('2026-10-06','weekly',1),'2026-10-13');
 assert.equal(maintenanceDueOn('2026-10-06','custom',2,17),'2026-11-09');
 assert.equal(maintenanceDueOn('2026-10-06','once',0),'2026-10-06');
 assert.equal(maintenanceDueOn('2026-10-06','once',1),null);
});
test('invalid maintenance dates, intervals and runaway cycles fail explicitly',()=>{
 assert.throws(()=>maintenanceDueOn('2026-02-30','daily',1));
 assert.throws(()=>maintenanceDueOn('2026-10-06','custom',1,0));
 assert.throws(()=>maintenanceDueOn('2026-10-06','weekly',-1));
 assert.throws(()=>maintenanceDueOn('2026-10-06','monthly',0.5));
 assert.throws(()=>maintenanceDueOn('9999-12-31','annual',1));
});
