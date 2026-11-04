// Close Reader: five-colour highlighting and notes, stored per page.
(() => {
  if (window.__closeReaderLoaded || !document.body) return;
  window.__closeReaderLoaded = true;

  const COLORS = [
    { key: 'yellow', rgb: '255 214 10',  label: 'Core',     heading: 'Core argument',          desc: 'Core argument, thesis, conclusion or main idea' },
    { key: 'orange', rgb: '255 159 28',  label: 'Premise',  heading: 'Premises',               desc: 'Supporting qualitative or subjective premise' },
    { key: 'blue',   rgb: '78 168 222',  label: 'Evidence', heading: 'Evidence',               desc: 'Supporting evidence, data or statistics' },
    { key: 'green',  rgb: '82 183 136',  label: 'Method',   heading: 'Methods and definitions', desc: 'Methodology, new technique or definition' },
    { key: 'pink',   rgb: '255 112 166', label: 'Question', heading: 'Questions and gaps',     desc: 'Question, gap, counter-argument or surprise to look up' },
  ];
  const BY_KEY = Object.fromEntries(COLORS.map((c) => [c.key, c]));
  const CONTEXT = 40;
  const SKIP = 'script,style,noscript,textarea,input,select,option,[contenteditable]:not([contenteditable="false"]),#close-reader-host';
  const storageKey = 'cr:' + location.origin + location.pathname + location.search;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let enabled = false;
  let panelOpen = false;
  let highlights = [];
  let activeId = null;

  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  // ---------- storage ----------
  async function load() {
    try {
      const o = await chrome.storage.local.get(storageKey);
      highlights = (o[storageKey] && o[storageKey].items) || [];
    } catch (e) {
      highlights = [];
    }
  }

  function save() {
    try {
      if (highlights.length) {
        chrome.storage.local.set({
          [storageKey]: { title: document.title, url: location.href, updated: new Date().toISOString(), items: highlights },
        });
      } else {
        chrome.storage.local.remove(storageKey);
      }
    } catch (e) {
      // Extension was reloaded; this page needs a refresh to save again.
    }
  }

  // ---------- text index: the page's visible text as one string ----------
  function buildIndex() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let text = '';
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      nodes.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { text, nodes };
  }

  function rangeToOffsets(range, idx) {
    let s = -1;
    let e = -1;
    for (const { node, start } of idx.nodes) {
      if (!range.intersectsNode(node)) continue;
      const len = node.nodeValue.length;
      const ls = node === range.startContainer ? range.startOffset : 0;
      const le = node === range.endContainer ? range.endOffset : len;
      if (le <= ls) continue;
      if (s < 0) s = start + ls;
      e = start + le;
    }
    if (s < 0 || e <= s) return null;
    while (s < e && /\s/.test(idx.text[s])) s++;
    while (e > s && /\s/.test(idx.text[e - 1])) e--;
    return e > s ? { s, e } : null;
  }

  function wrap(idx, s, e, h) {
    let count = 0;
    for (const { node, start } of idx.nodes) {
      const len = node.nodeValue.length;
      if (start >= e || start + len <= s) continue;
      const ls = Math.max(0, s - start);
      const le = Math.min(len, e - start);
      if (!node.nodeValue.slice(ls, le).trim()) continue; // never wrap bare whitespace between blocks
      let target = node;
      if (le < len) target.splitText(le);
      if (ls > 0) target = target.splitText(ls);
      const m = document.createElement('mark');
      m.className = 'cr-mark' + (h.note ? ' cr-has-note' : '');
      m.dataset.crId = h.id;
      m.dataset.crColor = h.color;
      target.parentNode.insertBefore(m, target);
      m.appendChild(target);
      count++;
    }
    return count;
  }

  function marksFor(id) {
    return document.querySelectorAll(`mark.cr-mark[data-cr-id="${CSS.escape(id)}"]`);
  }

  function unwrap(id) {
    marksFor(id).forEach((m) => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    });
  }

  function locate(h, idx) {
    const t = idx.text;
    const exact = t.indexOf(h.prefix + h.text + h.suffix);
    if (exact >= 0) return exact + h.prefix.length;
    let best = -1;
    let bestDist = Infinity;
    let j = t.indexOf(h.text);
    while (j >= 0) {
      const d = Math.abs(j - h.pos);
      if (d < bestDist) { best = j; bestDist = d; }
      j = t.indexOf(h.text, j + 1);
    }
    return best;
  }

  const isPlaced = (h) => marksFor(h.id).length > 0;

  function restorePending() {
    let placed = 0;
    for (const h of highlights) {
      if (isPlaced(h)) continue;
      const idx = buildIndex();
      const s = locate(h, idx);
      if (s >= 0 && wrap(idx, s, s + h.text.length, h)) placed++;
    }
    if (placed) renderPanel();
  }

  // Pages that load content late get a few more chances to re-anchor.
  function watchForLateContent() {
    let tries = 0;
    let timer = null;
    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (++tries > 15 || highlights.every(isPlaced)) return mo.disconnect();
        restorePending();
      }, 700);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 30000);
  }

  // ---------- actions ----------
  function isEditable(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && el.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
  }

  function create(color, withNote) {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (isEditable(range.commonAncestorContainer)) return;
    const idx = buildIndex();
    const off = rangeToOffsets(range, idx);
    if (!off) return;
    const h = {
      id: uid(),
      color,
      text: idx.text.slice(off.s, off.e),
      prefix: idx.text.slice(Math.max(0, off.s - CONTEXT), off.s),
      suffix: idx.text.slice(off.e, off.e + CONTEXT),
      pos: off.s,
      note: '',
      created: new Date().toISOString(),
    };
    if (!wrap(idx, off.s, off.e, h)) return;
    highlights.push(h);
    save();
    sel.removeAllRanges();
    hidePalette();
    renderPanel();
    updatePill();
    if (withNote) openPopover(h.id);
  }

  function setColor(id, color) {
    const h = highlights.find((x) => x.id === id);
    if (!h) return;
    h.color = color;
    marksFor(id).forEach((m) => (m.dataset.crColor = color));
    save();
    renderPanel();
    syncSwatches(color);
  }

  function setNote(id, note) {
    const h = highlights.find((x) => x.id === id);
    if (!h) return;
    h.note = note;
    marksFor(id).forEach((m) => m.classList.toggle('cr-has-note', !!note.trim()));
    save();
    renderPanel();
  }

  function remove(id) {
    unwrap(id);
    highlights = highlights.filter((x) => x.id !== id);
    save();
    renderPanel();
    updatePill();
  }

  function flash(id) {
    const ms = marksFor(id);
    if (!ms.length) return;
    ms[0].scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    ms.forEach((m) => m.classList.add('cr-flash'));
    setTimeout(() => ms.forEach((m) => m.classList.remove('cr-flash')), 1400);
  }

  function toMarkdown() {
    const lines = [`# ${document.title || location.href}`, '', location.href, '', `Exported ${new Date().toLocaleDateString()}`];
    for (const c of COLORS) {
      const items = highlights.filter((h) => h.color === c.key).sort((a, b) => a.pos - b.pos);
      if (!items.length) continue;
      lines.push('', `## ${c.heading}`, '');
      for (const h of items) {
        h.text.split(/\n+/).map((l) => l.trim()).filter(Boolean).forEach((l) => lines.push('> ' + l));
        if (h.note.trim()) lines.push('', 'Note: ' + h.note.trim());
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  // ---------- interface (shadow DOM keeps page styles out) ----------
  const host = document.createElement('div');
  host.id = 'close-reader-host';
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });

  const h = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') n.textContent = v;
      else if (k === 'style') n.setAttribute('style', v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    kids.forEach((k) => k && n.appendChild(k));
    return n;
  };

  shadow.appendChild(h('style', { text: `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .root {
      --bg: #F6F8FB; --surface: #FFFFFF; --ink: #1C2230; --muted: #5B6476; --rule: #DFE4EC; --accent: #2F4A7A; --on-accent: #FFFFFF;
      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      --serif: "Iowan Old Style", Charter, "Palatino Linotype", Georgia, serif;
      font: 13px/1.4 var(--sans); color: var(--ink);
    }
    @media (prefers-color-scheme: dark) {
      .root { --bg: #151922; --surface: #1D2230; --ink: #E7EAF0; --muted: #9AA3B5; --rule: #2C3343; --accent: #9DB6E8; --on-accent: #151922; }
    }
    button { all: unset; cursor: pointer; }
    button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .palette, .pop, .pill { position: fixed; background: var(--surface); border: 1px solid var(--rule); box-shadow: 0 8px 24px rgb(15 20 35 / .18); }
    .palette { display: flex; gap: 4px; padding: 4px; border-radius: 10px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px 5px 5px; border-radius: 7px;
      font: 500 12px/1 var(--sans); color: #1C2230; background: rgb(var(--c) / .5); }
    .chip:hover { background: rgb(var(--c) / .85); }
    .chip kbd { font: 600 11px/1 var(--sans); background: rgb(255 255 255 / .65); border-radius: 4px; padding: 3px 5px; }

    .pop { width: 300px; padding: 12px; border-radius: 12px; }
    .swatches { display: flex; align-items: center; gap: 8px; }
    .sw { width: 20px; height: 20px; border-radius: 50%; background: rgb(var(--c)); box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); }
    .sw[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px rgb(var(--c)); }
    .sw-label { margin-left: 4px; color: var(--muted); font-size: 12px; }
    textarea { display: block; width: 100%; min-height: 84px; margin-top: 10px; padding: 8px 10px; resize: vertical;
      font: 14px/1.45 var(--serif); color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 8px; }
    .row { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
    .btn { padding: 6px 10px; border-radius: 7px; font: 500 12px/1 var(--sans); }
    .btn.primary { background: var(--accent); color: var(--on-accent); }
    .btn:disabled { opacity: .5; cursor: default; }
    .btn.quiet { color: var(--muted); }
    .btn.quiet:hover { color: var(--ink); background: var(--bg); }
    .btn.danger:hover { color: #C0362C; background: var(--bg); }

    .pill { right: 16px; bottom: 16px; display: flex; align-items: center; gap: 8px; padding: 5px 5px 5px 12px; border-radius: 999px; font: 500 12px/1 var(--sans); }
    .root.panel-open .pill { right: calc(min(380px, 92vw) + 16px); }
    .dot { width: 10px; height: 10px; border-radius: 50%;
      background: conic-gradient(rgb(255 214 10) 0 20%, rgb(255 159 28) 0 40%, rgb(78 168 222) 0 60%, rgb(82 183 136) 0 80%, rgb(255 112 166) 0); }
    .pill .btn { background: var(--bg); }

    .panel { position: fixed; top: 0; right: 0; height: 100vh; width: min(380px, 92vw); display: flex; flex-direction: column;
      background: var(--bg); border-left: 1px solid var(--rule); box-shadow: -10px 0 30px rgb(15 20 35 / .12); }
    @media (prefers-reduced-motion: no-preference) { .panel { animation: in .18s ease-out; } }
    @keyframes in { from { transform: translateX(16px); opacity: 0; } }
    .panel header { display: flex; align-items: baseline; gap: 8px; padding: 16px 12px 8px 16px; }
    h2 { margin: 0; font: 600 15px/1.2 var(--sans); }
    .count { color: var(--muted); }
    .close { margin-left: auto; padding: 2px 8px; border-radius: 6px; font: 18px/1 var(--sans); color: var(--muted); }
    .close:hover { color: var(--ink); background: var(--surface); }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 10px; border-bottom: 1px solid var(--rule); }
    .import-status { padding: 0 16px; margin: 8px 0; color: var(--muted); overflow-wrap: anywhere; }
    .import-status:empty { display: none; }
    .import-status a { color: var(--accent); }
    .list { flex: 1; overflow-y: auto; padding: 4px 16px 16px; }
    h3 { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; font: 600 12px/1.2 var(--sans); }
    h3::before { content: ''; width: 10px; height: 10px; border-radius: 3px; background: rgb(var(--c)); }
    h3 span { color: var(--muted); font-weight: 400; }
    .item { display: block; width: 100%; margin-bottom: 6px; padding: 8px 10px 8px 12px; border-left: 3px solid rgb(var(--c));
      border-radius: 0 6px 6px 0; background: var(--surface); }
    .item:hover { background: rgb(var(--c) / .14); }
    .quote { font: 14px/1.5 var(--serif); color: var(--ink); }
    .note { margin-top: 6px; font: 12.5px/1.45 var(--sans); color: var(--muted); white-space: pre-wrap; }
    .missing { margin-top: 4px; font: italic 11px/1.3 var(--sans); color: var(--muted); }
    .empty { padding: 24px 0; font: 14px/1.5 var(--serif); color: var(--muted); max-width: 32ch; }
    .keys { display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 10px 16px 14px; border-top: 1px solid var(--rule); font-size: 11.5px; color: var(--muted); }
    .k { display: inline-flex; align-items: center; gap: 5px; }
    .k i { width: 8px; height: 8px; border-radius: 2px; background: rgb(var(--c)); }
  ` }));

  const root = h('div', { class: 'root' });
  shadow.appendChild(root);

  // Palette shown over a fresh selection.
  const palette = h('div', { class: 'palette', role: 'toolbar', 'aria-label': 'Highlight colour', hidden: '' },
    COLORS.map((c, i) => h('button', {
      class: 'chip', style: `--c:${c.rgb}`, title: c.desc,
      onclick: (e) => create(c.key, e.shiftKey),
    }, [h('kbd', { text: String(i + 1) }), document.createTextNode(c.label)])));
  palette.addEventListener('mousedown', (e) => e.preventDefault()); // keep the page selection alive
  root.appendChild(palette);

  // Popover for one highlight.
  const swLabel = h('span', { class: 'sw-label' });
  const swatches = h('div', { class: 'swatches' }, [
    ...COLORS.map((c) => h('button', {
      class: 'sw', style: `--c:${c.rgb}`, 'data-color': c.key, 'aria-label': c.desc, title: c.desc,
      onclick: () => activeId && setColor(activeId, c.key),
    })),
    swLabel,
  ]);
  let noteTimer = null;
  const noteBox = h('textarea', {
    placeholder: 'Add a note',
    'aria-label': 'Note',
    oninput: () => {
      clearTimeout(noteTimer);
      const id = activeId;
      const v = noteBox.value;
      noteTimer = setTimeout(() => setNote(id, v), 300);
    },
  });
  const pop = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'Highlight', hidden: '' }, [
    swatches,
    noteBox,
    h('div', { class: 'row' }, [
      h('button', { class: 'btn quiet danger', text: 'Delete highlight', onclick: () => { const id = activeId; closePopover(); remove(id); } }),
      h('button', { class: 'btn primary', text: 'Done', onclick: () => closePopover() }),
    ]),
  ]);
  root.appendChild(pop);

  // Pill shown while highlighting is on.
  const pillCount = h('span', { text: '0' });
  const pill = h('div', { class: 'pill', hidden: '' }, [
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    document.createTextNode('Highlighting on'),
    h('button', { class: 'btn', onclick: () => togglePanel() }, [document.createTextNode('Notes '), pillCount]),
  ]);
  root.appendChild(pill);

  // Notes panel.
  const panelCount = h('span', { class: 'count' });
  const list = h('div', { class: 'list' });
  const copyBtn = h('button', {
    class: 'btn quiet', text: 'Copy as Markdown',
    onclick: async () => {
      closePopover();
      const md = toMarkdown();
      try {
        await navigator.clipboard.writeText(md);
      } catch (e) {
        const ta = h('textarea', { style: 'position:fixed;opacity:0' });
        ta.value = md;
        root.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      copyBtn.textContent = 'Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy as Markdown'), 1500);
    },
  });
  const importStatus = h('p', { class: 'import-status', role: 'status', 'aria-live': 'polite' });
  let importing = false;
  const notionBtn = h('button', {
    class: 'btn primary', text: 'Import to Notion',
    onclick: async () => {
      if (importing || !highlights.length) return;
      closePopover(); // Flush a note that is still waiting for its save timer.
      importing = true;
      notionBtn.disabled = true;
      notionBtn.textContent = 'Importing…';
      importStatus.textContent = 'Sending this page’s highlights and notes to Notion…';
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'notion-import',
          page: { title: document.title, url: location.href, items: highlights.map(({ text, note, color, pos }) => ({ text, note, color, pos })) },
        });
        if (!result) throw new Error('No response from the extension. Reload this page and try again.');
        if (result.setup) {
          await chrome.runtime.sendMessage({ type: 'notion-settings' });
          importStatus.textContent = 'Connect Notion in the settings tab, then return here and import.';
        } else {
          importStatus.textContent = result.error || 'Imported. ';
          if (result.url) {
            const url = new URL(result.url);
            if (url.protocol === 'https:' && (url.hostname === 'notion.so' || url.hostname.endsWith('.notion.so'))) {
              importStatus.appendChild(h('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer', text: 'Open in Notion' }));
            }
          }
        }
      } catch (error) {
        importStatus.textContent = `${error.message} Check Notion before retrying; the import may have completed.`;
      } finally {
        importing = false;
        notionBtn.textContent = 'Import to Notion';
        notionBtn.disabled = !highlights.length;
      }
    },
  });
  const panel = h('aside', { class: 'panel', 'aria-label': 'Notes on this page', hidden: '' }, [
    h('header', {}, [
      h('h2', { text: 'Notes on this page' }),
      panelCount,
      h('button', { class: 'close', 'aria-label': 'Close notes', text: '×', onclick: () => togglePanel(false) }),
    ]),
    h('div', { class: 'actions' }, [
      notionBtn,
      copyBtn,
      h('button', {
        class: 'btn quiet', text: 'Notion settings',
        onclick: async () => {
          try {
            await chrome.runtime.sendMessage({ type: 'notion-settings' });
          } catch {
            importStatus.textContent = 'Reload this page to reconnect to the extension.';
          }
        },
      }),
    ]),
    importStatus,
    list,
    h('footer', { class: 'keys' }, [
      ...COLORS.map((c, i) => h('span', { class: 'k', style: `--c:${c.rgb}` }, [h('i'), document.createTextNode(`${i + 1} ${c.label}`)])),
      h('span', { text: 'Shift + number adds a note' }),
    ]),
  ]);
  root.appendChild(panel);

  document.documentElement.appendChild(host);

  // ---------- interface behaviour ----------
  function place(elm, rect) {
    elm.hidden = false;
    const w = elm.offsetWidth;
    const ht = elm.offsetHeight;
    let top = rect.top - ht - 8;
    if (top < 8) top = rect.bottom + 8;
    top = Math.min(top, innerHeight - ht - 8);
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8));
    elm.style.top = `${Math.max(8, top)}px`;
    elm.style.left = `${left}px`;
  }

  function showPalette(range) {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    place(palette, rect);
  }

  function hidePalette() { palette.hidden = true; }

  function syncSwatches(color) {
    swatches.querySelectorAll('.sw').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === color)));
    swLabel.textContent = BY_KEY[color].label;
  }

  function openPopover(id) {
    const hl = highlights.find((x) => x.id === id);
    const first = marksFor(id)[0];
    if (!hl || !first) return;
    activeId = id;
    noteBox.value = hl.note;
    syncSwatches(hl.color);
    hidePalette();
    place(pop, first.getBoundingClientRect());
    noteBox.focus({ preventScroll: true });
  }

  function closePopover() {
    if (activeId && noteTimer) {
      clearTimeout(noteTimer);
      setNote(activeId, noteBox.value);
    }
    noteTimer = null;
    activeId = null;
    pop.hidden = true;
  }

  function updatePill() {
    pill.hidden = !enabled;
    pillCount.textContent = String(highlights.length);
  }

  function togglePanel(force) {
    panelOpen = typeof force === 'boolean' ? force : !panelOpen;
    panel.hidden = !panelOpen;
    root.classList.toggle('panel-open', panelOpen);
    renderPanel();
  }

  function renderPanel() {
    panelCount.textContent = String(highlights.length);
    notionBtn.disabled = importing || !highlights.length;
    copyBtn.disabled = !highlights.length;
    if (!panelOpen) return;
    list.replaceChildren();
    if (!highlights.length) {
      list.appendChild(h('p', { class: 'empty', text: 'Nothing highlighted yet. Turn highlighting on, select text, then press 1 to 5.' }));
      return;
    }
    for (const c of COLORS) {
      const items = highlights.filter((x) => x.color === c.key).sort((a, b) => a.pos - b.pos);
      if (!items.length) continue;
      const section = h('section', { style: `--c:${c.rgb}` }, [
        h('h3', {}, [document.createTextNode(c.heading + ' '), h('span', { text: String(items.length) })]),
      ]);
      for (const x of items) {
        const quote = x.text.length > 320 ? x.text.slice(0, 320).trimEnd() + '…' : x.text;
        section.appendChild(h('button', {
          class: 'item', title: 'Show on page',
          onclick: () => flash(x.id),
        }, [
          h('div', { class: 'quote', text: quote }),
          x.note.trim() ? h('div', { class: 'note', text: x.note.trim() }) : null,
          isPlaced(x) ? null : h('div', { class: 'missing', text: 'Not found on the page right now' }),
        ]));
      }
      list.appendChild(section);
    }
  }

  function setEnabled(v) {
    enabled = v;
    document.documentElement.classList.toggle('cr-on', v);
    hidePalette();
    if (!v) closePopover();
    updatePill();
  }

  // ---------- page events ----------
  const fromUI = (e) => e.composedPath().includes(host);

  document.addEventListener('mouseup', (e) => {
    if (!enabled || fromUI(e)) return;
    setTimeout(() => {
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed || !sel.toString().trim()) return hidePalette();
      const r = sel.getRangeAt(0);
      if (isEditable(r.commonAncestorContainer)) return hidePalette();
      showPalette(r);
    }, 0);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!pop.hidden && !fromUI(e)) closePopover();
  }, true);

  document.addEventListener('click', (e) => {
    if (!enabled || fromUI(e)) return;
    const m = e.target.closest && e.target.closest('mark.cr-mark');
    if (!m) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    e.preventDefault();
    e.stopPropagation();
    openPopover(m.dataset.crId);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hidePalette(); if (!pop.hidden) closePopover(); return; }
    if (!enabled || fromUI(e) || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    const m = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    if (!m) return;
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    e.preventDefault();
    e.stopPropagation();
    create(COLORS[Number(m[1]) - 1].key, e.shiftKey);
  }, true);

  addEventListener('scroll', hidePalette, { passive: true, capture: true });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'toggle') setEnabled(!enabled);
    else if (msg.type === 'panel') togglePanel();
    reply({ enabled });
  });

  // ---------- start ----------
  (async () => {
    await load();
    restorePending();
    if (highlights.length && !highlights.every(isPlaced)) watchForLateContent();
    updatePill();
    renderPanel();
  })();
})();
