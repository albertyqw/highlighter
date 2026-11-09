const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extract, dateOnly } = require('../close-reader/article.js');
function documentWith(json = [], metas = {}) {
  return { title: 'Browser title | Publisher', URL: 'https://example.com/article',
    querySelectorAll: () => json.map(value => ({ textContent: typeof value === 'string' ? value : JSON.stringify(value) })),
    querySelector: selector => metas[selector] ? { getAttribute: () => metas[selector], textContent: metas[selector] } : null,
  };
}
test('uses the article headline and datePublished, preserving publisher calendar date', () => {
  assert.deepEqual(extract(documentWith([{ '@graph': [{ '@type': 'NewsArticle', headline: 'Article headline', datePublished: '2026-10-15T23:30:00-07:00' }] }])), { title: 'Article headline', publishedDate: '2026-10-15' });
});
test('ignores dateModified and leaves absent publication dates blank', () => {
  assert.equal(extract(documentWith([{ '@type': 'Article', dateModified: '2026-11-04' }])).publishedDate, '');
});
test('falls back to explicit publication meta tags and social title, ignoring malformed JSON', () => {
  assert.deepEqual(extract(documentWith(['invalid'], { 'meta[property="article:published_time"]': '2025-08-09T08:00:00Z', 'meta[property="og:title"]': 'Social headline' })), { title: 'Social headline', publishedDate: '2025-08-09' });
});
test('prefers JSON-LD matching the article URL over another article', () => {
  const metadata = extract(documentWith([{ '@type': 'Article', headline: 'Related', url: 'https://example.com/other' }, { '@type': 'BlogPosting', headline: 'Correct', url: 'https://example.com/article', datePublished: '2024-01-02' }]));
  assert.equal(metadata.title, 'Correct');
  assert.equal(metadata.publishedDate, '2024-01-02');
});
test('validates complete calendar dates without inventing missing month/day', () => {
  assert.equal(dateOnly('2024/02/29'), '2024-02-29');
  for (const value of ['2025-02-29', '2026-13-01', '2026-10', '', undefined]) assert.equal(dateOnly(value), '');
});
