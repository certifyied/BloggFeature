
export function getRules() {
  return [
    // ── Technical Rules ────────────────────────────────────────────────────────
    {
      id: 'technical.robots.blocked',
      category: 'technical',
      severity: 'critical',
      weight: 10,
      evaluate: (facts) => {
        const blocked = facts.indexability?.reasons?.includes('Blocked by robots.txt');
        return {
          passed: !blocked,
          evidence: blocked ? 'Page is blocked by robots.txt directives' : 'Page is allowed by robots.txt'
        };
      }
    },
    {
      id: 'technical.https.missing',
      category: 'technical',
      severity: 'high',
      weight: 8,
      evaluate: (facts) => {
        const isHttps = (facts.page?.url || '').startsWith('https://');
        return {
          passed: isHttps,
          evidence: isHttps ? 'URL uses secure HTTPS protocol' : 'URL is using insecure HTTP protocol'
        };
      }
    },
    {
      id: 'technical.status_code.error',
      category: 'technical',
      severity: 'critical',
      weight: 10,
      evaluate: (facts) => {
        const status = facts.http?.status || 200;
        const passed = status >= 200 && status < 400;
        return {
          passed,
          evidence: passed ? `HTTP status code ${status} OK` : `HTTP error status code ${status}`
        };
      }
    },
    {
      id: 'technical.redirects.chain_too_long',
      category: 'technical',
      severity: 'medium',
      weight: 5,
      evaluate: (facts) => {
        const chainLength = facts.http?.redirectChain?.length || 0;
        const passed = chainLength <= 2;
        return {
          passed,
          evidence: passed ? `Redirect chain length ${chainLength} is optimal` : `Redirect chain has ${chainLength} hops (max 2 recommended)`
        };
      }
    },
    {
      id: 'technical.canonical.missing',
      category: 'technical',
      severity: 'medium',
      weight: 5,
      evaluate: (facts) => {
        const canonical = facts.rendered?.metadata?.canonical || facts.rawHtml?.metadata?.canonical;
        return {
          passed: !!canonical,
          evidence: canonical ? `Canonical URL specified: ${canonical}` : 'Missing canonical link tag'
        };
      }
    },
    {
      id: 'technical.governance.ai_txt',
      category: 'technical',
      severity: 'low',
      weight: 3,
      evaluate: (facts) => {
        const present = facts.governance?.aiTxtPresent;
        return {
          passed: !!present,
          evidence: present ? 'ai.txt file present for AI crawler governance' : 'Missing ai.txt file for AI crawler governance directives'
        };
      }
    },
    {
      id: 'technical.governance.llms_txt',
      category: 'technical',
      severity: 'low',
      weight: 3,
      evaluate: (facts) => {
        const present = facts.governance?.llmsTxtPresent;
        return {
          passed: !!present,
          evidence: present ? 'llms.txt file present for LLM context optimization' : 'Missing llms.txt file for LLM context indexing'
        };
      }
    },


    // ── On-Page Rules ──────────────────────────────────────────────────────────
    {
      id: 'onpage.title.missing',
      category: 'onpage',
      severity: 'critical',
      weight: 10,
      evaluate: (facts) => {
        const title = facts.rendered?.metadata?.title || facts.rawHtml?.metadata?.title;
        return {
          passed: !!title && title.trim().length > 0,
          evidence: title ? `Title tag present: "${title}"` : 'Page missing <title> tag'
        };
      }
    },
    {
      id: 'onpage.title.length',
      category: 'onpage',
      severity: 'low',
      weight: 4,
      evaluate: (facts) => {
        const title = facts.rendered?.metadata?.title || facts.rawHtml?.metadata?.title || '';
        if (!title) return { passed: true, evidence: 'N/A (title missing)' };
        const len = title.length;
        const passed = len >= 30 && len <= 60;
        return {
          passed,
          evidence: passed ? `Title length (${len} chars) is within recommended range (30-60 chars)` : `Title length is ${len} chars (recommended: 30-60 chars)`
        };
      }
    },
    {
      id: 'onpage.description.missing',
      category: 'onpage',
      severity: 'high',
      weight: 8,
      evaluate: (facts) => {
        const desc = facts.rendered?.metadata?.metaDescription || facts.rawHtml?.metadata?.metaDescription;
        return {
          passed: !!desc && desc.trim().length > 0,
          evidence: desc ? `Meta description present: "${desc.slice(0, 50)}..."` : 'Missing meta description tag'
        };
      }
    },
    {
      id: 'onpage.description.length',
      category: 'onpage',
      severity: 'low',
      weight: 3,
      evaluate: (facts) => {
        const desc = facts.rendered?.metadata?.metaDescription || facts.rawHtml?.metadata?.metaDescription || '';
        if (!desc) return { passed: true, evidence: 'N/A (description missing)' };
        const len = desc.length;
        const passed = len >= 120 && len <= 160;
        return {
          passed,
          evidence: passed ? `Meta description length (${len} chars) is optimal (120-160 chars)` : `Meta description length is ${len} chars (recommended: 120-160 chars)`
        };
      }
    },
    {
      id: 'onpage.headings.h1_missing',
      category: 'onpage',
      severity: 'high',
      weight: 7,
      evaluate: (facts) => {
        const headings = facts.rendered?.headings || facts.rawHtml?.headings;
        const h1Count = Array.isArray(headings) 
          ? headings.filter(h => h.level === 1 || h.tag?.toLowerCase() === 'h1').length
          : (typeof headings?.filter === 'function' ? headings.filter(h => h.level === 1 || h.tag?.toLowerCase() === 'h1').length : (headings?.h1?.length || 0));
        return {
          passed: h1Count > 0,
          evidence: h1Count > 0 ? `Found ${h1Count} H1 heading(s)` : 'Page is missing an <h1> heading tag'
        };
      }
    },
    {
      id: 'onpage.headings.h1_multiple',
      category: 'onpage',
      severity: 'medium',
      weight: 4,
      evaluate: (facts) => {
        const headings = facts.rendered?.headings || facts.rawHtml?.headings;
        const h1Count = Array.isArray(headings) 
          ? headings.filter(h => h.level === 1 || h.tag?.toLowerCase() === 'h1').length
          : (typeof headings?.filter === 'function' ? headings.filter(h => h.level === 1 || h.tag?.toLowerCase() === 'h1').length : (headings?.h1?.length || 0));
        const passed = h1Count <= 1;
        return {
          passed,
          evidence: passed ? `Found ${h1Count} H1 tag` : `Multiple H1 tags found (${h1Count}). Best practice is 1 H1 per page.`
        };
      }
    },
    {
      id: 'onpage.viewport.missing',
      category: 'onpage',
      severity: 'high',
      weight: 7,
      evaluate: (facts) => {
        const viewport = facts.rendered?.metadata?.viewport || facts.rawHtml?.metadata?.viewport;
        return {
          passed: !!viewport,
          evidence: viewport ? `Viewport meta tag present: ${viewport}` : 'Missing viewport meta tag for mobile responsiveness'
        };
      }
    },

    // ── Content Rules ──────────────────────────────────────────────────────────
    {
      id: 'content.word_count.thin',
      category: 'content',
      severity: 'high',
      weight: 8,
      evaluate: (facts) => {
        const wc = Math.max(facts.rendered?.content?.wordCount || 0, facts.rawHtml?.content?.wordCount || 0);
        const passed = wc >= 300;
        return {
          passed,
          evidence: passed ? `Word count is ${wc} words` : `Thin content detected: page has only ${wc} words (minimum recommended: 300)`
        };
      }
    },
    {
      id: 'content.images.missing_alt',
      category: 'content',
      severity: 'medium',
      weight: 5,
      evaluate: (facts) => {
        const rawImages = facts.rendered?.images || facts.rawHtml?.images;
        const imgList = Array.isArray(rawImages) 
          ? rawImages 
          : (Array.isArray(rawImages?.images) ? rawImages.images : (typeof rawImages?.filter === 'function' ? rawImages : []));
        if (imgList.length === 0) return { passed: true, evidence: 'No images found on page' };
        const missingAlt = imgList.filter(img => !img.alt || img.alt.trim().length === 0);
        const passed = missingAlt.length === 0;
        return {
          passed,
          evidence: passed ? `All ${imgList.length} images have alt attributes` : `${missingAlt.length} of ${imgList.length} images are missing alt attributes`
        };
      }
    },

    // ── Structured Data Rules ──────────────────────────────────────────────────
    {
      id: 'structured_data.jsonld.missing',
      category: 'structured_data',
      severity: 'low',
      weight: 3,
      evaluate: (facts) => {
        const rawSchema = facts.rendered?.schema || facts.rawHtml?.schema;
        const schemaList = Array.isArray(rawSchema)
          ? rawSchema
          : (Array.isArray(rawSchema?.schemas) ? rawSchema.schemas : (typeof rawSchema?.filter === 'function' ? rawSchema : []));
        const hasSchema = schemaList.length > 0;
        return {
          passed: hasSchema,
          evidence: hasSchema ? `Found ${schemaList.length} structured data block(s)` : 'No JSON-LD or structured data markup found on page'
        };
      }
    },

    // ── Local SEO Rules ────────────────────────────────────────────────────────
    {
      id: 'local.nap.phone_missing',
      category: 'local_seo',
      severity: 'high',
      weight: 8,
      evaluate: (facts) => {
        const text = (facts.rendered?.content?.visibleText || facts.rawHtml?.content?.visibleText || '');
        const rawSchema = facts.rendered?.schema || facts.rawHtml?.schema;
        const schemaList = Array.isArray(rawSchema) ? rawSchema : (Array.isArray(rawSchema?.schemas) ? rawSchema.schemas : []);
        const hasPhoneSchema = schemaList.some(s => !!s.telephone || !!s.raw?.telephone);
        const hasPhoneText = /(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}|\b\d{10}\b/.test(text);
        const passed = hasPhoneSchema || hasPhoneText;
        return {
          passed,
          evidence: passed ? 'Business contact phone number detected' : 'Missing business contact phone number for NAP consistency'
        };
      }
    },
    {
      id: 'local.nap.address_missing',
      category: 'local_seo',
      severity: 'high',
      weight: 8,
      evaluate: (facts) => {
        const text = (facts.rendered?.content?.visibleText || facts.rawHtml?.content?.visibleText || '').toLowerCase();
        const rawSchema = facts.rendered?.schema || facts.rawHtml?.schema;
        const schemaList = Array.isArray(rawSchema) ? rawSchema : (Array.isArray(rawSchema?.schemas) ? rawSchema.schemas : []);
        const hasAddressSchema = schemaList.some(s => !!s.address || !!s.raw?.address);
        const hasAddressKeywords = /\b(street|st|avenue|ave|road|rd|suite|ste|bldg|building|pincode|zip|city|state|floor|lane|drive|dr)\b/i.test(text);
        const passed = hasAddressSchema || hasAddressKeywords;
        return {
          passed,
          evidence: passed ? 'Physical business address indicators detected' : 'Missing physical address details for local NAP presence'
        };
      }
    },
    {
      id: 'local.schema.missing',
      category: 'local_seo',
      severity: 'medium',
      weight: 6,
      evaluate: (facts) => {
        const rawSchema = facts.rendered?.schema || facts.rawHtml?.schema;
        const schemaList = Array.isArray(rawSchema) ? rawSchema : (Array.isArray(rawSchema?.schemas) ? rawSchema.schemas : []);
        const hasLocalSchema = schemaList.some(s => {
          const type = (s['@type'] || s.type || s.raw?.['@type'] || '').toLowerCase();
          return ['localbusiness', 'organization', 'store', 'restaurant', 'medicalbusiness', 'professional service'].some(t => type.includes(t));
        });
        return {
          passed: hasLocalSchema,
          evidence: hasLocalSchema ? 'LocalBusiness / Organization schema markup present' : 'Missing LocalBusiness / Organization structured data markup'
        };
      }
    },
    {
      id: 'local.business_name.missing',
      category: 'local_seo',
      severity: 'medium',
      weight: 5,
      evaluate: (facts) => {
        const title = (facts.rendered?.metadata?.title || facts.rawHtml?.metadata?.title || '');
        const ogSiteName = (facts.rendered?.metadata?.openGraph?.siteName || facts.rawHtml?.metadata?.openGraph?.siteName || '');
        const passed = title.trim().length > 0 || ogSiteName.trim().length > 0;
        return {
          passed,
          evidence: passed ? `Business name / site branding detected: "${ogSiteName || title.slice(0, 30)}"` : 'Missing explicit business branding name in metadata'
        };
      }
    },
    {
      id: 'local.geo_tags.missing',
      category: 'local_seo',
      severity: 'low',
      weight: 3,
      evaluate: (facts) => {
        const html = facts.rawHtml?.raw || '';
        const hasGeoMeta = /<meta[^>]+name=["'](geo\.position|geo\.region|geo\.placename|ICBM)["']/i.test(html);
        return {
          passed: hasGeoMeta,
          evidence: hasGeoMeta ? 'Geo-location meta tags (geo.position/ICBM) present' : 'Missing geo-location meta tags (geo.position / ICBM) for regional ranking'
        };
      }
    }
  ];
}
