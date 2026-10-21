import assert from 'node:assert/strict';
import test from 'node:test';
import { armenianCurrency, formatArmenianDate, isCompletedRequestStatus, localizeRequestStatus, requestCount } from '../constants/armenian.ts';

test('formats dates in Armenian and handles invalid API values', () => {
  assert.equal(formatArmenianDate('2026-10-21T12:00:00Z'), '21 հոկ.');
  assert.equal(formatArmenianDate('2026-10-21T12:00:00Z', true), '21 հոկտեմբերի, 2026 թ.');
  assert.equal(formatArmenianDate('not a date'), 'Ամսաթիվը նշված չէ');
});

test('localizes request status values, including status emphasis', () => {
  assert.equal(localizeRequestStatus('in_progress'), 'Ընթացքի մեջ է');
  assert.equal(localizeRequestStatus('assigned'), 'Կատարողը նշանակված է');
  assert.equal(localizeRequestStatus('unknown_state'), 'Կարգավիճակը թարմացվում է');
  assert.equal(isCompletedRequestStatus('completed'), true);
  assert.equal(isCompletedRequestStatus('assigned'), false);
});

test('formats counts and currency names in Armenian', () => {
  assert.equal(requestCount(3), '3 հայտ');
  assert.equal(armenianCurrency('AMD'), 'ՀՀ դրամ');
  assert.equal(armenianCurrency('USD'), 'ԱՄՆ դոլար');
});
