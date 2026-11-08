// Notion requests run in the extension, directly against the user's workspace.
const CloseReaderNotion = (() => {
  const articleDates = typeof module !== 'undefined' ? require('./article.js') : CloseReaderArticle;
  const colors = { yellow: 'yellow_background', orange: 'orange_background', blue: 'blue_background', green: 'green_background', pink: 'pink_background' };
  const richText = content => [{ type: 'text', text: { content } }];
  const block = (type, text, color = 'default') => ({ object: 'block', type, [type]: { rich_text: richText(text), color } });
  const childrenOf = b => b[b.type].children || [];
  const size = value => new TextEncoder().encode(JSON.stringify(value)).length;

  function pageId(value) {
    let id = value.trim();
    if (/^https?:\/\//i.test(id)) {
      const url = new URL(id);
      if (!(url.hostname === 'notion.so' || url.hostname.endsWith('.notion.so') || url.hostname === 'notion.com' || url.hostname.endsWith('.notion.com') || url.hostname.endsWith('.notion.site'))) throw new Error('Use a Notion database link or ID.');
      id = url.pathname.split('/').filter(Boolean).pop() || '';
      id = id.match(/[a-f0-9]{32}$/i)?.[0] || id;
    }
    id = id.replace(/-/g, '');
    if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error('Enter a valid Reads database link or ID.');
    return id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }

  function chunks(text) {
    const result = [];
    while (text.length) {
      let end = Math.min(2000, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      result.push(text.slice(0, end)); text = text.slice(end);
    }
    return result;
  }

  async function request(token, path, method, body, fetcher = fetch) {
    const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
    let response;
    try {
      response = await fetcher('https://api.notion.com/v1/' + path, {
        method, signal: AbortSignal.timeout(25000),
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2026-03-11', ...(!multipart ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error('Could not reach Notion. Check Notion before retrying an import; a write may have completed.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = {
        401: 'Notion rejected the token. Check your connection token in Notion settings.',
        403: 'Notion denied access. Enable Read content and Insert content and connect the Reads database.',
        404: 'Reads was not found. Add your connection to the Reads database using its Connections menu.',
        429: 'Notion is rate limiting requests. Wait before importing again.',
      };
      const error = new Error(messages[response.status] || `Notion request failed (${response.status}). Check Notion before retrying an import.`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function schemaFor(source) {
    const properties = Object.entries(source.properties || {});
    const title = properties.find(([, property]) => property.type === 'title');
    const field = (name, type) => {
      const entry = properties.find(([key]) => key === name);
      if (!entry || entry[1].type !== type) throw new Error(`Reads needs a ${type} property named “${name}”. Check Notion settings.`);
      return { id: entry[1].id || entry[0], options: (entry[1][type]?.options || []).map(({ id, name, color }) => ({ id, name, color })) };
    };
    if (!title) throw new Error('Reads needs a title property.');
    return {
      dataSourceId: source.id,
      name: (source.title || []).map(item => item.plain_text || item.text?.content || '').join('') || 'Reads',
      fields: { title: title[1].id || title[0], date: field('Date', 'date').id, topics: field('Topic Tags', 'multi_select'), projects: field('Project', 'multi_select') },
    };
  }

  async function resolveReads(connection, fetcher = fetch) {
    const get = path => request(connection.token, path, 'GET', undefined, fetcher);
    let source;
    if (connection.dataSourceId) {
      source = await get(`data_sources/${pageId(connection.dataSourceId)}`);
    } else if (connection.databaseId) {
      const database = await get(`databases/${pageId(connection.databaseId)}`);
      const sources = database.data_sources || [];
      const selected = sources.length === 1 ? sources[0] : sources.find(item => item.name === 'Reads');
      if (!selected) throw new Error('Choose a database with a single Reads data source.');
      source = await get(`data_sources/${selected.id}`);
    } else {
      const matches = [];
      let cursor;
      do {
        const result = await request(connection.token, 'search', 'POST', { query: 'Reads', filter: { value: 'data_source', property: 'object' }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }, fetcher);
        matches.push(...(result.results || []).filter(item => (item.title || []).map(t => t.plain_text || t.text?.content || '').join('').trim().toLowerCase() === 'reads'));
        cursor = result.has_more ? result.next_cursor : null;
      } while (cursor);
      if (matches.length !== 1) throw new Error(matches.length ? 'Multiple Reads databases found. Paste the correct database link in Notion settings.' : 'Share the Reads database with your connection, or enter its link in Notion settings.');
      source = await get(`data_sources/${matches[0].id}`);
    }
    if (source.archived || source.in_trash) throw new Error('Restore the Reads database in Notion or choose another destination.');
    return schemaFor(source);
  }

  function propertiesFor(context, page) {
    const { fields } = context;
    if (!page.title?.trim()) throw new Error('Enter the article title.');
    if (!articleDates.dateOnly(page.publishedDate) || page.publishedDate.length !== 10) throw new Error('Enter the explicit publication date before importing.');
    const properties = {
      [fields.title]: { title: richText(chunks(page.title.trim())[0]) },
      [fields.date]: { date: { start: page.publishedDate } },
    };
    for (const key of ['topics', 'projects']) {
      const values = [...new Set(page[key] || [])];
      if (values.length > 100) throw new Error('Choose at most 100 topics or projects.');
      if (values.some(id => !fields[key].options.some(option => option.id === id))) throw new Error('A selected topic or project no longer exists. Refresh the Notion choices.');
      properties[fields[key].id] = { multi_select: values.map(id => ({ id })) };
    }
    return properties;
  }

  function blocksFor(page) {
    if (!page || !Array.isArray(page.items) || (!page.items.length && !page.screenshots?.length)) throw new Error('Highlight something or take a screenshot before importing.');
    const localPdf = page.kind === 'pdf' && !page.url && typeof page.sourceName === 'string' && page.sourceName.trim();
    if (!localPdf) {
      const url = new URL(page.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only web page or PDF notes can be imported.');
    }
    const blocks = chunks(localPdf ? `Local PDF: ${page.sourceName}` : page.url).map(text => block('paragraph', text));
    if (!localPdf && page.url.length <= 2000) blocks[0].paragraph.rich_text[0].text.link = { url: page.url };
    blocks.push(block('paragraph', `Published: ${page.publishedDate}`));
    let main = null;
    for (const item of [...page.items].sort((a, b) => a.pos - b.pos)) {
      if (typeof item.text !== 'string' || !item.text.trim() || typeof item.note !== 'string' || !colors[item.color]) throw new Error('Invalid highlight or note.');
      const quote = item.pdfPage ? `${item.text} (PDF page ${item.pdfPage})` : item.text;
      const parts = chunks(quote).map(text => block('bulleted_list_item', text, colors[item.color]));
      const last = parts[parts.length - 1];
      const notes = item.note.trim() ? chunks('Note: ' + item.note.trim()).map(text => block('paragraph', text)) : [];
      // Notes belong to their highlight; support belongs to the preceding main idea.
      if (notes.length) last.bulleted_list_item.children = notes;
      if (item.color === 'yellow') {
        blocks.push(...parts);
        main = parts[parts.length - 1];
      } else if (main) {
        (main.bulleted_list_item.children ||= []).push(...parts);
      } else blocks.push(...parts);
    }
    return blocks;
  }

  function countBlocks(blocks) { return blocks.reduce((sum, b) => sum + 1 + countBlocks(childrenOf(b)), 0); }
  function canInline(blocks, depth = 0) {
    return blocks.length <= 100 && blocks.every(b => !childrenOf(b).length || (depth < 2 && canInline(childrenOf(b), depth + 1)));
  }
  function prepared(block) {
    if (canInline([block]) && countBlocks([block]) <= 900 && size(block) < 300000) return block;
    const copy = { ...block, [block.type]: { ...block[block.type] } };
    delete copy[block.type].children;
    return copy;
  }
  function batchesFor(blocks) {
    const batches = [];
    let batch = [], bytes = 0, count = 0;
    for (const b of blocks) {
      const nextBytes = size(b) + 1, nextCount = countBlocks([b]);
      if (batch.length && (batch.length === 100 || bytes + nextBytes > 400000 || count + nextCount > 900)) {
        batches.push(batch); batch = []; bytes = 0; count = 0;
      }
      batch.push(b); bytes += nextBytes; count += nextCount;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  async function importNotes(connection, page, fetcher = fetch) {
    const blocks = blocksFor(page);
    const context = await resolveReads(connection, fetcher);
    const properties = propertiesFor(context, page);
    const created = await request(connection.token, 'pages', 'POST', { parent: { data_source_id: context.dataSourceId }, properties }, fetcher);
    async function append(parent, originals) {
      let offset = 0;
      for (const children of batchesFor(originals.map(prepared))) {
        await new Promise(resolve => setTimeout(resolve, 350));
        const result = await request(connection.token, `blocks/${parent}/children`, 'PATCH', { children }, fetcher);
        for (let i = 0; i < children.length; i++) {
          const original = originals[offset + i];
          if (childrenOf(original).length && !childrenOf(children[i]).length) {
            const id = result.results?.[i]?.id;
            if (!id) throw new Error('Notion did not return the imported block IDs.');
            await append(id, childrenOf(original));
          }
        }
        offset += children.length;
      }
    }
    try {
      await append(created.id, blocks);
      for (const [index, capture] of (page.screenshots || []).entries()) {
        if (!capture.blob || capture.blob.type !== 'image/png' || capture.blob.size > 5 * 1024 * 1024) throw new Error('A screenshot is missing or too large to upload. Download it and try a smaller capture.');
        const upload = await request(connection.token, 'file_uploads', 'POST', { mode: 'single_part', filename: `close-reader-${index + 1}.png`, content_type: 'image/png' }, fetcher);
        const form = new FormData();
        form.append('file', capture.blob, `close-reader-${index + 1}.png`);
        let result = await request(connection.token, `file_uploads/${encodeURIComponent(upload.id)}/send`, 'POST', form, fetcher);
        for (let attempt = 0; result.status === 'pending' && attempt < 5; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          result = await request(connection.token, `file_uploads/${encodeURIComponent(upload.id)}`, 'GET', undefined, fetcher);
        }
        if (result.status !== 'uploaded') throw new Error('Notion has not finished processing a screenshot. Check the page before retrying.');
        const caption = [capture.caption, capture.pdfPage ? `PDF page ${capture.pdfPage}` : ''].filter(Boolean).join(' · ');
        const image = { object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: upload.id }, caption: caption ? chunks(caption).map(text => richText(text)[0]) : [] } };
        await new Promise(resolve => setTimeout(resolve, 350));
        await append(created.id, [...(index === 0 ? [block('heading_2', 'Screenshots')] : []), image]);
      }
    }
    catch (error) { return { url: created.url, error: `The Reads page was created, but the import is incomplete. ${error.message} Open it before retrying to avoid duplicates.` }; }
    return { url: created.url };
  }

  return { pageId, request, schemaFor, resolveReads, propertiesFor, blocksFor, batchesFor, importNotes };
})();
if (typeof module !== 'undefined') module.exports = CloseReaderNotion;
