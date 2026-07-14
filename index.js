import { createClient } from '@supabase/supabase-js';
import { handleAuthRequest, verifyJWT } from './auth.js';
import { handleBlogRequest } from './blogs.js';
import { handleReviewRequest, refreshSuggestionCache } from './reviews.js';
import { handleAiRequest } from './ai.js';
import { handleGoogleOauthRequest } from './google_oauth.js';
import { handleAutoReplyRequest, scheduledSyncAllClients } from './autoreply.js';

// System Audit Logs Helper
async function logAction(supabaseAdmin, email, action, details = {}, ip = '') {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      email: email ? email.toLowerCase() : 'anonymous',
      action,
      details,
      ip_address: ip
    });

    // Automate cleaning: if rows > 10,000, remove oldest 5,000
    const { count, error: countErr } = await supabaseAdmin
      .from('audit_logs')
      .select('*', { count: 'exact', head: true });

    if (!countErr && count > 10000) {
      const { data: logs, error: selectErr } = await supabaseAdmin
        .from('audit_logs')
        .select('created_at')
        .order('created_at', { ascending: true })
        .range(4999, 4999)
        .maybeSingle();

      if (!selectErr && logs && logs.created_at) {
        await supabaseAdmin
          .from('audit_logs')
          .delete()
          .lte('created_at', logs.created_at);
      }
    }
  } catch (err) {
    console.error("Error logging action:", err);
  }
}

export default {
  async scheduled(event, env, ctx) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });
    const supabaseAdmin = env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
      : supabase;

    ctx.waitUntil(Promise.all([
      scheduledSyncAllClients(env, supabaseAdmin),
      refreshSuggestionCache(env, supabaseAdmin)
    ]));
  },

  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response('OK', { headers: corsHeaders });
    }

    const url = new URL(request.url);
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    // Initialize Supabase Clients
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });

    const supabaseAdmin = env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
      : supabase;

    // --- JWT Authentication Barrier ---
    let payload = null;
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      payload = await verifyJWT(env, token);
    }

    const method = request.method;

    // 1. Dispatch Auth requests
    if (path.startsWith('/adminApiBlog/auth')) {
      const googleOauthRes = await handleGoogleOauthRequest(request, env, ctx, path, method, supabaseAdmin, corsHeaders);
      if (googleOauthRes) return googleOauthRes;

      const authRes = await handleAuthRequest(request, env, ctx, path, method, supabaseAdmin, corsHeaders, logAction);
      if (authRes) return authRes;
    }

    // 2. Dispatch Review requests
    if (path.startsWith('/adminApiBlog/api/reviews')) {
      const autoReplyRes = await handleAutoReplyRequest(request, env, ctx, path, method, supabaseAdmin, corsHeaders, url);
      if (autoReplyRes) return autoReplyRes;

      const reviewRes = await handleReviewRequest(request, env, ctx, path, method, url, payload, supabaseAdmin, corsHeaders, logAction);
      if (reviewRes) return reviewRes;
    }

    // 2b. Dispatch AI requests
    if (path.startsWith('/adminApiBlog/api/ai')) {
      const aiRes = await handleAiRequest(request, env, ctx, path, method, payload, corsHeaders);
      if (aiRes) return aiRes;
    }

    // 3. Dispatch Blog requests
    const blogRes = await handleBlogRequest(request, env, ctx, path, method, url, payload, supabaseAdmin, supabase, corsHeaders, logAction);
    if (blogRes) return blogRes;

    // 4. Default 404 response
    return new Response(JSON.stringify({ error: "Endpoint not found." }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
