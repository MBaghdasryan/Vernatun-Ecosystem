import test from 'node:test';
import assert from 'node:assert/strict';
import {canOpenCommunitySection,canOpenCalendar} from './section-access';
import {routeView,viewInProduct,viewRoute} from '../../shared/products';

test('manager meters is a stable HAYAT deep link',()=>{
 assert.equal(viewRoute('hayat','meters','manager'),'/hayat/meters');
 assert.equal(routeView('/hayat/meters','','manager'),'meters');
 assert.equal(viewInProduct('hayat','meters'),true);
 assert.equal(viewInProduct('console','meters'),false);
});
test('meters menu requires manager permission and enabled module',()=>{
 assert.equal(canOpenCommunitySection('meters',{permissions:['meters.manage'],modules:['meters']}),true);
 assert.equal(canOpenCommunitySection('meters',{permissions:['meters.manage'],modules:[]}),false);
 for(const permissions of [[],['meters.own'],['assets.read'],['requests.assign']]){
  assert.equal(canOpenCommunitySection('meters',{permissions,modules:['meters']}),false);
 }
});
test('legacy contexts without a module list retain navigation compatibility',()=>{
 assert.equal(canOpenCommunitySection('meters',{permissions:['meters.manage']}),true);
 assert.equal(canOpenCommunitySection('missing',{permissions:['meters.manage']}),false);
});
test('calendar has a dedicated HAYAT route and scoped navigation',()=>{
 assert.equal(viewRoute('hayat','calendar','dispatcher'),'/hayat/calendar');
 assert.equal(routeView('/hayat/calendar','','dispatcher'),'calendar');
 assert.equal(viewInProduct('hayat','calendar'),true);
 assert.equal(viewInProduct('console','calendar'),false);
 for(const role_key of ['manager','dispatcher','technician']){
  const permission=role_key==='technician'?'workorders.assigned':'requests.read';
  assert.equal(canOpenCalendar({role_key,permissions:[permission],modules:['requests']}),true);
  assert.equal(canOpenCalendar({role_key,permissions:[permission],modules:[]}),false);
  assert.equal(canOpenCalendar({role_key,permissions:[],modules:['requests']}),false);
 }
 for(const role_key of ['contractor','security','family','unit_owner']){
  assert.equal(canOpenCalendar({role_key,permissions:['requests.read'],modules:['requests']}),false);
 }
});
