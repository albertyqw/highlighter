const form = document.getElementById('connection');
const tokenInput = document.getElementById('token');
const pageInput = document.getElementById('page');
const status = document.getElementById('status');
const saveButton = document.getElementById('save');
const disconnectButton = document.getElementById('disconnect');

async function loadConnection() {
  const { notionConnection } = await chrome.storage.local.get('notionConnection');
  pageInput.value = notionConnection?.databaseId || '';
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
    const databaseId = pageInput.value.trim() ? CloseReaderNotion.pageId(pageInput.value) : undefined;
    const context = await CloseReaderNotion.resolveReads({ token, databaseId });
    await chrome.storage.local.set({ notionConnection: { token, ...(databaseId ? { databaseId } : {}), dataSourceId: context.dataSourceId } });
    await loadConnection();
    status.textContent = 'Connected to Reads. Return to the notes panel, review the article details, and choose topics and projects.';
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
