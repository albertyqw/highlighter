const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function worker(connection, importer = async () => ({ url: 'https://www.notion.so/test' })) {
  let listener;
  const chrome = {
    action: { setBadgeBackgroundColor() {}, onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
    runtime: { id: 'test-extension', getURL: path => 'chrome-extension://test-extension/' + path, onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } }, openOptionsPage: async () => {} },
    contextMenus: { onClicked: { addListener() {} } },
    storage: { local: { get: async () => ({ notionConnection: connection }) } },
  };
  vm.runInNewContext(readFileSync(require.resolve('../close-reader/background.js'), 'utf8'), {
    chrome, importScripts() {}, CloseReaderNotion: { importNotes: importer },
  });
  return listener;
}
const sender = { id: 'test-extension', tab: { id: 1 } };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('requests setup when there is no saved connection', async () => {
  let result;
  const listener = worker(undefined, () => { throw new Error('must not import'); });
  assert.equal(listener({ type: 'notion-import' }, sender, value => { result = value; }), true);
  await flush();
  assert.equal(result.setup, true);
});

test('worker retrieves credentials and imports without including credentials in its response', async () => {
  const connection = { token: 'private-token', pageId: 'page' };
  const page = { items: [] };
  let result;
  const listener = worker(connection, async (saved, payload) => {
    assert.equal(saved, connection);
    assert.equal(payload, page);
    return { url: 'https://www.notion.so/test' };
  });
  listener({ type: 'notion-import', page }, sender, value => { result = value; });
  await flush();
  assert.equal(result.url, 'https://www.notion.so/test');
  assert.ok(!JSON.stringify(result).includes(connection.token));
});

test('rejects duplicate concurrent imports and releases the lock on failure', async () => {
  let rejectImport;
  let calls = 0;
  const listener = worker({ token: 'token', pageId: 'page' }, () => {
    calls++;
    return new Promise((_, reject) => { rejectImport = reject; });
  });
  const message = { type: 'notion-import' };
  listener(message, sender, () => {});
  let duplicate;
  listener(message, sender, value => { duplicate = value; });
  assert.match(duplicate.error, /already running/);
  await flush();
  rejectImport(new Error('failed'));
  await flush();
  listener(message, sender, () => {});
  await flush();
  assert.equal(calls, 2);
  rejectImport(new Error('failed again'));
  await flush();
});

test('ignores foreign senders and import requests without a tab', () => {
  const listener = worker({ token: 'token', pageId: 'page' });
  const unexpected = () => assert.fail('must not respond');
  assert.equal(listener({ type: 'notion-import' }, { id: 'other', tab: { id: 1 } }, unexpected), undefined);
  assert.equal(listener({ type: 'notion-import' }, { id: 'test-extension' }, unexpected), undefined);
});

test('allows Notion imports from the extension PDF reader without sender.tab', async () => {
  const listener = worker({ token: 'token', dataSourceId: 'reads' });
  let result;
  listener({ type: 'notion-import', page: {} }, { id: 'test-extension', url: 'chrome-extension://test-extension/pdf.html?source=https://example.com/paper.pdf', documentId: 'pdf-document' }, value => { result = value; });
  await flush();
  assert.equal(result.url, 'https://www.notion.so/test');
});
