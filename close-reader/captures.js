const CloseReaderCaptures = (() => {
  let database;
  const inFlight = new Set();
  const lastCapture = new Map();
  function db() {
    return database ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('close-reader-captures', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('captures', { keyPath: 'id' }).createIndex('pageKey', 'pageKey');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = null; reject(new Error('Could not open screenshot storage.')); };
    });
  }
  async function transaction(mode, action) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const tx = connection.transaction('captures', mode);
      const request = action(tx.objectStore('captures'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('Could not save screenshot. Browser storage may be full.'));
    });
  }
  const put = record => transaction('readwrite', store => store.put(record));
  async function get(pageKey, id) {
    const record = await transaction('readonly', store => store.get(id));
    if (!record || record.pageKey !== pageKey) throw new Error('Screenshot not found on this page.');
    return record;
  }
  async function dataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:${blob.type};base64,${btoa(binary)}`;
  }
  async function list(pageKey) {
    const records = await transaction('readonly', store => store.index('pageKey').getAll(pageKey));
    return Promise.all(records.sort((a, b) => a.created.localeCompare(b.created)).map(async record => ({
      id: record.id, caption: record.caption, created: record.created, pdfPage: record.pdfPage,
      thumbnail: await dataUrl(record.thumbnail),
    })));
  }
  async function update(pageKey, id, caption) {
    const record = await get(pageKey, id);
    record.caption = String(caption || '').slice(0, 2000);
    await put(record);
  }
  async function remove(pageKey, id) {
    await get(pageKey, id);
    await transaction('readwrite', store => store.delete(id));
  }
  function cropPlan(rect, viewport, image) {
    const values = [viewport?.width, viewport?.height, image?.width, image?.height];
    if (values.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Invalid screenshot dimensions.');
    const area = rect || { x: 0, y: 0, width: viewport.width, height: viewport.height };
    if ([area.x, area.y, area.width, area.height].some(value => !Number.isFinite(value)) || area.width < 8 || area.height < 8) throw new Error('Select an area at least 8 pixels wide and high.');
    const left = Math.max(0, Math.min(viewport.width, area.x));
    const top = Math.max(0, Math.min(viewport.height, area.y));
    const right = Math.min(viewport.width, area.x + area.width);
    const bottom = Math.min(viewport.height, area.y + area.height);
    if (right <= left || bottom <= top) throw new Error('The selection is outside the visible page.');
    const x = Math.floor(left * image.width / viewport.width), y = Math.floor(top * image.height / viewport.height);
    const width = Math.min(image.width - x, Math.ceil((right - left) * image.width / viewport.width));
    const height = Math.min(image.height - y, Math.ceil((bottom - top) * image.height / viewport.height));
    const scale = Math.min(1, 2400 / width, 2400 / height, Math.sqrt(4000000 / (width * height)));
    return { x, y, width, height, outputWidth: Math.max(1, Math.round(width * scale)), outputHeight: Math.max(1, Math.round(height * scale)) };
  }
  async function processPng(url, options) {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    try {
      const plan = cropPlan(options.rect, options.viewport, bitmap);
      let canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight);
      canvas.getContext('2d').drawImage(bitmap, plan.x, plan.y, plan.width, plan.height, 0, 0, plan.outputWidth, plan.outputHeight);
      let blob = await canvas.convertToBlob({ type: 'image/png' });
      while (blob.size > 4 * 1024 * 1024) {
        const factor = Math.sqrt(4 * 1024 * 1024 / blob.size) * .9;
        const smaller = new OffscreenCanvas(Math.max(1, Math.floor(canvas.width * factor)), Math.max(1, Math.floor(canvas.height * factor)));
        smaller.getContext('2d').drawImage(canvas, 0, 0, smaller.width, smaller.height);
        canvas = smaller; blob = await canvas.convertToBlob({ type: 'image/png' });
      }
      const scale = Math.min(1, 320 / canvas.width, 240 / canvas.height);
      const thumbnail = new OffscreenCanvas(Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)));
      thumbnail.getContext('2d').drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
      return { blob, thumbnail: await thumbnail.convertToBlob({ type: 'image/jpeg', quality: .8 }) };
    } finally { bitmap.close(); }
  }
  async function captureTab(chromeApi, tab, options, processor = processPng, save = put) {
    if (inFlight.has(tab.windowId) || Date.now() - (lastCapture.get(tab.windowId) || 0) < 600) throw new Error('Wait a moment before taking another screenshot.');
    inFlight.add(tab.windowId);
    const check = async () => {
      const [active] = await chromeApi.tabs.query({ active: true, windowId: tab.windowId });
      if (active?.id !== tab.id) throw new Error('Return to the source tab before taking a screenshot.');
    };
    try {
      await check();
      lastCapture.set(tab.windowId, Date.now());
      let image;
      try { image = await chromeApi.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
      catch { throw new Error('Press Alt/Option + Shift + S to grant capture access and select an area.'); }
      await check(); // Discard a capture if the active tab changed during capture.
      const processed = await processor(image, options);
      const record = { id: crypto.randomUUID(), pageKey: options.pageKey, caption: '', created: new Date().toISOString(), pdfPage: options.pdfPage, ...processed };
      await save(record);
      return record.id;
    } finally { inFlight.delete(tab.windowId); }
  }
  return { list, get, update, remove, dataUrl, cropPlan, captureTab };
})();
if (typeof module !== 'undefined') module.exports = CloseReaderCaptures;
