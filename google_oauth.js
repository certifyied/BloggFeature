/**
 * google_oauth.js
 * Handles secure Google OAuth flow for review_clients to enable auto-reviews and replies.
 */

// Helper to exchange code for tokens
async function exchangeCodeForTokens(code, env) {
  const params = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
    access_type: 'offline',
    prompt: 'consent'
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to exchange authorization code: ${errorBody}`);
  }

  return await res.json();
}

// Helper to refresh access token using the refresh token
export async function refreshAccessToken(refreshToken, env) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to refresh access token: ${errorBody}`);
  }

  return await res.json();
}

// Fetch Google Business accounts
async function getGoogleBusinessAccount(accessToken) {
  try {
    const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const errText = await res.text();
    console.log(`getGoogleBusinessAccount response status: ${res.status}`);
    console.log(`getGoogleBusinessAccount raw output: ${errText}`);
    
    if (!res.ok) {
      console.error(`getGoogleBusinessAccount API error: Status ${res.status} - ${errText}`);
      return null;
    }
    const data = JSON.parse(errText);
    return data.accounts?.[0]?.name || null;
  } catch (e) {
    console.error(`getGoogleBusinessAccount fetch failed: ${e.message}`);
    return null;
  }
}

// Fetch Google Business location list
async function getGoogleBusinessLocations(accessToken, accountName) {
  if (!accountName) return [];
  try {
    const res = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const errText = await res.text();
    console.log(`getGoogleBusinessLocations response status: ${res.status}`);
    console.log(`getGoogleBusinessLocations raw output: ${errText}`);

    if (!res.ok) {
      console.error(`getGoogleBusinessLocations API error: Status ${res.status} - ${errText}`);
      return [];
    }
    const data = JSON.parse(errText);
    return data.locations || [];
  } catch (e) {
    console.error(`getGoogleBusinessLocations fetch failed: ${e.message}`);
    return [];
  }
}

export async function handleGoogleOauthRequest(request, env, ctx, path, method, supabaseAdmin, corsHeaders) {
  const url = new URL(request.url);

  // 1. Redirect to Google Consent Page
  if (path === '/adminApiBlog/auth/google' && method === 'GET') {
    const clientId = url.searchParams.get('clientId');
    if (!clientId) {
      return new Response(JSON.stringify({ error: "clientId parameter is required" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Direct user to Google OAuth screen
    // We pass clientId in the state query parameter so we know who authorized on callback redirect
    const scope = 'https://www.googleapis.com/auth/business.manage';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope,
      access_type: 'offline',
      prompt: 'consent',
      state: clientId
    }).toString();

    return Response.redirect(authUrl, 302);
  }

  // 2. OAuth Callback landing page redirect
  if (path === '/adminApiBlog/auth/google/callback' && method === 'GET') {
    const code = url.searchParams.get('code');
    const clientId = url.searchParams.get('state'); // Retrieve target client UUID passed in redirect state

    if (!code || !clientId) {
      return new Response("Missing authorization code or state configuration", { status: 400 });
    }

    try {
      // Exchange Code for Access & Refresh tokens
      const tokenData = await exchangeCodeForTokens(code, env);
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      // Retrieve account ID and location ID automatically
      const accountName = await getGoogleBusinessAccount(accessToken);
      const locations = await getGoogleBusinessLocations(accessToken, accountName);
      const locationName = locations?.[0]?.name || null; // e.g., accounts/{accountId}/locations/{locationId}

      // Save tokens back to matching review_clients row in Supabase
      const { error } = await supabaseAdmin
        .from('review_clients')
        .update({
          google_oauth_access_token: accessToken,
          google_oauth_refresh_token: refreshToken || null, // Will only return on initial consent
          google_oauth_token_expires_at: expiresAt,
          google_account_id: accountName,
          google_location_id: locationName
        })
        .eq('id', clientId);

      if (error) {
        throw new Error(`Supabase update error: ${error.message}`);
      }

      // Redirect client back to the front-end dashboard
      const dashboardUrl = `https://www.reviewmanager.in/dashboard?clientId=${clientId}&oauth=success`;
      return Response.redirect(dashboardUrl, 302);

    } catch (err) {
      return new Response(`Google OAuth Configuration Error: ${err.message}`, { status: 500 });
    }
  }

  return null;
}
