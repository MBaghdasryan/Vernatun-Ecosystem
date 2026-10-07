import test from 'node:test';
import assert from 'node:assert/strict';
import {canOpenCommunitySection} from './section-access';
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
