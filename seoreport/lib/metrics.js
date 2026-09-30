export class MetricsTracker {
  constructor(supabaseAdmin, jobId) {
    this.supabaseAdmin = supabaseAdmin;
    this.jobId = jobId;
  }
  
  async trackLLMCall({ url, tokensUsed, model, status, durationMs, apiKeyHint }) {
    const costUsd = tokensUsed ? (tokensUsed.total || 0) * 0.000002 : 0;
    await this.supabaseAdmin.from('seo_usage_metrics').insert({
      job_id: this.jobId,
      metric_type: 'llm_call',
      url,
      model,
      status,
      duration_ms: durationMs,
      tokens: tokensUsed?.total || 0,
      cost_usd: costUsd,
      details: { apiKeyHint, tokensUsed }
    });
  }
  
  async trackSERPRequest({ keyword, location, device, status, durationMs }) {
    await this.supabaseAdmin.from('seo_usage_metrics').insert({
      job_id: this.jobId,
      metric_type: 'serp_request',
      status,
      duration_ms: durationMs,
      cost_usd: 0.005,
      details: { keyword, location, device }
    });
  }
  
  async trackRenderCall({ url, status, durationMs }) {
    await this.supabaseAdmin.from('seo_usage_metrics').insert({
      job_id: this.jobId,
      metric_type: 'render_call',
      url,
      status,
      duration_ms: durationMs
    });
  }
  
  async trackPageSpeedCall({ url, strategy, status, durationMs }) {
    await this.supabaseAdmin.from('seo_usage_metrics').insert({
      job_id: this.jobId,
      metric_type: 'pagespeed_call',
      url,
      status,
      duration_ms: durationMs,
      details: { strategy }
    });
  }
  
  async getJobSummary() {
    const { data } = await this.supabaseAdmin.from('seo_usage_summary').select('*').eq('job_id', this.jobId).single();
    if (!data) return { llm_calls: { count: 0, tokens: 0, cost: 0 }, serp_requests: { count: 0, cost: 0 }, render_calls: { count: 0 }, pagespeed_calls: { count: 0 } };
    return {
      llm_calls: { count: data.llm_count || 0, tokens: data.llm_tokens || 0, cost: data.llm_cost || 0 },
      serp_requests: { count: data.serp_count || 0, cost: data.serp_cost || 0 },
      render_calls: { count: data.render_count || 0 },
      pagespeed_calls: { count: data.pagespeed_count || 0 }
    };
  }
  
  checkBudget(metricType, config) {
    if (metricType === 'serp') {
      return { allowed: true, reason: null };
    }
    return { allowed: true, reason: null };
  }
}
