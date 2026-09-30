export function compareRawVsRendered(rawFacts, renderedFacts) {
  if (!renderedFacts) return { severity: 'none' };
  
  const rawWords = rawFacts.content?.wordCount || 0;
  const renWords = renderedFacts.content?.wordCount || 0;
  const contentDiff = renWords >= rawWords * 3;
  
  const rawLinks = rawFacts.links?.total || 0;
  const renLinks = renderedFacts.links?.total || 0;
  const linkDiff = renLinks >= rawLinks * 3;
  
  const rawH1 = rawFacts.headings?.h1?.length || 0;
  const renH1 = renderedFacts.headings?.h1?.length || 0;
  const headingDiff = rawH1 !== renH1;
  
  const rawCanon = rawFacts.metadata?.canonical;
  const renCanon = renderedFacts.metadata?.canonical;
  const canonDiff = rawCanon !== renCanon;
  
  const rawSchemas = rawFacts.schema?.schemas?.length || 0;
  const renSchemas = renderedFacts.schema?.schemas?.length || 0;
  const schemaDiff = rawSchemas !== renSchemas;
  
  let severity = 'none';
  if (contentDiff || linkDiff) severity = 'significant';
  else if (headingDiff || canonDiff || schemaDiff) severity = 'minor';
  
  return {
    content_difference: contentDiff,
    link_difference: linkDiff,
    heading_difference: headingDiff,
    canonical_difference: canonDiff,
    schema_difference: schemaDiff,
    severity,
    details: {
      raw_word_count: rawWords,
      rendered_word_count: renWords,
      raw_links: rawLinks,
      rendered_links: renLinks,
      raw_h1_count: rawH1,
      rendered_h1_count: renH1,
      raw_canonical: rawCanon,
      rendered_canonical: renCanon
    }
  };
}