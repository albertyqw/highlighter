import { getDocument, GlobalWorkerOptions, TextLayer, PasswordResponses } from './vendor/pdfjs/pdf.mjs';

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs');
const $ = id => document.getElementById(id);
const pages = $('pdf-pages');
const status = $('pdf-status');
const sourceInput = $('pdf-url');
const zoom = $('zoom');
const pageNumber = $('page-number');
const passwordDialog = $('password-dialog');
const params = new URLSearchParams(location.search);
let loadingTask, pdf, records = [], contentReady = false, busy = false;
let renderQueue = Promise.resolve(), resizeTimer, passwordCallback;
let ownTabId;
chrome.tabs.getCurrent().then(tab => { ownTabId = tab?.id; });

function command(type) { document.dispatchEvent(new CustomEvent('cr-pdf-command', { detail: { type } })); }
$('toggle-highlight').addEventListener('click', () => command('toggle'));
$('toggle-notes').addEventListener('click', () => command('panel'));
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'pdf-command' && message.tabId === ownTabId) command(message.command);
});
document.addEventListener('cr-pdf-state', ({ detail }) => {
  $('toggle-highlight').textContent = detail.enabled ? 'Highlighting on' : 'Highlighting off';
  $('toggle-highlight').setAttribute('aria-pressed', String(detail.enabled));
  if (ownTabId !== undefined) chrome.action.setBadgeText({ tabId: ownTabId, text: detail.enabled ? 'ON' : '' });
});

$('password-form').addEventListener('submit', event => {
  event.preventDefault();
  const password = $('pdf-password').value;
  $('pdf-password').value = '';
  passwordDialog.close();
  passwordCallback?.(password);
  passwordCallback = null;
});
function cancelPassword() {
  passwordCallback = null;
  $('pdf-password').value = '';
  if (passwordDialog.open) passwordDialog.close();
  loadingTask?.destroy();
}
$('cancel-password').addEventListener('click', cancelPassword);
passwordDialog.addEventListener('cancel', event => { event.preventDefault(); cancelPassword(); });

function availableWidth() { return Math.max(180, pages.clientWidth - (innerWidth < 760 ? 16 : 32)); }
function scaleFor(page) {
  return zoom.value === 'fit' ? Math.min(1.7, availableWidth() / page.getViewport({ scale: 1 }).width) : Number(zoom.value);
}
function eventRendered() { document.dispatchEvent(new Event('cr-pdf-page-rendered')); }

async function draw(record) {
  const page = record.page ||= await pdf.getPage(record.number);
  const scale = scaleFor(page);
  if (record.scale === scale && record.canvas?.width) return;
  document.dispatchEvent(new Event('cr-pdf-before-render'));
  const viewport = page.getViewport({ scale });
  record.surface.style.width = `${viewport.width}px`;
  record.surface.style.height = `${viewport.height}px`;
  record.surface.style.setProperty('--total-scale-factor', viewport.scale * page.userUnit);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const outputScale = Math.min(devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const sameScale = record.scale === scale;
  if (record.canvas) { record.canvas.width = record.canvas.height = 0; record.canvas.remove(); }
  record.canvas = canvas;
  record.surface.prepend(canvas);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [outputScale, 0, 0, outputScale, 0, 0] }).promise;
  if (!sameScale || !record.layer) {
    record.layer?.remove();
    record.surface.querySelector('.scan-note')?.remove();
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    record.surface.append(layer);
    const textContent = await page.getTextContent();
    await new TextLayer({ textContentSource: textContent, container: layer, viewport }).render();
    // Keep explicit line endings in copied/exported quotations as well as on screen.
    layer.querySelectorAll('br').forEach(br => br.after(document.createTextNode('\n')));
    record.layer = layer;
    if (!textContent.items.some(item => item.str?.trim())) {
      const note = document.createElement('p');
      note.className = 'scan-note'; note.dataset.crUi = '';
      note.textContent = 'No selectable text on this page. Scanned PDFs need OCR before highlighting.';
      record.surface.append(note);
    }
  }
  record.scale = scale;
  eventRendered();
}

function render(record) {
  if (record.pending) return record.pending;
  const work = renderQueue.catch(() => {}).then(() => draw(record));
  record.pending = work;
  renderQueue = work;
  work.then(() => {
    record.pending = null;
    if (record.visible && record.page && record.scale !== scaleFor(record.page)) render(record);
  }, () => {
    record.pending = null;
    status.textContent = `Page ${record.number} could not be rendered. Reload the PDF to try again.`;
  });
  return work;
}

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const record = records[Number(entry.target.dataset.pdfPage) - 1];
    if (!record) continue;
    record.visible = entry.isIntersecting;
    if (record.visible) render(record);
    else if (!record.pending && record.canvas) {
      // Keep the selectable text and marks, release the much larger bitmap.
      record.canvas.width = record.canvas.height = 0;
    }
  }
}, { rootMargin: '900px 0px' });

new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (zoom.value !== 'fit') return;
    for (const record of records) {
      if (record.visible) render(record);
      else if (record.page) {
        const viewport = record.page.getViewport({ scale: scaleFor(record.page) });
        record.surface.style.width = `${viewport.width}px`;
        record.surface.style.height = `${viewport.height}px`;
      }
    }
  }, 120);
}).observe(pages);
zoom.addEventListener('change', () => { for (const record of records) if (record.visible) render(record); });
async function showPage(number, id) {
  const record = records[Math.max(0, Math.min(records.length - 1, number - 1))];
  if (!record) return;
  record.element.scrollIntoView({ block: 'start' });
  await render(record);
  pageNumber.value = String(record.number);
  if (id) document.dispatchEvent(new CustomEvent('cr-pdf-jump-ready', { detail: { id } }));
}
pageNumber.addEventListener('change', () => showPage(Number(pageNumber.value)));
pageNumber.addEventListener('keydown', event => { if (event.key === 'Enter') showPage(Number(pageNumber.value)); });
$('go-page').addEventListener('click', () => showPage(Number(pageNumber.value)));
let pageUpdateQueued = false;
addEventListener('scroll', () => {
  if (pageUpdateQueued || document.activeElement === pageNumber) return;
  pageUpdateQueued = true;
  requestAnimationFrame(() => {
    pageUpdateQueued = false;
    const threshold = document.querySelector('.pdf-toolbar').offsetHeight + 80;
    const current = records.find(record => record.element.getBoundingClientRect().bottom > threshold);
    if (current && document.activeElement !== pageNumber) pageNumber.value = String(current.number);
  });
}, { passive: true });
document.addEventListener('cr-pdf-show-page', ({ detail }) => showPage(detail.page, detail.id));

async function addHighlightInterface() {
  if (contentReady) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content.js');
    script.onload = resolve; script.onerror = reject;
    document.head.append(script);
  });
  contentReady = true;
  $('toggle-highlight').disabled = $('toggle-notes').disabled = false;
}

async function openBytes(bytes, remoteSource, filename) {
  if (busy) return;
  busy = true;
  $('load-url').disabled = $('pdf-file').disabled = true;
  status.textContent = 'Opening PDF…';
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    loadingTask = getDocument({
      data: new Uint8Array(bytes),
      cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'), cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
      wasmUrl: chrome.runtime.getURL('vendor/pdfjs/wasm/'),
      iccUrl: chrome.runtime.getURL('vendor/pdfjs/iccs/'),
      isEvalSupported: false, enableXfa: false,
    });
    loadingTask.onPassword = (updatePassword, reason) => {
      passwordCallback = updatePassword;
      $('password-hint').textContent = reason === PasswordResponses.INCORRECT_PASSWORD ? 'That password did not unlock the PDF. Try again.' : 'The password is used only to open this document and is not saved.';
      passwordDialog.showModal(); $('pdf-password').focus();
    };
    pdf = await loadingTask.promise;
    const metadata = await pdf.getMetadata().catch(() => ({}));
    const extracted = CloseReaderPdf.metadata(metadata.info, metadata.metadata);
    document.title = extracted.title || filename || 'PDF document';
    Object.assign(document.documentElement.dataset, {
      crPdf: 'true', crSourceUrl: remoteSource || '', crSourceName: filename || 'PDF document',
      crPublicationDate: extracted.publishedDate,
      crStorageKey: remoteSource ? 'cr:pdf:' + remoteSource : 'cr:pdf:file:' + fingerprint,
    });
    if (remoteSource) { $('original').href = remoteSource; $('original').hidden = false; }
    const firstPage = await pdf.getPage(1);
    const initial = firstPage.getViewport({ scale: scaleFor(firstPage) });
    for (let number = 1; number <= pdf.numPages; number++) {
      const element = document.createElement('section');
      element.className = 'pdf-page'; element.dataset.pdfPage = String(number);
      element.setAttribute('aria-label', `PDF page ${number}`);
      const surface = document.createElement('div'); surface.className = 'pdf-page-surface';
      surface.style.width = `${initial.width}px`; surface.style.height = `${initial.height}px`;
      const label = document.createElement('div'); label.className = 'pdf-page-label'; label.dataset.crUi = '';
      label.textContent = `Page ${number} of ${pdf.numPages}`;
      element.append(surface, label); pages.append(element);
      records.push({ number, element, surface, page: number === 1 ? firstPage : null, visible: number === 1 });
    }
    $('page-count').textContent = `of ${pdf.numPages}`;
    pageNumber.max = String(pdf.numPages);
    zoom.disabled = pageNumber.disabled = $('go-page').disabled = false;
    $('open-pdf').hidden = true;
    await render(records[0]);
    await addHighlightInterface();
    records.forEach(record => observer.observe(record.element));
    status.textContent = 'Select PDF text and press 1–5 to highlight. Shift + number adds a note.';
  } catch (error) {
    $('open-pdf').hidden = false;
    status.textContent = error.name === 'InvalidPDFException' ? 'This link or file did not contain a readable PDF. Choose the PDF file or try its direct download link.' : 'Could not open this PDF. It may need a password, a signed-in download, or a local file. Try choosing the downloaded PDF below.';
    observer.disconnect(); records = []; pages.replaceChildren();
  } finally {
    busy = false;
    $('load-url').disabled = $('pdf-file').disabled = false;
  }
}

async function openRemote(value, requestPermission) {
  let url;
  try { url = new URL(CloseReaderPdf.source(value)); }
  catch (error) { status.textContent = error.message; return; }
  if (url.protocol === 'file:') {
    status.textContent = `Choose ${CloseReaderPdf.nameFromUrl(url.href)} using the local file picker below.`;
    return;
  }
  const permission = { origins: [url.origin + '/*'] };
  try {
    // Request on the form's click gesture, before any asynchronous work.
    const allowed = requestPermission ? await chrome.permissions.request(permission) : await chrome.permissions.contains(permission);
    if (!allowed) { status.textContent = 'Click Open PDF link to allow access to this PDF’s site, or choose a downloaded file.'; return; }
    status.textContent = 'Downloading PDF from its source…';
    $('load-url').disabled = true;
    const response = await fetch(url.href, { credentials: 'include', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Download failed');
    await openBytes(await response.arrayBuffer(), url.href, CloseReaderPdf.nameFromUrl(url.href));
  } catch {
    status.textContent = 'Could not download the PDF. Sign in to the source site and try again, or download it and choose the local file.';
  } finally { $('load-url').disabled = false; }
}
$('url-form').addEventListener('submit', event => { event.preventDefault(); openRemote(sourceInput.value, true); });
$('pdf-file').addEventListener('change', async () => {
  const file = $('pdf-file').files[0];
  if (file) await openBytes(await file.arrayBuffer(), null, file.name);
});
if (params.get('source')) {
  const source = params.get('source');
  if (!source.startsWith('file:')) sourceInput.value = source;
  openRemote(source, false);
}
