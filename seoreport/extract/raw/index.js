export { extractMetadata } from './metadata.js';
export { extractHeadings } from './headings.js';
export { extractLinks } from './links.js';
export { extractImages } from './images.js';
export { extractSchema } from './schema.js';
export { extractContent } from './content.js';

import { extractMetadata } from './metadata.js';
import { extractHeadings } from './headings.js';
import { extractLinks } from './links.js';
import { extractImages } from './images.js';
import { extractSchema } from './schema.js';
import { extractContent } from './content.js';

export function extractAll(html, pageUrl) {
  return {
    metadata: extractMetadata ? extractMetadata(html, pageUrl) : {},
    headings: extractHeadings ? extractHeadings(html, pageUrl) : [],
    links: extractLinks ? extractLinks(html, pageUrl) : [],
    images: extractImages ? extractImages(html, pageUrl) : [],
    schema: extractSchema ? extractSchema(html, pageUrl) : [],
    content: extractContent ? extractContent(html, pageUrl) : {}
  };
}
