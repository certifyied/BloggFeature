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
        .select('name, google_review_link, ai_keywords, suggestion_type, custom_suggestions, copy_mode')
        .eq('id', clientId)
        .maybeSingle();

      if (resQuery.error) {
        console.warn("⚠️ Column fetch failed (schema migration pending), executing fallback query.");
        const fallbackQuery = await supabaseAdmin
          .from('review_clients')
          .select('name, google_review_link, ai_keywords')
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

      if (suggestionType === 'custom' && customSuggestions.length > 0) {
        examples = customSuggestions;
      } else if (suggestionType === 'ai') {
        if (env.OPENROUTER_API_KEY) {
          // Call OpenRouter API if API key exists
          try {
            const systemPrompt = `You are an AI assistant helping a customer write a genuine, positive Google review for a business named "${client.name}". The business has specified these keywords to emphasize: ${client.ai_keywords || 'excellent service'}. Generate exactly 3 to 4 distinct, natural-sounding, positive (5-star) review variations (2 to 4 sentences each) that naturally weave in the business name "${client.name}" and some of these keywords. Make them feel written by different human customers (varying style, length, and tone). Respond ONLY with a valid JSON object containing an array of strings in the key "reviews". Example: {"reviews": ["variation 1", "variation 2", "variation 3"]}`;

            const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'https://certifyied.com',
                'X-Title': 'Certifyied Review Funnel'
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: `Generate positive reviews utilizing keywords: ${client.ai_keywords}` }
                ],
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
          } catch (aiErr) {
            console.error("OpenRouter integration error:", aiErr);
            // Fallback to local keyword suggestions on API error
            examples = generateLocalSuggestions(client.name, client.ai_keywords);
          }
        } else {
          // If no API key is set up, dynamically generate customized keyword variations locally (zero cost)
          examples = generateLocalSuggestions(client.name, client.ai_keywords);
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
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden. Admin privileges required." }), { 
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

  if (path === '/adminApiBlog/api/reviews/clients') {
    if (!isAdmin) {
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
            
            // Insert/Upsert into admins table
            await supabaseAdmin.from('admins').upsert({
              id: userId,
              email: email.toLowerCase(),
              role: 'client',
              project_id
            });
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

        const { data, error } = await supabaseAdmin
          .from('review_clients')
          .update({
            name,
            email: email ? email.toLowerCase() : undefined,
            google_review_link,
            ai_keywords,
            suggestion_type,
            custom_suggestions,
            copy_mode: copy_mode || 'auto',
            logo_url
          })
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
      let clientId = payload.clientId;

      // If admin requests dashboard for a specific client
      if (payload.role === 'admin' || payload.role === 'global') {
        clientId = url.searchParams.get('clientId');
      }

      if (!clientId) {
        return new Response(JSON.stringify({ error: "clientId is required for dashboard queries." }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Fetch client profile
      const { data: client, error: clientErr } = await supabaseAdmin
        .from('review_clients')
        .select('name, email, google_review_link, ai_keywords, logo_url')
        .eq('id', clientId)
        .maybeSingle();

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

  return null;
}
