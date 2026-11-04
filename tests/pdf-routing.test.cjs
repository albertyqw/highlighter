const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
function worker() {
  const handlers = {}, calls = { tabs: [], pageMessages: [], extensionMessages: [] };
  const chrome = {
    action: { setBadgeBackgroundColor() {}, setBadgeText() {}, onClicked: { addListener(fn) { handlers.click = fn; } } },
    commands: { onCommand: { addListener(fn) { handlers.command = fn; } } },
    runtime: { getURL: path => 'chrome-extension://test/' + path, onInstalled: { addListener() {} }, onMessage: { addListener() {} }, sendMessage: async message => { calls.extensionMessages.push(message); } },
    contextMenus: { onClicked: { addListener(fn) { handlers.menu = fn; } } },
    tabs: { create: async tab => { calls.tabs.push(tab); }, sendMessage: async (id, message) => { calls.pageMessages.push({ id, message }); return { enabled: true }; } },
  };
  vm.runInNewContext(readFileSync(require.resolve('../close-reader/background.js'), 'utf8'), {
    chrome, importScripts() {}, CloseReaderPdf: require('../close-reader/pdf-source.js'), URLSearchParams,
  });
  return { handlers, calls };
}
test('toolbar on a PDF opens its own reader and preserves the source', async () => {
  const { handlers, calls } = worker();
  await handlers.click({ id: 7, url: 'https://example.com/paper.pdf?download=1' });
  const opened = new URL(calls.tabs[0].url);
  assert.equal(opened.pathname, '/pdf.html');
  assert.equal(opened.searchParams.get('source'), 'https://example.com/paper.pdf?download=1');
  assert.equal(calls.tabs[0].openerTabId, 7);
  assert.equal(calls.pageMessages.length, 0);
});
test('ordinary articles keep using content-script highlighting', async () => {
  const { handlers, calls } = worker();
  await handlers.click({ id: 8, url: 'https://example.com/article' });
  assert.equal(calls.tabs.length, 0);
  assert.equal(calls.pageMessages[0].message.type, 'toggle');
});
test('PDF viewer toolbar commands target only the intended viewer tab', async () => {
  const { handlers, calls } = worker();
  await handlers.click({ id: 9, url: 'chrome-extension://test/pdf.html?source=https://example.com/paper.pdf' });
  assert.equal(calls.extensionMessages[0].type, 'pdf-command');
  assert.equal(calls.extensionMessages[0].tabId, 9);
  assert.equal(calls.tabs.length, 0);
});
test('context menu supports PDF links without a .pdf suffix and a local file launcher', () => {
  const { handlers, calls } = worker();
  handlers.menu({ menuItemId: 'pdf-link', linkUrl: 'https://example.com/download/123' }, { id: 1 });
  handlers.menu({ menuItemId: 'pdf-tab' }, { id: 2 });
  assert.equal(new URL(calls.tabs[0].url).searchParams.get('source'), 'https://example.com/download/123');
  assert.equal(new URL(calls.tabs[1].url).pathname, '/pdf.html');
});
