const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pageMessage } = require('../close-reader/messaging.js');
const handlers = () => ({ toggle() {}, panel() {}, screenshot() {}, enabled: () => true });

test('another PDF tab cannot answer Notion requests before the worker', async () => {
  for (const type of ['notion-context', 'notion-import', 'notion-settings', 'screenshots-list', 'screenshots-capture']) {
    const response = await new Promise(resolve => {
      pageMessage({ type }, handlers(), resolve);
      setImmediate(() => resolve({ context: { name: 'Reads' } }));
    });
    assert.equal(response.context.name, 'Reads');
  }
});
test('page controls still run and reply with the current highlighter state', () => {
  for (const type of ['toggle', 'panel', 'screenshot']) {
    let invoked = false, response;
    pageMessage({ type }, { ...handlers(), [type]: () => { invoked = true; } }, result => { response = result; });
    assert.ok(invoked);
    assert.equal(response.enabled, true);
  }
});
