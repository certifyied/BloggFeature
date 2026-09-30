export async function fetchAndParseRobots(rootUrl, userAgent = '*', timeoutMs = 5000) {
  let raw = '';
  let sitemaps = [];
  const rules = []; // Array of { agent, disallow: [], allow: [] }

  try {
    const urlObj = new URL(rootUrl);
    const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(robotsUrl, { 
      signal: controller.signal,
      headers: { 'User-Agent': userAgent }
    });
    clearTimeout(timeout);

    if (res.ok) {
      raw = await res.text();
    }
  } catch (error) {
    // If fetch fails, we default to allowing everything
    return { allowed: () => true, sitemaps: [], raw: '' };
  }

  // Parse robots.txt
  const lines = raw.split(/\r?\n/);
  let currentAgent = null;

  for (const line of lines) {
    const cleanLine = line.split('#')[0].trim();
    if (!cleanLine) continue;

    const [key, ...valueParts] = cleanLine.split(':');
    if (valueParts.length === 0) continue;
    
    const value = valueParts.join(':').trim();
    const lowerKey = key.trim().toLowerCase();

    if (lowerKey === 'user-agent') {
      currentAgent = value.toLowerCase();
      if (!rules.find(r => r.agent === currentAgent)) {
        rules.push({ agent: currentAgent, disallow: [], allow: [] });
      }
    } else if (lowerKey === 'disallow' && currentAgent) {
      const ruleObj = rules.find(r => r.agent === currentAgent);
      if (ruleObj && value) ruleObj.disallow.push(value);
    } else if (lowerKey === 'allow' && currentAgent) {
      const ruleObj = rules.find(r => r.agent === currentAgent);
      if (ruleObj && value) ruleObj.allow.push(value);
    } else if (lowerKey === 'sitemap') {
      sitemaps.push(value);
    }
  }

  // Determine allowed function
  const allowed = (urlToCheck) => {
    try {
      const pathToCheck = new URL(urlToCheck).pathname;
      
      // Find rules for our specific userAgent, or fallback to '*'
      let applicableRule = rules.find(r => r.agent === userAgent.toLowerCase()) || 
                           rules.find(r => r.agent === '*');
                           
      if (!applicableRule) return true; // Default allow

      // Check allow first (most specific path)
      for (const allowPath of applicableRule.allow) {
        if (pathToCheck.startsWith(allowPath)) return true;
      }

      // Check disallow
      for (const disallowPath of applicableRule.disallow) {
        if (pathToCheck.startsWith(disallowPath)) return false;
      }

      return true;
    } catch {
      return false; // block invalid URLs
    }
  };

  return { allowed, sitemaps, raw };
}

export async function fetchGovernance(rootUrl, timeoutMs = 5000) {
  let aiTxtPresent = false;
  let llmsTxtPresent = false;
  try {
    const urlObj = new URL(rootUrl);
    const origin = `${urlObj.protocol}//${urlObj.host}`;

    const checkFile = async (path) => {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${origin}${path}`, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'User-Agent': 'CertifyiedSEOBot/1.0' }
        });
        clearTimeout(t);
        return res.ok && res.status === 200;
      } catch {
        return false;
      }
    };

    const [aiRes, llmsRes] = await Promise.all([
      checkFile('/ai.txt'),
      checkFile('/llms.txt')
    ]);

    aiTxtPresent = aiRes;
    llmsTxtPresent = llmsRes;
  } catch {
    // default false on fetch error
  }

  return { aiTxtPresent, llmsTxtPresent };
}

