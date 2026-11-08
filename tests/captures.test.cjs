const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cropPlan, captureTab } = require('../close-reader/captures.js');

test('maps CSS selection to screenshot pixels independently of display scaling', () => {
  assert.deepEqual(cropPlan({ x: 100, y: 50, width: 200, height: 100 }, { width: 1000, height: 500 }, { width: 2000, height: 1000 }), { x: 200, y: 100, width: 400, height: 200, outputWidth: 400, outputHeight: 200 });
});
test('clips to the viewport and bounds large full-viewport images', () => {
  const clipped = cropPlan({ x: -20, y: 10, width: 100, height: 1000 }, { width: 1000, height: 500 }, { width: 1000, height: 500 });
  assert.equal(clipped.width, 80); assert.equal(clipped.height, 490);
  const full = cropPlan(null, { width: 4000, height: 4000 }, { width: 8000, height: 8000 });
  assert.equal(full.outputWidth, 2000); assert.equal(full.outputHeight, 2000);
  assert.throws(() => cropPlan({ x: NaN, y: 1, width: 100, height: 100 }, { width: 1000, height: 500 }, { width: 1000, height: 500 }));
  assert.throws(() => cropPlan({ x: 2000, y: 1, width: 100, height: 100 }, { width: 1000, height: 500 }, { width: 1000, height: 500 }));
});
test('refuses to capture another active tab', async () => {
  let captured = false;
  const api = { tabs: { query: async () => [{ id: 2 }], captureVisibleTab: async () => { captured = true; } } };
  await assert.rejects(captureTab(api, { id: 1, windowId: 10 }, {}), /source tab/);
  assert.equal(captured, false);
});
test('discards the image if the tab changes during capture', async () => {
  let queries = 0, processed = false;
  const api = { tabs: { query: async () => [{ id: ++queries === 1 ? 1 : 2 }], captureVisibleTab: async () => 'data:image/png;base64,test' } };
  await assert.rejects(captureTab(api, { id: 1, windowId: 11 }, {}, async () => { processed = true; }), /source tab/);
  assert.equal(processed, false);
});
test('returns actionable capture permission guidance and saves successful captures', async () => {
  const denied = { tabs: { query: async () => [{ id: 1 }], captureVisibleTab: async () => { throw new Error('activeTab'); } } };
  await assert.rejects(captureTab(denied, { id: 1, windowId: 12 }, {}), /Shift \+ S/);
  let saved;
  const allowed = { tabs: { query: async () => [{ id: 1 }], captureVisibleTab: async () => 'data:image/png;base64,test' } };
  const id = await captureTab(allowed, { id: 1, windowId: 13 }, { pageKey: 'cr:pdf:test', pdfPage: 4 }, async () => ({ blob: new Blob(['png'], { type: 'image/png' }) }), async record => { saved = record; });
  assert.equal(saved.id, id); assert.equal(saved.pageKey, 'cr:pdf:test'); assert.equal(saved.pdfPage, 4);
});
