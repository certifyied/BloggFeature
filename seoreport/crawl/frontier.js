import { normalizeUrl } from './normalize.js';
import { fetchPage } from './fetcher.js';
import { detectSPA } from '../extract/spa-detect.js';

export class Frontier {
  constructor(config, robotsData, logger) {
    this.config = config;
    this.robotsData = robotsData;
    this.logger = logger;
    
    this.queue = [];      // Array of { url, depth, parentUrl }
    this.visited = new Map(); // Map<normalizedUrl, { depth, parentUrl }>
    this.activeCount = 0;
    this.pageCount = 0;
  }

  resolveUrl(rawHref, baseUrlStr) {
    if (!rawHref || typeof rawHref !== 'string') return null;
    const cleanHref = rawHref.trim();
    if (!cleanHref || /^(javascript:|mailto:|tel:|#|data:|blob:)/i.test(cleanHref)) return null;

    try {
      let base = baseUrlStr;
      if (!cleanHref.startsWith('/') && !cleanHref.startsWith('http://') && !cleanHref.startsWith('https://') && !base.endsWith('/')) {
        if (!base.includes('?')) {
          base += '/';
        }
      }
      return new URL(cleanHref, base).toString();
    } catch {
      return null;
    }
  }

  extractLinksFromHtml(html, pageUrl) {
    const rawLinks = new Set();
    if (!html || typeof html !== 'string') return [];

    // 1. Standard href & route matching (quoted & unquoted, allowing spaces around =)
    const hrefRegex = /(?:href|to|data-href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>'"#]+))/gi;
    let match;
    while ((match = hrefRegex.exec(html)) !== null) {
      const href = match[1] || match[2] || match[3];
      if (href) rawLinks.add(href);
    }

    // 2. JS SPA router strings & json paths (e.g. path: "/blogs", "/blogs", "/pricing")
    const jsPathRegex = /(?:["']\/([a-zA-Z0-9_\-\/]{2,60})["'])/g;
    while ((match = jsPathRegex.exec(html)) !== null) {
      const pathCandidate = '/' + match[1];
      if (!/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|xml|json|map|ts|tsx)$/i.test(pathCandidate)) {
        rawLinks.add(pathCandidate);
      }
    }

    const resolvedUrls = [];
    for (const rawHref of rawLinks) {
      if (/\$\{.*\}|\{\{.*\}\}|%24%7B.*%7D/i.test(rawHref)) continue;
      const absoluteUrl = this.resolveUrl(rawHref, pageUrl);
      if (absoluteUrl) {
        const pathname = new URL(absoluteUrl).pathname.toLowerCase();
        if (!/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|xml|json|pdf|zip|mp4|mp3|map)$/i.test(pathname)) {
          resolvedUrls.push(absoluteUrl);
        }
      }
    }

    return resolvedUrls;
  }

  async *crawl(seedUrls) {
    const getRootHost = (u) => {
      try {
        const h = new URL(u).host.toLowerCase();
        return h.startsWith('www.') ? h.slice(4) : h;
      } catch { return ''; }
    };

    const primarySeed = seedUrls[0];
    const seedHost = getRootHost(primarySeed);
    
    // Add primary seed (rootUrl) first at depth 0
    const normRoot = normalizeUrl(primarySeed);
    if (normRoot && this.robotsData.allowed(normRoot)) {
      this.visited.set(normRoot, { depth: 0, parentUrl: null });
      this.queue.push({ url: normRoot, depth: 0, parentUrl: null });
    }

    // Add secondary seeds (sitemap URLs) at depth 1
    for (const url of seedUrls.slice(1)) {
      const norm = normalizeUrl(url);
      if (norm && !this.visited.has(norm) && this.robotsData.allowed(norm)) {
        this.visited.set(norm, { depth: 1, parentUrl: normRoot });
        this.queue.push({ url: norm, depth: 1, parentUrl: normRoot });
      }
    }

    while (this.queue.length > 0 && this.pageCount < this.config.maxPages) {
      const batchSize = Math.min(
        this.config.maxConcurrency - this.activeCount,
        this.queue.length,
        this.config.maxPages - this.pageCount
      );

      if (batchSize === 0) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      const batch = this.queue.splice(0, batchSize);
      this.activeCount += batch.length;

      const promises = batch.map(async (item) => {
        try {
          if (this.config.requestDelayMs) {
            await new Promise(r => setTimeout(r, this.config.requestDelayMs));
          }
          
          const httpResult = await fetchPage(item.url, this.config);
          let htmlToExtract = httpResult.html || '';
          let renderedHtml = null;

          // Check SPA rendering if raw HTML has low content or is SPA
          if (httpResult.html && this.config.features?.render && this.config.cfBrowserRenderingUrl) {
            const spaInfo = detectSPA(httpResult.html);
            if (spaInfo.isSPA || (htmlToExtract.length < 5000 && !/<a\s+[^>]*href=/i.test(htmlToExtract))) {
              try {
                const renderResp = await fetch(this.config.cfBrowserRenderingUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: item.url }),
                });
                if (renderResp.ok) {
                  const renderData = await renderResp.json();
                  if (renderData?.html) {
                    renderedHtml = renderData.html;
                    htmlToExtract = htmlToExtract + '\n' + renderedHtml;
                  }
                }
              } catch (e) {
                this.logger.warn('frontier_render', { message: 'Render failed in frontier', url: item.url, error: e.message });
              }
            }
          }

          // Discover new links (respecting maxPages cap)
          if (htmlToExtract && item.depth < this.config.maxDepth && this.visited.size < this.config.maxPages) {
            const discoveredUrls = this.extractLinksFromHtml(htmlToExtract, item.url);

            for (const nextUrl of discoveredUrls) {
              if (this.visited.size >= this.config.maxPages) break;
              if (getRootHost(nextUrl) === seedHost) {
                const nextNorm = normalizeUrl(nextUrl);
                if (nextNorm && this.robotsData.allowed(nextNorm)) {
                  const existing = this.visited.get(nextNorm);
                  const nextDepth = item.depth + 1;
                  
                  if (!existing) {
                    if (this.visited.size < this.config.maxPages) {
                      this.visited.set(nextNorm, { depth: nextDepth, parentUrl: item.url });
                      this.queue.push({ url: nextNorm, depth: nextDepth, parentUrl: item.url });
                    }
                  } else if (nextDepth < existing.depth) {
                    // Update to shorter depth and actual parent
                    existing.depth = nextDepth;
                    existing.parentUrl = item.url;
                  }
                }
              }
            }
          }

          return {
            url: item.url,
            normalizedUrl: item.url,
            depth: item.depth,
            parentUrl: item.parentUrl,
            html: httpResult.html,
            renderedHtml: renderedHtml,
            http: {
              status: httpResult.status,
              contentType: httpResult.contentType,
              contentLength: httpResult.contentLength,
              redirectChain: httpResult.redirectChain,
              responseTimeMs: httpResult.responseTimeMs,
              error: httpResult.error
            }
          };
        } finally {
          this.activeCount--;
          this.pageCount++;
        }
      });

      const results = await Promise.all(promises);
      for (const res of results) {
        yield res;
      }
    }
  }
}
