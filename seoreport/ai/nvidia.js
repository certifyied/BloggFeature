import { sanitizeLLMOutput, validateLLMOutputShape } from './sanitize.js';

export async function interpretPage(pageFacts, siteContext, env, config) {
  const apiKey = env.NVIDIA_ANALYSIS_API_KEY || env.NVIDIA_API_KEY;
  const fallbackKey = env.OPENROUTER_API_KEY;
  const maxTokens = config?.MAX_LLM_TOKENS_PER_PAGE || 1024;
  
  // Rate limiting simulation (1 per 300ms)
  await new Promise(r => setTimeout(r, 300));

  const prompt = `Perform a pure diagnostic SEO analysis of this page data: ${JSON.stringify(pageFacts)} and site context: ${JSON.stringify(siteContext)}. 
CRITICAL DIRECTIVE: Provide DIAGNOSTIC ANALYSIS ONLY (topic clarity, search intent, content completeness, content gaps). DO NOT provide step-by-step remedies, how-to guides, or solutions.
Return JSON with allowed keys: content_quality, issues, suggested_title, suggested_meta_description, content_gaps, ai_analysis.`;
  const messages = [{ role: 'user', content: prompt }];
  
  let rawContent = null;
  let tokens = null;
  let attempt = 0;
  
  if (apiKey || fallbackKey) {
    while (attempt < 3) {
      try {
        if (apiKey) {
          const res = await callNvidiaAPI(messages, apiKey, maxTokens);
          rawContent = res.content;
          tokens = res.tokens_used;
        } else if (fallbackKey) {
          const res = await callOpenRouterFallback(messages, fallbackKey, maxTokens);
          rawContent = res.content;
          tokens = res.tokens_used;
        }
        break;
      } catch (err) {
        attempt++;
        if (attempt >= 3) break;
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
  }
  
  if (rawContent) {
    try {
      const rawObj = JSON.parse(rawContent);
      const sanitized = sanitizeLLMOutput(rawObj);
      const validation = validateLLMOutputShape(sanitized);
      if (validation.valid) return { ...sanitized, _tokens: tokens?.total || 100 };
    } catch (_) {}
  }
  
  // Fallback: Generate intelligent rule-backed diagnostic AI analysis
  return generateHeuristicAiAnalysis(pageFacts, siteContext);
}

function generateHeuristicAiAnalysis(pageFacts, siteContext) {
  const url = pageFacts.url || '';
  const raw = pageFacts.raw_html || pageFacts.rawFacts || {};
  const rendered = pageFacts.rendered || {};
  const meta = rendered.metadata || raw.metadata || {};
  const content = rendered.content || raw.content || {};

  const title = (meta.title || '').trim();
  const desc = (meta.metaDescription || '').trim();
  const wordCount = Math.max(content.wordCount || 0, raw.content?.wordCount || 0);

  const topicClarity = title ? (title.length >= 30 && title.length <= 60 ? 9 : 6) : 3;
  const intentAlignment = desc ? (desc.length >= 120 && desc.length <= 160 ? 9 : 7) : 4;
  const completeness = wordCount >= 800 ? 9 : (wordCount >= 300 ? 7 : (wordCount > 50 ? 5 : 2));

  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { host = 'Site'; }
  const brand = siteContext?.business_name || host;

  const contentGaps = [];
  if (!desc) contentGaps.push('Missing meta description tag to capture organic search click-throughs');
  if (wordCount < 300) contentGaps.push('Thin content depth: page contains fewer than 300 visible words');
  if (!meta.canonical) contentGaps.push('Missing canonical link tag for duplicate content protection');
  if (!meta.viewport) contentGaps.push('Missing viewport meta tag for mobile search responsiveness');

  const suggestedTitle = title 
    ? `${title} | ${brand}`.slice(0, 60)
    : `Top Services & Solutions in ${siteContext?.location || 'India'} | ${brand}`;

  const suggestedDesc = desc
    ? desc.slice(0, 160)
    : `Explore ${brand} for official ${siteContext?.target_keywords?.[0] || 'services'} and solutions in ${siteContext?.location || 'your region'}. Request details and view complete offerings.`;

  return {
    content_quality: {
      topic_clarity: topicClarity,
      search_intent_alignment: intentAlignment,
      content_completeness: completeness,
      content_gaps: contentGaps.length > 0 ? contentGaps : ['Add deeper topical authority content and structured FAQs']
    },
    suggested_title: suggestedTitle,
    suggested_meta_description: suggestedDesc,
    ai_analysis: {
      diagnostic_summary: `Diagnostic analysis for ${url}: Page presents ${wordCount} visible words with topic clarity score ${topicClarity}/10 and intent alignment ${intentAlignment}/10.`,
      analysis_source: 'intelligent_heuristic'
    },
    _tokens: 0
  };
}

async function callNvidiaAPI(messages, apiKey, maxTokens) {
  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'meta/llama-3.1-8b-instruct', messages, max_tokens: maxTokens, response_format: { type: "json_object" } })
  });
  if (!res.ok) throw new Error('Nvidia API Error');
  const data = await res.json();
  return { 
    content: data.choices[0].message.content, 
    tokens_used: { prompt: data.usage?.prompt_tokens || 0, completion: data.usage?.completion_tokens || 0, total: data.usage?.total_tokens || 0 } 
  };
}

async function callOpenRouterFallback(messages, apiKey, maxTokens) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'meta-llama/llama-3.1-8b-instruct', messages, max_tokens: maxTokens, response_format: { type: "json_object" } })
  });
  if (!res.ok) throw new Error('OpenRouter API Error');
  const data = await res.json();
  return { 
    content: data.choices[0].message.content, 
    tokens_used: { prompt: data.usage?.prompt_tokens || 0, completion: data.usage?.completion_tokens || 0, total: data.usage?.total_tokens || 0 } 
  };
}
