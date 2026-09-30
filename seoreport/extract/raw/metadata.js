export function extractMetadata(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;

  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || 
                        html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const metaDescription = metaDescMatch ? metaDescMatch[1] : null;

  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i) ||
                         html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i);
  const canonical = canonicalMatch ? canonicalMatch[1] : null;

  const robotsMatch = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i) ||
                      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["']/i);
  const robotsMeta = robotsMatch ? robotsMatch[1] : null;

  const langMatch = html.match(/<html[^>]+lang=["']([^"']*)["']/i);
  const lang = langMatch ? langMatch[1] : null;

  const hreflangRegex = /<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']+)["'][^>]+href=["']([^"']+)["']/gi;
  const hreflang = [];
  let hMatch;
  while ((hMatch = hreflangRegex.exec(html)) !== null) {
    hreflang.push({ lang: hMatch[1], url: hMatch[2] });
  }

  const viewportMatch = html.match(/<meta[^>]+name=["']viewport["'][^>]+content=["']([^"']*)["']/i);
  const viewport = viewportMatch ? viewportMatch[1] : null;

  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i);
  const ogTypeMatch = html.match(/<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']*)["']/i);
  const ogUrlMatch = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']*)["']/i);
  const ogSiteNameMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i);
  
  const openGraph = {
    title: ogTitleMatch ? ogTitleMatch[1] : null,
    description: ogDescMatch ? ogDescMatch[1] : null,
    image: ogImageMatch ? ogImageMatch[1] : null,
    type: ogTypeMatch ? ogTypeMatch[1] : null,
    url: ogUrlMatch ? ogUrlMatch[1] : null,
    siteName: ogSiteNameMatch ? ogSiteNameMatch[1] : null
  };

  const twCardMatch = html.match(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']*)["']/i);
  const twTitleMatch = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']*)["']/i);
  const twDescMatch = html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']*)["']/i);
  const twImageMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']*)["']/i);

  const twitterCard = {
    card: twCardMatch ? twCardMatch[1] : null,
    title: twTitleMatch ? twTitleMatch[1] : null,
    description: twDescMatch ? twDescMatch[1] : null,
    image: twImageMatch ? twImageMatch[1] : null
  };

  const charsetMatch = html.match(/<meta[^>]+charset=["']([^"']*)["']/i);
  const charset = charsetMatch ? charsetMatch[1] : null;

  return { title, metaDescription, canonical, robotsMeta, xRobotsTag: null, lang, hreflang, viewport, openGraph, twitterCard, charset };
}