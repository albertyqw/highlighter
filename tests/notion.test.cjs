const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pageId, blocksFor, batchesFor, importNotes, request } = require('../close-reader/notion.js');

const id = '12345678-1234-1234-1234-123456789abc';
const connection = { token: 'test-token', pageId: id };
const note = (overrides = {}) => ({ color: 'yellow', text: 'A quotation', note: 'My note', pos: 0, ...overrides });
const page = (items = [note()]) => ({ title: 'Article', url: 'https://example.com/article?q=reading', items });
const ok = data => ({ ok: true, json: async () => data });
const text = block => block[block.type].rich_text.map(part => part.text.content).join('');

test('accepts Notion URLs and page IDs, ignoring view parameters and anchors', () => {
  for (const value of [id, id.replaceAll('-', ''), `https://www.notion.so/Reading-${id.replaceAll('-', '')}?pvs=4#block`, `https://team.notion.site/${id}`]) {
    assert.equal(pageId(value), id);
  }
  for (const value of ['', 'invalid', `https://evil.example/${id}`, `https://notion.so.evil.example/${id}`]) {
    assert.throws(() => pageId(value));
  }
});

test('preserves source, groups, reading order, quote and note contents', () => {
  const blocks = blocksFor(page([note({ color: 'pink', text: 'Question?' }), note({ text: 'Second', pos: 2 }), note({ text: 'First', pos: 1 })]));
  assert.equal(text(blocks[0]), page().url);
  assert.equal(blocks[0].paragraph.rich_text[0].text.link.url, page().url);
  assert.deepEqual(blocks.filter(b => b.type === 'heading_2').map(text), ['Core argument', 'Questions and gaps']);
  assert.deepEqual(blocks.filter(b => b.type === 'quote').map(text), ['First', 'Second', 'Question?']);
  assert.equal(blocks.filter(b => text(b) === 'Note: My note').length, 3);
  assert.equal(blocks.find(b => b.type === 'quote').quote.color, 'yellow_background');
});

test('splits long Unicode highlights and notes without losing text or splitting surrogate pairs', () => {
  const original = 'a'.repeat(1999) + '📝'.repeat(5000);
  const blocks = blocksFor(page([note({ text: original, note: original })]));
  assert.equal(blocks.filter(b => b.type === 'quote').map(text).join(''), original);
  assert.equal(blocks.filter(b => b.type === 'paragraph').slice(2).map(text).join(''), 'Note: ' + original);
  for (const b of blocks) {
    assert.ok(text(b).length <= 2000);
    assert.ok(!/[\uD800-\uDBFF]$/.test(text(b)));
  }
});

test('skips empty notes and rejects empty exports and invalid source URLs', () => {
  assert.equal(blocksFor(page([note({ note: '  ' })])).filter(b => b.type === 'paragraph').length, 2);
  assert.throws(() => blocksFor(page([])), /Highlight/);
  assert.throws(() => blocksFor({ ...page(), url: 'javascript:alert(1)' }));
});

test('batches within block-count and byte limits, including multi-byte text', () => {
  const blocks = blocksFor(page(Array.from({ length: 250 }, () => note({ text: '漢'.repeat(2000), note: '' }))));
  const batches = batchesFor(blocks);
  assert.deepEqual(batches.flat(), blocks);
  for (const children of batches) {
    assert.ok(children.length <= 100);
    assert.ok(Buffer.byteLength(JSON.stringify({ children })) < 450000);
  }
});

test('creates a child page and appends subsequent batches in order', async () => {
  const calls = [];
  const data = page(Array.from({ length: 110 }, (_, pos) => note({ pos })));
  const result = await importNotes(connection, data, async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return ok({ id, url: 'https://www.notion.so/imported' });
  });
  assert.equal(result.url, 'https://www.notion.so/imported');
  assert.equal(calls[0].url, 'https://api.notion.com/v1/pages');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-token');
  assert.deepEqual(calls[0].body.parent, { page_id: id });
  assert.equal(calls[0].body.properties.title.title[0].text.content, 'Article');
  assert.ok(calls.slice(1).every(c => c.method === 'PATCH' && c.url.endsWith(`/blocks/${id}/children`)));
  assert.deepEqual(calls.flatMap(c => c.body.children), blocksFor(data));
});

test('returns the partial page link and does not automatically repeat writes', async () => {
  let count = 0;
  const result = await importNotes(connection, page(Array.from({ length: 110 }, () => note())), async () => {
    if (++count === 1) return ok({ id, url: 'https://www.notion.so/partial' });
    return { ok: false, status: 429, json: async () => ({}) };
  });
  assert.equal(count, 2);
  assert.equal(result.url, 'https://www.notion.so/partial');
  assert.match(result.error, /incomplete.*rate limiting.*duplicates/);
});

test('auth, permissions, missing page and server errors surface actionable messages without secrets', async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    await assert.rejects(request(connection.token, 'pages', 'POST', {}, async () => ({ ok: false, status, json: async () => ({ message: connection.token }) })), error => !error.message.includes(connection.token));
  }
});

test('network failure warns of uncertain write completion and is not retried', async () => {
  let count = 0;
  await assert.rejects(importNotes(connection, page(), async () => { count++; throw new Error('offline'); }), /check Notion before trying again/i);
  assert.equal(count, 1);
});
