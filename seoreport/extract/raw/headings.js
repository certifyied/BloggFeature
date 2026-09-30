export function extractHeadings(html) {
  const headings = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };
  const items = [];
  const issues = { multipleH1: false, missingH1: false, skippedLevels: [], emptyHeadings: [] };
  
  const hRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  let lastLevel = 0;
  
  while ((match = hRegex.exec(html)) !== null) {
    const level = parseInt(match[1]);
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    
    headings[`h${level}`].push(text);
    items.push({ level, tag: `h${level}`, text });

    if (!text) issues.emptyHeadings.push(`h${level}`);
    
    if (lastLevel > 0 && level > lastLevel + 1) {
      issues.skippedLevels.push(`h${lastLevel}->h${level}`);
    }
    lastLevel = level;
  }
  
  if (headings.h1.length === 0) issues.missingH1 = true;
  if (headings.h1.length > 1) issues.multipleH1 = true;
  
  const result = { ...headings, items, issues };

  Object.defineProperty(result, 'filter', {
    value: function(fn) {
      return items.filter(fn);
    },
    enumerable: false,
    writable: true,
    configurable: true
  });
  Object.defineProperty(result, 'some', {
    value: function(fn) {
      return items.some(fn);
    },
    enumerable: false,
    writable: true,
    configurable: true
  });
  Object.defineProperty(result, 'forEach', {
    value: function(fn) {
      return items.forEach(fn);
    },
    enumerable: false,
    writable: true,
    configurable: true
  });
  Object.defineProperty(result, 'map', {
    value: function(fn) {
      return items.map(fn);
    },
    enumerable: false,
    writable: true,
    configurable: true
  });

  return result;
}