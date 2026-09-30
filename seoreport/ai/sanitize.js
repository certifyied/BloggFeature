const PROTECTED_KEYS = ['scores', 'technical', 'onpage', 'content', 'local_seo', 
  'performance', 'structured_data', 'site', 'rankings', 'search_console'];

export function sanitizeLLMOutput(raw) {
  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, errors: ['Output must be an object'] };
  }
  
  for (const key of PROTECTED_KEYS) {
    if (key in raw) {
      throw new Error(`LLM output contains protected key: ${key}`);
    }
  }

  const allowedKeys = ['content_quality', 'issues', 'suggested_title', 'suggested_meta_description', 'content_gaps', 'ai_analysis'];
  const sanitized = {};
  
  for (const key of allowedKeys) {
    if (key in raw) {
      sanitized[key] = raw[key];
    }
  }

  if (Array.isArray(sanitized.issues)) {
    sanitized.issues = sanitized.issues.map(issue => ({
      ...issue,
      source: 'llm'
    }));
  }

  return sanitized;
}

export function validateLLMOutputShape(sanitized) {
  const errors = [];
  if (typeof sanitized !== 'object' || sanitized === null) {
    errors.push('Output must be an object');
    return { valid: false, errors };
  }
  
  if (sanitized.issues && !Array.isArray(sanitized.issues)) {
    errors.push('issues must be an array');
  }
  
  return { valid: errors.length === 0, errors };
}
