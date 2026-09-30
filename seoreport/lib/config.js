export function getConfig(env) {
  // IMPORTANT: This function must NEVER expose NVIDIA_API_KEY.
  // Only NVIDIA_ANALYSIS_API_KEY is permitted for AI code paths.
  const config = {
    // Thresholds — all from env with defaults
    title: {
      min: parseInt(env.TITLE_MIN_LENGTH || '30', 10),
      max: parseInt(env.TITLE_MAX_LENGTH || '60', 10),
    },
    metaDescription: {
      min: parseInt(env.META_DESC_MIN_LENGTH || '120', 10),
      max: parseInt(env.META_DESC_MAX_LENGTH || '160', 10),
    },
    thinContentThreshold: parseInt(env.THIN_CONTENT_THRESHOLD || '300', 10),

    // Crawl limits
    maxPages: parseInt(env.MAX_PAGES_PER_JOB || '500', 10),
    maxDepth: parseInt(env.MAX_DEPTH || '5', 10),
    maxConcurrency: parseInt(env.MAX_CONCURRENCY || '8', 10),
    requestDelayMs: parseInt(env.REQUEST_DELAY_MS || '200', 10),
    timeoutMs: parseInt(env.TIMEOUT_MS || '15000', 10),
    maxResponseSizeBytes: parseInt(env.MAX_RESPONSE_SIZE_BYTES || '2097152', 10),
    maxRendersPerJob: parseInt(env.MAX_RENDERS_PER_JOB || '25', 10),
    maxSerpRequestsPerJob: parseInt(env.MAX_SERP_REQUESTS_PER_JOB || '40', 10),
    maxLlmTokensPerPage: parseInt(env.MAX_LLM_TOKENS_PER_PAGE || '2000', 10),

    // Feature flags — enabled by default unless explicitly disabled
    features: {
      llm:       env.FEATURE_LLM !== 'false',
      serp:      env.FEATURE_SERP !== 'false',
      pagespeed: env.FEATURE_PAGESPEED !== 'false',
      render:    env.FEATURE_RENDER !== 'false',
    },

    // Category scoring weights (template overrides)
    categoryWeights: {
      technical:       env.WEIGHT_TECHNICAL ? parseFloat(env.WEIGHT_TECHNICAL) : 0.30,
      onpage:          env.WEIGHT_ONPAGE ? parseFloat(env.WEIGHT_ONPAGE) : 0.30,
      content:         env.WEIGHT_CONTENT ? parseFloat(env.WEIGHT_CONTENT) : 0.20,
      structured_data: env.WEIGHT_STRUCTURED_DATA ? parseFloat(env.WEIGHT_STRUCTURED_DATA) : 0.10,
      performance:     env.WEIGHT_PERFORMANCE ? parseFloat(env.WEIGHT_PERFORMANCE) : 0.10,
      local_seo:       env.WEIGHT_LOCAL_SEO ? parseFloat(env.WEIGHT_LOCAL_SEO) : 0.00,
    },

    // External integrations
    supabaseUrl:            env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    nvidiaAnalysisApiKey:   env.NVIDIA_ANALYSIS_API_KEY || env.NVIDIA_API_KEY,
    brightdataApiKey:       env.BRIGHTDATA_API_KEY || env.BRIGHTDATA_KEY || env.SERP_API_KEY || env.BRIGHTDATA_SERP_API_KEY,
    brightdataZone:         env.BRIGHTDATA_ZONE || env.SERP_ZONE || env.BRIGHTDATA_SERP_ZONE || 'serp_api1',
    pagespeedApiKey:        env.PAGESPEED_API_KEY,
    cfBrowserRenderingUrl:  env.CF_BROWSER_RENDERING_URL,
  };

  return config;
}
