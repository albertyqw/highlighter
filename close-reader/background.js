// Routes the toolbar button and keyboard shortcuts to the page.
importScripts('article.js', 'pdf-source.js', 'notion.js');

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
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const source = info.menuItemId === 'pdf-link' ? info.linkUrl : info.menuItemId === 'pdf-tab' ? tab?.url : null;
  if (source || info.menuItemId === 'pdf-tab') openPdf(tab, source).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => send(tab, 'toggle'));

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  send(tab, command === 'toggle-panel' ? 'panel' : 'toggle');
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
      reply(await CloseReaderNotion.importNotes(notionConnection, message.page));
    } catch (error) {
      reply({ error: error.message });
    } finally {
      importing.delete(key);
    }
  })();
  return true;
});
