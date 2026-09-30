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

  try {
    const body = await request.json().catch(() => ({}));
    const prompt = body.prompt || (Array.isArray(body.messages) ? body.messages[body.messages.length - 1]?.content : null);
    
    if (!prompt) {
      return new Response(JSON.stringify({ 
        error: "Prompt is required in JSON body.", 
        example: { prompt: "Analyze this text and return summary." } 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const nvidiaKey = env.NVIDIA_ANALYSIS_API_KEY;
    const openRouterKey = env.OPENROUTER_API_KEY;

    if (!nvidiaKey && (!openRouterKey || openRouterKey === 'your_openrouter_api_key')) {
      return new Response(JSON.stringify({ 
        error: "AI API Key is not configured on Cloudflare Worker secrets.",
        hint: "Please set NVIDIA_ANALYSIS_API_KEY or OPENROUTER_API_KEY."
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let response;
    let isNvidia = false;

    if (nvidiaKey) {
      isNvidia = true;
      const model = body.model || "meta/llama-3.1-8b-instruct";
      const messages = body.messages || [
        ...(body.system ? [{ role: "system", content: body.system }] : []),
        { role: "user", content: prompt }
      ];
      
      const payloadBody = {
        model,
        messages,
        temperature: body.temperature ?? 0.5,
        max_tokens: body.max_tokens || 1024
      };

      if (body.json_format || body.response_format?.type === 'json_object') {
        payloadBody.response_format = { type: "json_object" };
      }

      response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${nvidiaKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payloadBody)
      });
    } else {
      const model = body.model || "meta-llama/llama-3.1-8b-instruct";
      const messages = body.messages || [
        ...(body.system ? [{ role: "system", content: body.system }] : []),
        { role: "user", content: prompt }
      ];

      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://www.certifyied.com",
          "X-Title": "Certifyied"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: body.temperature ?? 0.5,
          max_tokens: body.max_tokens || 1024
        })
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ 
        error: isNvidia ? "NVIDIA API Error" : "OpenRouter API Error", 
        status: response.status,
        details: errText 
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "";

    // Parse structured JSON from response if returned
    let parsedJson = null;
    try {
      const jsonMatch = reply.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, reply];
      const rawJsonCandidate = (jsonMatch[1] || reply).trim();
      if (rawJsonCandidate.startsWith('{') || rawJsonCandidate.startsWith('[')) {
        parsedJson = JSON.parse(rawJsonCandidate);
      }
    } catch (e) {
      /* Content is plain text */
    }

    const lines = reply.split('\n').map(l => l.trim()).filter(Boolean);

    return new Response(JSON.stringify({
      success: true,
      raw: reply,
      json: parsedJson,
      splitOutput: lines,
      usage: data.usage || null,
      provider: isNvidia ? 'nvidia' : 'openrouter',
      model: data.model || body.model
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
