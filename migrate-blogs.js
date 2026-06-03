const fs = require('fs');
const path = require('path');

/**
 * Translates raw text blog content into the structured JSON format required by the database.
 * Maps headings to "subheading" fields and text/lists to "text" fields inside block objects.
 */
function convertContentToParagraphs(content) {
  if (!content) return [];

  // Split content by double newlines to process paragraph/heading/list blocks
  const blocks = content.split(/\n\s*\n/);
  const paragraphsList = [];

  let pendingSubheading = "";

  for (const block of blocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) continue;

    const lines = trimmedBlock.split("\n");
    let blockHtml = "";
    let inList = false;
    let listType = null; // 'ul' or 'ol'
    let isHeadingOnlyBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const isBullet = /^[●•\-\*]/u.test(line);
      const isNumbered = /^\d+\.\s+/.test(line);

      if (isBullet) {
        if (!inList || listType !== "ul") {
          if (inList) {
            blockHtml += listType === "ol" ? "</ol>\n" : "</ul>\n";
          }
          blockHtml += `<ul>\n`;
          inList = true;
          listType = "ul";
        }
        const cleanText = line.replace(/^[●•\-\*]\s*/u, "");
        blockHtml += `  <li>${cleanText}</li>\n`;
      } else if (isNumbered) {
        if (lines.length === 1) {
          pendingSubheading = line;
          isHeadingOnlyBlock = true;
        } else {
          if (!inList || listType !== "ol") {
            if (inList) {
              blockHtml += listType === "ol" ? "</ol>\n" : "</ul>\n";
            }
            blockHtml += `<ol>\n`;
            inList = true;
            listType = "ol";
          }
          const cleanText = line.replace(/^\d+\.\s*/, "");
          blockHtml += `  <li>${cleanText}</li>\n`;
        }
      } else {
        if (inList) {
          blockHtml += listType === "ol" ? "</ol>\n" : "</ul>\n";
          inList = false;
          listType = null;
        }

        // Check if it looks like a heading
        if (lines.length === 1 && line.length < 80 && !line.endsWith(".") && !line.endsWith("?") && !line.endsWith("!") && !line.includes(": ")) {
          pendingSubheading = line;
          isHeadingOnlyBlock = true;
        } else {
          blockHtml += `<p>${line}</p>\n`;
        }
      }
    }

    if (inList) {
      blockHtml += listType === "ol" ? "</ol>\n" : "</ul>\n";
    }

    // If this block was just a heading, keep it pending for the next text block
    if (isHeadingOnlyBlock && !blockHtml.trim()) {
      continue;
    }

    paragraphsList.push({
      type: "p",
      ...(pendingSubheading && { subheading: pendingSubheading }),
      text: blockHtml.trim()
    });

    // Reset pending subheading once consumed
    pendingSubheading = "";
  }

  // Handle case where a trailing heading has no paragraph text following it
  if (pendingSubheading) {
    paragraphsList.push({
      type: "p",
      subheading: pendingSubheading,
      text: ""
    });
  }

  return paragraphsList;
}

// Generate simple slug
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

/**
 * Migration Script
 * Usage: node migrate-blogs.js <path_to_blog_posts_json> <project_id> <output_sql_path>
 */
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log("Usage: node migrate-blogs.js <path_to_blog_posts_json> <project_id> [output_sql_path]");
  console.log("\nNote: Please export your blogPosts array to a JSON file first (e.g. blogPosts.json)");
  process.exit(1);
}

const jsonPath = path.resolve(args[0]);
const projectId = args[1];
const sqlPath = args[2] ? path.resolve(args[2]) : path.join(path.dirname(jsonPath), 'migrate_blogs.sql');

try {
  const fileContent = fs.readFileSync(jsonPath, 'utf8');
  const posts = JSON.parse(fileContent);

  if (!Array.isArray(posts)) {
    throw new Error("JSON root must be an array of blog posts.");
  }

  let sqlOutput = `-- Blog Migration SQL generated on ${new Date().toISOString()}\n\n`;

  posts.forEach((post, index) => {
    const title = post.title || `Blog Post ${index + 1}`;
    const subtitle = post.excerpt || "";
    const content = post.content || "";
    const slug = generateSlug(title);
    const paragraphs = convertContentToParagraphs(content);
    
    // Escape single quotes for SQL insertion
    const escapedTitle = title.replace(/'/g, "''");
    const escapedSubtitle = subtitle.replace(/'/g, "''");
    const escapedSlug = slug.replace(/'/g, "''");
    const jsonString = JSON.stringify(paragraphs).replace(/'/g, "''");

    const blogId = post.id || (index + 1);
    sqlOutput += `INSERT INTO blogs (readable_id, project_id, title, subtitle, main_image_url, paragraphs, slug) \n`;
    sqlOutput += `VALUES (${blogId}, '${projectId}', '${escapedTitle}', '${escapedSubtitle}', NULL, '${jsonString}'::jsonb, '${escapedSlug}')\n`;
    sqlOutput += `ON CONFLICT (project_id, slug) DO NOTHING;\n\n`;
  });

  fs.writeFileSync(sqlPath, sqlOutput, 'utf8');
  console.log(`\n✅ Migration SQL successfully generated at:\n   ${sqlPath}`);
  console.log(`\nYou can now run the contents of that file in your Supabase SQL Editor!`);

} catch (err) {
  console.error("Migration failed:", err.message);
}
