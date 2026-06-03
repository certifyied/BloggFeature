import { createClient } from '@supabase/supabase-js';
// nodemailer removed: CF Workers does not support raw TCP/SMTP
// Using MailChannels API (free, native to Cloudflare Workers) instead
import * as jose from 'jose';

// Helper for JWT signing and verification using Web Crypto API via 'jose'
async function signJWT(env, payload) {
  const secret = new TextEncoder().encode(env.JWT_SECRET || 'fallback-secret-for-dev-only');
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .sign(secret);
}

async function verifyJWT(env, token) {
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET || 'fallback-secret-for-dev-only');
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
  } catch (e) {
    return null;
  }
}

// System Audit Logs & Trail logging helper with automatic cleanup
async function logAction(supabaseAdmin, email, action, details = {}, ip = '') {
  try {
    // 1. Insert log record
    await supabaseAdmin.from('audit_logs').insert({
      email: email ? email.toLowerCase() : 'anonymous',
      action,
      details,
      ip_address: ip
    });

    // 2. Automate cleaning: if rows > 10,000, remove the oldest 5,000
    const { count, error: countErr } = await supabaseAdmin
      .from('audit_logs')
      .select('*', { count: 'exact', head: true });

    if (!countErr && count > 10000) {
      const { data: logs, error: selectErr } = await supabaseAdmin
        .from('audit_logs')
        .select('created_at')
        .order('created_at', { ascending: true })
        .range(4999, 4999)
        .maybeSingle();

      if (!selectErr && logs && logs.created_at) {
        await supabaseAdmin
          .from('audit_logs')
          .delete()
          .lte('created_at', logs.created_at);
      }
    }
  } catch (err) {
    console.error("Error logging action:", err);
  }
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response('OK', { headers: corsHeaders });
    }

    const url = new URL(request.url);
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });

    const supabaseAdmin = env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
      : supabase;

    // --- Serve Images from Cloudflare R2 Bucket ---
    const imageMatch = path.match(/^\/adminApiBlog\/cdn\/image\/(.+)$/);
    if (imageMatch && request.method === 'GET') {
      try {
        if (!env.BUCKET) {
          return new Response('R2 storage is disabled', { status: 503, headers: corsHeaders });
        }
        const key = decodeURIComponent(imageMatch[1]);
        const object = await env.BUCKET.get(key);
        if (!object) {
          return new Response('Image not found', { status: 404, headers: corsHeaders });
        }
        const headers = new Headers(corsHeaders);
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000');
        if (!headers.get('content-type')) {
          if (key.endsWith('.png')) headers.set('content-type', 'image/png');
          else if (key.endsWith('.gif')) headers.set('content-type', 'image/gif');
          else if (key.endsWith('.svg')) headers.set('content-type', 'image/svg+xml');
          else headers.set('content-type', 'image/jpeg');
        }
        return new Response(object.body, { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // --- Embed JS script for external sites ---
    if (path === '/adminApiBlog/api/embed' && request.method === 'GET') {
      const embedScript = `
(function() {
  const workerOrigin = "${url.origin}";

  // Insert Base CSS
  const style = document.createElement('style');
  style.innerHTML = 
    '.cf-blog-grid {' +
    '  display: grid;' +
    '  grid-template-columns: 1fr;' +
    '  gap: 24px;' +
    '  margin-bottom: 24px;' +
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
    '}' +
    '@media (min-width: 640px) {' +
    '  .cf-blog-grid {' +
    '    grid-template-columns: repeat(2, minmax(0, 1fr));' +
    '  }' +
    '}' +
    '@media (min-width: 1024px) {' +
    '  .cf-blog-grid {' +
    '    grid-template-columns: repeat(3, minmax(0, 1fr));' +
    '  }' +
    '}' +
    '.cf-blog-card {' +
    '  background: white;' +
    '  border: 1px solid #e2e8f0;' +
    '  border-radius: 12px;' +
    '  overflow: hidden;' +
    '  display: flex;' +
    '  flex-direction: column;' +
    '  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);' +
    '  transition: transform 0.2s, box-shadow 0.2s;' +
    '  cursor: pointer;' +
    '}' +
    '.cf-blog-card:hover {' +
    '  transform: translateY(-4px);' +
    '  box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);' +
    '}' +
    '.cf-blog-image {' +
    '  aspect-ratio: 16/9;' +
    '  width: 100%;' +
    '  background: #f1f5f9;' +
    '  overflow: hidden;' +
    '}' +
    '.cf-blog-image img {' +
    '  width: 100%;' +
    '  height: 100%;' +
    '  object-fit: cover;' +
    '}' +
    '.cf-blog-content {' +
    '  padding: 20px;' +
    '  display: flex;' +
    '  flex-direction: column;' +
    '  flex-grow: 1;' +
    '}' +
    '.cf-blog-date {' +
    '  font-size: 12px;' +
    '  color: #94a3b8;' +
    '  text-transform: uppercase;' +
    '  letter-spacing: 0.05em;' +
    '  margin-bottom: 6px;' +
    '}' +
    '.cf-blog-title {' +
    '  font-size: 18px;' +
    '  font-weight: 700;' +
    '  color: #0f172a;' +
    '  margin: 8px 0;' +
    '  line-height: 1.4;' +
    '  display: -webkit-box;' +
    '  -webkit-line-clamp: 2;' +
    '  -webkit-box-orient: vertical;' +
    '  overflow: hidden;' +
    '}' +
    '.cf-blog-subtitle {' +
    '  font-size: 14px;' +
    '  color: #64748b;' +
    '  margin-bottom: 16px;' +
    '  flex-grow: 1;' +
    '  line-height: 1.5;' +
    '  display: -webkit-box;' +
    '  -webkit-line-clamp: 3;' +
    '  -webkit-box-orient: vertical;' +
    '  overflow: hidden;' +
    '}' +
    '.cf-blog-read-more {' +
    '  font-size: 13px;' +
    '  font-weight: 600;' +
    '  color: #2563eb;' +
    '  display: inline-flex;' +
    '  align-items: center;' +
    '  gap: 4px;' +
    '  margin-top: auto;' +
    '}' +
    '.cf-blog-card:hover .cf-blog-read-more {' +
    '  color: #1d4ed8;' +
    '}' +
    '.cf-blog-read-more svg {' +
    '  transition: transform 0.2s;' +
    '}' +
    '.cf-blog-card:hover .cf-blog-read-more svg {' +
    '  transform: translateX(4px);' +
    '}' +
    '.cf-blog-loader {' +
    '  text-align: center;' +
    '  padding: 40px;' +
    '  font-size: 14px;' +
    '  color: #64748b;' +
    '}' +
    '.cf-blog-error {' +
    '  color: #ef4444;' +
    '  text-align: center;' +
    '  padding: 20px;' +
    '  font-size: 14px;' +
    '}' +
    '.cf-post-container {' +
    '  max-width: 800px;' +
    '  margin: 0 auto;' +
    '  padding: 24px 16px;' +
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
    '  color: #334155;' +
    '  line-height: 1.7;' +
    '}' +
    '.cf-post-header {' +
    '  margin-bottom: 32px;' +
    '}' +
    '.cf-post-title {' +
    '  font-size: 32px;' +
    '  font-weight: 800;' +
    '  color: #0f172a;' +
    '  line-height: 1.25;' +
    '  margin-bottom: 16px;' +
    '}' +
    '@media (min-width: 768px) {' +
    '  .cf-post-title {' +
    '    font-size: 42px;' +
    '  }' +
    '}' +
    '.cf-post-meta {' +
    '  font-size: 14px;' +
    '  color: #64748b;' +
    '  margin-bottom: 8px;' +
    '}' +
    '.cf-post-subtitle {' +
    '  font-size: 18px;' +
    '  color: #475569;' +
    '  line-height: 1.5;' +
    '  margin-bottom: 24px;' +
    '}' +
    '.cf-post-image {' +
    '  width: 100%;' +
    '  aspect-ratio: 16/9;' +
    '  border-radius: 12px;' +
    '  overflow: hidden;' +
    '  margin-bottom: 32px;' +
    '  box-shadow: 0 4px 10px rgba(0,0,0,0.05);' +
    '}' +
    '.cf-post-image img {' +
    '  width: 100%;' +
    '  height: 100%;' +
    '  object-fit: cover;' +
    '}' +
    '.cf-post-body p {' +
    '  font-size: 16px;' +
    '  margin-bottom: 20px;' +
    '  color: #334155;' +
    '}' +
    '.cf-post-body h2, .cf-post-body h3, .cf-post-body h4 {' +
    '  color: #0f172a;' +
    '  font-weight: 700;' +
    '  margin-top: 36px;' +
    '  margin-bottom: 12px;' +
    '  line-height: 1.3;' +
    '}' +
    '.cf-post-body h2 { font-size: 26px; }' +
    '.cf-post-body h3 { font-size: 22px; }' +
    '.cf-post-body h4 { font-size: 18px; }' +
    '.cf-post-body ul, .cf-post-body ol {' +
    '  margin-bottom: 20px;' +
    '  padding-left: 24px;' +
    '}' +
    '.cf-post-body li {' +
    '  margin-bottom: 8px;' +
    '}';
  document.head.appendChild(style);

  const listContainer = document.getElementById('certifyied-blog-container');
  const postContainer = document.getElementById('certifyied-blog-post');
  const fallbackImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="%23e2e8f0"><rect width="100%" height="100%"/></svg>';

  // --- RENDERING LIST MODE ---
  if (listContainer) {
    const projectId = listContainer.dataset.projectId;
    const initialLimit = parseInt(listContainer.dataset.limit) || 9;
    const redirectUrl = listContainer.dataset.redirectUrl || '/blog';
    
    if (!projectId) {
      listContainer.innerHTML = '<p class="cf-blog-error">Error: data-project-id attribute is missing!</p>';
      return;
    }

    const gridEl = document.createElement('div');
    gridEl.className = 'cf-blog-grid';
    listContainer.appendChild(gridEl);

    const loaderEl = document.createElement('div');
    loaderEl.className = 'cf-blog-loader';
    loaderEl.innerText = 'Loading stories...';
    listContainer.appendChild(loaderEl);

    async function loadList() {
      loaderEl.style.display = 'block';
      try {
        const res = await fetch(workerOrigin + '/adminApiBlog/api/blogs/public?projectId=' + projectId + '&limit=' + initialLimit + '&offset=0');
        const data = await res.json();
        
        if (data.blogs && data.blogs.length > 0) {
          data.blogs.forEach(blog => {
            const card = document.createElement('div');
            card.className = 'cf-blog-card';
            
            const imgUrl = blog.main_image_url || fallbackImg;
            const dateStr = blog.created_at ? new Date(blog.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
            
            card.innerHTML = 
              '<div class="cf-blog-image">' +
              '  <img src="' + imgUrl + '" onerror="this.src=\\'' + fallbackImg + '\\'">' +
              '</div>' +
              '<div class="cf-blog-content">' +
              (dateStr ? '  <div class="cf-blog-date">' + dateStr + '</div>' : '') +
              '  <h3 class="cf-blog-title">' + (blog.title || 'Untitled') + '</h3>' +
              '  <p class="cf-blog-subtitle">' + (blog.subtitle || '') + '</p>' +
              '  <div class="cf-blog-read-more">Read More <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px; transition:transform 0.2s;"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></div>' +
              '</div>';
            
            card.addEventListener('click', function() {
              let targetUrl = redirectUrl;
              if (targetUrl.includes('?')) {
                targetUrl += (targetUrl.endsWith('&') || targetUrl.endsWith('?')) ? '' : '&';
                targetUrl += 'id=' + blog.id;
              } else {
                targetUrl = targetUrl.replace(/\/$/, '') + '/' + blog.id;
              }
              window.location.href = targetUrl;
            });
            
            gridEl.appendChild(card);
          });
        } else {
          gridEl.innerHTML = '<p style="color:#64748b; font-size:14px; grid-column:1/-1; text-align:center;">No published stories yet.</p>';
        }
      } catch (err) {
        console.error("Error loading blogs:", err);
        gridEl.innerHTML = '<p class="cf-blog-error">Failed to load stories.</p>';
      } finally {
        loaderEl.style.display = 'none';
      }
    }
    loadList();
  }

  // --- RENDERING SINGLE POST MODE ---
  if (postContainer) {
    const projectId = postContainer.dataset.projectId;
    if (!projectId) {
      postContainer.innerHTML = '<p class="cf-blog-error">Error: data-project-id attribute is missing!</p>';
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    let blogId = urlParams.get('id') || urlParams.get('slug');
    if (!blogId) {
      const cleanPath = window.location.pathname.replace(/\/$/, '');
      const pathParts = cleanPath.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart && lastPart !== 'blog' && lastPart !== 'blogs' && lastPart !== 'index.html') {
        blogId = lastPart;
      }
    }

    if (!blogId) {
      postContainer.innerHTML = '<p class="cf-blog-error">Error: Blog ID or slug is missing from URL path or query params (e.g. /blog/1 or ?id=1).</p>';
      return;
    }

    const postLoaderEl = document.createElement('div');
    postLoaderEl.className = 'cf-blog-loader';
    postLoaderEl.innerText = 'Loading story details...';
    postContainer.appendChild(postLoaderEl);

    async function loadPost() {
      try {
        const res = await fetch(workerOrigin + '/adminApiBlog/api/blogs/public/single?projectId=' + projectId + '&id=' + blogId);
        if (!res.ok) {
          throw new Error('Blog not found');
        }
        const data = await res.json();
        const blog = data.blog;

        postContainer.innerHTML = ''; // Clear loader

        const postWrap = document.createElement('article');
        postWrap.className = 'cf-post-container';

        const dateStr = blog.created_at ? new Date(blog.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
        const imgSection = blog.main_image_url 
          ? '<div class="cf-post-image"><img src="' + blog.main_image_url + '" onerror="this.parentNode.style.display=\\'none\\'"></div>'
          : '';

        let bodyHtml = '';
        if (blog.paragraphs && Array.isArray(blog.paragraphs)) {
          blog.paragraphs.forEach(function(p) {
            if (p.subheading) {
              bodyHtml += '<h2>' + p.subheading + '</h2>';
            }
            if (p.text) {
              bodyHtml += p.text;
            }
          });
        }

        postWrap.innerHTML = 
          '<header class="cf-post-header">' +
          (dateStr ? '  <div class="cf-post-meta">Published on ' + dateStr + '</div>' : '') +
          '  <h1 class="cf-post-title">' + blog.title + '</h1>' +
          (blog.subtitle ? '  <p class="cf-post-subtitle">' + blog.subtitle + '</p>' : '') +
          '</header>' +
          imgSection +
          '<div class="cf-post-body">' +
          bodyHtml +
          '</div>';

        postContainer.appendChild(postWrap);
      } catch (err) {
        console.error("Error loading blog details:", err);
        postContainer.innerHTML = '<p class="cf-blog-error">Story not found or failed to load.</p>';
      }
    }
    loadPost();
  }
})();
      `;
      return new Response(embedScript, {
        headers: {
          'Content-Type': 'application/javascript',
          ...corsHeaders,
        },
      });
    }

    // --- Serve public single blog viewing page ---
    const publicBlogMatch = path.match(/^\/adminApiBlog\/blog\/([a-zA-Z0-9_-]+)$/);
    if (publicBlogMatch && request.method === 'GET') {
      const slug = publicBlogMatch[1];
      const projectId = url.searchParams.get('project');

      const { data: blog, error } = await supabase
        .from('blogs')
        .select('*')
        .eq('slug', slug)
        .eq('project_id', projectId)
        .single();

      if (error || !blog) {
        return new Response('Blog post not found', { status: 404, headers: corsHeaders });
      }

      // Render a simple clean responsive reading view
      const renderBlogHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${blog.title}</title>
  <meta name="description" content="${blog.subtitle || ''}">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #fafafa;
      --text: #1e293b;
      --muted: #64748b;
      --font-sans: 'Plus Jakarta Sans', sans-serif;
      --font-serif: 'Playfair Display', Georgia, serif;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      margin: 0;
      padding: 0;
      line-height: 1.6;
    }
    header {
      max-width: 800px;
      margin: 60px auto 40px auto;
      padding: 0 20px;
      text-align: center;
    }
    h1 {
      font-family: var(--font-serif);
      font-size: 2.8rem;
      color: #0f172a;
      margin-bottom: 15px;
      line-height: 1.2;
    }
    .subtitle {
      font-size: 1.25rem;
      color: var(--muted);
      margin-bottom: 20px;
    }
    .meta {
      font-size: 0.9rem;
      color: var(--muted);
      font-weight: 500;
    }
    .hero-image {
      max-width: 900px;
      margin: 0 auto 40px auto;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0,0,0,0.05);
    }
    .hero-image img {
      width: 100%;
      max-height: 500px;
      object-fit: cover;
    }
    .content {
      max-width: 680px;
      margin: 0 auto 80px auto;
      padding: 0 20px;
      font-size: 1.15rem;
      color: #334155;
    }
    .content p {
      margin-bottom: 1.8rem;
      line-height: 1.8;
    }
    .content h2, .content h3 {
      font-family: var(--font-serif);
      color: #0f172a;
      margin-top: 2.5rem;
      margin-bottom: 1rem;
    }
    .image-block {
      margin: 2.5rem 0;
      text-align: center;
    }
    .image-block img {
      width: 100%;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }
    .image-row {
      display: flex;
      gap: 15px;
      margin: 2.5rem 0;
    }
    .image-row img {
      flex: 1;
      width: 100%;
      border-radius: 8px;
      object-fit: cover;
    }
  </style>
</head>
<body>
  <header>
    <h1>${blog.title}</h1>
    <p class="subtitle">${blog.subtitle || ''}</p>
    <div class="meta">Published on ${new Date(blog.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </header>
  
  ${blog.main_image_url ? `
  <div class="hero-image">
    <img src="${blog.main_image_url}">
  </div>
  ` : ''}

  <div class="content">
    ${blog.paragraphs.map(p => {
        let html = '';
        if (p.subheading) {
          html += `<h2>${p.subheading}</h2>`;
        }
        if (p.type === 'p') {
          html += `<div>${p.text}</div>`;
        } else if (p.type === 'img_row_2' || p.type === 'img_row_3') {
          const count = p.type === 'img_row_2' ? 2 : 3;
          const imgUrls = p.images || [];
          html += `<div class="image-row">`;
          for (let i = 0; i < count; i++) {
            if (imgUrls[i]) {
              html += `<img src="${imgUrls[i]}">`;
            }
          }
          html += `</div>`;
          if (p.text) html += `<div>${p.text}</div>`;
        } else {
          if (p.imageUrl) {
            html += `<div class="image-block"><img src="${p.imageUrl}"></div>`;
          }
          if (p.text) html += `<div>${p.text}</div>`;
        }
        return html;
      }).join('')}
  </div>
</body>
</html>
      `;
      return new Response(renderBlogHTML, {
        headers: { 'Content-Type': 'text/html', ...corsHeaders }
      });
    }

    // Public single blog JSON fetch (for CDN JS snippet single view)
    if (path === '/adminApiBlog/api/blogs/public/single' && request.method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      const blogId = url.searchParams.get('id');

      if (!projectId || !blogId) {
        return new Response(JSON.stringify({ error: "projectId and id are required" }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let query = supabase
        .from('blogs')
        .select('id, readable_id, title, subtitle, main_image_url, paragraphs, slug, created_at')
        .eq('project_id', projectId);

      if (/^\d+$/.test(blogId)) {
        query = query.eq('readable_id', parseInt(blogId));
      } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(blogId)) {
        query = query.eq('id', blogId);
      } else {
        query = query.eq('slug', blogId);
      }

      const { data: blog, error } = await query.maybeSingle();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!blog) {
        return new Response(JSON.stringify({ error: "Blog not found" }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const formattedBlog = {
        id: blog.readable_id || blog.id,
        uuid: blog.id,
        title: blog.title,
        subtitle: blog.subtitle,
        main_image_url: blog.main_image_url,
        paragraphs: blog.paragraphs,
        slug: blog.slug,
        created_at: blog.created_at
      };

      return new Response(JSON.stringify({ blog: formattedBlog }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Public blogs fetch (for CDN JS snippet)
    if (path === '/adminApiBlog/api/blogs/public' && request.method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      const limit = parseInt(url.searchParams.get('limit')) || 15;
      const offset = parseInt(url.searchParams.get('offset')) || 0;

      if (!projectId) {
        return new Response(JSON.stringify({ error: "projectId is required" }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data, error } = await supabase
        .from('blogs')
        .select('id, readable_id, title, subtitle, main_image_url, slug, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const formattedBlogs = data.map(b => ({
        id: b.readable_id || b.id,
        uuid: b.id,
        title: b.title,
        subtitle: b.subtitle,
        main_image_url: b.main_image_url,
        slug: b.slug,
        created_at: b.created_at
      }));

      return new Response(JSON.stringify({ blogs: formattedBlogs }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Authentication Actions ---
    if (path === '/adminApiBlog/auth/send-otp' && request.method === 'POST') {
      try {
        const { email } = await request.json();

        // Validate admin email
        let isAuthorized = false;
        try {
          const { data: adminUser, error: adminError } = await supabaseAdmin
            .from('admins')
            .select('email')
            .eq('email', email.toLowerCase())
            .maybeSingle();

          console.log(adminUser, adminError);

          if (adminUser && adminUser.email) {
            isAuthorized = true;

          }
        } catch (e) {
          console.log(e);
          // If query fails or table does not exist yet, fall back to environment config
        }

        if (!isAuthorized && email.toLowerCase() !== (env.ADMIN_EMAIL || '').toLowerCase()) {
          await logAction(supabaseAdmin, email, 'login_failed_unauthorized', { email }, request.headers.get('CF-Connecting-IP') || '');
          return new Response(JSON.stringify({ error: "Unauthorized email address." }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // Store OTP in database
        const { error } = await supabaseAdmin
          .from('auth_otps')
          .upsert({ email: email.toLowerCase(), otp, expires_at: expiresAt.toISOString() }, { onConflict: 'email' });

        if (error) throw error;

        await logAction(supabaseAdmin, email, 'otp_requested', { email }, request.headers.get('CF-Connecting-IP') || '');

        // Try to send email — but NEVER block the flow if it fails.
        // The OTP is already saved in DB and can still be verified.
        let emailFailed = false;
        try {
          await sendOTPEmail(env, email, otp);
        } catch (emailErr) {
          emailFailed = true;
          console.error('[OTP] Email send failed:', emailErr.message);
          console.warn(`🔑 OTP for ${email}: ${otp}`);
        }

        return new Response(JSON.stringify({
          message: emailFailed
            ? 'OTP generated. Email delivery failed — check server logs for the code.'
            : 'OTP sent successfully.',
          emailFailed,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (path === '/adminApiBlog/auth/verify-otp' && request.method === 'POST') {
      try {
        const { email, otp } = await request.json();

        const { data, error } = await supabaseAdmin
          .from('auth_otps')
          .select('*')
          .eq('email', email.toLowerCase())
          .single();

        if (error || !data) {
          await logAction(supabaseAdmin, email, 'login_failed_invalid_session', { email }, request.headers.get('CF-Connecting-IP') || '');
          return new Response(JSON.stringify({ error: "Invalid login session." }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (data.otp !== otp) {
          await logAction(supabaseAdmin, email, 'login_failed_incorrect_otp', { email }, request.headers.get('CF-Connecting-IP') || '');
          return new Response(JSON.stringify({ error: "Incorrect OTP." }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (new Date() > new Date(data.expires_at)) {
          await logAction(supabaseAdmin, email, 'login_failed_expired_otp', { email }, request.headers.get('CF-Connecting-IP') || '');
          return new Response(JSON.stringify({ error: "OTP has expired." }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Retrieve role and project_id for token payload
        let role = 'blogger';
        let projectId = null;
        try {
          const { data: adminUser } = await supabaseAdmin
            .from('admins')
            .select('role, project_id')
            .eq('email', email.toLowerCase())
            .maybeSingle();

          if (adminUser) {
            if (adminUser.role) role = adminUser.role;
            if (adminUser.project_id) projectId = adminUser.project_id;
          } else if (email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase()) {
            role = 'admin';
          }
        } catch (e) {
          if (email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase()) {
            role = 'admin';
          }
        }

        // Generate JWT Token
        const token = await signJWT(env, { email: email.toLowerCase(), role, projectId });

        // Clean up OTP
        await supabaseAdmin.from('auth_otps').delete().eq('email', email.toLowerCase());

        await logAction(supabaseAdmin, email, 'login_success', { email, role, projectId }, request.headers.get('CF-Connecting-IP') || '');

        return new Response(JSON.stringify({ token }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // --- PROTECTED ENDPOINTS BARRIER ---
    let payload = null;
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      payload = await verifyJWT(env, token);
    }

    // Require authentication for all /api/ admin requests
    if (path.startsWith('/adminApiBlog/api/') && !path.endsWith('/public') && !path.endsWith('/embed')) {
      if (!payload) {
        return new Response(JSON.stringify({ error: "Unauthorized access. Invalid or expired token." }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // GET & POST Projects
    if (path === '/adminApiBlog/api/projects') {
      if (request.method === 'GET') {
        let query = supabaseAdmin.from('projects').select('*');
        if (payload.projectId) {
          query = query.eq('id', payload.projectId);
        }
        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ projects: data }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST') {
        if (payload.projectId) {
          return new Response(JSON.stringify({ error: "Access denied. Restricted users cannot create projects." }), { status: 403, headers: corsHeaders });
        }
        const { name } = await request.json();
        if (!name) {
          return new Response(JSON.stringify({ error: "Project name is required" }), { status: 400, headers: corsHeaders });
        }
        const { data, error } = await supabaseAdmin
          .from('projects')
          .insert({ name })
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }
        await logAction(supabaseAdmin, payload.email, 'project_created', { name, id: data.id }, request.headers.get('CF-Connecting-IP') || '');
        return new Response(JSON.stringify(data), {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Delete Project
    const projectDeleteMatch = path.match(/^\/adminApiBlog\/api\/projects\/([a-zA-Z0-9_-]+)$/);
    if (projectDeleteMatch && request.method === 'DELETE') {
      if (payload.projectId) {
        return new Response(JSON.stringify({ error: "Access denied. Restricted users cannot delete projects." }), { status: 403, headers: corsHeaders });
      }
      const { error } = await supabaseAdmin
        .from('projects')
        .delete()
        .eq('id', projectDeleteMatch[1]);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
      await logAction(supabaseAdmin, payload.email, 'project_deleted', { id: projectDeleteMatch[1] }, request.headers.get('CF-Connecting-IP') || '');
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    // GET & POST Blogs for Admin
    if (path === '/adminApiBlog/api/blogs') {
      if (request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        if (!projectId) {
          return new Response(JSON.stringify({ error: "projectId is required" }), { status: 400, headers: corsHeaders });
        }
        if (payload.projectId && payload.projectId !== projectId) {
          return new Response(JSON.stringify({ error: "Access denied to this project's blogs." }), { status: 403, headers: corsHeaders });
        }
        const { data, error } = await supabaseAdmin
          .from('blogs')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false });

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ blogs: data }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST') {
        try {
          const { id, project_id, title, subtitle, main_image_url, paragraphs } = await request.json();

          if (!title || !project_id) {
            return new Response(JSON.stringify({ error: "Title and project_id are required" }), { status: 400, headers: corsHeaders });
          }
          if (payload.projectId && payload.projectId !== project_id) {
            return new Response(JSON.stringify({ error: "Access denied. You can only publish blogs to your assigned project." }), { status: 403, headers: corsHeaders });
          }

          // Generate simple clean slug
          const slug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)+/g, '');

          const blogPayload = {
            project_id,
            title,
            subtitle,
            main_image_url,
            paragraphs,
            slug,
            updated_at: new Date().toISOString()
          };

          let result;
          if (id) {
            // Update
            const { data, error } = await supabaseAdmin
              .from('blogs')
              .update(blogPayload)
              .eq('id', id)
              .select()
              .single();
            if (error) throw error;
            result = data;
            await logAction(supabaseAdmin, payload.email, 'blog_updated', { title, slug, project_id, id }, request.headers.get('CF-Connecting-IP') || '');
          } else {
            // Insert - Auto-assign readable_id
            const { data: maxBlog } = await supabaseAdmin
              .from('blogs')
              .select('readable_id')
              .eq('project_id', project_id)
              .order('readable_id', { ascending: false })
              .limit(1)
              .maybeSingle();

            const nextReadableId = maxBlog && maxBlog.readable_id ? maxBlog.readable_id + 1 : 1;
            blogPayload.readable_id = nextReadableId;

            const { data, error } = await supabaseAdmin
              .from('blogs')
              .insert(blogPayload)
              .select()
              .single();
            if (error) throw error;
            result = data;
            await logAction(supabaseAdmin, payload.email, 'blog_created', { title, slug, project_id, id: data.id }, request.headers.get('CF-Connecting-IP') || '');
          }

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
        }
      }
    }

    // Delete Blog
    const blogDeleteMatch = path.match(/^\/adminApiBlog\/api\/blogs\/([a-zA-Z0-9_-]+)$/);
    if (blogDeleteMatch && request.method === 'DELETE') {
      const blogId = blogDeleteMatch[1];
      if (payload.projectId) {
        const { data: blog } = await supabaseAdmin
          .from('blogs')
          .select('project_id')
          .eq('id', blogId)
          .single();
        if (blog && blog.project_id !== payload.projectId) {
          return new Response(JSON.stringify({ error: "Access denied. You cannot delete this blog." }), { status: 403, headers: corsHeaders });
        }
      }
      const { error } = await supabaseAdmin
        .from('blogs')
        .delete()
        .eq('id', blogId);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
      await logAction(supabaseAdmin, payload.email, 'blog_deleted', { id: blogId }, request.headers.get('CF-Connecting-IP') || '');
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    // POST Image Upload to Cloudflare R2
    if (path === '/adminApiBlog/api/upload' && request.method === 'POST') {
      try {
        if (!env.BUCKET) {
          return new Response(JSON.stringify({ error: "Image upload is temporarily disabled because Cloudflare R2 is not configured." }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const fileKey = `${crypto.randomUUID()}.jpg`;
        const contentType = request.headers.get('content-type') || 'image/jpeg';
        const bodyArrayBuffer = await request.arrayBuffer();

        await env.BUCKET.put(fileKey, bodyArrayBuffer, {
          httpMetadata: { contentType }
        });

        const accessUrl = `${url.origin}/adminApiBlog/cdn/image/${encodeURIComponent(fileKey)}`;
        return new Response(JSON.stringify({ url: accessUrl }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // --- AUDIT LOGS ENDPOINT (RESTRICTED TO GLOBAL ADMINS/DEVELOPERS) ---
    if (path === '/adminApiBlog/api/audit-logs') {
      if (!payload || (payload.role !== 'admin' && payload.role !== 'developer') || payload.projectId) {
        return new Response(JSON.stringify({ error: "Access denied. Only global admins/developers can view audit logs." }), { status: 403, headers: corsHeaders });
      }

      if (request.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit')) || 100;
        const offset = parseInt(url.searchParams.get('offset')) || 0;

        const { data, error } = await supabaseAdmin
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ logs: data }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // --- USER MANAGEMENT (RESTRICTED TO GLOBAL ADMINS/DEVELOPERS) ---
    if (path === '/adminApiBlog/api/users') {
      if (!payload || (payload.role !== 'admin' && payload.role !== 'developer') || payload.projectId) {
        return new Response(JSON.stringify({ error: "Access denied. Only global admins/developers can manage users." }), { status: 403, headers: corsHeaders });
      }

      if (request.method === 'GET') {
        const { data, error } = await supabaseAdmin
          .from('admins')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ users: data }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST') {
        const { email, role, project_id } = await request.json();
        if (!email || !role) {
          return new Response(JSON.stringify({ error: "Email and role are required." }), { status: 400, headers: corsHeaders });
        }

        let userId = null;

        if (env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
              email: email.toLowerCase(),
              email_confirm: true,
              password: Math.random().toString(36).substring(2, 15)
            });

            if (authError) {
              if (authError.message.includes("already registered") || authError.message.includes("already exists")) {
                const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
                if (listError) throw listError;
                const matched = existingUsers.users.find(u => u.email.toLowerCase() === email.toLowerCase());
                if (matched) {
                  userId = matched.id;
                } else {
                  throw authError;
                }
              } else {
                throw authError;
              }
            } else {
              userId = authUser.user.id;
            }
          } catch (e) {
            return new Response(JSON.stringify({ error: "Failed to create Auth user: " + e.message }), { status: 500, headers: corsHeaders });
          }
        } else {
          return new Response(JSON.stringify({ error: "Configuration Error: SUPABASE_SERVICE_ROLE_KEY is required to manage console users." }), { status: 500, headers: corsHeaders });
        }

        const insertData = {
          id: userId,
          email: email.toLowerCase(),
          role,
          project_id: project_id || null
        };

        const { data, error } = await supabaseAdmin
          .from('admins')
          .upsert(insertData)
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }
        await logAction(supabaseAdmin, payload.email, 'user_added', { email: email.toLowerCase(), role, project_id }, request.headers.get('CF-Connecting-IP') || '');
        return new Response(JSON.stringify({ user: data }), {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const deleteUserMatch = path.match(/^\/adminApiBlog\/api\/users\/([^/]+)$/);
    if (deleteUserMatch && request.method === 'DELETE') {
      if (!payload || (payload.role !== 'admin' && payload.role !== 'developer') || payload.projectId) {
        return new Response(JSON.stringify({ error: "Access denied. Only global admins/developers can manage users." }), { status: 403, headers: corsHeaders });
      }

      const emailToDelete = decodeURIComponent(deleteUserMatch[1]).toLowerCase();

      // Retrieve auth user ID first to delete them from auth.users
      const { data: adminUser } = await supabaseAdmin
        .from('admins')
        .select('id')
        .eq('email', emailToDelete)
        .maybeSingle();

      if (adminUser && adminUser.id && env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          await supabaseAdmin.auth.admin.deleteUser(adminUser.id);
        } catch (e) {
          console.error("Failed to delete user from Supabase Auth:", e);
        }
      }

      const { error } = await supabaseAdmin
        .from('admins')
        .delete()
        .eq('email', emailToDelete);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
      await logAction(supabaseAdmin, payload.email, 'user_deleted', { email: emailToDelete }, request.headers.get('CF-Connecting-IP') || '');
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    // --- Serve HTML Dashboard ---
    if (path === '/adminApiBlog' && request.method === 'GET') {
      const dashboardHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Certifyied SEO Blog Engine - Client Portal</title>
  <!-- Google Fonts & Quill CSS -->
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link href="https://cdn.quilljs.com/1.3.6/quill.snow.css" rel="stylesheet">
  <script src="https://cdn.quilljs.com/1.3.6/quill.js"></script>
  <style>
    :root {
      --bg: #080710;
      --card-bg: rgba(17, 24, 39, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --text: #f9fafb;
      --muted: #9ca3af;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --accent: #10b981;
      --danger: #ef4444;
      --font-sans: 'Plus Jakarta Sans', sans-serif;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg);
      background: radial-gradient(circle at 10% 20%, rgba(99, 102, 241, 0.15) 0%, transparent 40%),
                  radial-gradient(circle at 90% 80%, rgba(16, 185, 129, 0.1) 0%, transparent 40%),
                  var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      padding: 60px 20px;
      display: flex;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      width: 100%;
      max-width: 1000px;
      display: flex;
      flex-direction: column;
      gap: 35px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 35px;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
      backdrop-filter: blur(16px) saturate(120%);
      transition: border-color 0.3s ease, box-shadow 0.3s ease;
    }
    .card:hover {
      border-color: rgba(99, 102, 241, 0.3);
      box-shadow: 0 10px 40px 0 rgba(99, 102, 241, 0.15);
    }
    h1, h2, h3 {
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    p {
      color: var(--muted);
      font-size: 14.5px;
      line-height: 1.6;
    }
    .btn {
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: white;
      border: none;
      padding: 14px 28px;
      border-radius: 10px;
      font-weight: 700;
      cursor: pointer;
      font-size: 14px;
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
      background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
    }
    .btn:active {
      transform: translateY(0);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: var(--text);
      box-shadow: none;
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
      box-shadow: 0 4px 15px rgba(255, 255, 255, 0.05);
    }
    .btn-danger {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      box-shadow: 0 4px 15px rgba(239, 68, 68, 0.25);
    }
    .btn-danger:hover {
      background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
      box-shadow: 0 6px 20px rgba(239, 68, 68, 0.45);
    }
    input, select, textarea {
      width: 100%;
      padding: 14px;
      background: rgba(31, 41, 55, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: white;
      border-radius: 10px;
      font-family: inherit;
      font-size: 14px;
      transition: all 0.3s ease;
      margin-top: 6px;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      background: rgba(31, 41, 55, 0.7);
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
    }
    label {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.75px;
      color: var(--muted);
    }
    .flex-group {
      display: flex;
      gap: 15px;
    }
    .flex-group > * {
      flex: 1;
    }
    /* Auth Form styling */
    .auth-box {
      max-width: 420px;
      margin: 80px auto;
    }
    .auth-box input {
      margin-bottom: 20px;
    }
    /* Dashboard view layout */
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 25px;
    }
    .tab-section {
      display: none;
    }
    .tab-active {
      display: block;
    }
    .project-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 24px;
      margin-top: 20px;
    }
    .project-card {
      background: rgba(22, 30, 46, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 24px;
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      gap: 15px;
      transition: all 0.3s ease;
    }
    .project-card:hover {
      transform: translateY(-4px);
      background: rgba(22, 30, 46, 0.7);
      border-color: rgba(99, 102, 241, 0.3);
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.25);
    }
    .blog-list-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 24px;
      margin-top: 20px;
    }
    .blog-card {
      background: rgba(22, 30, 46, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: all 0.3s ease;
    }
    .blog-card:hover {
      transform: translateY(-4px);
      border-color: rgba(99, 102, 241, 0.3);
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.25);
    }
    .blog-card-img {
      height: 120px;
      background: rgba(255, 255, 255, 0.03);
      object-fit: cover;
      width: 100%;
    }
    .blog-card-body {
      padding: 20px;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .blog-card-title {
      font-size: 15px;
      font-weight: 700;
    }
    /* Editor styling */
    .editor-block {
      background: rgba(22, 30, 46, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      position: relative;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .editor-block-trash {
      position: absolute;
      top: 20px;
      right: 20px;
    }
    .quill-editor-wrapper {
      background: white;
      color: black;
      border-radius: 10px;
      overflow: hidden;
      margin-top: 10px;
    }
    .ql-toolbar {
      background: #f3f4f6;
    }
    .snippet-box {
      background: rgba(17, 24, 39, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 20px;
      font-family: monospace;
      font-size: 13px;
      color: #10b981;
      border-radius: 10px;
      overflow-x: auto;
      margin-top: 10px;
      box-shadow: inset 0 2px 8px rgba(0,0,0,0.5);
      white-space: pre-wrap;
      word-break: break-all;
    }
    .sitemap-item {
      display: flex;
      justify-content: space-between;
      background: rgba(22, 30, 46, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 14px 20px;
      border-radius: 10px;
      margin-bottom: 12px;
      font-size: 13px;
      align-items: center;
      transition: all 0.2s ease;
    }
    .sitemap-item:hover {
      background: rgba(22, 30, 46, 0.8);
      border-color: rgba(99, 102, 241, 0.2);
    }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- AUTH VIEW -->
    <div id="view-auth" class="card auth-box tab-section tab-active">
      <h2 style="margin-bottom: 10px;">Certifyied Dev & Writer Portal</h2>
      <p style="margin-bottom: 20px;">Access the multi-client SEO blog manager. Enter your admin email to receive a secure OTP code.</p>
      
      <div id="email-step">
        <label>Developer Email</label>
        <input type="email" id="auth-email" placeholder="email@example.com">
        <button class="btn" style="width: 100%; margin-top: 10px;" onclick="sendOTP()">Send OTP</button>
      </div>

      <div id="otp-step" style="display: none;">
        <label>Enter 6-Digit OTP</label>
        <input type="text" id="auth-otp" placeholder="123456" maxlength="6">
        <button class="btn" style="width: 100%; margin-top: 10px;" onclick="verifyOTP()">Verify & Log In</button>
        <button class="btn btn-secondary" style="width: 100%; margin-top: 10px;" onclick="showEmailStep()">Back</button>
      </div>
    </div>

    <!-- MAIN DASHBOARD -->
    <div id="view-dashboard" class="tab-section">
      <div class="card header-bar" style="margin-bottom: 20px;">
        <div>
          <h2>Certifyied Client Blog Engine</h2>
          <p>Provision client website projects, write SEO-optimized stories, generate search sitemaps, and obtain CDN integration snippets.</p>
        </div>
        <button class="btn btn-secondary btn-danger" onclick="logout()">Log Out</button>
      </div>

      <!-- PROJECTS VIEW -->
      <div id="panel-projects" class="tab-section tab-active">
        <div style="margin-bottom: 20px; display: flex; gap: 10px; justify-content: flex-end;">
          <button class="btn btn-secondary global-only" onclick="showUsersPanel()">👥 User Permissions</button>
          <button class="btn btn-secondary global-only" onclick="showAuditLogsPanel()">📜 Audit Logs</button>
        </div>
        
        <div class="card dev-only" style="margin-bottom: 25px;">
          <h3>Provision New Client Website Project</h3>
          <p style="margin-top: 5px; margin-bottom: 10px; font-size: 13px;">Creating a project adds a new row in your Supabase database with a unique Project ID and establishes a fast indexed query workspace to serve all its associated blogs.</p>
          <div class="flex-group" style="margin-top: 15px;">
            <input type="text" id="new-project-name" placeholder="Client / Site Name (e.g., Acme Agency, Spark eCommerce)">
            <button class="btn" onclick="createProject()">Create Project Row</button>
          </div>
        </div>

        <h3 style="margin-bottom: 15px;">Your Projects</h3>
        <div id="projects-list" class="project-grid">
          <!-- Projects load here -->
        </div>
      </div>

      <!-- USERS PANEL -->
      <div id="panel-users" class="tab-section">
        <button class="btn btn-secondary" style="margin-bottom: 20px;" onclick="goBack()">← Back</button>
        
        <div class="card" style="margin-bottom: 25px;">
          <h3>Add / Invite User</h3>
          <p style="margin-top: 5px; margin-bottom: 15px; font-size: 13px;">Add a new user with a specific role. Assigning them to a specific project limits their visibility to only that project.</p>
          <div class="flex-group" style="margin-top: 15px; flex-wrap: wrap; gap: 15px;">
            <div style="flex: 2; min-width: 200px;">
              <label>User Email</label>
              <input type="email" id="new-user-email" placeholder="user@example.com" style="width:100%; height:42px;">
            </div>
            <div style="flex: 1; min-width: 120px;">
              <label>Role</label>
              <select id="new-user-role" style="width:100%; height:42px; background:#111827; border:1px solid rgba(255,255,255,0.08); border-radius:8px; color:#f9fafb; padding:0 10px;">
                <option value="blogger">Blogger</option>
                <option value="developer">Developer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style="flex: 2; min-width: 200px;">
              <label>Assign Project (Optional)</label>
              <select id="new-user-project" style="width:100%; height:42px; background:#111827; border:1px solid rgba(255,255,255,0.08); border-radius:8px; color:#f9fafb; padding:0 10px;">
                <option value="">All Projects (Global)</option>
              </select>
            </div>
            <button class="btn" onclick="createUser()" style="margin-top:24px; height:42px;">Add User</button>
          </div>
        </div>

        <h3 style="margin-bottom: 15px;">Console Users</h3>
        <div class="card" style="padding:0; overflow:hidden; margin-bottom: 25px;">
          <table style="width:100%; border-collapse:collapse; text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02);">
                <th style="padding:15px; font-size:12px; text-transform:uppercase; color:var(--muted);">Email</th>
                <th style="padding:15px; font-size:12px; text-transform:uppercase; color:var(--muted);">Role</th>
                <th style="padding:15px; font-size:12px; text-transform:uppercase; color:var(--muted);">Assigned Project</th>
                <th style="padding:15px; font-size:12px; text-transform:uppercase; color:var(--muted); text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody id="users-list">
              <!-- Users load here -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- AUDIT LOGS PANEL -->
      <div id="panel-audit-logs" class="tab-section">
        <button class="btn btn-secondary" style="margin-bottom: 20px;" onclick="goBack()">← Back</button>
        
        <h3 style="margin-bottom: 15px;">System Audit Trails & Login History</h3>
        <div class="card" style="padding:0; overflow:hidden; margin-bottom: 25px;">
          <table style="width:100%; border-collapse:collapse; text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02);">
                <th style="padding:15px; font-size:12px; text-transform:uppercase; color:var(--muted); width: 180px;">Timestamp</th>
                <th style="padding:15px; font-size:12px; text-transform:uppercase; color:var(--muted); width: 200px;">Email</th>
                <th style="padding:15px; font-size:12px; text-transform:uppercase; color:var(--muted); width: 160px;">Action</th>
                <th style="padding:15px; font-size:12px; text-transform:uppercase; color:var(--muted); width: 130px;">IP Address</th>
                <th style="padding:15px; font-size:12px; text-transform:uppercase; color:var(--muted);">Details</th>
              </tr>
            </thead>
            <tbody id="audit-logs-list">
              <!-- Logs load here -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- SINGLE PROJECT VIEW (Blogs & Integrations) -->
      <div id="panel-project-detail" class="tab-section">
        <div style="margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
          <button id="btn-back-to-projects" class="btn btn-secondary" onclick="showPanel('panel-projects')">← Back to Projects</button>
          <button class="btn" onclick="newBlog()">✍️ New Blog Story</button>
          <button class="btn btn-secondary dev-only" onclick="showIntegrations()">🔌 Get CDN Embed Snippet</button>
          <button class="btn btn-secondary dev-only" onclick="showSitemaps()">🔗 Get Sitemap Links</button>
          <button class="btn btn-secondary global-only" onclick="showUsersPanel()">👥 User Permissions</button>
          <button class="btn btn-secondary global-only" onclick="showAuditLogsPanel()">📜 Audit Logs</button>
        </div>

        <div class="card" style="margin-bottom: 25px;">
          <h2 id="detail-project-name">Project Details</h2>
          <p id="detail-project-id" style="font-family: monospace; font-size: 12px; margin-top: 5px; color: var(--accent);"></p>
        </div>

        <h3 style="margin-bottom: 15px;">Published Stories</h3>
        <div id="blogs-list" class="blog-list-grid">
          <!-- Blogs load here -->
        </div>
      </div>

      <!-- INTEGRATIONS MODAL/PANEL -->
      <div id="panel-integrations" class="tab-section">
        <button class="btn btn-secondary" style="margin-bottom: 20px;" onclick="showPanel('panel-project-detail')">← Back to Blogs</button>
        
        <div class="card" style="margin-bottom: 20px;">
          <h3>1. Home Page Integration (3x3 Grid View)</h3>
          <p style="margin-top: 5px; margin-bottom: 15px;">Copy the code below and place it on your Home page. It will automatically render a responsive 3x3 blog card grid.</p>
          <label>Embed HTML Snippet (Home Page)</label>
          <div id="integration-snippet-home" class="snippet-box"></div>
          <button class="btn" style="margin-top: 15px;" onclick="copySnippetHome()">Copy Home Page Snippet</button>
        </div>

        <div class="card" style="margin-top: 20px;">
          <h3>2. Blog Page Integration (Single Post Reader)</h3>
          <p style="margin-top: 5px; margin-bottom: 15px;">Copy the code below and place it on your Blog detail page. The script will dynamically load the post based on URL path (e.g. \`/blog/1\`) or query params (e.g. \`?id=1\`).</p>
          <label>Embed HTML Snippet (Blog Page)</label>
          <div id="integration-snippet-blog" class="snippet-box"></div>
          <button class="btn" style="margin-top: 15px;" onclick="copySnippetBlog()">Copy Blog Page Snippet</button>
        </div>
      </div>

      <!-- SITEMAP MODAL/PANEL -->
      <div id="panel-sitemaps" class="tab-section">
        <button class="btn btn-secondary" style="margin-bottom: 20px;" onclick="showPanel('panel-project-detail')">← Back to Blogs</button>
        <div class="card">
          <h3>Generate Sitemap Links</h3>
          <p style="margin-top: 5px; margin-bottom: 15px;">Below are all public URLs generated for your blogs. Click the button to copy all links for your sitemap.xml config.</p>
          
          <div id="sitemap-list" style="margin-top: 15px; display: flex; flex-direction: column; gap: 10px;">
            <!-- Sitemaps map here -->
          </div>
          <button class="btn" style="margin-top: 15px;" onclick="copyAllSitemaps()">Copy All URLs</button>
        </div>
      </div>

      <!-- BLOG WRITER / EDITOR -->
      <div id="panel-blog-editor" class="tab-section">
        <button class="btn btn-secondary" style="margin-bottom: 20px;" onclick="cancelEditor()">← Cancel</button>
        
        <div class="card" style="display: flex; flex-direction: column; gap: 20px;">
          <h2 id="editor-title-label">Craft New Story</h2>
          <input type="hidden" id="edit-blog-id">

          <div>
            <label>Blog Title *</label>
            <input type="text" id="blog-title" placeholder="Stunning headline...">
          </div>

          <div>
            <label>Blog Subtitle / Excerpt</label>
            <input type="text" id="blog-subtitle" placeholder="Short intro describing the story...">
          </div>

          <div>
            <label>Cover Image (Upload directly to R2 / S3)</label>
            <div style="display: flex; gap: 10px; margin-top: 5px;">
              <input type="text" id="blog-cover-url" placeholder="R2 image URL matches here after uploading...">
              <button class="btn" type="button" onclick="document.getElementById('cover-file-input').click()">📤 Upload Cover</button>
              <input type="file" id="cover-file-input" style="display: none;" onchange="uploadImage(this, 'blog-cover-url')">
            </div>
          </div>

          <div id="editor-paragraphs-container" style="display: flex; flex-direction: column; gap: 20px;">
            <!-- Dynamic blocks here -->
          </div>

          <div>
            <label>Add Content block</label>
            <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
              <button class="btn btn-secondary" onclick="addParagraphBlock('p')">📝 Text Only</button>
              <button class="btn btn-secondary" onclick="addParagraphBlock('img_row_2')">🖼️ 2 Images Row</button>
              <button class="btn btn-secondary" onclick="addParagraphBlock('img_row_3')">🖼️ 3 Images Row</button>
              <button class="btn btn-secondary" onclick="addParagraphBlock('img_text')">📷 Image + Text Block</button>
            </div>
          </div>

          <button class="btn" style="align-self: flex-end; margin-top: 20px;" onclick="saveBlog()">🚀 Publish Story to Live Site</button>
        </div>
      </div>

    </div>
  </div>

  <script>
    const baseUrl = window.location.origin + "/adminApiBlog";
    let token = localStorage.getItem('blog_auth_token');
    let selectedProjectId = '';
    let projectsCache = [];
    let blogsCache = [];
    let currentPanel = 'panel-projects';
    let previousPanel = 'panel-projects';

    // On Load
    if (token) {
      showDashboard();
    }

    function getPayload() {
      if (!token) return null;
      try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
      } catch (e) {
        return null;
      }
    }

    function showDashboard() {
      document.getElementById('view-auth').classList.remove('tab-active');
      document.getElementById('view-dashboard').classList.add('tab-active');
      
      const payload = getPayload();
      const role = payload ? payload.role : 'blogger';
      const isGlobal = payload && !payload.projectId;
      
      if (role === 'admin' || role === 'developer') {
        document.querySelectorAll('.dev-only').forEach(el => el.style.display = 'block');
      } else {
        document.querySelectorAll('.dev-only').forEach(el => {
          if (el.tagName === 'BUTTON') el.style.display = 'none';
          else el.style.display = 'none';
        });
      }

      if ((role === 'admin' || role === 'developer') && isGlobal) {
        document.querySelectorAll('.global-only').forEach(el => el.style.display = 'block');
      } else {
        document.querySelectorAll('.global-only').forEach(el => el.style.display = 'none');
      }
      
      if (payload && payload.projectId) {
        // Go straight to the single project detail
        selectedProjectId = payload.projectId;
        document.getElementById('detail-project-name').innerText = "Assigned Workspace";
        document.getElementById('detail-project-id').innerText = "Project ID: " + payload.projectId;
        
        // Hide the back-to-projects button
        document.getElementById('btn-back-to-projects').style.display = 'none';
        
        showPanel('panel-project-detail');
        loadBlogs();
      } else {
        document.getElementById('btn-back-to-projects').style.display = 'block';
        showPanel('panel-projects');
        loadProjects();
      }
    }

    function logout() {
      localStorage.removeItem('blog_auth_token');
      token = null;
      document.getElementById('view-dashboard').classList.remove('tab-active');
      document.getElementById('view-auth').classList.add('tab-active');
      showEmailStep();
    }



    function showPanel(panelId) {
      if (panelId !== currentPanel) {
        previousPanel = currentPanel;
        currentPanel = panelId;
      }
      document.querySelectorAll('#view-dashboard > .tab-section').forEach(el => {
        el.classList.remove('tab-active');
      });
      document.getElementById(panelId).classList.add('tab-active');
    }

    function goBack() {
      showPanel(previousPanel);
    }

    // --- AUTH FLOW ---
    function showEmailStep() {
      document.getElementById('email-step').style.display = 'block';
      document.getElementById('otp-step').style.display = 'none';
    }

    async function sendOTP() {
      const email = document.getElementById('auth-email').value;
      if (!email) return alert("Email is required!");

      const btn = document.querySelector('#email-step button');
      btn.disabled = true;
      btn.innerText = 'Sending...';

      try {
        const res = await fetch(baseUrl + "/auth/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const data = await res.json();

        if (res.ok) {
          // Always show OTP field — even if email failed, OTP is saved in DB
          document.getElementById('email-step').style.display = 'none';
          document.getElementById('otp-step').style.display = 'block';

          if (data.emailFailed) {
            alert("⚠️ OTP generated but email delivery failed. Check wrangler logs for the code, or check your Resend API key.");
          } else {
            alert("✅ OTP sent! Please check your email.");
          }
        } else {
          alert(data.error || "Failed to send OTP.");
        }
      } catch (e) {
        alert("Network error: " + e.message);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Send OTP';
      }
    }

    async function verifyOTP() {
      const email = document.getElementById('auth-email').value;
      const otp = document.getElementById('auth-otp').value;
      if (!otp) return alert("OTP is required!");
      try {
        const res = await fetch(baseUrl + "/auth/verify-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, otp })
        });
        const data = await res.json();
        if (res.ok) {
          token = data.token;
          localStorage.setItem('blog_auth_token', token);
          showDashboard();
        } else {
          alert(data.error || "Incorrect OTP.");
        }
      } catch (e) {
        alert("Verification failed: " + e.message);
      }
    }

    // --- PROJECTS FLOW ---
    async function loadProjects() {
      try {
        const res = await fetch(baseUrl + "/api/projects", {
          headers: { "Authorization": "Bearer " + token }
        });
        if (res.status === 401) return logout();
        const data = await res.json();
        projectsCache = data.projects || [];
        renderProjects();
      } catch (e) {
        alert("Failed to load projects: " + e.message);
      }
    }

    function renderProjects() {
      const listEl = document.getElementById('projects-list');
      listEl.innerHTML = '';
      projectsCache.forEach(p => {
        const card = document.createElement('div');
        card.className = 'project-card';
        
        const title = document.createElement('h4');
        title.style.fontSize = '18px';
        title.innerText = p.name;
        
        const pid = document.createElement('p');
        pid.style.fontFamily = 'monospace';
        pid.style.fontSize = '11px';
        pid.style.color = 'var(--accent)';
        pid.innerText = 'ID: ' + p.id;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '10px';
        btnGroup.style.marginTop = 'auto';
        
        const manageBtn = document.createElement('button');
        manageBtn.className = 'btn btn-secondary';
        manageBtn.style.flex = '1';
        manageBtn.innerText = 'Manage Blogs';
        manageBtn.onclick = () => viewProject(p.id, p.name);
        
        btnGroup.appendChild(manageBtn);

        const payload = getPayload();
        const role = payload ? payload.role : 'blogger';
        if (role === 'admin' || role === 'developer') {
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'btn btn-danger';
          deleteBtn.style.padding = '10px';
          deleteBtn.innerText = '🗑️';
          deleteBtn.onclick = () => deleteProject(p.id);
          btnGroup.appendChild(deleteBtn);
        }
        
        card.appendChild(title);
        card.appendChild(pid);
        card.appendChild(btnGroup);
        
        listEl.appendChild(card);
      });
    }

    async function createProject() {
      const name = document.getElementById('new-project-name').value;
      if (!name) return alert("Name is required!");
      try {
        const res = await fetch(baseUrl + "/api/projects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
          },
          body: JSON.stringify({ name })
        });
        if (res.ok) {
          document.getElementById('new-project-name').value = '';
          loadProjects();
        } else {
          const data = await res.json();
          alert(data.error);
        }
      } catch (e) {
        alert("Error adding project");
      }
    }

    async function deleteProject(id) {
      if (!confirm("Are you sure you want to delete this project? This will delete all associated blogs permanently!")) return;
      try {
        const res = await fetch(baseUrl + "/api/projects/" + id, {
          method: "DELETE",
          headers: { "Authorization": "Bearer " + token }
        });
        if (res.ok) loadProjects();
      } catch (e) {
        alert("Failed to delete project");
      }
    }

    function viewProject(id, name) {
      selectedProjectId = id;
      document.getElementById('detail-project-name').innerText = name;
      document.getElementById('detail-project-id').innerText = "Project ID: " + id;
      showPanel('panel-project-detail');
      loadBlogs();
    }

    // --- BLOGS FLOW ---
    async function loadBlogs() {
      try {
        const res = await fetch(baseUrl + "/api/blogs?projectId=" + selectedProjectId, {
          headers: { "Authorization": "Bearer " + token }
        });
        const data = await res.json();
        blogsCache = data.blogs || [];
        renderBlogs();
      } catch (e) {
        alert("Failed to load blogs");
      }
    }

    function renderBlogs() {
      const listEl = document.getElementById('blogs-list');
      listEl.innerHTML = '';
      if (blogsCache.length === 0) {
        listEl.innerHTML = '<p style="grid-column:1/-1; text-align:center;">No published stories found. Click "New Blog Story" to create one!</p>';
        return;
      }
      blogsCache.forEach(b => {
        const card = document.createElement('div');
        card.className = 'blog-card';
        const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="%231f2937"><rect width="100%" height="100%"/></svg>';
        
        const img = document.createElement('img');
        img.className = 'blog-card-img';
        img.src = b.main_image_url || fallback;
        img.onerror = () => { img.src = fallback; };
        
        const body = document.createElement('div');
        body.className = 'blog-card-body';
        
        const title = document.createElement('span');
        title.className = 'blog-card-title';
        title.innerText = b.title || '';
        
        const subtitle = document.createElement('span');
        subtitle.style.fontSize = '12px';
        subtitle.style.color = 'var(--muted)';
        subtitle.innerText = b.subtitle || '';
        
        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '10px';
        btnGroup.style.marginTop = 'auto';
        btnGroup.style.paddingTop = '10px';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-secondary';
        editBtn.style.flex = '1';
        editBtn.style.padding = '8px';
        editBtn.innerText = 'Edit';
        editBtn.onclick = () => editBlog(b.id);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.style.padding = '8px';
        deleteBtn.innerText = '🗑️';
        deleteBtn.onclick = () => deleteBlog(b.id);
        
        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(deleteBtn);
        
        body.appendChild(title);
        body.appendChild(subtitle);
        body.appendChild(btnGroup);
        
        card.appendChild(img);
        card.appendChild(body);
        
        listEl.appendChild(card);
      });
    }

    async function deleteBlog(id) {
      if (!confirm("Are you sure you want to delete this story?")) return;
      try {
        const res = await fetch(baseUrl + "/api/blogs/" + id, {
          method: "DELETE",
          headers: { "Authorization": "Bearer " + token }
        });
        if (res.ok) loadBlogs();
      } catch (e) {
        alert("Error deleting blog");
      }
    }

    // --- INTEGRATIONS SNIPPET ---
    function showIntegrations() {
      const homeSnippet = '<!-- Container where the 3x3 blog grid will load -->\\n' +
        '<div id="certifyied-blog-container" data-project-id="' + selectedProjectId + '" data-limit="9" data-redirect-url="/blog"></div>\\n\\n' +
        '<!-- Load CDN Embed Script -->\\n' +
        '<' + 'script src="' + baseUrl + '/api/embed"><' + '/script>';
      
      const blogSnippet = '<!-- Container where the single blog post will load -->\\n' +
        '<div id="certifyied-blog-post" data-project-id="' + selectedProjectId + '"></div>\\n\\n' +
        '<!-- Load CDN Embed Script -->\\n' +
        '<' + 'script src="' + baseUrl + '/api/embed"><' + '/script>';

      document.getElementById('integration-snippet-home').innerText = homeSnippet;
      document.getElementById('integration-snippet-blog').innerText = blogSnippet;
      showPanel('panel-integrations');
    }

    function copySnippetHome() {
      navigator.clipboard.writeText(document.getElementById('integration-snippet-home').innerText);
      alert("Home Page snippet code copied to clipboard!");
    }

    function copySnippetBlog() {
      navigator.clipboard.writeText(document.getElementById('integration-snippet-blog').innerText);
      alert("Blog Page snippet code copied to clipboard!");
    }

    // --- SITEMAPS GENERATOR ---
    function showSitemaps() {
      const container = document.getElementById('sitemap-list');
      container.innerHTML = '';
      
      if (blogsCache.length === 0) {
        container.innerHTML = '<p>Publish some blogs to generate sitemap links.</p>';
        return;
      }
      
      blogsCache.forEach(b => {
        const blogUrl = baseUrl + '/blog/' + b.slug + '?project=' + selectedProjectId;
        const div = document.createElement('div');
        div.className = 'sitemap-item';
        
        const span = document.createElement('span');
        span.style.fontFamily = 'monospace';
        span.style.color = 'var(--accent)';
        span.innerText = blogUrl;
        
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.style.padding = '6px 12px';
        btn.style.fontSize = '12px';
        btn.innerText = 'Copy';
        btn.onclick = () => {
          navigator.clipboard.writeText(blogUrl);
          alert('Copied link!');
        };
        
        div.appendChild(span);
        div.appendChild(btn);
        container.appendChild(div);
      });
      showPanel('panel-sitemaps');
    }

    function copyAllSitemaps() {
      const links = blogsCache.map(b => baseUrl + '/blog/' + b.slug + '?project=' + selectedProjectId).join('\\n');
      navigator.clipboard.writeText(links);
      alert("All blog links copied to clipboard!");
    }

    // --- SYSTEM AUDIT LOGS DISPLAY ---
    async function showAuditLogsPanel() {
      showPanel('panel-audit-logs');
      loadAuditLogs();
    }

    async function loadAuditLogs() {
      try {
        const res = await fetch(baseUrl + "/api/audit-logs?limit=100", {
          headers: { "Authorization": "Bearer " + token }
        });
        const data = await res.json();
        const logs = data.logs || [];
        renderAuditLogs(logs);
      } catch (e) {
        alert("Failed to load audit logs: " + e.message);
      }
    }

    function renderAuditLogs(logs) {
      const listEl = document.getElementById('audit-logs-list');
      listEl.innerHTML = '';
      if (logs.length === 0) {
        listEl.innerHTML = '<tr><td colspan="5" style="padding:15px; text-align:center; color:var(--muted);">No audit logs found.</td></tr>';
        return;
      }
      logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        
        const tdTime = document.createElement('td');
        tdTime.style.padding = '15px';
        tdTime.style.fontSize = '13px';
        tdTime.innerText = new Date(log.created_at).toLocaleString();
        
        const tdEmail = document.createElement('td');
        tdEmail.style.padding = '15px';
        tdEmail.style.fontSize = '13px';
        tdEmail.innerText = log.email;
        
        const tdAction = document.createElement('td');
        tdAction.style.padding = '15px';
        tdAction.style.fontSize = '13px';
        tdAction.innerHTML = '<span style="background:rgba(99,102,241,0.15); color:#818cf8; padding:3px 8px; border-radius:4px; font-weight:600;">' + log.action + '</span>';
        
        const tdIp = document.createElement('td');
        tdIp.style.padding = '15px';
        tdIp.style.fontSize = '13px';
        tdIp.innerText = log.ip_address || 'N/A';
        
        const tdDetails = document.createElement('td');
        tdDetails.style.padding = '15px';
        tdDetails.style.fontSize = '12px';
        tdDetails.style.color = 'var(--muted)';
        tdDetails.innerText = JSON.stringify(log.details);
        
        tr.appendChild(tdTime);
        tr.appendChild(tdEmail);
        tr.appendChild(tdAction);
        tr.appendChild(tdIp);
        tr.appendChild(tdDetails);
        listEl.appendChild(tr);
      });
    }

    // --- USER PERMISSIONS MANAGEMENT ---
    async function showUsersPanel() {
      showPanel('panel-users');
      const projectDropdown = document.getElementById('new-user-project');
      projectDropdown.innerHTML = '<option value="">All Projects (Global)</option>';
      projectsCache.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = p.name;
        projectDropdown.appendChild(opt);
      });
      loadUsers();
    }

    async function loadUsers() {
      try {
        const res = await fetch(baseUrl + "/api/users", {
          headers: { "Authorization": "Bearer " + token }
        });
        const data = await res.json();
        const users = data.users || [];
        renderUsers(users);
      } catch (e) {
        alert("Failed to load users: " + e.message);
      }
    }

    function renderUsers(users) {
      const listEl = document.getElementById('users-list');
      listEl.innerHTML = '';
      users.forEach(u => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        
        const tdEmail = document.createElement('td');
        tdEmail.style.padding = '15px';
        tdEmail.style.fontSize = '14px';
        tdEmail.innerText = u.email;
        
        const tdRole = document.createElement('td');
        tdRole.style.padding = '15px';
        tdRole.innerHTML = '<span style="background:rgba(99,102,241,0.15); color:var(--primary); padding:3px 8px; border-radius:4px; font-size:11px; text-transform:uppercase; font-weight:800;">' + u.role + '</span>';
        
        const tdProject = document.createElement('td');
        tdProject.style.padding = '15px';
        tdProject.style.fontSize = '13px';
        if (u.project_id) {
          const proj = projectsCache.find(p => p.id === u.project_id);
          tdProject.innerText = proj ? proj.name : u.project_id;
        } else {
          tdProject.innerHTML = '<span style="color:var(--accent);">Global Access</span>';
        }
        
        const tdActions = document.createElement('td');
        tdActions.style.padding = '15px';
        tdActions.style.textAlign = 'right';
        
        const payload = getPayload();
        if (payload && payload.email !== u.email) {
          const delBtn = document.createElement('button');
          delBtn.className = 'btn btn-danger';
          delBtn.style.padding = '6px 12px';
          delBtn.style.fontSize = '12px';
          delBtn.innerText = 'Revoke Access';
          delBtn.onclick = () => deleteUser(u.email);
          tdActions.appendChild(delBtn);
        }
        
        tr.appendChild(tdEmail);
        tr.appendChild(tdRole);
        tr.appendChild(tdProject);
        tr.appendChild(tdActions);
        listEl.appendChild(tr);
      });
    }

    async function createUser() {
      const email = document.getElementById('new-user-email').value;
      const role = document.getElementById('new-user-role').value;
      const project_id = document.getElementById('new-user-project').value;
      if (!email) return alert("Email is required!");
      try {
        const res = await fetch(baseUrl + "/api/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
          },
          body: JSON.stringify({ email, role, project_id })
        });
        if (res.ok) {
          document.getElementById('new-user-email').value = '';
          loadUsers();
        } else {
          const data = await res.json();
          alert(data.error);
        }
      } catch (e) {
        alert("Error adding user");
      }
    }

    async function deleteUser(email) {
      if (!confirm("Are you sure you want to revoke access for " + email + "?")) return;
      try {
        const res = await fetch(baseUrl + "/api/users/" + encodeURIComponent(email), {
          method: "DELETE",
          headers: { "Authorization": "Bearer " + token }
        });
        if (res.ok) loadUsers();
      } catch (e) {
        alert("Failed to delete user");
      }
    }

    // --- BLOG WRITER / EDITOR LOGIC ---
    function cancelEditor() {
      if (confirm("Any unsaved changes will be lost. Cancel editing?")) {
        showPanel('panel-project-detail');
      }
    }

    function newBlog() {
      document.getElementById('edit-blog-id').value = '';
      document.getElementById('blog-title').value = '';
      document.getElementById('blog-subtitle').value = '';
      document.getElementById('blog-cover-url').value = '';
      document.getElementById('editor-paragraphs-container').innerHTML = '';
      document.getElementById('editor-title-label').innerText = 'Craft New Story';
      showPanel('panel-blog-editor');
      
      // Add a starting text block automatically
      addParagraphBlock('p');
    }

    function editBlog(id) {
      const blog = blogsCache.find(b => b.id === id);
      if (!blog) return;

      document.getElementById('edit-blog-id').value = blog.id;
      document.getElementById('blog-title').value = blog.title || '';
      document.getElementById('blog-subtitle').value = blog.subtitle || '';
      document.getElementById('blog-cover-url').value = blog.main_image_url || '';
      document.getElementById('editor-title-label').innerText = 'Editing Story: ' + blog.title;

      const container = document.getElementById('editor-paragraphs-container');
      container.innerHTML = '';

      if (blog.paragraphs && Array.isArray(blog.paragraphs)) {
        blog.paragraphs.forEach(p => {
          addParagraphBlock(p.type, p.text, p.imageUrl || p.images, p.subheading);
        });
      }
      showPanel('panel-blog-editor');
    }

    function addParagraphBlock(type, optText = '', optImg = '', optSubheading = '') {
      const container = document.getElementById('editor-paragraphs-container');
      const pDiv = document.createElement('div');
      pDiv.className = 'editor-block';
      pDiv.dataset.type = type;

      const blockId = 'editor-body-' + Math.random().toString(36).substring(2, 9);

      let inner = \`<button class="btn btn-secondary btn-danger editor-block-trash" onclick="this.parentElement.remove();">Remove</button>\`;
      
      const safeText = String(optText || '');
      const safeSubheading = String(optSubheading || '').replace(/"/g, '&quot;');

      let badgeColor = type === 'p' ? '#3b82f6' : (type === 'img_text' ? '#10b981' : '#8b5cf6');
      let badgeText = type === 'p' ? 'Text Block' : (type === 'img_text' ? 'Image + Text Block' : (type === 'img_row_2' ? '2 Images Row' : '3 Images Row'));

      inner += \`<div style="display:inline-block; background:\${badgeColor}20; color:\${badgeColor}; font-size:11px; font-weight:800; padding:5px 10px; border-radius:6px; text-transform:uppercase; margin-bottom:15px;">\${badgeText}</div>\`;

      const subInput = \`<div style="margin-top:10px;"><label>Section Subheading (Optional)</label><input type="text" class="para-subheading" value="\${safeSubheading}" placeholder="Section heading..."></div>\`;

      if (type === 'p') {
        inner += \`\${subInput}
          <div style="margin-top:15px;">
            <label>Paragraph Text</label>
            <div class="quill-editor-wrapper">
              <div id="\${blockId}" style="min-height:150px; font-size:14px;">\${safeText}</div>
            </div>
          </div>\`;
      } else if (type === 'img_row_2' || type === 'img_row_3') {
        const count = type === 'img_row_2' ? 2 : 3;
        const images = Array.isArray(optImg) ? optImg : [optImg, '', ''];
        let imagesHtml = '';
        for (let i = 0; i < count; i++) {
          const val = String(images[i] || '').replace(/"/g, '&quot;');
          const inputId = blockId + '-img-' + i;
          imagesHtml += \`
            <div style="flex:1; display:flex; flex-direction:column; gap:5px;">
              <label>Image \${i + 1}</label>
              <div style="display:flex; gap:10px;">
                <input type="text" class="para-img-multi" id="\${inputId}" value="\${val}" placeholder="R2 image URL...">
                <button class="btn btn-secondary" type="button" onclick="document.getElementById('\${inputId}-file').click()">📤</button>
                <input type="file" id="\${inputId}-file" style="display:none;" onchange="uploadImage(this, '\${inputId}')">
              </div>
            </div>
          \`;
        }
        inner += \`<div class="flex-group" style="margin-bottom:10px;">\${imagesHtml}</div>\`;
        inner += \`\${subInput}
          <div style="margin-top:15px;">
            <label>Optional text content below image row</label>
            <div class="quill-editor-wrapper">
              <div id="\${blockId}" style="min-height:100px; font-size:14px;">\${safeText}</div>
            </div>
          </div>\`;
      } else {
        // img_text
        const imgVal = String(Array.isArray(optImg) ? optImg[0] : optImg || '').replace(/"/g, '&quot;');
        inner += \`
          <div style="margin-bottom:15px;">
            <label>Image Attachment</label>
            <div style="display:flex; gap:10px; margin-top:5px;">
              <input type="text" class="para-img" id="\${blockId}-img" value="\${imgVal}" placeholder="R2 image URL...">
              <button class="btn btn-secondary" type="button" onclick="document.getElementById('\${blockId}-img-file').click()">📤 Upload Image</button>
              <input type="file" id="\${blockId}-img-file" style="display:none;" onchange="uploadImage(this, '\${blockId}-img')">
            </div>
          </div>
          \${subInput}
          <div style="margin-top:15px;">
            <label>Content Text</label>
            <div class="quill-editor-wrapper">
              <div id="\${blockId}" style="min-height:120px; font-size:14px;">\${safeText}</div>
            </div>
          </div>\`;
      }

      pDiv.innerHTML = inner;
      container.appendChild(pDiv);

      // Bind Quill
      const quill = new Quill('#' + blockId, {
        theme: 'snow',
        modules: {
          toolbar: [
            ['bold', 'italic', 'underline'],
            ['link'],
            [{ 'list': 'bullet' }]
          ]
        }
      });
      pDiv.quillInstance = quill;
    }

    // --- UPLOAD HANDLER FOR CLOUDFLARE R2 ---
    async function uploadImage(fileInput, targetInputId) {
      const file = fileInput.files[0];
      if (!file) return;

      const btn = fileInput.previousElementSibling;
      const originalText = btn.innerText;
      btn.innerText = "⏳ Uploading...";
      btn.disabled = true;

      try {
        const res = await fetch(baseUrl + "/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": file.type || "image/jpeg",
            "Authorization": "Bearer " + token
          },
          body: file // Sends raw binary to Cloudflare Worker
        });

        if (!res.ok) throw new Error("Upload request failed.");
        const data = await res.json();
        document.getElementById(targetInputId).value = data.url;
        alert("Image uploaded to R2 successfully!");
      } catch (err) {
        alert("Upload failed: " + err.message);
      } finally {
        btn.innerText = originalText;
        btn.disabled = false;
        fileInput.value = "";
      }
    }

    // --- SAVE THE BLOG TO SUPABASE ---
    async function saveBlog() {
      const id = document.getElementById('edit-blog-id').value;
      const title = document.getElementById('blog-title').value;
      const subtitle = document.getElementById('blog-subtitle').value;
      const main_image_url = document.getElementById('blog-cover-url').value;

      if (!title) return alert("Blog Title is required!");

      const paragraphs = [];
      document.querySelectorAll('.editor-block').forEach(el => {
        const type = el.dataset.type;
        const subheading = el.querySelector('.para-subheading')?.value || '';
        const text = el.quillInstance ? el.quillInstance.root.innerHTML : '';

        const obj = { type, text };
        if (subheading) obj.subheading = subheading;

        if (type === 'img_row_2' || type === 'img_row_3') {
          const imgInputs = el.querySelectorAll('.para-img-multi');
          const images = [];
          imgInputs.forEach(inp => images.push(inp.value));
          obj.images = images;
        } else if (type === 'img_text') {
          obj.imageUrl = el.querySelector('.para-img')?.value || '';
        }
        paragraphs.push(obj);
      });

      const payload = {
        project_id: selectedProjectId,
        title,
        subtitle,
        main_image_url,
        paragraphs
      };

      if (id) payload.id = id;

      try {
        const res = await fetch(baseUrl + "/api/blogs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
          },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          alert("Story published successfully!");
          showPanel('panel-project-detail');
          loadBlogs();
        } else {
          const data = await res.json();
          alert("Failed to save: " + data.error);
        }
      } catch (err) {
        alert("Network error: " + err.message);
      }
    }
  </script>
</body>
</html>
      `;
      return new Response(dashboardHTML, {
        headers: { 'Content-Type': 'text/html', ...corsHeaders }
      });
    }

    return new Response(JSON.stringify({ error: "Endpoint not found" }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};

// Email delivery via Resend API (https://resend.com — free tier: 3000 emails/month)
// Requires RESEND_API_KEY secret. Falls back to console log in local dev if key missing.
async function sendOTPEmail(env, email, otp) {
  const apiKey = env.RESEND_API_KEY;

  // Local dev fallback: log OTP to wrangler console if no API key set
  if (!apiKey) {
    console.warn('⚠️  RESEND_API_KEY not set.');
    console.warn(`🔑 DEV FALLBACK — OTP for ${email}: ${otp}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'Certifyied Blog Portal <onboarding@resend.dev>',
      to: [email],
      subject: 'Your Certifyied Login OTP',
      html: `<div style="font-family:sans-serif;background:#0b0f19;color:#f9fafb;padding:40px;border-radius:12px;max-width:500px;margin:auto;border:1px solid #1f2937;">
  <h2 style="color:#6366f1;font-weight:700;margin-bottom:20px;">Developer Portal Access</h2>
  <p style="color:#9ca3af;font-size:14px;line-height:1.6;">A login request was made for the Blog Admin Panel. Use the OTP below to authenticate:</p>
  <div style="font-size:36px;font-weight:800;color:#10b981;letter-spacing:6px;text-align:center;margin:30px 0;background:#161e2e;padding:20px;border-radius:8px;border:1px solid #1f2937;">${otp}</div>
  <p style="color:#9ca3af;font-size:12px;">Valid for 10 minutes. If you did not request this, ignore this email.</p>
</div>`,
      text: `Your Certifyied login OTP is: ${otp}\n\nValid for 10 minutes.`,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    // In local miniflare dev, network may fail — log OTP so dev can still test
    console.warn(`[OTP EMAIL] Resend failed (${res.status}): ${err}`);
    console.warn(`🔑 DEV FALLBACK — OTP for ${email}: ${otp}`);
    if (res.status >= 500) return; // Don't block login on server errors
    throw new Error(`Email delivery failed: ${res.status} ${err}`);
  }
}
