const form = document.getElementById('connection');
const tokenInput = document.getElementById('token');
const pageInput = document.getElementById('page');
const status = document.getElementById('status');
const saveButton = document.getElementById('save');
const disconnectButton = document.getElementById('disconnect');

async function loadConnection() {
  const { notionConnection } = await chrome.storage.local.get('notionConnection');
  pageInput.value = notionConnection?.pageId || '';
  tokenInput.value = '';
  tokenInput.placeholder = notionConnection?.token ? 'Token saved — leave blank to keep it' : 'Paste your Notion connection token';
  status.textContent = notionConnection?.token ? 'Connection saved. You can import notes from the notes panel.' : '';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  saveButton.disabled = disconnectButton.disabled = true;
  status.textContent = 'Checking the destination in Notion…';
  try {
    const { notionConnection } = await chrome.storage.local.get('notionConnection');
    const token = tokenInput.value.trim() || notionConnection?.token;
    if (!token) throw new Error('Enter your Notion connection token.');
    const pageId = CloseReaderNotion.pageId(pageInput.value);
    const page = await CloseReaderNotion.request(token, `pages/${pageId}`, 'GET');
    if (page.archived || page.in_trash) throw new Error('Restore the destination page in Notion or choose another page.');
    await chrome.storage.local.set({ notionConnection: { token, pageId } });
    await loadConnection();
    status.textContent = 'Connected. Return to the notes panel and click Import to Notion.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    saveButton.disabled = disconnectButton.disabled = false;
  }
});

disconnectButton.addEventListener('click', async () => {
  await chrome.storage.local.remove('notionConnection');
  await loadConnection();
  status.textContent = 'Disconnected. Your highlights and notes are still saved.';
});

loadConnection().catch(() => { status.textContent = 'Could not load settings. Reopen this page to try again.'; });
