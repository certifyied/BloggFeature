export function createLogger(jobId) {
  const log = (level, message, phase = null, url = null, durationMs = null, extra = {}) => {
    const payload = {
      job_id: jobId,
      timestamp: new Date().toISOString(),
      level,
      message,
      phase,
      url,
      duration_ms: durationMs,
      ...extra
    };
    
    // Exclude null/undefined properties
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([_, v]) => v != null)
    );
    
    console.log(JSON.stringify(cleanPayload));
  };

  return {
    info: (msg, phase, url, durationMs, extra) => log('info', msg, phase, url, durationMs, extra),
    warn: (msg, phase, url, durationMs, extra) => log('warn', msg, phase, url, durationMs, extra),
    error: (msg, phase, url, durationMs, extra) => log('error', msg, phase, url, durationMs, extra),
  };
}
