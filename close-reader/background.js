// Routes the toolbar button and keyboard shortcuts to the page.
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
