// Routes the toolbar button and keyboard shortcuts to the page.
importScripts('article.js', 'notion.js');

chrome.action.setBadgeBackgroundColor({ color: '#2F4A7A' });

async function send(tab, type) {
  if (!tab || tab.id === undefined) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type });
    if (res && typeof res.enabled === 'boolean') {
      chrome.action.setBadgeText({ tabId: tab.id, text: res.enabled ? 'ON' : '' });
    }
  } catch (e) {
    // The page can't run extensions (chrome:// pages, the PDF viewer, the Web Store),
    // or it was open before the extension was installed. Reloading the page fixes the latter.
  }
}

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
  if (!['notion-import', 'notion-context'].includes(message.type) || !sender.tab) return;
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
  const key = sender.tab.id;
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
