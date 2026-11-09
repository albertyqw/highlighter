// Routes the toolbar button and keyboard shortcuts to the page.
importScripts('article.js', 'pdf-source.js', 'captures.js', 'notion.js');

chrome.action.setBadgeBackgroundColor({ color: '#2F4A7A' });

async function send(tab, type) {
  if (!tab || tab.id === undefined) return;
  if (tab.url?.startsWith(chrome.runtime.getURL('pdf.html'))) {
    await chrome.runtime.sendMessage({ type: 'pdf-command', tabId: tab.id, command: type }).catch(() => {});
    return;
  }
  const pdfSource = CloseReaderPdf.sourceFromTab(tab);
  if (pdfSource) return openPdf(tab, pdfSource, type);
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type });
    if (res && typeof res.enabled === 'boolean') {
      chrome.action.setBadgeText({ tabId: tab.id, text: res.enabled ? 'ON' : '' });
    }
  } catch (e) {
    // The page can't run extensions (chrome:// pages or the Web Store),
    // or it was open before the extension was installed. Reloading the page fixes the latter.
  }
}

async function openPdf(tab, source, mode = 'toggle') {
  const query = new URLSearchParams({ mode });
  if (source) query.set('source', CloseReaderPdf.source(source));
  await chrome.tabs.create({ url: chrome.runtime.getURL('pdf.html') + '?' + query, ...(tab?.id !== undefined ? { openerTabId: tab.id } : {}) });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'pdf-link', title: 'Open PDF in Close Reader', contexts: ['link'], targetUrlPatterns: ['http://*/*', 'https://*/*', 'file://*/*'] });
    chrome.contextMenus.create({ id: 'pdf-tab', title: 'Open this tab as a PDF', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'screenshot', title: 'Capture a screenshot for notes', contexts: ['action'] });
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'screenshot') { send(tab, 'screenshot'); return; }
  const source = info.menuItemId === 'pdf-link' ? info.linkUrl : info.menuItemId === 'pdf-tab' ? tab?.url : null;
  if (source || info.menuItemId === 'pdf-tab') openPdf(tab, source).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => send(tab, 'toggle'));

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  send(tab, command === 'capture-screenshot' ? 'screenshot' : command === 'toggle-panel' ? 'panel' : 'toggle');
});

// Requests run in the worker so the Notion token never enters the page UI.
const importing = new Set();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'notion-settings') {
    chrome.runtime.openOptionsPage().then(() => reply({ ok: true }), () => reply({ error: 'Could not open Notion settings.' }));
    return true;
  }
  const fromPdfReader = sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('pdf.html');
  if (message.type?.startsWith('screenshots-') && (sender.tab || fromPdfReader)) {
    (async () => {
      try {
        const { pageKey } = message;
        if (typeof pageKey !== 'string' || !pageKey.startsWith('cr:') || pageKey.length > 16000) throw new Error('Invalid screenshot source.');
        if (!fromPdfReader) {
          const url = new URL(sender.url || sender.tab.url);
          if (pageKey !== 'cr:' + url.origin + url.pathname + url.search) throw new Error('Screenshot source does not match this page.');
        }
        if (message.type === 'screenshots-list') return reply({ screenshots: await CloseReaderCaptures.list(pageKey) });
        if (message.type === 'screenshots-update') {
          await CloseReaderCaptures.update(pageKey, message.id, message.caption); return reply({ ok: true });
        }
        if (message.type === 'screenshots-remove') {
          await CloseReaderCaptures.remove(pageKey, message.id); return reply({ ok: true });
        }
        if (message.type === 'screenshots-read') {
          const capture = await CloseReaderCaptures.get(pageKey, message.id);
          return reply({ dataUrl: await CloseReaderCaptures.dataUrl(capture.blob) });
        }
        if (message.type === 'screenshots-capture') {
          let tab = sender.tab;
          if (!tab && fromPdfReader && Number.isInteger(message.tabId)) {
            tab = await chrome.tabs.get(message.tabId);
            if (tab.url !== sender.url) throw new Error('Return to the source PDF tab and try again.');
          }
          if (!tab) throw new Error('Could not identify the source tab. Use Alt/Option + Shift + S.');
          if ((await CloseReaderCaptures.list(pageKey)).length >= 30) throw new Error('This page already has 30 screenshots. Remove one before capturing more.');
          const id = await CloseReaderCaptures.captureTab(chrome, tab, message);
          return reply({ id });
        }
        reply({ error: 'Unknown screenshot request.' });
      } catch (error) { reply({ error: error.message }); }
    })();
    return true;
  }
  if (!['notion-import', 'notion-context'].includes(message.type) || (!sender.tab && !fromPdfReader)) return;
  if (message.type === 'notion-context') {
    (async () => {
      try {
        const { notionConnection } = await chrome.storage.local.get('notionConnection');
        if (!notionConnection?.token) return reply({ setup: true });
        const context = await CloseReaderNotion.resolveReads(notionConnection);
        reply({ context });
      } catch (error) { reply({ error: error.message }); }
    })();
    return true;
  }
  const key = sender.tab?.id ?? sender.documentId ?? sender.url;
  if (importing.has(key)) {
    reply({ error: 'An import is already running for this tab.' });
    return;
  }
  importing.add(key);
  (async () => {
    try {
      const { notionConnection } = await chrome.storage.local.get('notionConnection');
      if (!notionConnection?.token) {
        reply({ setup: true });
        return;
      }
      let page = message.page;
      if (page?.screenshots?.length) {
        if (page.screenshots.length > 30) throw new Error('Import at most 30 screenshots at a time.');
        if (!fromPdfReader) {
          const url = new URL(sender.url || sender.tab.url);
          if (page.captureKey !== 'cr:' + url.origin + url.pathname + url.search) throw new Error('Screenshot source does not match this page.');
        }
        const captures = [];
        for (const screenshot of page.screenshots) captures.push(await CloseReaderCaptures.get(page.captureKey, screenshot.id));
        page = { ...page, screenshots: captures };
      }
      reply(await CloseReaderNotion.importNotes(notionConnection, page));
    } catch (error) {
      reply({ error: error.message });
    } finally {
      importing.delete(key);
    }
  })();
  return true;
});
