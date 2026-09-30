import { getRules } from './rules-loader.js';

export async function evaluate(facts, config) {
  const rules = getRules();
  const results = [];
  
  const urlPath = (() => {
    try { return new URL(facts.page?.url || '').pathname.toLowerCase(); } catch { return ''; }
  })();

  const contentType = (facts.http?.contentType || '').toLowerCase();
  const isHtmlPage = (contentType.includes('text/html') || contentType === '') && 
    !/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|xml|json|pdf|zip|mp4|mp3|map)$/i.test(urlPath);

  for (const rule of rules) {
    // Non-HTML assets (e.g. sitemaps, images, CSS, JSON) must not fail webpage on-page/content rules
    if (!isHtmlPage && ['onpage', 'content', 'structured_data'].includes(rule.category)) {
      continue;
    }

    const res = rule.evaluate(facts, config?.thresholds);
    results.push({
      ruleId: rule.id,
      category: rule.category,
      score: res.passed ? 100 : 0,
      weight: rule.weight,
      evidence: res.evidence || (res.passed ? 'Passed' : 'Failed'),
      severity: rule.severity || 'medium',
      passed: res.passed
    });
  }
  return results;
}

export function loadRulesFromDefinitions(ruleDefinitions) {
  return ruleDefinitions.map(def => ({
    ...def,
    evaluate: (facts) => ({ passed: true, evidence: 'dummy' })
  }));
}