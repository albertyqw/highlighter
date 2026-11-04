// Source identity and metadata are separate from the extension viewer's URL.
const CloseReaderPdf = (() => {
  const dates = typeof module !== 'undefined' ? require('./article.js') : CloseReaderArticle;
  function source(value) {
    const url = new URL(value);
    if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password) throw new Error('Choose a PDF file or an HTTP(S) PDF link.');
    url.hash = '';
    return url.href;
  }
  function sourceFromTab(tab) {
    if (!tab?.url) return null;
    try {
      const url = new URL(tab.url);
      // Chrome's internal PDF extension sometimes exposes the source this way.
      if (url.protocol === 'chrome-extension:' && url.hostname === 'mhjfbmdgcfjbbpaeojofohoefgiehjai') return source(url.searchParams.get('src'));
      if (/\.pdf$/i.test(url.pathname) || /\.pdf(?:\s|$)/i.test(tab.title || '')) return source(url.href);
    } catch { /* Restricted tab or unsupported URL. */ }
    return null;
  }
  function nameFromUrl(value) {
    try { return decodeURIComponent(new URL(value).pathname.split('/').pop()) || 'PDF document'; }
    catch { return 'PDF document'; }
  }
  function metadata(info = {}, xmp) {
    const title = xmp?.get('dc:title') || info.Title;
    // PDF creation/modification timestamps do not establish a publication date.
    return {
      title: typeof title === 'string' ? title.trim() : '',
      publishedDate: dates.dateOnly(xmp?.get('prism:publicationdate')),
    };
  }
  return { source, sourceFromTab, nameFromUrl, metadata };
})();
if (typeof module !== 'undefined') module.exports = CloseReaderPdf;
