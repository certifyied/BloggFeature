export function extractContent(html) {
  const stripped = html.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, '')
                       .replace(/<!--[\s\S]*?-->/g, '')
                       .replace(/<[^>]+>/g, ' ');
                       
  const visibleText = stripped.replace(/\s+/g, ' ').trim();
  
  const words = visibleText.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const charCount = visibleText.length;
  
  const paragraphCount = (html.match(/<p[^>]*>/gi) || []).length;
  const sentences = visibleText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentenceCount = sentences.length;
  const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0;
  
  const contentToHtmlRatio = html.length > 0 ? charCount / html.length : 0;
  
  let hash = 0;
  for (let i = 0; i < words.length - 2; i++) {
    const shingle = words[i] + ' ' + words[i+1] + ' ' + words[i+2];
    for (let j = 0; j < shingle.length; j++) {
      hash = Math.imul(31, hash) + shingle.charCodeAt(j) | 0;
    }
  }
  const simhash = hash.toString(16);

  return { wordCount, charCount, paragraphCount, sentenceCount, avgSentenceLength, contentToHtmlRatio, visibleText, simhash };
}