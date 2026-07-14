/**
 * autoreply.js
 * Handles review fetch automation, auto-reply drafting via NVIDIA Nemotron 3 Ultra, and publishing replies via Google Business API.
 */

import { refreshAccessToken } from './google_oauth.js';

// Auto draft reviews using OpenRouter NVIDIA Nemotron
async function draftReviewReply(env, businessName, reviewerName, rating, reviewText, keywordsStr) {
  const keywordSection = keywordsStr ? ` If writing a positive reply, try to naturally highlight or align with these key qualities: "${keywordsStr}".` : "";

  const prompt = `You are a professional customer relations assistant writing replies to Google reviews for the business "${businessName}". 
Reviewer: ${reviewerName}
Rating: ${rating} Stars
Review comment: "${reviewText || 'No comments left.'}"
${keywordSection}

Generate a short, friendly, professional reply to this customer (1 to 3 sentences). If the review is positive (4 or 5 stars), express appreciation. If the review is critical (3 stars or below), express empathy, offer apology, and invite them to reach out directly to resolve the matter. Keep the reply clean. Respond with ONLY the reply text, no introductory lines, notes, or quotes.`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://www.certifyied.com",
        "X-Title": "Certifyied Auto-Reply API"
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) {
      const errTxt = await res.text();
      console.error(`OpenRouter Error Response: Status ${res.status} - ${errTxt}`);
      return `Thank you for your feedback! We appreciate you taking the time to share your experience. (API Error: ${res.status})`;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "Thank you for your review!";
  } catch (err) {
    console.error(`draftReviewReply failed: ${err.message}`);
    return `Thank you for your feedback! We appreciate you sharing your experience with us. (Exception: ${err.message})`;
  }
}

// Fetch active access token (Refresh if expired)
async function getOrRefreshClientToken(client, env, supabaseAdmin) {
  const expiresAt = new Date(client.google_oauth_token_expires_at).getTime();
  // If token is still valid for the next 2 minutes, return it
  if (expiresAt > Date.now() + 120000) {
    return client.google_oauth_access_token;
  }

  // Refresh token required
  if (!client.google_oauth_refresh_token) {
    throw new Error(`Refresh token missing for client ${client.id}. Client must re-authorize.`);
  }

  const refreshData = await refreshAccessToken(client.google_oauth_refresh_token, env);
  const newAccessToken = refreshData.access_token;
  const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

  // Update back to Supabase
  await supabaseAdmin
    .from('review_clients')
    .update({
      google_oauth_access_token: newAccessToken,
      google_oauth_token_expires_at: newExpiresAt
    })
    .eq('id', client.id);

  return newAccessToken;
}

// Publish reply back to Google Business API
async function postReplyToGoogle(accessToken, locationId, reviewId, replyText) {
  // Endpoints: v1/accounts/{accountId}/locations/{locationId}/reviews/{reviewId}/reply
  const url = `https://mybusinessreviews.googleapis.com/v1/${locationId}/reviews/${reviewId}/reply`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ comment: replyText })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Review Reply API Error: ${errText}`);
  }
  return await res.json();
}

// Fetch latest reviews from Google My Business
async function fetchGoogleReviews(accessToken, locationId) {
  const url = `https://mybusinessreviews.googleapis.com/v1/${locationId}/reviews`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.reviews || [];
}

export async function handleAutoReplyRequest(request, env, ctx, path, method, supabaseAdmin, corsHeaders, url) {
  // Test Review Simulator Endpoint
  if (path === '/adminApiBlog/api/reviews/simulate-reply' && method === 'POST') {
    try {
      const { clientId, reviewerName, rating, comment } = await request.json();
      if (!clientId) {
        return new Response(JSON.stringify({ error: "clientId is required" }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: client, error } = await supabaseAdmin
        .from('review_clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle();

      if (error || !client) {
        return new Response(JSON.stringify({ error: "Client not found" }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Generate response using identical Nemotron drafting engine
      const replyText = await draftReviewReply(
        env,
        client.name,
        reviewerName || 'Valued Customer',
        parseInt(rating) || 5,
        comment || '',
        client.ai_keywords
      );

      return new Response(JSON.stringify({ success: true, replyText }), {
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

  // Webhook or Trigger Endpoint to initiate automation
  if (path === '/adminApiBlog/api/reviews/sync-and-reply' && method === 'POST') {
    const { clientId } = await request.json();
    if (!clientId) {
      return new Response(JSON.stringify({ error: "clientId is required" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      // 1. Fetch client credentials from DB
      const { data: client, error } = await supabaseAdmin
        .from('review_clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle();

      if (error || !client || !client.google_location_id) {
        return new Response(JSON.stringify({ error: "Client not configured for Google OAuth" }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 2. Fetch or refresh the Google OAuth Token
      const accessToken = await getOrRefreshClientToken(client, env, supabaseAdmin);

      // 3. Fetch reviews from Google My Business Profile
      const reviews = await fetchGoogleReviews(accessToken, client.google_location_id);
      const actionLog = [];

      // 4. Process each review
      for (const review of reviews) {
        const reviewId = review.reviewId;
        
        // Skip if review already has an owner response
        if (review.reviewReply) continue;

        const ratingVal = review.starRating; // e.g. "FIVE", "FOUR"
        let stars = 5;
        if (ratingVal === 'ONE') stars = 1;
        else if (ratingVal === 'TWO') stars = 2;
        else if (ratingVal === 'THREE') stars = 3;
        else if (ratingVal === 'FOUR') stars = 4;

        const reviewerName = review.reviewer?.displayName || 'Valued Customer';
        const reviewComment = review.comment || '';

        // Generate response using Nemotron
        const replyText = await draftReviewReply(env, client.name, reviewerName, stars, reviewComment, client.ai_keywords);

        // Submit reply to Google Review Profile
        await postReplyToGoogle(accessToken, client.google_location_id, reviewId, replyText);

        // Log results
        actionLog.push({ reviewId, reviewerName, stars, replyText });
      }

      return new Response(JSON.stringify({ success: true, processedReviews: actionLog }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed auto-reply process", message: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // 1b. Setup Notification settings admin API to register pub/sub topic with Google GMB
  if (path === '/adminApiBlog/api/reviews/setup-notifications' && method === 'GET') {
    const clientId = url.searchParams.get('clientId');
    if (!clientId) {
      return new Response(JSON.stringify({ error: "clientId is required" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      const { data: client, error } = await supabaseAdmin
        .from('review_clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle();

      if (error || !client || !client.google_account_id) {
        return new Response(JSON.stringify({ error: "Client credentials not connected or missing google_account_id." }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const accessToken = await getOrRefreshClientToken(client, env, supabaseAdmin);
      
      // Call Google My Business API to configure Pub/Sub notificationSettings
      const setupUrl = `https://mybusinessaccountmanagement.googleapis.com/v1/${client.google_account_id}/notificationSetting`;
      const googleRes = await fetch(setupUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          notificationSetting: {
            pubsubTopic: "projects/review-manager-oauth/topics/gmb-reviews",
            notificationTypes: ["NEW_REVIEW", "UPDATED_REVIEW"]
          }
        })
      });

      const resText = await googleRes.text();
      if (!googleRes.ok) {
        throw new Error(`Google API responded with error: ${resText}`);
      }

      return new Response(JSON.stringify({ success: true, message: "Google My Business Notifications successfully registered!", details: JSON.parse(resText) }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to configure GMB notifications", message: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // 2. Google Business Profile Pub/Sub Webhook Notification Receiver
  if (path === '/adminApiBlog/api/reviews/google-webhook' && method === 'POST') {
    try {
      const payloadBody = await request.json();
      
      // Decrypt Google Cloud Pub/Sub base64 envelope data
      // Google sends notifications in envelope format: { message: { data: "base64String", messageId: "xxx" } }
      if (!payloadBody.message || !payloadBody.message.data) {
        return new Response("Invalid Pub/Sub envelope format", { status: 400 });
      }

      const decodedString = atob(payloadBody.message.data);
      const googleNotification = JSON.parse(decodedString);
      
      // Google Notification payload format:
      // {
      //   "name": "accounts/{accountId}/locations/{locationId}/reviews/{reviewId}",
      //   "eventType": "NEW_REVIEW"
      // }
      const resourceName = googleNotification.name;
      const eventType = googleNotification.eventType;

      // We only auto-reply to new review events
      if (eventType !== 'NEW_REVIEW' || !resourceName) {
        return new Response(JSON.stringify({ success: true, message: "Ignored event type" }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Parse Location ID to match with a client in our database
      // resourceName format: accounts/{accountId}/locations/{locationId}/reviews/{reviewId}
      const parts = resourceName.split('/');
      const locationId = `accounts/${parts[1]}/locations/${parts[3]}`;
      const reviewId = parts[5];

      // Retrieve client row by google_location_id
      const { data: client, error } = await supabaseAdmin
        .from('review_clients')
        .select('*')
        .eq('google_location_id', locationId)
        .maybeSingle();

      if (error || !client) {
        console.warn(`Webhook: Location ID ${locationId} not found in DB.`);
        return new Response(JSON.stringify({ error: "Client not found for location" }), { status: 404 });
      }

      // Fetch or refresh authorization tokens
      const accessToken = await getOrRefreshClientToken(client, env, supabaseAdmin);

      // Fetch the individual review details from Google API
      const reviewUrl = `https://mybusinessreviews.googleapis.com/v1/${resourceName}`;
      const reviewRes = await fetch(reviewUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!reviewRes.ok) {
        throw new Error(`Failed to fetch review details from Google: ${await reviewRes.text()}`);
      }

      const review = await reviewRes.json();
      if (review.reviewReply) {
        return new Response(JSON.stringify({ success: true, message: "Review already replied to" }), { status: 200 });
      }

      const ratingVal = review.starRating;
      let stars = 5;
      if (ratingVal === 'ONE') stars = 1;
      else if (ratingVal === 'TWO') stars = 2;
      else if (ratingVal === 'THREE') stars = 3;
      else if (ratingVal === 'FOUR') stars = 4;

      const reviewerName = review.reviewer?.displayName || 'Valued Customer';
      const reviewComment = review.comment || '';

      // Draft reply via Nemotron
      const replyText = await draftReviewReply(env, client.name, reviewerName, stars, reviewComment, client.ai_keywords);

      // Post the reply back to Google My Business API
      await postReplyToGoogle(accessToken, locationId, reviewId, replyText);
      console.log(`Webhook auto-reply succeeded for review: ${reviewId} (Client: ${client.name})`);

      return new Response(JSON.stringify({ success: true, reviewId, replyText }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (err) {
      console.error("Webhook processing failed:", err.message);
      return new Response(JSON.stringify({ error: "Webhook error", details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  return null;
}

// Scheduled Cron processor for all clients
export async function scheduledSyncAllClients(env, supabaseAdmin) {
  try {
    // 1. Get all clients that have completed Google OAuth connection
    const { data: clients, error } = await supabaseAdmin
      .from('review_clients')
      .select('*')
      .not('google_location_id', 'is', null);

    if (error || !clients || clients.length === 0) {
      console.log('No clients configured for Google OAuth sync.');
      return;
    }

    console.log(`Cron: Starting auto-reply sync for ${clients.length} clients...`);

    // 2. Loop and process sync for each client
    for (const client of clients) {
      try {
        const accessToken = await getOrRefreshClientToken(client, env, supabaseAdmin);
        const reviews = await fetchGoogleReviews(accessToken, client.google_location_id);

        for (const review of reviews) {
          if (review.reviewReply) continue; // Already replied

          const ratingVal = review.starRating;
          let stars = 5;
          if (ratingVal === 'ONE') stars = 1;
          else if (ratingVal === 'TWO') stars = 2;
          else if (ratingVal === 'THREE') stars = 3;
          else if (ratingVal === 'FOUR') stars = 4;

          const reviewerName = review.reviewer?.displayName || 'Valued Customer';
          const reviewComment = review.comment || '';

          const replyText = await draftReviewReply(env, client.name, reviewerName, stars, reviewComment, client.ai_keywords);
          await postReplyToGoogle(accessToken, client.google_location_id, review.reviewId, replyText);
          console.log(`Successfully auto-replied to review ${review.reviewId} for client: ${client.name}`);
        }
      } catch (clientErr) {
        console.error(`Error processing sync for client ${client.name}:`, clientErr.message);
      }
    }
  } catch (err) {
    console.error('Scheduled Cron Error:', err.message);
  }
}
