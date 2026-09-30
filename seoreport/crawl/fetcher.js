export async function fetchPage(url, config, redirectChain = []) {
  const start = Date.now();
  const result = {
    status: null,
    contentType: null,
    contentLength: null,
    redirectChain: [...redirectChain],
    html: null,
    responseTimeMs: 0,
    error: null
  };

  try {
    if (redirectChain.length >= 5) {
      throw new Error('Too many redirects');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    // Use redirect: 'follow' to get 200 OK and full HTML after domain/protocol redirects
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; CertifyiedBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    clearTimeout(timeout);
    
    result.status = res.status;
    result.contentType = res.headers.get('content-type') || 'text/html';
    const cl = res.headers.get('content-length');
    if (cl) result.contentLength = parseInt(cl, 10);

    if (res.redirected && res.url && res.url !== url) {
      result.redirectChain.push(res.url);
    }

    // Read body for text/html, xhtml, or default
    const ct = (result.contentType || '').toLowerCase();
    const isHtml = !ct || ct.includes('text/html') || ct.includes('xhtml') || ct.includes('text/plain');
    if (isHtml) {
      let content = '';
      let bytesRead = 0;
      const reader = res.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        bytesRead += value.length;
        if (bytesRead > config.maxResponseSizeBytes) {
          reader.cancel();
          break;
        }
        
        content += new TextDecoder().decode(value, { stream: true });
      }
      
      result.html = content;
      if (!result.contentLength) {
        result.contentLength = bytesRead;
      }
    }

  } catch (error) {
    result.error = error.message;
    // Fallback status if network error
    if (!result.status) result.status = 500;
  } finally {
    result.responseTimeMs = Date.now() - start;
  }

  return result;
}
