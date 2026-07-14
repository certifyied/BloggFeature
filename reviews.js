function generateLocalSuggestions(businessName, keywordsStr) {
  const keywords = (keywordsStr || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
    
  const defaultKeywords = ['excellent service', 'friendly staff', 'great quality'];
  const k1 = keywords[0] || defaultKeywords[0];
  const k2 = keywords[1] || defaultKeywords[1];
  const k3 = keywords[2] || keywords[0] || defaultKeywords[2];

  return [
    `Outstanding service at ${businessName}! The team is extremely professional and they offer ${k1}. Had a very smooth experience.`,
    `I highly recommend ${businessName}! They have ${k2} and the overall quality is top-notch. Very satisfied with my experience.`,
    `Great attention to detail and ${k3}. ${businessName} is my go-to place now, thank you for the amazing support!`
  ];
}

// Shared AI suggestion generator — used by /submit (background refresh) and cron
async function generateAISuggestions(env, client, customSuggestions = []) {
  if (!env.OPENROUTER_API_KEY) return null;
  try {
    let guidanceTemplate = '';
    if (customSuggestions.length > 0) {
      const randomIndex = Math.floor(Math.random() * customSuggestions.length);
      guidanceTemplate = ` Use this user-provided example template as a reference for tone/style: "${customSuggestions[randomIndex]}".`;
    }
    const systemPrompt = `You are an AI assistant helping a customer write a genuine, positive Google review for a business named "${client.name}". The business has specified these keywords that MUST be woven into the reviews: ${client.ai_keywords || 'excellent service'}.${guidanceTemplate} Generate exactly 3 to 4 distinct, natural-sounding, positive (5-star) review variations that naturally weave in the business name "${client.name}" and explicitly use one or more of these keywords in each variation. Make them feel written by different human customers. Critically, VARY the length of each variation: make one very short (1 sentence), one medium (2 sentences), and one more detailed (3 sentences). Respond ONLY with a valid JSON object containing an array of strings in the key "reviews". Example: {"reviews": ["variation 1", "variation 2", "variation 3"]}`;
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
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate positive reviews for: ${client.ai_keywords || ''} (Seed: ${randomSeed})` }
        ],
        temperature: 0.9,
        seed: randomSeed,
        response_format: { type: 'json_object' }
      })
    });
    if (!aiRes.ok) return null;
    const aiData = await aiRes.json();
    const text = aiData.choices?.[0]?.message?.content;
    if (!text) return null;
    const parsed = JSON.parse(text);
    return parsed.reviews || parsed.examples || (Array.isArray(parsed) ? parsed : null);
  } catch (e) {
    console.error('[generateAISuggestions] Error:', e.message);
    return null;
  }
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
      const { clientId, rating, reviewer_name, reviewer_email, comment, draft } = await request.json();

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
        .select('name, email, google_review_link, ai_keywords, suggestion_type, custom_suggestions, copy_mode, cached_suggestions, suggestions_cached_at')
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
            const apiKey = env.RESEND_API_KEY;
            if (apiKey) {
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  from: 'Review Manager <no-reply@send.certifyied.com>',
                  to: [client.email],
                  subject: `⚠️ Alert: New Negative Feedback Received for ${client.name}`,
                  html: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #334155;">
                      <h2 style="color: #ef4444; font-weight: 700; margin-top: 0; margin-bottom: 16px;">New Negative Feedback Alert</h2>
                      <p style="font-size: 15px; line-height: 1.6;">
                        Hello <strong>${client.name}</strong>,
                      </p>
                      <p style="font-size: 15px; line-height: 1.6;">
                        A customer has submitted a low rating (<strong>${rating} out of 5 stars</strong>) on your feedback funnel. Since this rating was 3 stars or below, we intercepted it and saved it internally so you can follow up with them directly.
                      </p>
                      
                      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 24px 0;">
                        <h4 style="margin: 0 0 12px; color: #1e293b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Feedback Details</h4>
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #475569;">
                          <tr>
                            <td style="padding: 4px 0; font-weight: 600; width: 120px;">Customer Name:</td>
                            <td style="padding: 4px 0;">${reviewer_name || 'Anonymous'}</td>
                          </tr>
                          <tr>
                            <td style="padding: 4px 0; font-weight: 600;">Customer Email:</td>
                            <td style="padding: 4px 0;">${reviewer_email || 'Not provided'}</td>
                          </tr>
                          <tr>
                            <td style="padding: 4px 0; font-weight: 600;">Rating:</td>
                            <td style="padding: 4px 0; color: #f59e0b;">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)</td>
                          </tr>
                          ${comment ? `
                          <tr>
                            <td style="padding: 8px 0 4px; font-weight: 600; vertical-align: top;">Comment:</td>
                            <td style="padding: 8px 0 4px; font-style: italic; color: #334155; line-height: 1.5;">"${comment}"</td>
                          </tr>
                          ` : ''}
                        </table>
                      </div>

                       <p style="font-size: 15px; line-height: 1.6;">
                        We recommend reaching out to this customer as soon as possible to resolve their concerns and prevent any negative public reviews.
                      </p>

                      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                      <div style="text-align: center;">
                        <img src="https://www.reviewmanager.in/favicon.ico" alt="Review Manager Logo" style="height: 32px; width: auto; margin-bottom: 8px;" />
                        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                          This is an automated notification from Review Manager.
                        </p>
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

        if (hasFreshCache) {
          // ✅ Serve from cache instantly — shuffle for variety
          examples = [...client.cached_suggestions].sort(() => 0.5 - Math.random());

          // 🔁 Only trigger background regeneration if cache is >30 min old
          // Prevents an AI call on every single visit — cooldown guard
          const REFRESH_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
          const needsBackgroundRefresh = cacheAgeMs > REFRESH_COOLDOWN_MS;

          if (needsBackgroundRefresh) {
            // Mark as used so cron knows context
            supabaseAdmin.from('review_clients').update({
              suggestions_used_at: new Date().toISOString()
            }).eq('id', clientId).catch(e => console.error('suggestions_used_at write failed:', e));

            // Fire-and-forget: regenerate in background
            ;(async () => {
              try {
                const freshExamples = await generateAISuggestions(env, client);
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
          // Cache is stale or missing — generate fresh AI suggestions synchronously
          if (env.OPENROUTER_API_KEY) {
          // Call OpenRouter API if API key exists
          try {
            let guidanceTemplate = "";
            if (customSuggestions.length > 0) {
              const randomIndex = Math.floor(Math.random() * customSuggestions.length);
              guidanceTemplate = ` Use this user-provided example template as a reference for tone/style: "${customSuggestions[randomIndex]}".`;
            }
            
            const systemPrompt = `You are an AI assistant helping a customer write a genuine, positive Google review for a business named "${client.name}". The business has specified these keywords that MUST be woven into the reviews: ${client.ai_keywords || 'excellent service'}.${guidanceTemplate} Generate exactly 3 to 4 distinct, natural-sounding, positive (5-star) review variations that naturally weave in the business name "${client.name}" and explicitly use one or more of these keywords in each variation. Make them feel written by different human customers. Critically, VARY the length of each variation: make one very short (1 sentence), one medium (2 sentences), and one more detailed (3 sentences). Vary the tone and length styles so they are not the same size. Respond ONLY with a valid JSON object containing an array of strings in the key "reviews". Example: {"reviews": ["variation 1", "variation 2", "variation 3"]}`;

             // Generate a random seed/salt to prevent OpenRouter/provider response caching
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
                model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
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
              const responseText = aiData.choices?.[0]?.message?.content;
              if (responseText) {
                const parsed = JSON.parse(responseText);
                if (parsed.reviews && Array.isArray(parsed.reviews)) {
                  examples = parsed.reviews;
                } else if (parsed.examples && Array.isArray(parsed.examples)) {
                  examples = parsed.examples;
                } else if (Array.isArray(parsed)) {
                  examples = parsed;
                }
              }
            }

            // Save fresh suggestions back to DB cache + mark used
            if (examples.length > 0) {
              supabaseAdmin.from('review_clients').update({
                cached_suggestions: examples,
                suggestions_cached_at: new Date().toISOString(),
                suggestions_used_at: new Date().toISOString()
              }).eq('id', clientId).then(() => {}).catch(e => console.error('Cache write failed:', e));
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
