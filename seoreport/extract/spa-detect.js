export function detectSPA(html) {
  // Strip script/style content before measuring visible text
  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const visibleText = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = visibleText.split(/\s+/).filter(Boolean).length;

  // ── Framework signal detection ─────────────────────────────────────────────
  const scriptSrcs    = (html.match(/<script[^>]+src=["'][^"']+["']/gi) || []).join(' ');
  const inlineScripts = (html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []).join(' ');

  // Empty shell containers — the definitive SPA signal
  const hasEmptyRoot  = /<div[^>]+id=["']root["'][^>]*>\s*<\/div>/i.test(html);
  const hasEmptyNext  = /<div[^>]+id=["']__next["'][^>]*>\s*<\/div>/i.test(html);
  const hasEmptyApp   = /<div[^>]+id=["'](?:app|nuxt)["'][^>]*>\s*<\/div>/i.test(html);
  const hasEmptyShell = hasEmptyRoot || hasEmptyNext || hasEmptyApp;

  // Framework markers (in scripts only)
  const hasReact   = /react(?:dom)?[\.\-](?:development|production|min)/i.test(scriptSrcs);
  const hasNext    = /__NEXT_DATA__/.test(inlineScripts) || /\/_next\/static\//.test(scriptSrcs);
  const hasNuxt    = /__NUXT__/.test(inlineScripts) || /nuxt\/dist\//.test(scriptSrcs);
  const hasAngular = /ng-version=/i.test(html) || /angular[\.\-]core/i.test(scriptSrcs);
  const hasVue     = /vue(?:\.runtime)?(?:\.esm)?(?:\.min)?\.js/i.test(scriptSrcs);
  const hasFramework = hasReact || hasNext || hasNuxt || hasAngular || hasVue;

  // ── SSR detection ──────────────────────────────────────────────────────────
  // A page is SSR if: (a) it has substantial visible content OR
  //                   (b) it has a framework marker + no empty shell (server rendered the content)
  const isLikelySsr = wordCount > 50 || (hasFramework && !hasEmptyShell && wordCount > 10);

  if (isLikelySsr) {
    return { isSPA: false, signals: [`SSR detected (${wordCount} words, emptyShell=${hasEmptyShell})`], confidence: 'high' };
  }

  // ── Collect signals for SPA verdict ───────────────────────────────────────
  const signals = [];
  if (hasEmptyRoot)  signals.push('Empty #root');
  if (hasEmptyNext)  signals.push('Empty #__next');
  if (hasEmptyApp)   signals.push('Empty #app/#nuxt');
  if (hasReact)      signals.push('React bundle');
  if (hasNext)       signals.push('Next.js marker');
  if (hasNuxt)       signals.push('Nuxt.js marker');
  if (hasAngular)    signals.push('Angular marker');
  if (hasVue)        signals.push('Vue marker');

  const linkCount = (html.match(/<a[^>]+href=["'][^"']+["']/gi) || []).length;
  if (wordCount < 50 && linkCount < 3 && hasFramework) signals.push('Low content heuristic');

  // SPA = has at least one framework-related signal
  const isSPA = signals.length > 0;
  const confidence = signals.length >= 4 ? 'high' : signals.length >= 2 ? 'medium' : 'low';

  return { isSPA, signals, confidence };
}
