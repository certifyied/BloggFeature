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

// Fetch Google Business locations (handling pagination to load all locations)
async function getGoogleBusinessLocations(accessToken, accountName) {
  if (!accountName) return [];
  const allLocations = [];
  let pageToken = '';
  try {
    do {
      const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title&pageSize=100` + 
        (pageToken ? `&pageToken=${pageToken}` : '');
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error(`getGoogleBusinessLocations API Error: ${errText}`);
        break;
      }
      const data = await res.json();
      if (data.locations) {
        allLocations.push(...data.locations);
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);

    return allLocations;
  } catch (e) {
    console.error(`getGoogleBusinessLocations fetch failed: ${e.message}`);
    return [];
  }
}

export async function handleGoogleOauthRequest(request, env, ctx, path, method, supabaseAdmin, corsHeaders) {
  const url = new URL(request.url);

  // 1. Redirect to Google Consent Page
  if (path === '/adminApiBlog/auth/google' && method === 'GET') {
    let clientId = url.searchParams.get('clientId') || 'login';
    if (clientId === 'null') clientId = 'login';
    const redirectUrl = url.searchParams.get('redirectUrl') || '';
    const stateStr = redirectUrl ? `${clientId}|${redirectUrl}` : clientId;

    // Direct user to Google OAuth screen including email scopes
    const scope = 'https://www.googleapis.com/auth/business.manage https://www.googleapis.com/auth/userinfo.email openid';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope,
      access_type: 'offline',
      prompt: 'consent',
      state: stateStr
    }).toString();

    return Response.redirect(authUrl, 302);
  }

  if (path === '/adminApiBlog/auth/google/callback' && method === 'GET') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state'); // Retrieve target client UUID and optionally redirectUrl passed in state

    if (!code || !state) {
      return new Response("Missing authorization code or state configuration", { status: 400 });
    }

    let clientId = state;
    let customRedirectUrl = '';

    if (state.includes('|')) {
      const parts = state.split('|');
      clientId = parts[0];
      customRedirectUrl = parts[1];
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
      // Fetch user's Google email to support email matching fallback
      let userEmail = '';
      try {
        const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (userinfoRes.ok) {
          const userinfo = await userinfoRes.json();
          userEmail = userinfo.email || '';
        }
      } catch (e) {
        console.error("Failed to fetch Google userinfo:", e.message);
      }

      let targetClientId = clientId;
      if ((!targetClientId || targetClientId === 'null' || targetClientId === 'login') && userEmail) {
        const { data: matchedClient } = await supabaseAdmin
          .from('review_clients')
          .select('id')
          .eq('email', userEmail.toLowerCase())
          .maybeSingle();
        if (matchedClient) {
          targetClientId = matchedClient.id;
          console.log(`[OAuth] Resolved client ID ${targetClientId} from authenticated email ${userEmail}`);
        }
      }

      if (!targetClientId || targetClientId === 'null' || targetClientId === 'login') {
        throw new Error(`Could not resolve client ID association from Google email. Email fetched: ${userEmail || 'none'}`);
      }

      let locationName = null;
      if (locations && locations.length > 0) {
        try {
          const { data: clientObj } = await supabaseAdmin
            .from('review_clients')
            .select('name')
            .eq('id', targetClientId)
            .maybeSingle();

          const clientNameStr = (clientObj?.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
          const clientWords = clientNameStr.split(/\s+/).filter(w => w.length > 2);

          // Try to match client name with location titles (collecting all matching locations)
          const matchedLocations = locations.filter(loc => {
            const locTitle = (loc.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
            if (locTitle.includes(clientNameStr) || clientNameStr.includes(locTitle)) {
              return true;
            }
            const locWords = locTitle.split(/\s+/);
            return clientWords.some(cw => locWords.some(lw => lw === cw || lw.includes(cw) || cw.includes(lw)));
          });

          if (matchedLocations.length > 0) {
            locationName = matchedLocations.map(loc => loc.name).join(',');
            console.log(`[OAuth] Automatically matched ${matchedLocations.length} locations (${locationName}) for client "${clientObj?.name}"`);
          }
        } catch (dbErr) {
          console.error("[OAuth] Failed to fetch client name for matching:", dbErr.message);
        }

        // Fallback to first location if no match found
        if (!locationName) {
          locationName = locations[0].name;
          console.log(`[OAuth] Fallback to first location "${locations[0].title}" (${locationName})`);
        }
      }

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
        .eq('id', targetClientId);

      if (error) {
        throw new Error(`Supabase update error: ${error.message}`);
      }

      // Redirect client back to the front-end dashboard
      let dashboardUrl = customRedirectUrl || `https://www.reviewmanager.in/dashboard`;
      try {
        const finalUrl = new URL(dashboardUrl);
        finalUrl.searchParams.set('clientId', targetClientId);
        finalUrl.searchParams.set('oauth', 'success');
        dashboardUrl = finalUrl.toString();
      } catch (e) {
        dashboardUrl = `https://www.reviewmanager.in/dashboard?clientId=${targetClientId}&oauth=success`;
      }
      return Response.redirect(dashboardUrl, 302);

    } catch (err) {
      return new Response(`Google OAuth Configuration Error: ${err.message}`, { status: 500 });
    }
  }

  return null;
}
