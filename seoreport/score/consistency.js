export function checkConsistency(allPagesData, sitemapUrls, robotsData) {
  const issues = [];
  
  for (const url of sitemapUrls) {
    if (!allPagesData.has(url)) {
      issues.push({ issue: 'URL in sitemap not crawled', url, source: 'rules' });
    }
  }
  
  for (const [url, data] of allPagesData.entries()) {
    if (data.indexability.indexable && !sitemapUrls.includes(url)) {
      issues.push({ issue: 'Indexable page missing from sitemap', url, source: 'rules' });
    }
    
    const canonical = data.rawFacts?.metadata?.canonical;
    if (canonical && canonical !== url) {
      issues.push({ issue: 'Canonical does not match page URL', url, source: 'rules', evidence: canonical });
    }
    
    if (data.renderedFacts && data.rawFacts) {
      if (data.rawFacts.metadata?.title !== data.renderedFacts.metadata?.title) {
        issues.push({ issue: 'Title differs between raw HTML and rendered DOM', url, source: 'rules' });
      }
      if (data.rawFacts.metadata?.canonical !== data.renderedFacts.metadata?.canonical) {
        issues.push({ issue: 'Canonical injected by JavaScript', url, source: 'rules' });
      }
    }
  }
  
  return issues;
}