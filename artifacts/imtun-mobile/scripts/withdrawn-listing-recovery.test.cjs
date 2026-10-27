const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const listingText = {
  confirmSend: ['Confirm Armenian', 'Confirm Russian', 'Confirm viewing request'],
  reqView: ['Request Armenian', 'Request Russian', 'Request a viewing'],
  badNum: ['Bad Armenian', 'Bad Russian', 'Invalid date'],
  sent: ['Sent Armenian', 'Sent Russian', 'Viewing request sent'],
  changed: ['Changed Armenian', 'Changed Russian', 'This listing has changed and is no longer available. Return to current results.'],
  currentResults: ['Results Armenian', 'Results Russian', 'Back to current results'],
  retry: ['Retry Armenian', 'Retry Russian', 'Retry'],
  when: ['When Armenian', 'When Russian', 'Date and time'],
  consent: ['Consent Armenian', 'Consent Russian', 'Owner consent'],
  vs: { requested: ['Requested Armenian', 'Requested Russian', 'Requested'] },
};

function createHarness(platform, { raceOnCreate = false } = {}) {
  let currentStatus = 'active';
  let hookValues = [];
  let hookIndex = 0;
  let rendered;
  let alert;
  let createCalls = 0;
  let availabilityChecks = 0;
  let returnedToResults = 0;
  let closedByOwner = false;
  const accessibilityAnnouncements = [];

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = initial;
      return [hookValues[index], value => {
        hookValues[index] = typeof value === 'function' ? value(hookValues[index]) : value;
      }];
    },
    useEffect(effect, deps) {
      const index = hookIndex++;
      const previous = hookValues[index];
      if (!previous || deps.some((value, depIndex) => !Object.is(value, previous.deps[depIndex]))) {
        hookValues[index] = { deps };
        effect();
      }
    },
  };

  const modules = {
    react: React,
    'react-native': {
      AccessibilityInfo: { announceForAccessibility: message => accessibilityAnnouncements.push(message) },
      Alert: { alert: (...args) => { alert = args; } },
      Platform: { OS: platform },
      Text: 'Text',
      View: 'View',
    },
    '@workspace/api-client-react': {
      getResidentRecord: async () => {
        availabilityChecks++;
        return { id: 'listing-1', status: currentStatus };
      },
      createResidentRecord: async () => {
        createCalls++;
        if (raceOnCreate) {
          currentStatus = 'closed';
          const error = new Error('Listing is no longer available');
          error.status = 409;
          throw error;
        }
        return { id: 'request-1' };
      },
    },
    '@tanstack/react-query': {
      useQuery: () => ({
        data: { id: 'listing-1', status: 'active' },
        isPending: false,
        isError: false,
        isFetching: false,
        refetch: async () => {},
      }),
    },
    '@/lib/resident/text': { L: (_language, values) => values[2] },
    '@/lib/resident/listingText': {
      LT: listingText,
      parseViewingLocal: () => new Date('2035-10-27T12:00:00'),
    },
    './Ui': {
      Btn: props => React.createElement('Btn', props),
      ErrorBox: props => React.createElement('ErrorBox', props),
      Field: props => React.createElement('Field', props),
      Toggle: props => React.createElement('Toggle', props),
    },
    './useAction': {
      useAction: () => ({ run: operation => operation(), busy: false, err: null }),
    },
  };

  const source = fs.readFileSync(path.join(__dirname, '../components/resident/ViewingForm.tsx'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: name => {
      assert.ok(modules[name], `Unexpected component dependency: ${name}`);
      return modules[name];
    },
    Date,
    Number,
    String,
    isNaN,
  });
  const ViewingForm = exports.default;
  const props = {
    rec: { id: 'listing-1', title: 'Renter-visible listing' },
    l: 'en',
    after: () => {},
    onDone: () => {},
    onUnavailable: () => { returnedToResults++; },
  };

  function render() {
    hookIndex = 0;
    rendered = ViewingForm(props);
    return rendered;
  }
  function find(node, testID) {
    if (!node || typeof node !== 'object') return null;
    if (node.props?.testID === testID) return node;
    for (const child of node.children ?? []) {
      const match = find(child, testID);
      if (match) return match;
    }
    return null;
  }
  function all(node, predicate, matches = []) {
    if (!node || typeof node !== 'object') return matches;
    if (predicate(node)) matches.push(node);
    for (const child of node.children ?? []) all(child, predicate, matches);
    return matches;
  }

  return {
    render,
    find: testID => find(rendered, testID),
    get alert() { return alert; },
    get accessibilityAnnouncements() { return accessibilityAnnouncements; },
    get createCalls() { return createCalls; },
    get availabilityChecks() { return availabilityChecks; },
    get returnedToResults() { return returnedToResults; },
    get closedByOwner() { return closedByOwner; },
    ownerClosesListing() {
      currentStatus = 'closed';
      closedByOwner = true;
    },
    text: value => all(rendered, node => node.type === 'Text' && node.children.includes(value)).length > 0,
  };
}

async function fillForm(harness) {
  harness.render();
  const date = harness.find('viewing-date-time');
  assert.ok(date, 'The active listing should show the viewing form');
  date.props.onChange('2035-10-27 12:00');
  harness.render();
  harness.find('viewing-owner-consent').props.onChange(true);
  harness.render();
}

for (const platform of ['ios', 'android']) {
  test(`${platform}: cancelling the viewing confirmation sends nothing and keeps the active form usable`, async () => {
    const h = createHarness(platform);
    await fillForm(h);

    h.find('submit-viewing-request').props.onPress();
    const cancel = h.alert[2].find(button => button.text === 'No');
    assert.ok(cancel, 'The native confirmation should offer a cancel action');
    assert.equal(cancel.style, 'cancel', 'The No action should use native cancel behavior');
    await cancel.onPress?.();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(h.createCalls, 0, 'Cancelling must not send a viewing request');
    h.render();
    assert.ok(h.find('viewing-date-time'), 'The active listing form should remain available');
    assert.equal(h.find('viewing-date-time').props.value, '2035-10-27 12:00');
    assert.equal(h.find('viewing-owner-consent').props.value, true);

    h.find('submit-viewing-request').props.onPress();
    const confirm = h.alert[2].find(button => button.text === 'Request a viewing');
    assert.ok(confirm, 'The renter should be able to reopen the confirmation');
    await confirm.onPress();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.createCalls, 1, 'The active form should still submit after cancelling once');
  });

  test(`${platform}: renter sees the withdrawn-listing explanation and can return to current results`, async () => {
    const h = createHarness(platform);
    await fillForm(h);
    h.ownerClosesListing();
    assert.ok(h.closedByOwner, 'The separate owner session closed the listing');

    h.find('submit-viewing-request').props.onPress();
    assert.equal(h.alert?.[0], 'Confirm viewing request', 'Native confirmation should be presented');
    const confirm = h.alert[2].find(button => button.text === 'Request a viewing');
    assert.ok(confirm, 'The confirmation must offer an explicit request action');
    await confirm.onPress();
    await new Promise(resolve => setImmediate(resolve));

    h.render();
    const explanation = h.find('viewing-listing-unavailable');
    assert.ok(explanation, 'The renter should see the listing-changed explanation');
    assert.equal(explanation.props.accessibilityLabel, listingText.changed[2], 'The unavailable message should have an explicit screen-reader label');
    assert.ok(h.accessibilityAnnouncements.includes(listingText.changed[2]), 'The changed-listing explanation and recovery guidance should be announced');
    assert.ok(h.text(listingText.changed[2]));
    assert.equal(h.find('submit-viewing-request'), null, 'A withdrawn listing must not remain submittable');
    assert.equal(h.createCalls, 0, 'No viewing request should be sent after the owner closes the listing');
    assert.equal(h.availabilityChecks, 1, 'The native confirmation must recheck listing availability');

    const recovery = h.find('viewing-back-to-results');
    assert.equal(recovery.props.label, listingText.currentResults[2], 'The recovery action should have a clear accessible button name');
    recovery.props.onPress();
    assert.equal(h.returnedToResults, 1, 'Recovery should invoke the marketplace current-results action');
  });

  test(`${platform}: a listing closed during submission is recovered from the server conflict`, async () => {
    const h = createHarness(platform, { raceOnCreate: true });
    await fillForm(h);
    h.find('submit-viewing-request').props.onPress();
    const confirm = h.alert[2].find(button => button.text === 'Request a viewing');
    await confirm.onPress();
    await new Promise(resolve => setImmediate(resolve));

    h.render();
    const explanation = h.find('viewing-listing-unavailable');
    assert.ok(explanation, 'A server conflict should show the listing-changed explanation');
    assert.ok(h.accessibilityAnnouncements.includes(listingText.changed[2]), 'A server conflict should announce the changed-listing guidance');
    assert.equal(h.createCalls, 1, 'The request can reach the server only in the close-during-submit race');
    assert.equal(h.find('submit-viewing-request'), null);
    const recovery = h.find('viewing-back-to-results');
    assert.equal(recovery.props.label, listingText.currentResults[2]);
    recovery.props.onPress();
    assert.equal(h.returnedToResults, 1);
  });
}
