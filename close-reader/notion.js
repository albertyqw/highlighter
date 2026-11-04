// Shared by the service worker and settings page. No remote dependencies.
const CloseReaderNotion = (() => {
  const groups = [
    ['yellow', 'Core argument', 'yellow_background'],
    ['orange', 'Premises', 'orange_background'],
    ['blue', 'Evidence', 'blue_background'],
    ['green', 'Methods and definitions', 'green_background'],
    ['pink', 'Questions and gaps', 'pink_background'],
  ];

  function pageId(value) {
    let id = value.trim();
    if (/^https?:\/\//i.test(id)) {
      const url = new URL(id);
      if (!(url.hostname === 'notion.so' || url.hostname.endsWith('.notion.so') ||
            url.hostname === 'notion.site' || url.hostname.endsWith('.notion.site'))) {
        throw new Error('Use a Notion page link or page ID.');
      }
      id = url.pathname.split('/').filter(Boolean).pop() || '';
      id = id.match(/[a-f0-9]{32}$/i)?.[0] || id;
    }
    id = id.replace(/-/g, '');
    if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error('Enter a valid destination page link or page ID.');
    return id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }

  function chunks(text) {
    const result = [];
    while (text.length) {
      let end = Math.min(2000, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      result.push(text.slice(0, end));
      text = text.slice(end);
    }
    return result;
  }

  const richText = (content) => [{ type: 'text', text: { content } }];
  const block = (type, text, color = 'default') => ({
    object: 'block', type, [type]: { rich_text: richText(text), color },
  });

  function blocksFor(page) {
    if (!page || !Array.isArray(page.items) || !page.items.length) throw new Error('Highlight something before importing.');
    const url = new URL(page.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only web page notes can be imported.');
    const blocks = chunks(page.url).map(text => block('paragraph', text));
    if (page.url.length <= 2000) blocks[0].paragraph.rich_text[0].text.link = { url: page.url };
    blocks.push(block('paragraph', `Imported from Close Reader on ${new Date().toISOString().slice(0, 10)}`));
    for (const [key, heading, color] of groups) {
      const items = page.items.filter(item => item.color === key).sort((a, b) => a.pos - b.pos);
      if (!items.length) continue;
      blocks.push(block('heading_2', heading, color));
      for (const item of items) {
        if (typeof item.text !== 'string' || typeof item.note !== 'string') throw new Error('Invalid highlight or note.');
        blocks.push(...chunks(item.text).map(text => block('quote', text, color)));
        if (item.note.trim()) blocks.push(...chunks('Note: ' + item.note.trim()).map(text => block('paragraph', text)));
      }
    }
    return blocks;
  }

  // Respect both the 100-child and 500 KB request limits, including Unicode.
  function batchesFor(blocks) {
    const batches = [];
    let batch = [], bytes = 0;
    for (const block of blocks) {
      const size = new TextEncoder().encode(JSON.stringify(block)).length + 1;
      if (batch.length === 100 || bytes + size > 400000) {
        batches.push(batch);
        batch = []; bytes = 0;
      }
      batch.push(block); bytes += size;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  async function request(token, path, method, body, fetcher = fetch) {
    let response;
    try {
      response = await fetcher('https://api.notion.com/v1/' + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2026-03-11', 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error('Could not reach Notion. For an import, check Notion before trying again; a write may have completed.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = {
        401: 'Notion rejected the token. Check your connection token in Notion settings.',
        403: 'Notion denied access. Enable Read content and Insert content and connect the destination page.',
        404: 'Destination not found. Add your connection to that Notion page using its Connections menu.',
        429: 'Notion is rate limiting requests. Wait before importing again.',
      };
      throw new Error(messages[response.status] || `Notion request failed (${response.status}). Check Notion before retrying an import.`);
    }
    return data;
  }

  async function importNotes(connection, page, fetcher = fetch) {
    const batches = batchesFor(blocksFor(page));
    const parentId = pageId(connection.pageId);
    const title = chunks(page.title || page.url)[0];
    const created = await request(connection.token, 'pages', 'POST', {
      parent: { page_id: parentId },
      properties: { title: { type: 'title', title: richText(title) } },
      children: batches[0],
    }, fetcher);
    const url = created.url;
    try {
      for (const children of batches.slice(1)) {
        // Space writes to stay near the baseline connection rate limit.
        await new Promise(resolve => setTimeout(resolve, 350));
        await request(connection.token, `blocks/${created.id}/children`, 'PATCH', { children }, fetcher);
      }
    } catch (error) {
      return { url, error: `The Notion page was created, but the import is incomplete. ${error.message} Open it before retrying to avoid duplicates.` };
    }
    return { url };
  }

  return { pageId, blocksFor, batchesFor, request, importNotes };
})();

if (typeof module !== 'undefined') module.exports = CloseReaderNotion;
