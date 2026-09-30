export function normalizeUrl(rawUrl) {
  try {
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    // Reject template literal placeholders
    if (/\$\{.*\}|\{\{.*\}\}|%24%7B.*%7D/i.test(rawUrl)) {
      return null;
    }

    const urlObj = new URL(rawUrl);

    // 1. Lowercase scheme and host
    let host = urlObj.hostname.toLowerCase();
    // Normalize www. domain prefix to canonical root domain for consistent crawl graph
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }

    // 2. Strip default ports
    const port = urlObj.port;
    if (port && !(
      (urlObj.protocol === 'http:'  && port === '80') ||
      (urlObj.protocol === 'https:' && port === '443')
    )) {
      host = `${host}:${port}`;
    }

    // 3. Fragment is excluded — never included in output

    // 4. Remove tracking & cache-busting params
    const trackingPrefixes = ['utm_', 'mc_'];
    const exactTrackingParams = new Set(['fbclid', 'gclid', 'ref', 'source', 'campaign']);
    
    // Check if path is a static asset
    const isStaticAsset = /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)$/i.test(urlObj.pathname);
    const assetCacheBusters = new Set(['v', 'ver', 'version', '_v', 't', 'cb', 'hash']);

    const params = new URLSearchParams(urlObj.search);
    for (const key of [...params.keys()]) {
      const lk = key.toLowerCase();
      if (exactTrackingParams.has(lk) || trackingPrefixes.some(p => lk.startsWith(p))) {
        params.delete(key);
      } else if (isStaticAsset && assetCacheBusters.has(lk)) {
        params.delete(key);
      }
    }

    // 5 & 6. Collapse repeated slashes in path + strip ALL trailing slashes
    let path = urlObj.pathname.replace(/\/{2,}/g, '/');
    while (path.endsWith('/')) path = path.slice(0, -1);

    // 7 & 9. Percent-decode unreserved chars, re-encode path safely
    try { path = encodeURI(decodeURIComponent(path)); } catch (_) { /* leave as-is on bad encoding */ }

    // 8. Sort remaining query params alphabetically
    params.sort();
    const qs = params.toString();

    return `${urlObj.protocol}//${host}${path}${qs ? '?' + qs : ''}`;

  } catch (_err) {
    return null;
  }
}
