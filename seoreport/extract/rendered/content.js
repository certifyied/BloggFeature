import { extractContent as baseExtract } from '../raw/content.js';
export function extractContent(html) {
  const base = baseExtract(html);
  
  const extractSection = (regex) => {
    const match = regex.exec(html);
    return match ? baseExtract(match[1]).visibleText : '';
  };
  
  return {
    ...base,
    mainContent: extractSection(/<main[^>]*>([\s\S]*?)<\/main>/i) || base.visibleText,
    navigationText: extractSection(/<nav[^>]*>([\s\S]*?)<\/nav>/i),
    footerText: extractSection(/<footer[^>]*>([\s\S]*?)<\/footer>/i),
    totalVisible: base.visibleText
  };
}