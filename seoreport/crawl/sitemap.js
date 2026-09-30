import { normalizeUrl } from './normalize.js';

export async function parseSitemap(rootUrl, config, maxLevels = 3) {
  const normalizedUrls = new Set();
  
  async function fetchAndParse(sitemapUrl, level = 1) {
    if (level > maxLevels) return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      
      const res = await fetch(sitemapUrl, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!res.ok) return;

      let content = '';
      const reader = res.body.getReader();
      let bytesRead = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.length;
        if (bytesRead > config.maxResponseSizeBytes) {
          reader.cancel();
          break; // Read partial max size
        }
        content += new TextDecoder().decode(value, { stream: true });
      }

      // Simple regex parser for <loc> tags
      const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
      let match;
      
      while ((match = locRegex.exec(content)) !== null) {
        const urlMatch = match[1].trim();
        
        // Determine if it's a sitemap index or normal sitemap
        if (urlMatch.toLowerCase().endsWith('.xml')) {
           await fetchAndParse(urlMatch, level + 1);
        } else {
           const norm = normalizeUrl(urlMatch);
           if (norm) normalizedUrls.add(norm);
        }
      }

    } catch (err) {
      // Ignore errors for individual sitemaps
      console.warn(`Error parsing sitemap ${sitemapUrl}:`, err);
    }
  }

  const urlObj = new URL(rootUrl);
  const base = `${urlObj.protocol}//${urlObj.host}`;
  
  // Try common paths
  await Promise.all([
    fetchAndParse(`${base}/sitemap.xml`),
    fetchAndParse(`${base}/sitemap_index.xml`)
  ]);

  return Array.from(normalizedUrls);
}
