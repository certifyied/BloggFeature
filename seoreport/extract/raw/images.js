export function extractImages(html) {
  const images = [];
  const issues = { missingAlt: [], emptyAlt: 0, overLongAlt: [], missingDimensions: [] };
  
  const imgRegex = /<img([^>]+)>/gi;
  let match;
  
  while ((match = imgRegex.exec(html)) !== null) {
    const attrs = match[1];
    
    const srcMatch = attrs.match(/src=["']([^"']*)["']/i);
    const src = srcMatch ? srcMatch[1] : '';
    
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    const alt = altMatch ? altMatch[1] : null;
    const hasAlt = /alt=["']/i.test(attrs);
    
    const widthMatch = attrs.match(/width=["']([^"']*)["']/i);
    const heightMatch = attrs.match(/height=["']([^"']*)["']/i);
    
    const loadingMatch = attrs.match(/loading=["']([^"']*)["']/i);
    const srcsetMatch = attrs.match(/srcset=["']([^"']*)["']/i);
    const sizesMatch = attrs.match(/sizes=["']([^"']*)["']/i);
    
    const isDecorative = hasAlt && alt === '';
    
    if (!hasAlt) issues.missingAlt.push(src);
    if (isDecorative) issues.emptyAlt++;
    if (alt && alt.length > 125) issues.overLongAlt.push(src);
    if (!widthMatch || !heightMatch) issues.missingDimensions.push(src);
    
    images.push({
      src,
      alt,
      width: widthMatch ? widthMatch[1] : null,
      height: heightMatch ? heightMatch[1] : null,
      loading: loadingMatch ? loadingMatch[1] : null,
      srcset: srcsetMatch ? srcsetMatch[1] : null,
      sizes: sizesMatch ? sizesMatch[1] : null,
      isDecorative
    });
  }
  
  const result = { images, issues };

  Object.defineProperty(result, 'filter', {
    value: function(fn) { return images.filter(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'some', {
    value: function(fn) { return images.some(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'forEach', {
    value: function(fn) { return images.forEach(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'map', {
    value: function(fn) { return images.map(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'length', {
    get: function() { return images.length; },
    enumerable: false, configurable: true
  });

  return result;
}