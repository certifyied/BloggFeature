export function extractLinks(html, pageUrl) {
  const links = { internal: [], external: [], total: 0 };
  if (!html || typeof html !== 'string') return links;

  const aRegex = /<a([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  
  let pageOrigin = '';
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch (e) {}

  while ((match = aRegex.exec(html)) !== null) {
    const attrs = match[1];
    let text = match[2].trim();
    
    // Support quoted and unquoted hrefs
    const hrefMatch = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '') : '';
    
    const relMatch = attrs.match(/rel=["']([^"']*)["']/i);
    const rel = relMatch ? relMatch[1].split(' ') : [];
    
    const targetMatch = attrs.match(/target=["']([^"']*)["']/i);
    const target = targetMatch ? targetMatch[1] : null;
    
    const isImageOnly = !text.replace(/<img[^>]+>/i, '').trim() && /<img/i.test(text);
    const isEmpty = !href || href === '#' || href.startsWith('javascript:');
    
    let context = 'main'; 
    const beforeIdx = match.index;
    const preHtml = html.substring(Math.max(0, beforeIdx - 2000), beforeIdx);
    if (preHtml.lastIndexOf('<nav') > preHtml.lastIndexOf('</nav>')) context = 'nav';
    else if (preHtml.lastIndexOf('<footer') > preHtml.lastIndexOf('</footer>')) context = 'footer';
    
    const item = { href, text: text.replace(/<[^>]+>/g, '').trim(), rel, target, context, isImageOnly, isEmpty };
    
    let isInternal = true;
    try {
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        let base = pageUrl;
        if (!href.startsWith('/') && !href.startsWith('http://') && !href.startsWith('https://') && !base.endsWith('/')) {
          if (!base.includes('?')) base += '/';
        }
        const url = new URL(href, base);
        if (url.origin !== pageOrigin) isInternal = false;
      }
    } catch(e) {}

    if (isInternal) links.internal.push(item);
    else links.external.push(item);
    
    links.total++;
  }

  const allLinks = [...links.internal, ...links.external];
  const result = { ...links, items: allLinks };

  Object.defineProperty(result, 'filter', {
    value: function(fn) { return allLinks.filter(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'some', {
    value: function(fn) { return allLinks.some(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'forEach', {
    value: function(fn) { return allLinks.forEach(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'map', {
    value: function(fn) { return allLinks.map(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'length', {
    get: function() { return allLinks.length; },
    enumerable: false, configurable: true
  });

  return result;
}