export function extractSchema(html) {
  const schemas = [];
  const issues = [];
  
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const raw = JSON.parse(match[1]);
      const processNode = (node) => {
        if (!node) return;
        if (Array.isArray(node)) { node.forEach(processNode); return; }
        if (typeof node === 'object') {
          if (node['@type']) {
            schemas.push({
              type: node['@type'],
              raw: node,
              name: node.name,
              url: node.url,
              address: node.address,
              telephone: node.telephone,
              openingHours: node.openingHours || node.openingHoursSpecification,
              sameAs: node.sameAs,
              aggregateRating: node.aggregateRating,
              offers: node.offers,
              breadcrumb: node.itemListElement
            });
          }
          if (!node['@context'] && !node['@type']) issues.push('Schema object missing @context or @type');
          Object.values(node).forEach(processNode);
        }
      };
      processNode(raw);
    } catch (e) {
      issues.push('Invalid JSON-LD');
    }
  }
  
  const microdataRegex = /itemtype=["']([^"']+)["']/gi;
  let mdMatch;
  while ((mdMatch = microdataRegex.exec(html)) !== null) {
    schemas.push({ type: mdMatch[1], raw: {}, isMicrodata: true });
  }

  const orgTypes = schemas.filter(s => s.type === 'Organization');
  if (orgTypes.length > 1) issues.push('Duplicate Organization schema');

  const result = { schemas, issues };

  Object.defineProperty(result, 'filter', {
    value: function(fn) { return schemas.filter(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'some', {
    value: function(fn) { return schemas.some(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'forEach', {
    value: function(fn) { return schemas.forEach(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'map', {
    value: function(fn) { return schemas.map(fn); },
    enumerable: false, writable: true, configurable: true
  });
  Object.defineProperty(result, 'length', {
    get: function() { return schemas.length; },
    enumerable: false, configurable: true
  });

  return result;
}