function generateLocalSuggestions(businessName, keywordsStr, count = 3) {
  const keywords = (keywordsStr || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
    
  const defaultKeywords = ['excellent service', 'friendly staff', 'great support'];
  const k1 = keywords[0] || defaultKeywords[0];
  const k2 = keywords[1] || defaultKeywords[1];
  const k3 = keywords[2] || keywords[0] || defaultKeywords[2];
  const k4 = keywords[3] || keywords[1] || defaultKeywords[0];

  // Tier 1: Short & Punchy (1-2 sentences, ~15-25 words)
  const poolShort = [
    `Super fast and reliable service at ${businessName}! The team was very attentive with ${k1} and made everything effortless.`,
    `Had a wonderful experience with ${businessName}. Top quality ${k2} and very friendly team, definitely 5 stars!`,
    `Truly impressed with ${businessName}! Quick turnaround, honest pricing, and skilled work on ${k1}. Highly recommended.`,
    `Great customer care and prompt support for ${k2}. ${businessName} is easily my top recommendation!`
  ];

  // Tier 2: Warm Family / Personal (2-3 sentences, ~45-65 words)
  const poolFamily = [
    `My family and I had an amazing experience with ${businessName}. The staff was incredibly welcoming, patient, and made sure all our requirements were addressed with care. Their attention to ${k1} and ${k2} really sets them apart, and we will definitely be recommending them to our friends!`,
    `Visited ${businessName} recently with my spouse and we were blown away by the hospitality and care. They handled our requirements with so much attention to detail and delivered fantastic ${k1}. It is so refreshing to see a team that genuinely cares about their customers.`,
    `I brought my parents to ${businessName} and could not be happier with how smoothly everything went. From the moment we connected, the team treated us like family while taking care of ${k2}. Outstanding service and warm, dependable support!`
  ];

  // Tier 3: Eloquent / High-English Professional (5-7 sentences, ~85-125 words)
  const poolHighEnglish = [
    `The level of professionalism and meticulous attention to detail demonstrated by the team at ${businessName} was truly commendable. From the initial consultation through to the final execution, every single aspect of their service was handled with utmost transparency, precision, and diligence. Their expertise in ${k1} was evident from the outset, and they consistently went above and beyond to ensure our expectations were not merely met, but thoroughly exceeded. In an industry where reliability is rare, ${businessName} stands out as a benchmark of quality and integrity. I have zero hesitation in recommending them to anyone seeking dependable support and top-tier expertise.`,
    `I would like to place on record my sincere appreciation for the exemplary service delivered by ${businessName}. Their staff demonstrated an admirable grasp of technical nuances and executed our requirements concerning ${k2} with impeccable precision. Communication remained seamless and courteous throughout the entire engagement, leaving no room for ambiguity or delay. It is exceedingly rare to encounter an organization that combines profound domain expertise with such a courteous, customer-centric approach. I wholeheartedly endorse ${businessName} for anyone who values dependable timelines, skilled workmanship, and peerless professionalism.`
  ];

  const results = [];
  for (let i = 0; i < count; i++) {
    const slot = i % 3;
    if (slot === 0) {
      results.push(poolShort[Math.floor(Math.random() * poolShort.length)]);
    } else if (slot === 1) {
      results.push(poolFamily[Math.floor(Math.random() * poolFamily.length)]);
    } else {
      results.push(poolHighEnglish[Math.floor(Math.random() * poolHighEnglish.length)]);
    }
  }
  return results;
}

// Shared AI suggestion generator — used by /submit (sync and background) and cron
let cachedWorkingModel = null;
let lastModelCheckTime = 0;
const MODEL_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function getWorkingModel(env) {
  const now = Date.now();
  if (cachedWorkingModel && (now - lastModelCheckTime < MODEL_CHECK_INTERVAL_MS)) {
    return cachedWorkingModel;
  }

  console.log('[ModelCheck] Stale or missing working model. Running health check...');
  const testPrompt = "respond ONLY with the word 'OK'";
  
  const testModels = [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3.5-lightning:free",
    "liquid/lfm-2.5-2.6b:free",
    "minimax/minimax-m3.1-flash:free",
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free"
  ];

  for (const model of testModels) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://certifyied.com',
          'X-Title': 'Certifyied Health Check'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: testPrompt }],
          reasoning: { effort: 'none' },
          max_tokens: 300,
          temperature: 0.1
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data && (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning)) {
          console.log(`[ModelCheck] Active model discovered: ${model}`);
          cachedWorkingModel = model;
          lastModelCheckTime = now;
          return model;
        }
      }
      console.warn(`[ModelCheck] Model ${model} failed health check (Status: ${res.status})`);
    } catch (e) {
      console.error(`[ModelCheck] Exception testing ${model}:`, e.message);
    }
  }

  // Fallback if all test checks fail
  return "nvidia/nemotron-3-ultra-550b-a55b:free";
}

// Shared AI suggestion generator — used by /submit (sync and background) and cron
async function generateAISuggestions(env, supabaseAdmin, client, customSuggestions = [], count = 3) {
  const provider = env.AI_PROVIDER || (env.NVIDIA_API_KEY ? 'nvidia' : 'openrouter');
  const apiKey = provider === 'nvidia' ? env.NVIDIA_API_KEY : env.OPENROUTER_API_KEY;

  if (!apiKey) return null;

  const keywordsList = (client.ai_keywords || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  let guidanceTemplate = '';
  const actualCustomSuggestions = customSuggestions.length > 0 ? customSuggestions : (client.custom_suggestions || []);
  if (actualCustomSuggestions.length > 0) {
    const randomIndex = Math.floor(Math.random() * actualCustomSuggestions.length);
    guidanceTemplate = `\nUse this user-provided example template as a reference for tone/style: "${actualCustomSuggestions[randomIndex]}".\n`;
  }

  // Generate dynamic array example formatting for the prompt based on the requested count
  const dummyExamples = [];
  for (let i = 0; i < Math.min(count, 3); i++) {
    if (i % 3 === 0) {
      dummyExamples.push(`"Short 1-2 line review (~20 words)..."`);
    } else if (i % 3 === 1) {
      dummyExamples.push(`"Warm family or personal review (~50 words)..."`);
    } else {
      dummyExamples.push(`"Articulate high-English professional review (~90 words)..."`);
    }
  }
  const dummyJSON = `{\n  "reviews": [\n    ${dummyExamples.join(',\n    ')}\n  ]\n}`;

  const industryStr = (client.industry || '').trim();
  const domainInstruction = industryStr
    ? `1. INDUSTRY / SECTOR: "${industryStr}". The business strictly operates in the "${industryStr}" sector. All reviews MUST be explicitly grounded in realistic services, products, and customer scenarios authentic to this specific industry without guesswork.`
    : `1. Analyze the business name "${client.name}" and the keywords [${keywordsList.join(', ')}].\n2. Infer what this business does (e.g. AC/appliances repair, dental/medical clinic, luxury resort/stay, furniture & home decor, dining/restaurant, retail, salon, automotive, legal, etc.).`;

  const systemPrompt = `You are an AI generating authentic, natural 5-star Google review suggestions for a business named "${client.name}"${industryStr ? ` in the "${industryStr}" industry` : ''}.

CONTEXT & DOMAIN REASONING:
${domainInstruction}
${industryStr ? '2' : '3'}. Ground every review in realistic, believable scenarios that real clients encounter in this specific domain. Avoid artificial clichés and robotic praise.

MANDATORY PERSONAS AND LENGTH ROTATION:
Generate exactly ${count} distinct positive (5-star) review suggestions. Every consecutive set of 3 reviews MUST strictly follow this exact rotating pattern:

- REVIEW 1 (or 3k+1) — SHORT & PUNCHY (1-2 sentences, ~15-25 words):
  * Persona: Busy, direct mobile user leaving quick praise.
  * Tone: Casual, punchy, straight to the point. Focuses on speed, quality, and satisfaction.

- REVIEW 2 (or 3k+2) — WARM FAMILY / PERSONAL (2-3 sentences, ~45-65 words):
  * Persona: Warm, community-minded customer mentioning personal/family experience ("My family and I visited...", "I came here with my spouse...", "Brought my parents...").
  * Tone: Friendly, heartfelt, highly appreciative. Highlights welcoming staff, patience, and comfort.

- REVIEW 3 (or 3k+3) — ELOQUENT / HIGH-ENGLISH PROFESSIONAL (5-7 sentences, ~85-125 words):
  * Persona: Articulate professional with high English proficiency.
  * Tone: Thoughtful, polished, sophisticated vocabulary (e.g., "exemplary", "impeccable", "meticulous attention to detail", "commendable diligence", "seamless experience").
  * Structure: Details the initial requirement/problem, the team's domain expertise, the smooth execution, and an earnest recommendation.

KEYWORDS INTEGRATION:
Naturally weave in these keywords contextually without forcing or keyword-stuffing:
${keywordsList.length > 0 ? keywordsList.map(kw => `- ${kw}`).join('\n') : '- excellent service, professional staff'}

${guidanceTemplate}

OUTPUT FORMAT:
Respond ONLY with a valid, clean JSON object with the exact key "reviews" containing an array of ${count} strings:
${dummyJSON}`;

  let models = [];
  let baseUrl = '';
  let headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  if (provider === 'nvidia') {
    baseUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';
    models = ["nvidia/nemotron-3-ultra-550b-a55b"];
  } else {
    baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    headers['HTTP-Referer'] = 'https://certifyied.com';
    headers['X-Title'] = 'Certifyied Review Funnel';
    
    // Dynamically obtain the working model cached for 30 minutes
    const activeModel = await getWorkingModel(env);
    models = [
      activeModel,
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "nvidia/nemotron-3.5-lightning:free",
      "liquid/lfm-2.5-2.6b:free",
      "minimax/minimax-m3.1-flash:free",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free"
    ].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);
  }

  let responseText = null;

  for (const model of models) {
    try {
      const randomSeed = Math.floor(Math.random() * 1000000);
      const requestBody = {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate positive reviews with realistic context for "${client.name}"${industryStr ? ` (Industry: ${industryStr})` : ''} incorporating keywords: ${client.ai_keywords || ''} (Request ID: ${randomSeed})` }
        ],
        temperature: 0.7,
        max_tokens: 3500
      };

      // Add seed, json_object formatting, and disable reasoning tokens so output is clean JSON without thinking monologue
      if (provider === 'openrouter') {
        requestBody.response_format = { type: 'json_object' };
        requestBody.reasoning = { effort: 'none' };
        requestBody.seed = randomSeed;
      }

      const aiRes = await fetch(baseUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        let rawContent = aiData.choices?.[0]?.message?.content;
        if (!rawContent && aiData.choices?.[0]?.message?.reasoning) {
          rawContent = aiData.choices?.[0]?.message?.reasoning;
        }

        if (rawContent) {
          responseText = rawContent;
          console.log(`[generateAISuggestions] Successfully generated using model: ${model} via ${provider}`);
          
          // Log call to audit_logs
          try {
            await supabaseAdmin.from('audit_logs').insert({
              email: 'system_ai',
              action: 'ai_call',
              details: {
                client_id: client.id,
                client_name: client.name,
                provider: provider,
                model: model,
                count: count
              }
            });
          } catch (logErr) {
            console.error("Failed to log AI call:", logErr);
          }
          
          break;
        }
      } else {
        console.warn(`[generateAISuggestions] Model ${model} via ${provider} returned status: ${aiRes.status}`);
      }
    } catch (modelErr) {
      console.error(`[generateAISuggestions] Fetch failed for model ${model} via ${provider}:`, modelErr.message);
    }
  }

  if (!responseText) return null;

  // Resilient multi-layer parser: handles thinking tags, markdown fences, JSON objects/arrays, and truncated outputs
  try {
    // 1. Strip <think>...</think> blocks
    let cleanText = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // 2. Strip markdown code fences (```json or ```)
    cleanText = cleanText.replace(/^```(?:json)?/gim, '').replace(/```$/gim, '').trim();

    let candidateReviews = null;

    // 3. Locate JSON object { ... }
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const parsed = JSON.parse(cleanText.slice(firstBrace, lastBrace + 1));
        const list = parsed.reviews || parsed.examples || parsed.data;
        if (Array.isArray(list) && list.length > 0) {
          candidateReviews = list;
        }
      } catch (innerErr) {
        // Fall through to regex string extractor
      }
    }

    // 4. Locate JSON array [ ... ] if object parse wasn't found
    if (!candidateReviews) {
      const firstBracket = cleanText.indexOf('[');
      const lastBracket = cleanText.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        try {
          const parsedArr = JSON.parse(cleanText.slice(firstBracket, lastBracket + 1));
          if (Array.isArray(parsedArr) && parsedArr.length > 0) {
            candidateReviews = parsedArr;
          }
        } catch (innerErr) {
          // Fall through
        }
      }
    }

    // 5. Truncated or malformed JSON regex recovery:
    // Pull out all quoted strings of review length (filters out keys like "reviews")
    if (!candidateReviews || candidateReviews.length === 0) {
      const extractedStrings = [...cleanText.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
        .map(m => m[1].replace(/\\"/g, '"').trim())
        .filter(s => s && s.toLowerCase() !== 'reviews' && s.length >= 15);
      if (extractedStrings.length > 0) {
        candidateReviews = extractedStrings;
      }
    }

    // 6. Numbered list fallback: lines starting with 1., 2., -, etc.
    if (!candidateReviews || candidateReviews.length === 0) {
      const listLines = cleanText.split('\n')
        .map(l => l.replace(/^[\d+.)\-*\s]+/, '').replace(/^["']|["']$/g, '').trim())
        .filter(l => l.length >= 15 && !l.toLowerCase().startsWith('we need to') && !l.toLowerCase().startsWith('here are'));
      if (listLines.length > 0) {
        candidateReviews = listLines;
      }
    }

    if (Array.isArray(candidateReviews) && candidateReviews.length > 0) {
      return candidateReviews.map(s => {
        if (typeof s !== 'string') return '';
        let clean = s.trim();
        clean = clean.replace(/^["']|["']$/g, '');
        clean = clean.replace(/[*_`#]/g, '');
        clean = clean.replace(/\s+/g, ' ');
        return clean.trim();
      }).filter(Boolean);
    }
  } catch (parseErr) {
    console.error(`[generateAISuggestions] Parser exception: ${parseErr.message} for snippet: ${responseText.substring(0, 150)}...`);
  }

  return null;
}


// Router handler for reviews endpoints
export async function handleReviewRequest(request, env, ctx, path, method, url, payload, supabaseAdmin, corsHeaders, logAction) {
  
  // ==========================================
  // 1. PUBLIC FUNNEL ENDPOINTS (NO AUTH REQUIRED)
  // ==========================================

  // GET Fetch Public Client Details
  if (path === '/adminApiBlog/api/reviews/public/client' && method === 'GET') {
    try {
      const clientId = url.searchParams.get('clientId');
      if (!clientId) {
        return new Response(JSON.stringify({ error: "clientId is required." }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      let client = null;
      let clientErr = null;
      
      const resQuery = await supabaseAdmin
        .from('review_clients')
        .select('name, google_review_link, copy_mode, logo_url')
        .eq('id', clientId)
        .maybeSingle();

      if (resQuery.error) {
        console.warn("⚠️ Column fetch failed in public/client (schema migration pending), executing fallback query.");
        const fallbackQuery = await supabaseAdmin
          .from('review_clients')
          .select('name, google_review_link')
          .eq('id', clientId)
          .maybeSingle();
          
        if (fallbackQuery.error) {
          clientErr = fallbackQuery.error;
        } else {
          client = fallbackQuery.data;
          client.copy_mode = 'auto';
          client.logo_url = null;
        }
      } else {
        client = resQuery.data;
        if (client && !client.copy_mode) {
          client.copy_mode = 'auto';
        }
      }

      if (clientErr || !client) {
        return new Response(JSON.stringify({ error: "Client not found." }), { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      return new Response(JSON.stringify(client), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  }

  // POST Submit Review (Feedbacks / Gatekeeper)
  if (path === '/adminApiBlog/api/reviews/public/submit' && method === 'POST') {
    try {
      const { clientId, rating, reviewer_name, reviewer_email, comment, draft, refresh, refreshCount } = await request.json();

      if (!clientId || !rating) {
        return new Response(JSON.stringify({ error: "clientId and rating are required." }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Retrieve client review info
      let client = null;
      let clientErr = null;
      
      const resQuery = await supabaseAdmin
        .from('review_clients')
        .select('name, email, google_review_link, ai_keywords, suggestion_type, custom_suggestions, copy_mode, cached_suggestions, suggestions_cached_at, suggestions_used_at')
        .eq('id', clientId)
        .maybeSingle();

      if (resQuery.error) {
        console.warn("⚠️ Column fetch failed (schema migration pending), executing fallback query.");
        const fallbackQuery = await supabaseAdmin
          .from('review_clients')
          .select('name, email, google_review_link, ai_keywords')
          .eq('id', clientId)
          .maybeSingle();
          
        if (fallbackQuery.error) {
          clientErr = fallbackQuery.error;
        } else {
          client = fallbackQuery.data;
          client.suggestion_type = 'ai';
          client.custom_suggestions = [];
          client.copy_mode = 'auto';
        }
      } else {
        client = resQuery.data;
        if (client && !client.copy_mode) {
          client.copy_mode = 'auto';
        }
      }

      if (clientErr || !client) {
        return new Response(JSON.stringify({ error: "Client profile not found." }), { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const status = rating <= 3 ? 'diverted' : 'facilitated';

      // Insert submission to Supabase only if it is not a draft (e.g. they clicked go to Google, or left negative feedback)
      if (!draft) {
        const { error: insErr } = await supabaseAdmin.from('reviews').insert({
          client_id: clientId,
          rating: parseInt(rating),
          reviewer_name: reviewer_name || 'Anonymous',
          reviewer_email: reviewer_email || null,
          comment: comment || null,
          status
        });

        if (insErr) {
          return new Response(JSON.stringify({ error: insErr.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }
      }

      // Case A: Rating is 3 or below - Save internally, return thank you
      if (rating <= 3) {
        if (!draft && client.email) {
          try {
            if (env.RESEND_API_KEY) {
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                },
                body: JSON.stringify({
                  from: 'Review Manager Alerts <alerts@send.certifyied.com>',
                  to: [client.email],
                  subject: `⚠️ Negative Feedback Alert: ${client.name}`,
                  html: `
                    <div style="font-family: sans-serif; padding: 24px; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
                      <h2 style="color: #e11d48; margin-top: 0;">Negative Customer Feedback</h2>
                      <p style="font-size: 16px; color: #334155;">
                        A customer has submitted a <strong>${rating}-star</strong> rating for <strong>${client.name}</strong>. Below are the details:
                      </p>
                      
                      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
                        <table style="width: 100%; border-collapse: collapse;">
                          <tr>
                            <td style="padding: 4px 0; font-weight: 600; width: 120px;">Customer Name:</td>
                            <td style="padding: 4px 0;">${reviewer_name || 'Anonymous'}</td>
                          </tr>
                          <tr>
                            <td style="padding: 4px 0; font-weight: 600;">Email:</td>
                            <td style="padding: 4px 0;">${reviewer_email || 'Not provided'}</td>
                          </tr>
                          <tr>
                            <td style="padding: 4px 0; font-weight: 600;">Rating:</td>
                            <td style="padding: 4px 0; color: #f59e0b;">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)</td>
                          </tr>
                          ${comment ? `<tr><td style="padding: 4px 0; font-weight: 600;">Comment:</td><td style="padding: 4px 0;">"${comment}"</td></tr>` : ''}
                        </table>
                      </div>
                    </div>
                  `,
                }),
              });
            }
          } catch (e) {
            console.error("Failed to send bad review email notification:", e);
          }
        }

        return new Response(JSON.stringify({
          success: true,
          action: 'feedback_saved',
          message: "Thank you for sharing your feedback with us internally. We will use this to improve our service."
        }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Case B: Rating is 4 or 5 - Predefined suggestions or AI-generated
      let examples = [
        `Outstanding service and very friendly staff at ${client.name}! Had a really smooth experience and would highly recommend to others.`,
        `Extremely professional, clean atmosphere, and super fast customer support. Very pleased with my experience with ${client.name}!`,
        `Great quality and attention to detail. ${client.name} is my go-to place now, thanks for the amazing work!`
      ];

      const suggestionType = client.suggestion_type || 'ai';
      const customSuggestions = Array.isArray(client.custom_suggestions) ? client.custom_suggestions : [];

      // Origin guard: Verify request originates from reviewmanager.in
      const origin = request.headers.get('origin') || '';
      const referer = request.headers.get('referer') || '';
      const isAllowedOrigin = origin.includes('reviewmanager.in') || referer.includes('reviewmanager.in') || origin.includes('localhost') || referer.includes('localhost');

      if (!isAllowedOrigin) {
        examples = ["Good service", "Good service", "Good service"];
      } else if (suggestionType === 'custom' && customSuggestions.length > 0) {
        examples = customSuggestions;
      } else if (suggestionType === 'ai') {
        // --- QUEUE BATCH CACHE SYSTEM ---
        const cacheQueue = Array.isArray(client.cached_suggestions) ? client.cached_suggestions : [];
        
        if (cacheQueue.length >= 3) {
          // ⚡ Serve the first 3 suggestions from the queue
          examples = cacheQueue.slice(0, 3);
          const remainingQueue = cacheQueue.slice(3);

          // Update the queue in the database by removing the served items
          ctx.waitUntil((async () => {
            try {
              await supabaseAdmin.from('review_clients').update({
                cached_suggestions: remainingQueue,
                suggestions_used_at: new Date().toISOString()
              }).eq('id', clientId);

              // 🔁 Threshold Check: If fewer than 5 suggestions are left, replenish the queue back to 20 suggestions in the background!
              if (remainingQueue.length < 5) {
                console.log(`[Submit] Queue threshold reached (${remainingQueue.length} left). Triggering background replenishment for ${client.name}...`);
                let freshExamples = await generateAISuggestions(env, supabaseAdmin, client, customSuggestions, 20);
                if (freshExamples && freshExamples.length > 0) {
                  // Merge any leftovers and cap at 20 total suggestions
                  const replenishedQueue = [...remainingQueue, ...freshExamples].slice(0, 20);
                  await supabaseAdmin.from('review_clients').update({
                    cached_suggestions: replenishedQueue,
                    suggestions_cached_at: new Date().toISOString()
                  }).eq('id', clientId);
                  console.log(`[Submit] ✅ Queue replenished back to ${replenishedQueue.length} for ${client.name}`);
                }
              }
            } catch (bgErr) {
              console.error(`[Submit] Background queue maintenance failed for ${client.name}:`, bgErr.message);
            }
          })());

        } else {
          // Queue is empty or has fewer than 3 items: Serve whatever is left, fill the rest with local fallback suggestions
          examples = [...cacheQueue];
          while (examples.length < 3) {
            const fallbackSet = generateLocalSuggestions(client.name, client.ai_keywords);
            examples.push(fallbackSet[examples.length % fallbackSet.length]);
          }

          // Fetch 20 fresh AI suggestions to fully populate the cache in the background
          ctx.waitUntil((async () => {
            try {
              let freshExamples = await generateAISuggestions(env, supabaseAdmin, client, customSuggestions, 20);
              if (!freshExamples || freshExamples.length === 0) {
                // Generate 20 local fallback suggestions if AI fails
                freshExamples = generateLocalSuggestions(client.name, client.ai_keywords, 20);
              }

              await supabaseAdmin.from('review_clients').update({
                cached_suggestions: freshExamples,
                suggestions_cached_at: new Date().toISOString(),
                suggestions_used_at: new Date().toISOString()
              }).eq('id', clientId);
              console.log(`[Submit] ✅ Fully populated fresh queue of ${freshExamples.length} suggestions for ${client.name}`);
            } catch (bgErr) {
              console.error(`[Submit] Background cache initialization failed for ${client.name}:`, bgErr.message);
            }
          })());
        }
      }

      return new Response(JSON.stringify({
        success: true,
        action: 'review_facilitation',
        examples,
        google_review_link: client.google_review_link,
        copy_mode: client.copy_mode || 'auto'
      }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  }

  // GET Resolve Slug (Public)
  if (path === '/adminApiBlog/api/reviews/public/slug' && method === 'GET') {
    try {
      const slug = url.searchParams.get('slug');
      if (!slug) {
        return new Response(JSON.stringify({ error: "slug parameter is required." }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const { data, error } = await supabaseAdmin
        .from('review_slugs')
        .select('client_id')
        .eq('slug', slug.toLowerCase().trim())
        .maybeSingle();

      if (error || !data) {
        return new Response(JSON.stringify({ error: "Short link not found." }), { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      return new Response(JSON.stringify({ clientId: data.client_id }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  }

  // ==========================================
  // SECURE ROUTES ENFORCING AUTH CHECK
  // ==========================================
  if (!payload) {
    return new Response(JSON.stringify({ error: "Unauthorized access. Invalid or expired token." }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ==========================================
  // 2. ADMIN CLIENT MANAGEMENT ENDPOINTS (ADMIN ROLE REQUIRED)
  // ==========================================
  let isAdmin = (payload.role === 'admin' || payload.role === 'global') && payload.role !== 'client';
  if (!isAdmin && payload.email && payload.role !== 'client') {
    if (env.ADMIN_EMAIL && payload.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase()) {
      isAdmin = true;
    } else {
      const { data: adminRecord } = await supabaseAdmin
        .from('admins')
        .select('id, role')
        .eq('email', payload.email.toLowerCase())
        .maybeSingle();
      if (adminRecord && (adminRecord.role === 'admin' || adminRecord.role === 'global')) {
        isAdmin = true;
      }
    }
  }

  if (path === '/adminApiBlog/api/reviews/clients/upload-logo' && method === 'POST') {
    const isAllowed = isAdmin || payload.role === 'client';
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: "Forbidden. Access denied." }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    try {
      const formData = await request.formData();
      const file = formData.get('logo');
      if (!file) {
        return new Response(JSON.stringify({ error: "No logo file provided." }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Upload to Supabase Storage
      const fileName = `${Date.now()}_${file.name || 'logo.png'}`;
      const fileBuffer = await file.arrayBuffer();

      const uploadUrl = `${env.SUPABASE_URL}/storage/v1/object/client-logos/${fileName}`;
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': file.type || 'image/png'
        },
        body: fileBuffer
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Failed to upload to Supabase Storage: ${errText}`);
      }

      const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/client-logos/${fileName}`;

      return new Response(JSON.stringify({ logoUrl: publicUrl }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  }

  // GET Locations matching client email address (for multi-project selectors)
  if (path === '/adminApiBlog/api/reviews/clients/locations' && method === 'GET') {
    try {
      const email = payload.email || '';
      if (!email) {
        return new Response(JSON.stringify({ error: "Unauthorized. Email is required." }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      let isAdminUser = (payload.role === 'admin' || payload.role === 'global') && payload.role !== 'client';
      if (!isAdminUser && env.ADMIN_EMAIL && email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase() && payload.role !== 'client') {
        isAdminUser = true;
      }

      // Check admins table directly in Supabase for this email ONLY if role is not explicitly client
      if (!isAdminUser && payload.role !== 'client') {
        const { data: adminRecord } = await supabaseAdmin
          .from('admins')
          .select('id, role')
          .eq('email', email.toLowerCase())
          .maybeSingle();
        if (adminRecord && (adminRecord.role === 'admin' || adminRecord.role === 'global')) {
          isAdminUser = true;
        }
      }

      let query = supabaseAdmin
        .from('review_clients')
        .select('id, name, logo_url, google_review_link, email, project_id, industry');

      // CRITICAL: Client-role users or non-admin users ONLY ever see their own locations
      if (!isAdminUser || payload.role === 'client') {
        query = query.eq('email', email.toLowerCase());
      }

      const { data, error } = await query;

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ locations: data || [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  if (path === '/adminApiBlog/api/reviews/clients') {
    const isClientPut = method === 'PUT' && payload.role === 'client';
    if (!isAdmin && !isClientPut) {
      return new Response(JSON.stringify({ error: "Forbidden. Admin privileges required." }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // GET List Clients
    if (method === 'GET') {
      try {
        const projectId = url.searchParams.get('projectId');
        let query = supabaseAdmin.from('review_clients').select('*');

        if (projectId) {
          query = query.eq('project_id', projectId);
        } else if (payload.projectId) {
          query = query.eq('project_id', payload.projectId);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        return new Response(JSON.stringify(data), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // POST Create Client
    if (method === 'POST') {
      try {
        const { project_id, name, email, google_review_link, ai_keywords, suggestion_type, custom_suggestions, copy_mode, logo_url, industry } = await request.json();

        if (!project_id || !name || !email || !google_review_link) {
          return new Response(JSON.stringify({ error: "Missing required fields (project_id, name, email, google_review_link)." }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // 1. Check if client user already exists in admins table or auth
        let userId = null;
        if (env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const { data: existingAdmin } = await supabaseAdmin
              .from('admins')
              .select('id, role, project_id')
              .eq('email', email.toLowerCase())
              .maybeSingle();

            if (existingAdmin) {
              userId = existingAdmin.id;
              if (existingAdmin.role === 'client' && !existingAdmin.project_id) {
                await supabaseAdmin.from('admins').update({ project_id }).eq('id', userId);
              }
            } else {
              // Not in admins table yet — create auth user and insert admin record
              const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email: email.toLowerCase(),
                email_confirm: true,
                password: Math.random().toString(36).substring(2, 15)
              });

              if (authUser && authUser.user) {
                userId = authUser.user.id;
              } else if (authError && (authError.message.includes("already registered") || authError.message.includes("already exists"))) {
                // If user was already in auth.users, find their id
                let page = 1;
                while (!userId && page <= 5) {
                  const { data: userPage } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
                  if (!userPage || !userPage.users || userPage.users.length === 0) break;
                  const matched = userPage.users.find(u => u.email.toLowerCase() === email.toLowerCase());
                  if (matched) {
                    userId = matched.id;
                    break;
                  }
                  page++;
                }
              }

              if (userId) {
                await supabaseAdmin.from('admins').insert({
                  id: userId,
                  email: email.toLowerCase(),
                  role: 'client',
                  project_id
                });
              }
            }
          } catch (e) {
            console.warn("Client user auth provisioning non-fatal notice:", e.message);
          }
        } else {
          return new Response(JSON.stringify({ error: "Configuration Error: SUPABASE_SERVICE_ROLE_KEY is required to register clients." }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // 2. Insert into review_clients
        const insertPayload = {
          project_id,
          name,
          email: email.toLowerCase(),
          google_review_link,
          ai_keywords: ai_keywords || '',
          suggestion_type: suggestion_type || 'ai',
          custom_suggestions: custom_suggestions || [],
          copy_mode: copy_mode || 'auto',
          logo_url: logo_url || null
        };
        if (industry !== undefined && industry !== null) {
          insertPayload.industry = industry.trim();
        }

        let { data, error } = await supabaseAdmin
          .from('review_clients')
          .insert(insertPayload)
          .select()
          .single();

        if (error && error.code === 'PGRST204' && insertPayload.industry !== undefined) {
          console.warn("industry column not yet present in Supabase review_clients. Retrying without industry.");
          delete insertPayload.industry;
          const retry = await supabaseAdmin.from('review_clients').insert(insertPayload).select().single();
          data = retry.data;
          error = retry.error;
        }

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        await logAction(supabaseAdmin, payload.email, 'client_created', { clientId: data.id, name }, request.headers.get('CF-Connecting-IP') || '');

        return new Response(JSON.stringify(data), { 
          status: 201, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // PUT Update Client
    if (method === 'PUT') {
      try {
        const { id, name, email, google_review_link, ai_keywords, suggestion_type, custom_suggestions, copy_mode, logo_url, industry } = await request.json();

        if (!id) {
          return new Response(JSON.stringify({ error: "Client id is required." }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        if (payload.role === 'client') {
          const { data: clientRec } = await supabaseAdmin
            .from('review_clients')
            .select('email')
            .eq('id', id)
            .maybeSingle();

          if (!clientRec || clientRec.email.toLowerCase() !== (payload.email || '').toLowerCase()) {
            return new Response(JSON.stringify({ error: "Forbidden. You can only update your own organizational settings." }), { 
              status: 403, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            });
          }
        }

        const updateFields = {
          name,
          google_review_link,
          ai_keywords,
          suggestion_type,
          custom_suggestions,
          copy_mode: copy_mode || 'auto',
          logo_url
        };

        if (email) {
          updateFields.email = email.toLowerCase();
        }
        if (industry !== undefined) {
          updateFields.industry = industry ? industry.trim() : null;
        }

        let { data, error } = await supabaseAdmin
          .from('review_clients')
          .update(updateFields)
          .eq('id', id)
          .select()
          .single();

        if (error && error.code === 'PGRST204' && updateFields.industry !== undefined) {
          console.warn("industry column not yet present in Supabase review_clients. Retrying without industry.");
          delete updateFields.industry;
          const retry = await supabaseAdmin.from('review_clients').update(updateFields).eq('id', id).select().single();
          data = retry.data;
          error = retry.error;
        }

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        await logAction(supabaseAdmin, payload.email, 'client_updated', { clientId: id, name }, request.headers.get('CF-Connecting-IP') || '');

        return new Response(JSON.stringify(data), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // DELETE Client
    if (method === 'DELETE') {
      try {
        const id = url.searchParams.get('id');
        if (!id) {
          return new Response(JSON.stringify({ error: "id is required." }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // Get the client email first
        const { data: client, error: getErr } = await supabaseAdmin
          .from('review_clients')
          .select('email')
          .eq('id', id)
          .maybeSingle();

        if (!getErr && client && client.email) {
          // Delete from admins table
          await supabaseAdmin.from('admins').delete().eq('email', client.email.toLowerCase());
          
          // Delete from Supabase Auth
          if (env.SUPABASE_SERVICE_ROLE_KEY) {
            try {
              const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
              const matched = existingUsers?.users?.find(u => u.email.toLowerCase() === client.email.toLowerCase());
              if (matched) {
                await supabaseAdmin.auth.admin.deleteUser(matched.id);
              }
            } catch (e) {
              console.error("Failed to delete client auth user:", e.message);
            }
          }
        }

        const { error } = await supabaseAdmin
          .from('review_clients')
          .delete()
          .eq('id', id);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        await logAction(supabaseAdmin, payload.email, 'client_deleted', { clientId: id }, request.headers.get('CF-Connecting-IP') || '');

        return new Response(JSON.stringify({ success: true }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500, 
        });
      }
    }
  }

  // Direct Cache Update (Admin only)
  if (path === '/adminApiBlog/api/reviews/clients/cache' && method === 'PUT') {
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden. Admin privileges required." }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    try {
      const { clientId, cached_suggestions } = await request.json();
      if (!clientId) {
        return new Response(JSON.stringify({ error: "clientId is required." }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const now = new Date().toISOString();
      const cleanSuggestions = Array.isArray(cached_suggestions) ? cached_suggestions.map(s => String(s || '').trim()).filter(Boolean) : [];

      const { data, error } = await supabaseAdmin
        .from('review_clients')
        .update({
          cached_suggestions: cleanSuggestions,
          suggestions_cached_at: now
        })
        .eq('id', clientId)
        .select('id, name, cached_suggestions, suggestions_cached_at')
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      await logAction(supabaseAdmin, payload.email, 'client_cache_direct_edit', { clientId, count: cleanSuggestions.length }, request.headers.get('CF-Connecting-IP') || '');

      return new Response(JSON.stringify({ success: true, client: data }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  }

  // Regenerate Cache On-Demand (Admin only)
  if (path === '/adminApiBlog/api/reviews/clients/cache/regenerate' && method === 'POST') {
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden. Admin privileges required." }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    try {
      const { clientId } = await request.json();
      if (!clientId) {
        return new Response(JSON.stringify({ error: "clientId is required." }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const { data: client, error: fetchErr } = await supabaseAdmin
        .from('review_clients')
        .select('*')
        .eq('id', clientId)
        .single();

      if (fetchErr || !client) {
        return new Response(JSON.stringify({ error: "Client not found." }), { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      let freshExamples = await generateAISuggestions(env, supabaseAdmin, client, client.custom_suggestions || [], 20);
      let isLocal = false;
      if (!freshExamples || freshExamples.length === 0) {
        freshExamples = generateLocalSuggestions(client.name, client.ai_keywords, 20);
        isLocal = true;
      }

      const now = new Date().toISOString();
      const { data: updatedClient, error: updateErr } = await supabaseAdmin
        .from('review_clients')
        .update({
          cached_suggestions: freshExamples,
          suggestions_cached_at: now
        })
        .eq('id', clientId)
        .select('id, name, cached_suggestions, suggestions_cached_at')
        .single();

      if (updateErr) {
        return new Response(JSON.stringify({ error: updateErr.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      await logAction(supabaseAdmin, payload.email, 'client_cache_regenerated', { clientId, client_name: client.name, isLocal, count: freshExamples.length }, request.headers.get('CF-Connecting-IP') || '');

      return new Response(JSON.stringify({ success: true, isLocal, client: updatedClient }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  }

  // ==========================================
  // 3. CLIENT DASHBOARD ENDPOINT (CLIENT / ADMIN ALLOWED)
  // ==========================================
  if (path === '/adminApiBlog/api/reviews/client/dashboard' && method === 'GET') {
    try {
      let clientId = url.searchParams.get('clientId') || payload.clientId;

      // Admin fallback: If no clientId was passed, default to the first client location
      if (!clientId && (payload.role === 'admin' || payload.role === 'global' || payload.role === 'blogger')) {
        const { data: firstClient } = await supabaseAdmin
          .from('review_clients')
          .select('id')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (firstClient) clientId = firstClient.id;
      }

      // Client fallback: If no clientId was passed for a client user, lookup their matched location
      if (!clientId && payload.email) {
        const { data: userClient } = await supabaseAdmin
          .from('review_clients')
          .select('id')
          .eq('email', payload.email.toLowerCase())
          .maybeSingle();
        if (userClient) clientId = userClient.id;
      }

      // Ensure that client-role users can only request dashboards for clients that match their authorized email
      if (payload.role === 'client') {
        const { data: matchedClient } = await supabaseAdmin
          .from('review_clients')
          .select('email')
          .eq('id', clientId)
          .maybeSingle();

        if (!matchedClient || matchedClient.email.toLowerCase() !== payload.email.toLowerCase()) {
          return new Response(JSON.stringify({ error: "Forbidden. Unauthorized client location access." }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      if (!clientId) {
        return new Response(JSON.stringify({ error: "clientId is required for dashboard queries." }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Fetch client profile
      let client = null;
      let clientErr = null;
      
      let resQuery = await supabaseAdmin
        .from('review_clients')
        .select('name, email, google_review_link, ai_keywords, industry, suggestion_type, custom_suggestions, copy_mode, logo_url, google_account_id, google_location_id')
        .eq('id', clientId)
        .maybeSingle();

      if (resQuery.error) {
        console.warn("⚠️ Column fetch failed in client/dashboard (schema migration pending), executing fallback query.");
        const fallbackQuery = await supabaseAdmin
          .from('review_clients')
          .select('name, email, google_review_link, ai_keywords, suggestion_type, custom_suggestions, copy_mode')
          .eq('id', clientId)
          .maybeSingle();
          
        if (fallbackQuery.error) {
          clientErr = fallbackQuery.error;
        } else {
          client = fallbackQuery.data;
          if (client) {
            client.logo_url = null;
          }
        }
      } else {
        client = resQuery.data;
      }

      if (clientErr || !client) {
        return new Response(JSON.stringify({ error: "Client profile not found." }), { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Fetch stats and reviews
      const { data: allReviews, error: revErr } = await supabaseAdmin
        .from('reviews')
        .select('rating, status, reviewer_name, reviewer_email, comment, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (revErr) {
        return new Response(JSON.stringify({ error: revErr.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const totalSubmissions = allReviews.length;
      const averageRating = totalSubmissions > 0 
        ? parseFloat((allReviews.reduce((sum, r) => sum + r.rating, 0) / totalSubmissions).toFixed(1))
        : 0;
      
      const divertedCount = allReviews.filter(r => r.status === 'diverted').length;
      const facilitatedCount = allReviews.filter(r => r.status === 'facilitated').length;

      return new Response(JSON.stringify({
        client,
        stats: {
          total_submissions: totalSubmissions,
          average_rating: averageRating,
          diverted_count: divertedCount,
          facilitated_count: facilitatedCount
        },
        reviews: allReviews
      }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  }

  // ==========================================
  // 3b. ADMIN SYSTEM MONITORING ENDPOINT
  // ==========================================
  if (path === '/adminApiBlog/api/reviews/admin/monitoring') {
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden. Invalid permissions." }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    try {
      // Query recent logs
      const { data: recentLogs, error: logsErr } = await supabaseAdmin
        .from('audit_logs')
        .select('*')
        .in('action', ['ai_call', 'cron_run'])
        .order('created_at', { ascending: false })
        .limit(40);

      if (logsErr) throw logsErr;

      // Query total counts in last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { count: aiCallsCount, error: countAiErr } = await supabaseAdmin
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })
        .eq('action', 'ai_call')
        .gte('created_at', thirtyDaysAgo.toISOString());

      const { count: cronRunsCount, error: countCronErr } = await supabaseAdmin
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })
        .eq('action', 'cron_run')
        .gte('created_at', thirtyDaysAgo.toISOString());

      return new Response(JSON.stringify({
        recentLogs: recentLogs || [],
        aiCallsCount: aiCallsCount || 0,
        cronRunsCount: cronRunsCount || 0
      }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  }

  // ==========================================
  // 4. SHORT LINK SLUGS ENDPOINTS
  // ==========================================


  // GET, POST, DELETE Slugs Management
  if (path === '/adminApiBlog/api/reviews/clients/slugs') {
    let body = null;
    if (method === 'POST') {
      try {
        body = await request.json();
      } catch (e) {
        console.error("Failed to parse request JSON body in slugs:", e);
      }
    }

    // Determine target client ID based on request or token
    let targetClientId = url.searchParams.get('clientId');
    if (!targetClientId && body) {
      targetClientId = body.clientId;
    }
    if (!targetClientId && payload) {
      targetClientId = payload.clientId;
    }

    let isAllowed = isAdmin;

    if (!isAllowed && payload && payload.role === 'client' && targetClientId) {
      try {
        const { data: matchedClient } = await supabaseAdmin
          .from('review_clients')
          .select('email')
          .eq('id', targetClientId)
          .maybeSingle();

        if (matchedClient && matchedClient.email.toLowerCase() === payload.email.toLowerCase()) {
          isAllowed = true;
        }
      } catch (err) {
        console.error("Failed to verify client email ownership for slug:", err);
      }
    }

    if (!isAllowed || !targetClientId) {
      return new Response(JSON.stringify({ error: "Forbidden. Invalid permissions." }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // GET List Slugs
    if (method === 'GET') {
      try {
        const { data, error } = await supabaseAdmin
          .from('review_slugs')
          .select('*')
          .eq('client_id', targetClientId)
          .order('created_at', { ascending: true });

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        return new Response(JSON.stringify(data), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // POST Create Slug
    if (method === 'POST') {
      try {
        const slug = body ? body.slug : null;
        if (!slug || typeof slug !== 'string') {
          return new Response(JSON.stringify({ error: "Slug is required." }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-_]/g, '');
        if (cleanSlug.length < 3) {
          return new Response(JSON.stringify({ error: "Slug must be at least 3 characters long and contain only alphanumeric characters, hyphens or underscores." }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // 1. Check if slug is already taken
        const { data: existingSlug, error: slugCheckErr } = await supabaseAdmin
          .from('review_slugs')
          .select('id')
          .eq('slug', cleanSlug)
          .maybeSingle();

        if (slugCheckErr) {
          return new Response(JSON.stringify({ error: slugCheckErr.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        if (existingSlug) {
          return new Response(JSON.stringify({ error: "This short link is already taken. Please try another slug." }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // 2. Check if client already has 3 slugs
        const { data: currentSlugs, error: countErr } = await supabaseAdmin
          .from('review_slugs')
          .select('id')
          .eq('client_id', targetClientId);

        if (countErr) {
          return new Response(JSON.stringify({ error: countErr.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        if (currentSlugs && currentSlugs.length >= 3) {
          return new Response(JSON.stringify({ error: "Maximum of 3 shortened links allowed per project." }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // 3. Insert new slug
        const { data, error } = await supabaseAdmin
          .from('review_slugs')
          .insert({ client_id: targetClientId, slug: cleanSlug })
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        return new Response(JSON.stringify(data), { 
          status: 201, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // DELETE Slug
    if (method === 'DELETE') {
      try {
        const slug = url.searchParams.get('slug');
        if (!slug) {
          return new Response(JSON.stringify({ error: "slug parameter is required." }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const cleanSlug = slug.toLowerCase().trim();
        const { error } = await supabaseAdmin
          .from('review_slugs')
          .delete()
          .eq('client_id', targetClientId)
          .eq('slug', cleanSlug);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        return new Response(JSON.stringify({ success: true }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }
  }

  return null;
}

// ==========================================
// CRON: Suggestion Cache Refresh (every 10 min)
// ==========================================
export async function refreshSuggestionCache(env, supabaseAdmin) {
  try {
    const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
    const now = new Date();

    // Fetch all AI-mode review_clients
    const { data: clients, error } = await supabaseAdmin
      .from('review_clients')
      .select('id, name, ai_keywords, industry, suggestion_type, custom_suggestions, cached_suggestions, suggestions_cached_at, suggestions_used_at')
      .eq('suggestion_type', 'ai');

    if (error || !clients || clients.length === 0) {
      console.log('[CronCache] No AI-mode clients found or query error.');
      return;
    }

    console.log(`[CronCache] Checking suggestion cache for ${clients.length} AI clients...`);

    // Log cron run
    try {
      await supabaseAdmin.from('audit_logs').insert({
        email: 'system_cron',
        action: 'cron_run',
        details: {
          type: 'suggestion_cache_refresh',
          clients_checked: clients.length,
          timestamp: now.toISOString()
        }
      });
    } catch (logErr) {
      console.error("[CronCache] Failed to log cron run:", logErr);
    }

    for (const client of clients) {
      try {
        const cachedAt = client.suggestions_cached_at ? new Date(client.suggestions_cached_at) : null;
        const usedAt = client.suggestions_used_at ? new Date(client.suggestions_used_at) : null;
        const cacheAgeMs = cachedAt ? (now.getTime() - cachedAt.getTime()) : Infinity;
        const usedAgeMs = usedAt ? (now.getTime() - usedAt.getTime()) : Infinity;

        // Conditions that trigger regeneration:
        // 1. No cache at all
        // 2. Cache is older than 2 hours (stale)
        // 3. Cache was used recently AND is older than 30 min (submit's cooldown already handles <30 min)
        const REFRESH_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes — must match /submit cooldown
        const needsRefresh =
          !client.cached_suggestions ||
          !Array.isArray(client.cached_suggestions) ||
          client.cached_suggestions.length === 0 ||
          cacheAgeMs > CACHE_TTL_MS ||
          (usedAgeMs < 20 * 60 * 1000 && cacheAgeMs > REFRESH_COOLDOWN_MS); // used recently but cache is >30min old

        if (!needsRefresh) {
          console.log(`[CronCache] Skipping ${client.name} — cache is fresh.`);
          continue;
        }

        console.log(`[CronCache] Refreshing suggestions for: ${client.name}`);

        // Use shared AI helper to generate 20 suggestions (same logic as /submit queue replenishment)
        let freshExamples = await generateAISuggestions(env, supabaseAdmin, client, client.custom_suggestions || [], 20);

        // If AI call failed or no key, generate 20 local fallback suggestions
        if (!freshExamples || freshExamples.length === 0) {
          freshExamples = generateLocalSuggestions(client.name, client.ai_keywords, 20);
        }

        // Write fresh suggestions back to DB cache
        const { error: updateErr } = await supabaseAdmin
          .from('review_clients')
          .update({
            cached_suggestions: freshExamples,
            suggestions_cached_at: now.toISOString()
          })
          .eq('id', client.id);

        if (updateErr) {
          console.error(`[CronCache] DB update failed for ${client.name}:`, updateErr.message);
        } else {
          console.log(`[CronCache] ✅ Updated cache for ${client.name} (${freshExamples.length} suggestions)`);
        }

        // Small delay between clients to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));

      } catch (clientErr) {
        console.error(`[CronCache] Error processing ${client.name}:`, clientErr.message);
      }
    }

    console.log('[CronCache] Suggestion cache refresh complete.');
  } catch (err) {
    console.error('[CronCache] Fatal error in refreshSuggestionCache:', err.message);
  }
}
