const { test } = require('node:test');
const assert = require('node:assert/strict');
const { source, sourceFromTab, nameFromUrl, metadata } = require('../close-reader/pdf-source.js');

test('remote identity keeps download parameters and removes page fragments', () => {
  assert.equal(source('https://example.com/paper.pdf?download=1#page=4'), 'https://example.com/paper.pdf?download=1');
  assert.equal(source('file:///Users/reader/Paper.pdf#page=2'), 'file:///Users/reader/Paper.pdf');
  for (const value of ['javascript:alert(1)', 'data:application/pdf,x', 'https://user:password@example.com/paper.pdf']) assert.throws(() => source(value));
});

test('detects PDF tabs and Chrome viewer URLs without redirecting ordinary articles', () => {
  assert.equal(sourceFromTab({ url: 'https://example.com/PAPER.PDF?download=1' }), 'https://example.com/PAPER.PDF?download=1');
  assert.equal(sourceFromTab({ url: 'https://example.com/download/42', title: 'paper.pdf' }), 'https://example.com/download/42');
  assert.equal(sourceFromTab({ url: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?src=https%3A%2F%2Fexample.com%2Fpaper.pdf' }), 'https://example.com/paper.pdf');
  assert.equal(sourceFromTab({ url: 'https://example.com/article', title: 'An article' }), null);
  assert.equal(sourceFromTab({ url: 'chrome://extensions' }), null);
});

test('extracts explicit PDF title and publication date, ignoring creation dates', () => {
  assert.deepEqual(metadata({ Title: 'A paper', CreationDate: 'D:20200101120000Z' }), { title: 'A paper', publishedDate: '' });
  const xmp = { get: key => ({ 'dc:title': 'Published title', 'prism:publicationdate': '2024-08-15T10:00:00Z' })[key] };
  assert.deepEqual(metadata({ Title: 'File title' }, xmp), { title: 'Published title', publishedDate: '2024-08-15' });
  assert.equal(nameFromUrl('https://example.com/A%20paper.pdf?download=true'), 'A paper.pdf');
});
