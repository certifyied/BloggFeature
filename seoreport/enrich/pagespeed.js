export async function fetchPageSpeed(url, apiKey, strategy = 'mobile') {
  const targetUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  targetUrl.searchParams.set('url', url);
  targetUrl.searchParams.set('strategy', strategy);
  targetUrl.searchParams.append('category', 'performance');
  targetUrl.searchParams.append('category', 'accessibility');
  targetUrl.searchParams.append('category', 'best-practices');
  targetUrl.searchParams.append('category', 'seo');

  const headers = {};

  if (apiKey) {
    if (apiKey.startsWith('ya29.') || apiKey.toLowerCase().startsWith('bearer ')) {
      const token = apiKey.replace(/^bearer\s+/i, '');
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      targetUrl.searchParams.set('key', apiKey);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);

  try {
    const res = await fetch(targetUrl.toString(), {
      headers,
      signal: controller.signal
    });
    if (!res.ok) {
      console.error(`PageSpeed API request failed with status ${res.status}`);
      return null;
    }
    const data = await res.json();
    
    const lighthouse = data.lighthouseResult;
    if (!lighthouse) return null;

    const audits = lighthouse.audits || {};
    const categories = lighthouse.categories || {};

    const getScore = (cat) => cat && cat.score !== null && cat.score !== undefined ? Math.round(cat.score * 100) : null;
    const getAuditVal = (audit) => audit && audit.numericValue !== undefined ? audit.numericValue : null;

    const perfScore = getScore(categories.performance);
    const a11yScore = getScore(categories.accessibility);
    const bpScore = getScore(categories['best-practices']);
    const seoScore = getScore(categories.seo);

    const lcp = getAuditVal(audits['largest-contentful-paint']);
    const cls = getAuditVal(audits['cumulative-layout-shift']);
    const inp = getAuditVal(audits['interaction-to-next-paint']);
    const fcp = getAuditVal(audits['first-contentful-paint']);
    const ttfb = getAuditVal(audits['server-response-time']);

    return {
      lcp_ms: lcp,
      cls: cls,
      inp_ms: inp,
      fcp_ms: fcp,
      ttfb_ms: ttfb,
      speed_index_ms: getAuditVal(audits['speed-index']),
      tbt_ms: getAuditVal(audits['total-blocking-time']),
      performance_score: perfScore,
      accessibility_score: a11yScore,
      best_practices_score: bpScore,
      seo_score: seoScore,
      lighthouse: {
        performance: perfScore,
        accessibility: a11yScore,
        best_practices: bpScore,
        seo: seoScore,
      },
      core_web_vitals: {
        lcp_ms: lcp,
        cls: cls,
        inp_ms: inp,
        fcp_ms: fcp,
        ttfb_ms: ttfb,
      },
      opportunities: Object.values(audits).filter(a => a.details && a.details.type === 'opportunity' && a.score !== 1).map(a => ({ id: a.id, title: a.title, description: a.description, savings_ms: a.details.overallSavingsMs })),
      diagnostics: Object.values(audits).filter(a => a.details && a.details.type === 'debugdata').map(a => ({ id: a.id, title: a.title, description: a.description }))
    };
  } catch (error) {
    console.error('PageSpeed API Exception:', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

