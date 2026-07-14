export async function handleAiRequest(request, env, ctx, path, method, payload, corsHeaders) {
  if (method === 'OPTIONS') {
    return new Response('OK', { headers: corsHeaders });
  }

  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Optional: Add auth gate if you want only authorized users to access AI endpoints
  // if (!payload) {
  //   return new Response(JSON.stringify({ error: "Unauthorized" }), {
  //     status: 401,
  //     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  //   });
  // }

  try {
    const { prompt } = await request.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const openRouterKey = env.OPENROUTER_API_KEY;
    if (!openRouterKey || openRouterKey === 'your_openrouter_api_key') {
      return new Response(JSON.stringify({ error: "OpenRouter API Key is not configured." }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://www.certifyied.com",
        "X-Title": "Certifyied"
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: "OpenRouter API Error", details: errText }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "";

    // Split logic if we want to parse specific lists, lines, or blocks
    const lines = reply.split('\n').map(line => line.trim()).filter(Boolean);

    return new Response(JSON.stringify({ 
      raw: reply,
      splitOutput: lines 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Internal Server Error", message: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
