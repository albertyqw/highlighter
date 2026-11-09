const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pageId, schemaFor, resolveReads, propertiesFor, blocksFor, batchesFor, importNotes, request } = require('../close-reader/notion.js');
const id = '12345678-1234-1234-1234-123456789abc';
const connection = { token: 'test-token', dataSourceId: id };
const note = (overrides = {}) => ({ color: 'yellow', text: 'Main idea', note: 'My note', pos: 0, ...overrides });
const page = (items = [note()]) => ({ title: 'Article', publishedDate: '2026-10-15', url: 'https://example.com/article', topics: ['topic-ai'], projects: ['project-llms'], items });
const source = () => ({ id, title: [{ plain_text: 'Reads' }], properties: {
  Title: { id: 'title', type: 'title' }, Date: { id: 'date', type: 'date' },
  'Topic Tags': { id: 'topics', type: 'multi_select', multi_select: { options: [{ id: 'topic-ai', name: 'AI', color: 'brown' }] } },
  Project: { id: 'project', type: 'multi_select', multi_select: { options: [{ id: 'project-llms', name: 'LLMs', color: 'orange' }] } },
} });
const ok = data => ({ ok: true, json: async () => data });
const text = block => block[block.type].rich_text.map(part => part.text.content).join('');
const flatten = blocks => blocks.flatMap(block => [block, ...flatten(block[block.type].children || [])]);
function mockNotion(failAppend = false) {
  const calls = [];
  return { calls, fetcher: async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    calls.push({ url, ...options, body });
    if (url.endsWith('/search')) return ok({ results: [source()] });
    if (url.includes('/databases/')) return ok({ data_sources: [{ id, name: 'Reads' }] });
    if (url.includes('/data_sources/')) return ok(source());
    if (url.endsWith('/pages')) return ok({ id: 'new-page', url: 'https://www.notion.so/imported' });
    if (failAppend) return { ok: false, status: 429, json: async () => ({}) };
    return ok({ results: body.children.map((_, i) => ({ id: `block-${calls.length}-${i}` })) });
  } };
}

test('accepts database IDs and Notion URLs including app.notion.com links', () => {
  for (const value of [id, id.replaceAll('-', ''), `https://www.notion.so/Reads-${id.replaceAll('-', '')}?v=view`, `https://app.notion.com/p/${id}`]) assert.equal(pageId(value), id);
  for (const value of ['', 'invalid', `https://evil.example/${id}`, `https://notion.so.evil.example/${id}`]) assert.throws(() => pageId(value));
});

test('loads real schema choices and rejects incompatible Reads properties', () => {
  const context = schemaFor(source());
  assert.equal(context.fields.title, 'title');
  assert.equal(context.fields.topics.options[0].name, 'AI');
  const invalid = source(); invalid.properties.Project.type = 'rich_text';
  assert.throws(() => schemaFor(invalid), /Project/);
});

test('resolves saved data sources, database links and automatically discovered Reads', async () => {
  for (const config of [connection, { token: 'token', databaseId: id }, { token: 'token', pageId: id }]) {
    const mock = mockNotion();
    assert.equal((await resolveReads(config, mock.fetcher)).dataSourceId, id);
  }
});

test('auto discovery paginates and refuses ambiguous Reads destinations', async () => {
  let searches = 0;
  const mock = mockNotion();
  const fetcher = (url, options) => {
    if (url.endsWith('/search')) return Promise.resolve(ok(++searches === 1 ? { results: [], has_more: true, next_cursor: 'next' } : { results: [source()] }));
    return mock.fetcher(url, options);
  };
  assert.equal((await resolveReads({ token: 'token' }, fetcher)).dataSourceId, id);
  assert.equal(searches, 2);
  await assert.rejects(resolveReads({ token: 'token' }, async () => ok({ results: [source(), source()] })), /Multiple Reads/);
});

test('writes title, publication date and existing option IDs without creating new tags', () => {
  const properties = propertiesFor(schemaFor(source()), page());
  assert.equal(properties.title.title[0].text.content, 'Article');
  assert.deepEqual(properties.date, { date: { start: '2026-10-15' } });
  assert.deepEqual(properties.topics, { multi_select: [{ id: 'topic-ai' }] });
  assert.deepEqual(properties.project, { multi_select: [{ id: 'project-llms' }] });
  assert.throws(() => propertiesFor(schemaFor(source()), { ...page(), topics: ['stale'] }), /no longer exists/);
  for (const publishedDate of ['', '2026-02-30', '2026-11', '2026-11-01T12:00:00Z']) assert.throws(() => propertiesFor(schemaFor(source()), { ...page(), publishedDate }), /publication date/);
});

test('nests supporting highlights under the preceding main idea with notes and colors intact', () => {
  const blocks = blocksFor(page([
    note({ color: 'pink', text: 'Before a main idea', pos: -1, note: '' }),
    note(), note({ color: 'blue', text: 'Evidence', pos: 1 }),
    note({ text: 'Second idea', pos: 2 }), note({ color: 'green', text: 'Method', pos: 3 }),
  ]));
  assert.equal(text(blocks[0]), page().url);
  assert.equal(blocks[0].paragraph.rich_text[0].text.link.url, page().url);
  assert.equal(text(blocks[1]), 'Published: 2026-10-15');
  assert.equal(text(blocks[2]), 'Before a main idea');
  const main = blocks[3];
  assert.equal(main.bulleted_list_item.color, 'yellow_background');
  assert.deepEqual(main.bulleted_list_item.children.map(text), ['Note: My note', 'Evidence']);
  assert.equal(main.bulleted_list_item.children[1].bulleted_list_item.color, 'blue_background');
  assert.equal(text(main.bulleted_list_item.children[1].bulleted_list_item.children[0]), 'Note: My note');
  assert.equal(text(blocks[4].bulleted_list_item.children[1]), 'Method');
});

test('long Unicode highlights and notes remain complete and below text limits', () => {
  const original = 'a'.repeat(1999) + '📝'.repeat(5000);
  const blocks = blocksFor(page([note({ text: original, note: original })]));
  assert.equal(blocks.filter(b => b.type === 'bulleted_list_item').map(text).join(''), original);
  assert.equal(flatten(blocks).filter(b => b.type === 'paragraph').slice(2).map(text).join(''), 'Note: ' + original);
  for (const b of flatten(blocks)) { assert.ok(text(b).length <= 2000); assert.ok(!/[\uD800-\uDBFF]$/.test(text(b))); }
});

test('rejects empty exports, invalid colors and non-web sources', () => {
  assert.throws(() => blocksFor(page([])), /Highlight/);
  assert.throws(() => blocksFor(page([note({ color: 'purple' })])), /Invalid/);
  assert.throws(() => blocksFor({ ...page(), url: 'javascript:alert(1)' }));
});

test('large imports retain hierarchy and obey block, byte and array limits', async () => {
  const data = page([note({ note: '' }), ...Array.from({ length: 105 }, (_, pos) => note({ color: 'blue', text: '漢'.repeat(2000), note: '', pos: pos + 1 }))]);
  const mock = mockNotion();
  const result = await importNotes(connection, data, mock.fetcher);
  assert.equal(result.url, 'https://www.notion.so/imported');
  const create = mock.calls.find(call => call.url.endsWith('/pages'));
  assert.deepEqual(create.body.parent, { data_source_id: id });
  const writes = mock.calls.filter(call => call.method === 'PATCH');
  assert.ok(writes.some(call => !call.url.includes('/blocks/new-page/')));
  for (const call of writes) {
    assert.ok(call.body.children.length <= 100);
    assert.ok(Buffer.byteLength(JSON.stringify(call.body)) < 450000);
    assert.ok(flatten(call.body.children).length <= 900);
  }
  assert.equal(writes.flatMap(call => flatten(call.body.children)).filter(b => b.type === 'bulleted_list_item').length, 106);
});

test('returns a partial Reads page link on failure and does not repeat the write', async () => {
  const mock = mockNotion(true);
  const result = await importNotes(connection, page(), mock.fetcher);
  assert.equal(result.url, 'https://www.notion.so/imported');
  assert.match(result.error, /incomplete.*rate limiting.*duplicates/);
  assert.equal(mock.calls.filter(call => call.method === 'PATCH').length, 1);
});

test('authentication and permission errors do not disclose the token', async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    await assert.rejects(request(connection.token, 'pages', 'POST', {}, async () => ({ ok: false, status, json: async () => ({ message: connection.token }) })), error => !error.message.includes(connection.token));
  }
});

test('network failure warns about uncertain writes', async () => {
  await assert.rejects(request('token', 'pages', 'POST', {}, async () => { throw new Error('offline'); }), /Check Notion before retrying/);
});

test('PDF exports keep page references and do not send local file paths', () => {
  const local = { ...page([note({ pdfPage: 7 })]), kind: 'pdf', url: '', sourceName: 'A paper.pdf' };
  const blocks = blocksFor(local);
  assert.equal(text(blocks[0]), 'Local PDF: A paper.pdf');
  assert.equal(blocks[0].paragraph.rich_text[0].text.link, undefined);
  assert.match(text(blocks[2]), /Main idea \(PDF page 7\)/);
  const remote = blocksFor({ ...page([note({ pdfPage: 2 })]), kind: 'pdf', url: 'https://example.com/paper.pdf' });
  assert.equal(remote[0].paragraph.rich_text[0].text.link.url, 'https://example.com/paper.pdf');
  assert.match(text(remote[2]), /PDF page 2/);
});

test('uploads screenshot-only notes as hosted Notion images with captions and PDF references', async () => {
  const mock = mockNotion();
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/file_uploads')) return ok({ id: 'file-one', status: 'pending' });
    if (url.endsWith('/file_uploads/file-one/send')) return ok({ id: 'file-one', status: 'uploaded' });
    return mock.fetcher(url, options);
  };
  const result = await importNotes(connection, { ...page([]), kind: 'pdf', screenshots: [{ blob: new Blob(['png'], { type: 'image/png' }), caption: 'Figure 2: cooperation rates', pdfPage: 3 }] }, fetcher);
  assert.equal(result.url, 'https://www.notion.so/imported');
  const upload = calls.find(call => call.url.endsWith('/send'));
  assert.ok(upload.body instanceof FormData);
  assert.equal(upload.headers['Content-Type'], undefined);
  assert.equal(upload.body.get('file').type, 'image/png');
  const image = mock.calls.filter(call => call.method === 'PATCH').flatMap(call => call.body.children).find(block => block.type === 'image');
  assert.deepEqual(image.image.file_upload, { id: 'file-one' });
  assert.match(image.image.caption[0].text.content, /Figure 2.*PDF page 3/);
});

test('screenshot upload failure preserves text already imported and links to the partial page', async () => {
  const mock = mockNotion();
  const result = await importNotes(connection, { ...page(), screenshots: [{ blob: new Blob(['png'], { type: 'image/png' }) }] }, async (url, options) => {
    if (url.endsWith('/file_uploads')) return { ok: false, status: 403, json: async () => ({}) };
    return mock.fetcher(url, options);
  });
  assert.equal(result.url, 'https://www.notion.so/imported');
  assert.match(result.error, /incomplete/);
  assert.ok(mock.calls.some(call => call.method === 'PATCH'));
});
