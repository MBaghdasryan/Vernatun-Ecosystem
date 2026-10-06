import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,detectDelimiter,toMinor,toMinorUnits,fromMinor,toDay} from '../src/portal/finance-data';
test('CSV handles BOM, quoted commas/semicolons, escaped quotes and multiline CRLF without changing evidence',()=>{
 const csv='\uFEFFexternal_id;purpose;amount\r\nB-1;"Memo, with; delimiter and ""quote""";12,34\r\nB-2;"First line\r\nSecond line";-1,50\r\n';
 assert.equal(detectDelimiter(csv),';');
 const parsed=parseCsv(csv);assert.equal(parsed.error,undefined);
 assert.deepEqual(parsed.rows,[['external_id','purpose','amount'],['B-1','Memo, with; delimiter and "quote"','12,34'],['B-2','First line\r\nSecond line','-1,50']]);
 assert.equal(parseCsv('id,amount\n"unterminated,1').error,'quote');
 assert.deepEqual(parseCsv('id\tamount\rA\t100\r', '\t').rows,[['id','amount'],['A','100']]);
});
test('Major and minor units use exact integer arithmetic and reject float notation, thousands separators, zero and overflow',()=>{
 assert.equal(toMinor('12.34'),'1234');assert.equal(toMinor('0.01'),'1');
 assert.equal(toMinor('-1,50',',',true),'-150');assert.equal(toMinor('999999999999.99'),'99999999999999');
 for(const value of ['1e3','1,000.00','1.001','0','-1','9999999999999.99'])assert.equal(toMinor(value),null);
 assert.equal(toMinorUnits('10000'),'10000');assert.equal(toMinorUnits('-25'),'-25');
 assert.equal(toMinorUnits('1.00'),null);assert.equal(toMinorUnits('0'),null);assert.equal(toMinorUnits('100000000000000'),null);
 assert.equal(fromMinor('-1234'),'-12.34');assert.equal(fromMinor('90071992547409'),'900719925474.09');
});
test('Bank dates are explicit calendar dates, not timezone-adjusted guesses',()=>{
 assert.equal(toDay('07.10.2026','dmy'),'2026-10-07');assert.equal(toDay('2026-10-07','iso'),'2026-10-07');
 assert.equal(toDay('29.02.2024','dmy'),'2024-02-29');
 for(const value of ['29.02.2026','31.04.2026','07/10/26'])assert.equal(toDay(value,'dmy'),null);
 assert.equal(toDay('2026-02-30','iso'),null);
});
