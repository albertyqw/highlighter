// Read explicit publisher metadata. Never substitute the reading/import date.
const CloseReaderArticle = (() => {
  function dateOnly(value) {
    if (typeof value !== 'string') return '';
    const match = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:$|[T\s])/.exec(value.trim());
    if (!match) return '';
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(date + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
  }

  function extract(doc) {
    const articles = [];
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(visit);
      const types = [].concat(value['@type'] || []);
      if (types.some(type => /(?:Article|Posting)$/.test(type))) articles.push(value);
      if (value['@graph']) visit(value['@graph']);
      if (value.mainEntity) visit(value.mainEntity);
    }
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try { visit(JSON.parse(script.textContent)); } catch { /* Ignore malformed publisher data. */ }
    }
    const meta = selector => doc.querySelector(selector)?.getAttribute('content')?.trim() || '';
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
    const article = articles.find(item => [item.url, item.mainEntityOfPage?.['@id'], item.mainEntityOfPage].some(url => typeof url === 'string' && (url === canonical || url === doc.URL))) || articles[0];
    const title = (typeof article?.headline === 'string' && article.headline.trim()) || meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || doc.querySelector('article h1, main h1, h1')?.textContent.trim() || doc.title || '';
    const dates = [
      article?.datePublished,
      meta('meta[property="article:published_time"]'),
      meta('meta[name="citation_publication_date"]'),
      meta('meta[name="parsely-pub-date"]'),
      meta('meta[itemprop="datePublished"]'),
      meta('meta[name="DC.date.issued"]'),
      doc.querySelector('time[itemprop="datePublished"], time[pubdate]')?.getAttribute('datetime'),
    ];
    return { title, publishedDate: dates.map(dateOnly).find(Boolean) || '' };
  }
  return { extract, dateOnly };
})();
if (typeof module !== 'undefined') module.exports = CloseReaderArticle;
