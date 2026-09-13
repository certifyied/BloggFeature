/**
 * autoreply.js
 * Handles review fetch automation, auto-reply drafting via NVIDIA Nemotron 3 Ultra, and publishing replies via Google Business API.
 */

import { refreshAccessToken } from './google_oauth.js';

// Auto draft reviews using OpenRouter NVIDIA Nemotron
async function draftReviewReply(env, businessName, reviewerName, rating, reviewText, keywordsStr) {
  const prompt = `You are a warm, friendly customer relations manager replying to a review for the business "${businessName}".
Reviewer: ${reviewerName}
Rating: ${rating} Stars
Review comment: "${reviewText || 'No comments left.'}"
Keywords to select from: "${keywordsStr || ''}"

Write a creative, warm, and casual reply.
Crucial rules:
1. Keep the reply very short and sweet (exactly 1 to 2 short sentences).
2. Weave in a maximum of 1 or 2 keywords from the list above. Do not force them, and do not include more than 2 keywords.
3. Do not repeat what the reviewer said in their comment. Be creative and write from the perspective of being extremely grateful to the customer because their support and feedback helps your business grow and succeed.
4. Make it sound highly conversational, natural, and friendly (like a real human typing a friendly casual message).
5. Use normal, basic punctuation marks (such as periods and commas) to make it readable and professional.
6. Respond with ONLY the reply text. Do not include any introductory lines, signatures, or metadata.`;

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
      return `Thank you for your feedback! We appreciate you taking the time to share your experience.`;
    }
    const data = await res.json();
    const rawReply = data.choices?.[0]?.message?.content || "Thank you so much for the feedback.";
    return rawReply.trim();
  } catch (err) {
    console.error(`draftReviewReply failed: ${err.message}`);
    return `Thank you for your feedback! We appreciate you sharing your experience with us.`;
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
async function postReplyToGoogle(accessToken, reviewName, replyText) {
  const url = `https://mybusiness.googleapis.com/v4/${reviewName}/reply`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ comment: replyText })
  });

  console.log(res, 'here from the res of the shit from api ')

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Review Reply API Error: ${errText}`);
  }
  return await res.json();
}

// Fetch latest reviews from Google My Business (supports comma-separated multiple locations)
async function fetchGoogleReviews(accessToken, accountId, locationId) {
  if (!locationId) return [];
  const locIds = locationId.split(',');
  const allReviews = [];

  for (const locId of locIds) {
    const trimmedLoc = locId.trim();
    const path = accountId ? `${accountId}/${trimmedLoc}` : trimmedLoc;
    const url = `https://mybusiness.googleapis.com/v4/${path}/reviews`;
    
    console.log(`[Google Reviews API] Fetching reviews from URL: ${url}`);
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`fetchGoogleReviews failed for ${trimmedLoc}: ${res.status} - ${errText}`);
      continue;
    }

    const data = await res.json();
    if (data.reviews) {
      allReviews.push(...data.reviews);
    }
  }

  console.log(`\n--- FETCHED REVIEWS SUMMARY ---`);
  console.log(`Total Reviews Fetched: ${allReviews.length}`);
  console.log(JSON.stringify(allReviews.map(r => ({
    reviewer: r.reviewer?.displayName,
    comment: r.comment,
    createTime: r.createTime
  })), null, 2));
  console.log(`--------------------------------\n`);

  return allReviews;
}

export async function handleAutoReplyRequest(request, env, ctx, path, method, supabaseAdmin, corsHeaders, url, payload) {
  // Test Review Simulator Endpoint
  if (path === '/adminApiBlog/api/reviews/simulate-reply' && method === 'POST') {
    try {
      const { clientId, reviewerName, rating, comment } = await request.json();
      let targetClientId = clientId;
      if (!targetClientId && payload && payload.projectId) {
        const { data: projectClients } = await supabaseAdmin
          .from('review_clients')
          .select('id')
          .eq('project_id', payload.projectId)
          .limit(1);
        if (projectClients && projectClients.length > 0) {
          targetClientId = projectClients[0].id;
        }
      }

      if (!targetClientId) {
        return new Response(JSON.stringify({ error: "clientId is required" }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: client, error } = await supabaseAdmin
        .from('review_clients')
        .select('*')
        .eq('id', targetClientId)
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
    let clientId = null;
    try {
      const body = await request.json();
      clientId = body?.clientId || null;
    } catch (e) {
      console.warn("Failed to parse request JSON body:", e.message);
    }

    let targetClientId = clientId;

    // Fallback: If clientId is missing but we have an authorized projectId from the JWT token
    if (!targetClientId && payload && payload.projectId) {
      const { data: projectClients } = await supabaseAdmin
        .from('review_clients')
        .select('id')
        .eq('project_id', payload.projectId)
        .limit(1);

      if (projectClients && projectClients.length > 0) {
        targetClientId = projectClients[0].id;
      }
    }

    if (!targetClientId) {
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
        .eq('id', targetClientId)
        .maybeSingle();
      console.log(client, error)
      if (error || !client || !client.google_location_id) {
        return new Response(JSON.stringify({ error: "Client not configured for Google OAuth" }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 2. Fetch or refresh the Google OAuth Token
      const accessToken = await getOrRefreshClientToken(client, env, supabaseAdmin);

      // 3. Fetch reviews from Google My Business Profile
      const reviews = await fetchGoogleReviews(accessToken, client.google_account_id, client.google_location_id);
      const actionLog = [];

      // 4. Process each review
      for (const review of reviews) {
        const reviewId = review.reviewId;

        // Skip if review already has an owner response
        if (review.reviewReply) {
          continue;
        }

        // Filter: Only reply to reviews created within the last 4 days
        const reviewDate = new Date(review.createTime || review.updateTime);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 4); // 4 days ago
        if (reviewDate < cutoffDate) {
          continue;
        }

        const ratingVal = review.starRating; // e.g. "FIVE", "FOUR"
        let stars = 5;
        if (ratingVal === 'ONE') stars = 1;
        else if (ratingVal === 'TWO') stars = 2;
        else if (ratingVal === 'THREE') stars = 3;
        else if (ratingVal === 'FOUR') stars = 4;

        const reviewerName = review.reviewer?.displayName || 'Valued Customer';
        const reviewComment = review.comment || '';

        console.log(`\n========================================`);
        console.log(`ELIGIBLE REVIEW FOR REPLY:`);
        console.log(`Reviewer: ${reviewerName}`);
        console.log(`Rating: ${stars} Stars`);
        console.log(`Comment: "${reviewComment}"`);
        console.log(`========================================\n`);

        // Generate response using Nemotron (or use white heart emoji if no comment)
        const replyText = !reviewComment.trim() ? "🤍" : await draftReviewReply(env, client.name, reviewerName, stars, reviewComment, client.ai_keywords);

        // Submit reply to Google Review Profile
        await postReplyToGoogle(accessToken, review.name, replyText);
        console.log(`Successfully replied to review ${reviewId} (${reviewerName}) with: "${replyText}"`);

        // Log results
        actionLog.push({ reviewId, reviewerName, stars, replyText, status: 'replied_live' });
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
        const reviews = await fetchGoogleReviews(accessToken, client.google_account_id, client.google_location_id);

        for (const review of reviews) {
          if (review.reviewReply) {
            console.log(`Cron: Skipping review ${review.reviewId} (already has reply)`);
            continue; // Already replied
          }

          // Filter: Only reply to reviews created within the last 4 days
          const reviewDate = new Date(review.createTime || review.updateTime);
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - 4); // 4 days ago
          if (reviewDate < cutoffDate) {
            continue;
          }

          const ratingVal = review.starRating;
          let stars = 5;
          if (ratingVal === 'ONE') stars = 1;
          else if (ratingVal === 'TWO') stars = 2;
          else if (ratingVal === 'THREE') stars = 3;
          else if (ratingVal === 'FOUR') stars = 4;

          const reviewerName = review.reviewer?.displayName || 'Valued Customer';
          const reviewComment = review.comment || '';

          // Generate response using Nemotron (or use white heart emoji if no comment)
          const replyText = !reviewComment.trim() ? "🤍" : await draftReviewReply(env, client.name, reviewerName, stars, reviewComment, client.ai_keywords);
          await postReplyToGoogle(accessToken, review.name, replyText);
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
