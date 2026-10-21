import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarDay} from './calendar-date';

test('business date changes at Yerevan midnight, not UTC midnight',()=>{
 assert.equal(calendarDay(new Date('2026-10-21T19:59:59Z')),'2026-10-21');
 assert.equal(calendarDay(new Date('2026-10-21T20:00:00Z')),'2026-10-22');
 assert.equal(calendarDay(new Date('2026-12-31T20:00:00Z')),'2027-01-01');
});
test('explicit calendar zone handles negative offsets and daylight saving',()=>{
 const instant=new Date('2026-03-29T22:30:00Z');
 assert.equal(calendarDay(instant,'UTC'),'2026-03-29');
 assert.equal(calendarDay(instant,'Europe/Berlin'),'2026-03-30');
 assert.equal(calendarDay(instant,'America/Los_Angeles'),'2026-03-29');
 assert.equal(calendarDay(new Date('2024-02-28T20:00:00Z')),'2024-02-29');
});
test('invalid inputs fail explicitly instead of choosing a different date',()=>{
 assert.throws(()=>calendarDay(new Date('invalid')),RangeError);
 assert.throws(()=>calendarDay(new Date(),'Invalid/Zone'),RangeError);
});
