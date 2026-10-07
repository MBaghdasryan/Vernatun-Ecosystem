import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarWindow,conflictingVisits} from './visit-calendar';
test('calendar uses complete Yerevan days and bounded inclusive ranges',()=>{
 assert.deepEqual(calendarWindow('2026-10-07','2026-10-07'),{from:'2026-10-06T20:00:00.000Z',to:'2026-10-07T20:00:00.000Z'});
 assert.equal(calendarWindow('2026-02-30','2026-03-01'),null);
 assert.equal(calendarWindow('2026-10-08','2026-10-07'),null);
 assert.equal(calendarWindow('','2026-10-07'),null);
 assert.equal(calendarWindow('2026-01-01','2026-04-01'),null);
 assert.ok(calendarWindow('2026-01-01','2026-03-03'));
});
test('overlaps compare full intervals for the same assigned executor only',()=>{
 const visit=(id:string,technician_id:string|null,start:string,end:string)=>({id,technician_id,starts_at:'2026-10-07T'+start+':00Z',ends_at:'2026-10-07T'+end+':00Z'});
 const rows=[visit('a','t1','09:00','10:00'),visit('b','t1','09:30','10:30'),visit('c','t2','09:30','10:30'),visit('d','t1','10:30','11:00'),visit('e',null,'09:00','12:00')];
 assert.deepEqual([...conflictingVisits(rows)].sort(),['a','b']);
 assert.equal(conflictingVisits([]).size,0);
});
