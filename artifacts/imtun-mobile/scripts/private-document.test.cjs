const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise orchestration with platform adapters; this does not replace a real
// OS share-sheet test or claim that physical devices have been tested.
function harness({ platform = 'ios', available = true, denied = false, failShare = false, failWrite = false } = {}) {
  const events = [];
  const directories = new Set();
  class Directory {
    constructor(parent, child) { this.uri = `${parent.uri ?? parent}/${child}`; }
    get exists() { return directories.has(this.uri); }
    create() { events.push('create'); directories.add('cache/imtun-private-documents'); directories.add(this.uri); }
    delete() { events.push('delete'); for (const p of directories) if (p.startsWith(this.uri)) directories.delete(p); }
  }
  class File {
    constructor(directory, name) { this.uri = directory.uri + '/' + name; events.push(this.uri); }
    write(data, options) {
      events.push('write');
      assert.equal(data, 'cHJpdmF0ZQ==');
      assert.equal(options.encoding, 'base64');
      if (failWrite) throw new Error('Disk full');
    }
  }
  const modules = {
    '@workspace/api-client-react': {
      downloadResidentDocument: async (id, options) => {
        events.push('download');
        assert.equal(id, 'authorized-document');
        assert.ok(options.signal);
        if (denied) throw Object.assign(new Error('Forbidden'), { status: 403 });
        return { type: 'application/pdf' };
      },
    },
    'react-native': { Platform: { OS: platform } },
    'expo-file-system': { Directory, File, Paths: { cache: 'cache' } },
    'expo-sharing': {
      isAvailableAsync: async () => available,
      shareAsync: async (uri, options) => {
        events.push('share');
        assert.match(uri, /\/document\.pdf$/);
        assert.equal(options.mimeType, 'application/pdf');
        if (failShare) throw new Error('Share failed');
      },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../lib/resident/privateDocument.native.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, require: name => { assert.ok(modules[name], `Unexpected dependency ${name}`); return modules[name]; },
    FileReader: class {
      readAsDataURL() { this.result = 'data:application/pdf;base64,cHJpdmF0ZQ=='; this.onload(); }
    },
    Date, Math,
  });
  return { ...exports, events, directories };
}
const doc = { id: 'authorized-document', title: '../../untrusted title', media_type: 'application/pdf' };
test('iOS uses authorized transport, safe cache path, system sheet, then removes private bytes', async () => {
  const h = harness();
  await h.openPrivateDocument(doc, new AbortController().signal);
  assert.deepEqual(h.events.filter(e => !e.startsWith('cache/')), ['download', 'create', 'write', 'share', 'delete']);
  assert.equal(h.directories.size, 1); // only the empty root remains
});
test('Android keeps a valid content URI until the next cold-start cleanup', async () => {
  const h = harness({ platform: 'android' });
  await h.openPrivateDocument(doc, new AbortController().signal);
  assert.equal(h.directories.size, 2);
  h.clearPrivateDocumentCache();
  assert.equal(h.directories.size, 0);
});
test('authorization denial, unavailable sharing, and aborted context never create a local file', async () => {
  for (const options of [{ denied: true }, { available: false }, {}]) {
    const h = harness(options);
    const controller = new AbortController();
    if (!Object.keys(options).length) controller.abort();
    await assert.rejects(h.openPrivateDocument(doc, controller.signal));
    assert.equal(h.directories.size, 0);
    assert.ok(!h.events.includes('share'));
  }
});
test('write and sharing errors remove temporary private bytes on either OS', async () => {
  for (const platform of ['ios', 'android']) for (const option of ['failWrite', 'failShare']) {
    const h = harness({ platform, [option]: true });
    await assert.rejects(h.openPrivateDocument(doc, new AbortController().signal));
    assert.equal(h.directories.size, 1);
    assert.equal(h.events.at(-1), 'delete');
  }
});
