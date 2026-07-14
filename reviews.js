function generateLocalSuggestions(businessName, keywordsStr) {
  const keywords = (keywordsStr || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
    
  const defaultKeywords = ['excellent service', 'friendly staff', 'great support'];
  const k1 = keywords[0] || defaultKeywords[0];
  const k2 = keywords[1] || defaultKeywords[1];
  const k3 = keywords[2] || keywords[0] || defaultKeywords[2];
  const k4 = keywords[3] || keywords[1] || defaultKeywords[0];

  return [
    `Outstanding experience at ${businessName}! The entire team was incredibly professional, welcoming, and attentive. They made sure all my needs were met and their expertise in ${k1} was very impressive. Highly recommend them to anyone looking for premium service.`,
    `I am extremely satisfied with my visit to ${businessName}. The facility is clean and modern, and the staff is genuinely friendly. They took the time to explain everything and did an amazing job with ${k2}. Will definitely be returning!`,
    `From start to finish, the service at ${businessName} was top-notch. Their attention to detail and dedication to providing high-quality care is clear. If you need reliable assistance with ${k3}, this is absolutely the best place in town.`,
    `Highly recommend ${businessName}! They went above and beyond to ensure a smooth, comfortable visit. The staff's expertise in ${k4} is outstanding and the results exceeded my expectations. Thank you for the wonderful support!`
  ];
}

// Shared AI suggestion generator — used by /submit (sync and background) and cron
async function generateAISuggestions(env, client, customSuggestions = []) {
  if (!env.OPENROUTER_API_KEY) return null;

  const keywordsList = (client.ai_keywords || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  let guidanceTemplate = '';
  const actualCustomSuggestions = customSuggestions.length > 0 ? customSuggestions : (client.custom_suggestions || []);
  if (actualCustomSuggestions.length > 0) {
    const randomIndex = Math.floor(Math.random() * actualCustomSuggestions.length);
    guidanceTemplate = ` Use this user-provided example template as a reference for tone/style: "${actualCustomSuggestions[randomIndex]}".`;
  }

  // Premium detailed prompt to ensure highly personalized, detailed, and realistic reviews.
  const systemPrompt = `You are a professional local SEO copywriter and customer experience assistant helping a client write a genuine, enthusiastic, and highly detailed Google review for a business named "${client.name}".
The business has specified these high-value, SEO-targeted keywords which MUST be woven naturally and contextually into the review variations:
${keywordsList.length > 0 ? keywordsList.map(kw => `- ${kw}`).join('\n') : '- excellent service'}

${guidanceTemplate}

Generate exactly 3 to 4 distinct, premium, natural-sounding, positive (5-star) review variations.
Guidelines:
1. DO NOT make the reviews too short. Each review variation should be a detailed, rich paragraph consisting of 2 to 4 complete, well-structured sentences (between 30 to 70 words per review).
2. The reviews must feel 100% written by different real human customers. Vary their writing style, tone, and specific points of focus:
   - Variation 1: Focus heavily on the professionalism, staff quality, and specific specialized services (weaving in keywords).
   - Variation 2: Focus on the excellent customer journey, ease of booking/visit, clean premium facility, and overall peace of mind.
   - Variation 3: Focus on the long-term results, value, and a strong recommendation to friends/family.
   - Variation 4 (if generated): A comprehensive review detailing a first-class overall experience.
3. Incorporate the name "${client.name}" and the specified keywords naturally. Avoid "keyword stuffing" — the keywords should blend in seamlessly as if a real customer naturally described their experience.
4. Respond ONLY with a valid, clean JSON object containing an array of strings under the key "reviews". Example:
{
  "reviews": [
    "I had an absolutely fantastic experience at ${client.name}. The staff is highly professional and their attention to detail during my treatment was outstanding. If you are looking for top-notch care, this is definitely the place to go!",
    "Highly recommend ${client.name}! From the moment I walked in, I felt welcomed and well cared for. Their expertise is unmatched and the results speak for themselves.",
    "Very pleased with the service at ${client.name}. Clean facility, friendly environment, and excellent communication throughout my visit. Five stars all the way!"
  ]
}`;

  // Fallback models list on OpenRouter (using active, valid free models)
  const models = [
    "meta-llama/llama-3.3-70b-instruct:free", // New premium free model (highly reliable)
    "meta-llama/llama-3.2-3b-instruct:free",  // Fast, lightweight free model
    "nvidia/nemotron-3-ultra-550b-a55b:free",  // Fallback free model
    "qwen/qwen-2.5-72b-instruct:free",
    "google/gemma-2-9b-it:free"
  ];

  let responseText = null;

  for (const model of models) {
    try {
      const randomSeed = Math.floor(Math.random() * 1000000);
      const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://certifyied.com',
          'X-Title': 'Certifyied Review Funnel'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Generate positive reviews utilizing keywords: ${client.ai_keywords || ''} (Request ID: ${randomSeed})` }
          ],
          temperature: 0.85,
          seed: randomSeed,
          response_format: { type: 'json_object' }
        })
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        responseText = aiData.choices?.[0]?.message?.content;
        if (responseText) {
          console.log(`[generateAISuggestions] Successfully generated using model: ${model}`);
          break;
        }
      } else {
        console.warn(`[generateAISuggestions] Model ${model} returned status: ${aiRes.status}`);
      }
    } catch (modelErr) {
      console.error(`[generateAISuggestions] Fetch failed for model ${model}:`, modelErr.message);
    }
  }

  if (!responseText) return null;

  // Robust JSON extractor and parser
  try {
    let cleanText = responseText.trim();
    const match = cleanText.match(/\{[\s\S]*\}/);
    if (match) {
      cleanText = match[0];
    }
    const parsed = JSON.parse(cleanText);
    const result = parsed.reviews || parsed.examples || (Array.isArray(parsed) ? parsed : null);
    if (Array.isArray(result) && result.length > 0) {
      return result;
    }
  } catch (parseErr) {
    console.error(`[generateAISuggestions] JSON parsing failed for response: ${responseText.substring(0, 150)}... Error: ${parseErr.message}`);
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
      const { clientId, rating, reviewer_name, reviewer_email, comment, draft, refresh } = await request.json();

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
        // --- DB CACHE CHECK ---
        const cachedAt = client.suggestions_cached_at ? new Date(client.suggestions_cached_at) : null;
        const cacheAgeMs = cachedAt ? (Date.now() - cachedAt.getTime()) : Infinity;
        const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
        const hasFreshCache = client.cached_suggestions && Array.isArray(client.cached_suggestions) && client.cached_suggestions.length > 0 && cacheAgeMs < CACHE_TTL_MS;

        const usedAt = client.suggestions_used_at ? new Date(client.suggestions_used_at) : null;
        const usedAgeMs = usedAt ? (Date.now() - usedAt.getTime()) : Infinity;

        // If the cache was already served very recently (< 5 minutes ago) to this or another customer,
        // we bypass the cache and fetch fresh AI suggestions directly from the live API.
        // Also bypasses cache on explicit "refresh" request.
        const isCacheUsable = hasFreshCache && usedAgeMs > 5 * 60 * 1000 && !refresh;

        if (isCacheUsable) {
          // ✅ Serve from cache instantly — shuffle for variety
          examples = [...client.cached_suggestions].sort(() => 0.5 - Math.random());

          // Mark suggestions_used_at = now in background, so subsequent requests within 5 mins bypass cache
          supabaseAdmin.from('review_clients').update({
            suggestions_used_at: new Date().toISOString()
          }).eq('id', clientId).then(() => {}).catch(e => console.error('suggestions_used_at write failed:', e));

          // 🔁 Only trigger background regeneration if cache is >30 min old
          // Prevents an AI call on every single visit — cooldown guard
          const REFRESH_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
          const needsBackgroundRefresh = cacheAgeMs > REFRESH_COOLDOWN_MS;

          if (needsBackgroundRefresh) {
            // Fire-and-forget: regenerate in background
            ;(async () => {
              try {
                const freshExamples = await generateAISuggestions(env, client, customSuggestions);
                if (freshExamples && freshExamples.length > 0) {
                  await supabaseAdmin.from('review_clients').update({
                    cached_suggestions: freshExamples,
                    suggestions_cached_at: new Date().toISOString()
                  }).eq('id', clientId);
                  console.log(`[Submit] Background refresh done for ${client.name} (cache was ${Math.round(cacheAgeMs / 60000)}min old)`);
                }
              } catch (bgErr) {
                console.error(`[Submit] Background refresh failed for ${client.name}:`, bgErr.message);
              }
            })();
          } else {
            console.log(`[Submit] Cache is fresh (${Math.round(cacheAgeMs / 60000)}min old) — skipping background refresh for ${client.name}`);
          }

        } else {
          // Cache is stale, missing, force-refreshed, or recently served — generate fresh AI suggestions synchronously
          if (env.OPENROUTER_API_KEY) {
            try {
              const freshExamples = await generateAISuggestions(env, client, customSuggestions);
              if (freshExamples && freshExamples.length > 0) {
                examples = freshExamples;

                // Save fresh suggestions back to DB cache + mark used
                supabaseAdmin.from('review_clients').update({
                  cached_suggestions: examples,
                  suggestions_cached_at: new Date().toISOString(),
                  suggestions_used_at: new Date().toISOString()
                }).eq('id', clientId).then(() => {}).catch(e => console.error('Cache write failed:', e));
              } else {
                examples = generateLocalSuggestions(client.name, client.ai_keywords);
              }
            } catch (aiErr) {
              console.error("OpenRouter integration error:", aiErr);
              // Fallback to cached suggestions if available, else local generation
              if (client.cached_suggestions && client.cached_suggestions.length > 0) {
                examples = client.cached_suggestions;
              } else {
                examples = generateLocalSuggestions(client.name, client.ai_keywords);
              }
            }
          } else {
            // No API key — use local generator
            examples = generateLocalSuggestions(client.name, client.ai_keywords);
          }
        } // end cache else block
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
  const isAdmin = payload.role === 'admin' || payload.role === 'global';

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
      const email = payload.email;
      if (!email) {
        return new Response(JSON.stringify({ error: "Unauthorized. Email is required." }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data, error } = await supabaseAdmin
        .from('review_clients')
        .select('id, name, logo_url, google_review_link')
        .eq('email', email.toLowerCase());

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
        const { project_id, name, email, google_review_link, ai_keywords, suggestion_type, custom_suggestions, copy_mode, logo_url } = await request.json();

        if (!project_id || !name || !email || !google_review_link) {
          return new Response(JSON.stringify({ error: "Missing required fields (project_id, name, email, google_review_link)." }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // 1. Create client user in Auth and admins table first
        let userId = null;
        if (env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
              email: email.toLowerCase(),
              email_confirm: true,
              password: Math.random().toString(36).substring(2, 15)
            });

            if (authError) {
              if (authError.message.includes("already registered") || authError.message.includes("already exists")) {
                const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
                if (listError) throw listError;
                const matched = existingUsers.users.find(u => u.email.toLowerCase() === email.toLowerCase());
                if (matched) {
                  userId = matched.id;
                } else {
                  throw authError;
                }
              } else {
                throw authError;
              }
            } else {
              userId = authUser.user.id;
            }
            
            // Check if the user is already in the admins table
            const { data: existingAdmin } = await supabaseAdmin
              .from('admins')
              .select('id, role, project_id')
              .eq('email', email.toLowerCase())
              .maybeSingle();

            if (!existingAdmin) {
              // Insert into admins table only if they don't exist yet
              await supabaseAdmin.from('admins').insert({
                id: userId,
                email: email.toLowerCase(),
                role: 'client',
                project_id
              });
            } else if (existingAdmin.role === 'client' && !existingAdmin.project_id) {
              // Update project_id if they exist but it was null
              await supabaseAdmin.from('admins').update({ project_id }).eq('id', userId);
            }
          } catch (e) {
            return new Response(JSON.stringify({ error: "Failed to provision client user: " + e.message }), { 
              status: 500, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            });
          }
        } else {
          return new Response(JSON.stringify({ error: "Configuration Error: SUPABASE_SERVICE_ROLE_KEY is required to register clients." }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // 2. Insert into review_clients
        const { data, error } = await supabaseAdmin
          .from('review_clients')
          .insert({
            project_id,
            name,
            email: email.toLowerCase(),
            google_review_link,
            ai_keywords: ai_keywords || '',
            suggestion_type: suggestion_type || 'ai',
            custom_suggestions: custom_suggestions || [],
            copy_mode: copy_mode || 'auto',
            logo_url: logo_url || null
          })
          .select()
          .single();

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
        const { id, name, email, google_review_link, ai_keywords, suggestion_type, custom_suggestions, copy_mode, logo_url } = await request.json();

        if (!id) {
          return new Response(JSON.stringify({ error: "Client id is required." }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        if (payload.role === 'client' && payload.clientId !== id) {
          return new Response(JSON.stringify({ error: "Forbidden. You can only update your own organizational settings." }), { 
            status: 403, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
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

        const { data, error } = await supabaseAdmin
          .from('review_clients')
          .update(updateFields)
          .eq('id', id)
          .select()
          .single();

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
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }
  }

  // ==========================================
  // 3. CLIENT DASHBOARD ENDPOINT (CLIENT / ADMIN ALLOWED)
  // ==========================================
  if (path === '/adminApiBlog/api/reviews/client/dashboard' && method === 'GET') {
    try {
      let clientId = url.searchParams.get('clientId') || payload.clientId;

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
      
      const resQuery = await supabaseAdmin
        .from('review_clients')
        .select('name, email, google_review_link, ai_keywords, suggestion_type, custom_suggestions, copy_mode, logo_url, google_account_id, google_location_id')
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
  // 4. SHORT LINK SLUGS ENDPOINTS
  // ==========================================


  // GET, POST, DELETE Slugs Management
  if (path === '/adminApiBlog/api/reviews/clients/slugs') {
    // Determine target client ID based on request or token
    let targetClientId = url.searchParams.get('clientId');
    if (!targetClientId && method === 'POST') {
      try {
        const body = await request.clone().json();
        targetClientId = body.clientId;
      } catch (e) {}
    }
    if (!targetClientId) {
      targetClientId = payload.clientId;
    }

    const isAdmin = payload.role === 'admin' || payload.role === 'global';
    const isAllowed = isAdmin || (payload.role === 'client' && payload.clientId === targetClientId);

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
        const { slug } = await request.json();
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
      .select('id, name, ai_keywords, suggestion_type, custom_suggestions, cached_suggestions, suggestions_cached_at, suggestions_used_at')
      .eq('suggestion_type', 'ai');

    if (error || !clients || clients.length === 0) {
      console.log('[CronCache] No AI-mode clients found or query error.');
      return;
    }

    console.log(`[CronCache] Checking suggestion cache for ${clients.length} AI clients...`);

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

        // Use shared AI helper (same logic as /submit)
        let freshExamples = await generateAISuggestions(env, client, client.custom_suggestions || []);

        // If AI call failed or no key, generate local fallback
        if (!freshExamples || freshExamples.length === 0) {
          freshExamples = generateLocalSuggestions(client.name, client.ai_keywords);
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
