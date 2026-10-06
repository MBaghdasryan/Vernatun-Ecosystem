import assert from 'node:assert/strict';
import test from 'node:test';
import {routeView,startRoute,viewInProduct} from '../../shared/products';

test('Onboarding is an explicit console workflow, not another role dashboard alias',()=>{
 for(const role of ['platform_admin','support']){
  assert.equal(routeView('/console/onboarding','',role),'onboarding');
  assert.ok(viewInProduct('console',routeView('/console/onboarding','',role)));
 }
 assert.equal(routeView(startRoute('support'),'','support'),'onboarding');
 assert.equal(routeView('/console/overview','','platform_admin'),'overview');
});
test('Phase5 feature routes remain available in their existing products',()=>{
 for(const view of ['organizations','support-cases','onboarding','imports']){
  assert.equal(routeView('/console/'+view,'','platform_admin'),view);
  assert.ok(viewInProduct('console',view));
 }
 assert.equal(routeView('/os/imports','','accountant'),'imports');
 assert.ok(viewInProduct('os','imports'));
 assert.equal(routeView('/os/accounting','','accountant'),'overview');
});
