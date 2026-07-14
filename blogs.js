// --- Rate Limiter ---
const contactRateLimiter = new Map();

function isRateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const record = contactRateLimiter.get(ip) || { count: 0, resetAt: now + 60000 };
  
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + 60000;
  } else {
    record.count++;
  }
  
  contactRateLimiter.set(ip, record);
  
  if (Math.random() < 0.01) {
    for (const [key, val] of contactRateLimiter.entries()) {
      if (now > val.resetAt) contactRateLimiter.delete(key);
    }
  }

  return record.count > 3;
}

export async function handleBlogRequest(request, env, ctx, path, method, url, payload, supabaseAdmin, supabase, corsHeaders, logAction) {

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
      let rawColor = url.searchParams.get('color') || '10b981';
      if (rawColor.startsWith('#')) rawColor = rawColor.substring(1);
      if (!/^[0-9A-Fa-f]{6}$/i.test(rawColor) && !/^[0-9A-Fa-f]{3}$/i.test(rawColor)) {
        rawColor = '10b981';
      }
      
      const r = parseInt(rawColor.length === 3 ? rawColor[0]+rawColor[0] : rawColor.substring(0,2), 16);
      const g = parseInt(rawColor.length === 3 ? rawColor[1]+rawColor[1] : rawColor.substring(2,4), 16);
      const b = parseInt(rawColor.length === 3 ? rawColor[2]+rawColor[2] : rawColor.substring(4,6), 16);
      
      const primaryHex = '#' + rawColor;
      const primaryRgb = `${r},${g},${b}`;

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
    '  margin-bottom: 32px;' +
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
    '}' +
    '@media (min-width: 640px) {' +
    '  .cf-blog-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }' +
    '}' +
    '@media (min-width: 900px) {' +
    '  .cf-blog-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }' +
    '}' +
    '.cf-blog-card {' +
    '  background: #ffffff;' +
    '  border-radius: 16px;' +
    '  overflow: hidden;' +
    '  display: flex;' +
    '  flex-direction: column;' +
    '  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06);' +
    '  transition: transform 0.3s ease, box-shadow 0.3s ease;' +
    '  cursor: pointer;' +
    '}' +
    '.cf-blog-card:hover {' +
    '  transform: translateY(-8px);' +
    '  box-shadow: 0 12px 32px rgba(${primaryRgb},0.15), 0 2px 8px rgba(0,0,0,0.08);' +
    '}' +
    '.cf-blog-image {' +
    '  aspect-ratio: 16/9;' +
    '  width: 100%;' +
    '  background: #f1f5f9;' +
    '  overflow: hidden;' +
    '  flex-shrink: 0;' +
    '}' +
    '.cf-blog-image img {' +
    '  width: 100%;' +
    '  height: 100%;' +
    '  object-fit: cover;' +
    '  transition: transform 0.4s ease;' +
    '}' +
    '.cf-blog-card:hover .cf-blog-image img {' +
    '  transform: scale(1.05);' +
    '}' +
    '.cf-blog-content {' +
    '  padding: 16px 20px 20px;' +
    '  display: flex;' +
    '  flex-direction: column;' +
    '  flex-grow: 1;' +
    '}' +
    '.cf-blog-date {' +
    '  font-size: 12px;' +
    '  font-weight: 500;' +
    '  color: #6b7280;' +
    '  margin-bottom: 10px;' +
    '  display: inline-flex;' +
    '  align-items: center;' +
    '  gap: 6px;' +
    '}' +
    '.cf-blog-date::before {' +
    '  content: "";' +
    '  width: 6px;' +
    '  height: 6px;' +
    '  border-radius: 50%;' +
    '  background: ${primaryHex};' +
    '  flex-shrink: 0;' +
    '}' +
    '.cf-blog-title {' +
    '  font-size: 18px;' +
    '  font-weight: 600;' +
    '  color: #111827;' +
    '  margin: 0 0 12px;' +
    '  line-height: 1.4;' +
    '  display: -webkit-box;' +
    '  -webkit-line-clamp: 2;' +
    '  -webkit-box-orient: vertical;' +
    '  overflow: hidden;' +
    '}' +
    '.cf-blog-subtitle {' +
    '  font-size: 14px;' +
    '  color: #6b7280;' +
    '  margin-bottom: 20px;' +
    '  flex-grow: 1;' +
    '  line-height: 1.6;' +
    '  display: -webkit-box;' +
    '  -webkit-line-clamp: 3;' +
    '  -webkit-box-orient: vertical;' +
    '  overflow: hidden;' +
    '}' +
    '.cf-blog-read-more {' +
    '  font-size: 14px;' +
    '  font-weight: 500;' +
    '  color: ${primaryHex};' +
    '  display: inline-flex;' +
    '  align-items: center;' +
    '  gap: 4px;' +
    '  margin-top: auto;' +
    '  transition: gap 0.2s ease;' +
    '}' +
    '.cf-blog-card:hover .cf-blog-read-more {' +
    '  gap: 8px;' +
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
    '}' +
    '.cf-pagination {' +
    '  display: flex;' +
    '  align-items: center;' +
    '  justify-content: center;' +
    '  gap: 8px;' +
    '  margin-top: 32px;' +
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
    '}' +
    '.cf-page-btn {' +
    '  display: inline-flex;' +
    '  align-items: center;' +
    '  justify-content: center;' +
    '  min-width: 36px;' +
    '  height: 36px;' +
    '  padding: 0 12px;' +
    '  border-radius: 8px;' +
    '  border: 1px solid #e2e8f0;' +
    '  background: white;' +
    '  color: #374151;' +
    '  font-size: 14px;' +
    '  font-weight: 500;' +
    '  cursor: pointer;' +
    '  transition: all 0.15s;' +
    '}' +
    '.cf-page-btn:hover:not(:disabled) {' +
    '  background: #f1f5f9;' +
    '  border-color: #94a3b8;' +
    '}' +
    '.cf-page-btn.active {' +
    '  background: ${primaryHex};' +
    '  color: white;' +
    '  border-color: ${primaryHex};' +
    '}' +
    '.cf-page-btn:disabled {' +
    '  opacity: 0.4;' +
    '  cursor: not-allowed;' +
    '}' +
    '.cf-page-info {' +
    '  font-size: 13px;' +
    '  color: #64748b;' +
    '  padding: 0 4px;' +
    '}';
  document.head.appendChild(style);

  const fallbackImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="%23e2e8f0"><rect width="100%" height="100%"/></svg>';

  async function checkAndRender() {
    const listContainer = document.getElementById('certifyied-blog-container');
    const postContainer = document.getElementById('certifyied-blog-post');

    // --- RENDERING LIST MODE (with pagination) ---
    if (listContainer && !listContainer.dataset.rendered) {
      listContainer.dataset.rendered = 'true';
      const projectId = listContainer.dataset.projectId;
      const pageSize = parseInt(listContainer.dataset.limit) || 9;
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

      const paginationEl = document.createElement('div');
      paginationEl.className = 'cf-pagination';
      listContainer.appendChild(paginationEl);

      let currentPage = 1;
      let totalBlogs = 0;

      function renderCards(blogs) {
        gridEl.innerHTML = '';
        blogs.forEach(blog => {
          const card = document.createElement('div');
          card.className = 'cf-blog-card';
          const dateStr = blog.created_at ? new Date(blog.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
          
          let imageHtml = '';
          let titleHtml = '';

          if (blog.main_image_url) {
            imageHtml = '<div class="cf-blog-image"><img src="' + blog.main_image_url + '" onerror="this.src=\\'' + fallbackImg + '\\'"></div>';
            titleHtml = '<h3 class="cf-blog-title">' + (blog.title || 'Untitled') + '</h3>';
          } else {
            imageHtml = '<div class="cf-blog-image" style="background: linear-gradient(135deg, rgba(${primaryRgb},0.85), rgba(${primaryRgb},1)), url(\\'https://images.unsplash.com/photo-1557682250-33bd709cbe85?q=80&w=800&auto=format&fit=crop\\') center/cover; padding: 32px 24px 24px; display: flex; align-items: flex-end; justify-content: flex-start; text-align: left;">' +
                        '  <h3 style="color: white; font-size: 26px; font-weight: 800; margin: 0; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, \\'Segoe UI\\', Roboto, sans-serif; text-shadow: 0 2px 4px rgba(0,0,0,0.15);">' + (blog.title || 'Untitled') + '</h3>' +
                        '</div>';
            titleHtml = '';
          }

          card.innerHTML =
            imageHtml +
            '<div class="cf-blog-content">' +
            (dateStr ? '  <div class="cf-blog-date">' + dateStr + '</div>' : '') +
            titleHtml +
            '  <p class="cf-blog-subtitle">' + (blog.subtitle || '') + '</p>' +
            '  <span class="cf-blog-read-more">Read More →</span>' +
            '</div>';

          card.addEventListener('click', function() {
            let baseUrl = redirectUrl.split('?')[0].replace(/\\/$/, '');
            let params = redirectUrl.split('?')[1] ? ('&' + redirectUrl.split('?')[1]) : '';
            let targetUrl = baseUrl + '/' + (blog.slug || '') + '?id=' + blog.id + params;
            window.location.href = targetUrl;
          });
          gridEl.appendChild(card);
        });
      }

      function renderPagination(total) {
        const totalPages = Math.ceil(total / pageSize);
        paginationEl.innerHTML = '';
        if (totalPages <= 1) return;

        const prevBtn = document.createElement('button');
        prevBtn.className = 'cf-page-btn';
        prevBtn.innerHTML = '&#8592; Prev';
        prevBtn.disabled = currentPage === 1;
        prevBtn.addEventListener('click', function() {
          if (currentPage > 1) { currentPage--; loadPage(true); }
        });
        paginationEl.appendChild(prevBtn);

        const info = document.createElement('span');
        info.className = 'cf-page-info';
        info.innerText = 'Page ' + currentPage + ' of ' + totalPages;
        paginationEl.appendChild(info);

        const nextBtn = document.createElement('button');
        nextBtn.className = 'cf-page-btn';
        nextBtn.innerHTML = 'Next &#8594;';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.addEventListener('click', function() {
          if (currentPage < totalPages) { currentPage++; loadPage(true); }
        });
        paginationEl.appendChild(nextBtn);
      }

      async function loadPage(scrollToTop = false) {
        loaderEl.style.display = 'block';
        gridEl.innerHTML = '';
        paginationEl.innerHTML = '';
        const offset = (currentPage - 1) * pageSize;
        try {
          const res = await fetch(workerOrigin + '/adminApiBlog/api/blogs/public?projectId=' + projectId + '&limit=' + pageSize + '&offset=' + offset);
          const data = await res.json();
          if (data.blogs && data.blogs.length > 0) {
            totalBlogs = data.total || totalBlogs || data.blogs.length;
            renderCards(data.blogs);
            renderPagination(totalBlogs);
            if (scrollToTop) listContainer.scrollIntoView({ behavior: "smooth", block: "start" });
          } else if (currentPage === 1) {
            gridEl.innerHTML = '<p style="color:#64748b; font-size:14px; grid-column:1/-1; text-align:center;">No published stories yet.</p>';
          }
        } catch (err) {
          console.error("Error loading blogs:", err);
          gridEl.innerHTML = '<p class="cf-blog-error">Failed to load stories.</p>';
        } finally {
          loaderEl.style.display = 'none';
        }
      }
      loadPage();
    }

    // --- RENDERING SINGLE POST MODE (OR FALLBACK TO LIST MODE) ---
    if (postContainer && !postContainer.dataset.rendered) {
      const projectId = postContainer.dataset.projectId;
      if (!projectId) {
        postContainer.innerHTML = '<p class="cf-blog-error">Error: data-project-id attribute is missing!</p>';
        return;
      }

      const urlParams = new URLSearchParams(window.location.search);
      let blogId = urlParams.get('id') || urlParams.get('slug') || urlParams.get('slug');
      if (!blogId) {
        const cleanPath = window.location.pathname.replace(/\\/$/, '');
        const pathParts = cleanPath.split('/');
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart && lastPart !== 'blog' && lastPart !== 'blogs' && lastPart !== 'index.html') {
          blogId = lastPart;
        }
      }

      if (blogId) {
        postContainer.dataset.rendered = 'true';
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
      } else {
        // Fallback to List Mode (with pagination)
        postContainer.dataset.rendered = 'true';
        const pageSize2 = parseInt(postContainer.dataset.limit) || 9;
        const redirectUrl2 = postContainer.dataset.redirectUrl || window.location.pathname;

        const gridEl2 = document.createElement('div');
        gridEl2.className = 'cf-blog-grid';
        postContainer.appendChild(gridEl2);

        const loaderEl2 = document.createElement('div');
        loaderEl2.className = 'cf-blog-loader';
        loaderEl2.innerText = 'Loading stories...';
        postContainer.appendChild(loaderEl2);

        const paginationEl2 = document.createElement('div');
        paginationEl2.className = 'cf-pagination';
        postContainer.appendChild(paginationEl2);

        let currentPage2 = 1;
        let totalBlogs2 = 0;

        function renderCards2(blogs) {
          gridEl2.innerHTML = '';
          blogs.forEach(blog => {
            const card = document.createElement('div');
            card.className = 'cf-blog-card';
          const dateStr = blog.created_at ? new Date(blog.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
          let imageHtml2 = '';
          let titleHtml2 = '';

          if (blog.main_image_url) {
            imageHtml2 = '<div class="cf-blog-image"><img src="' + blog.main_image_url + '" onerror="this.src=\\'' + fallbackImg + '\\'"></div>';
            titleHtml2 = '<h3 class="cf-blog-title">' + (blog.title || 'Untitled') + '</h3>';
          } else {
            imageHtml2 = '<div class="cf-blog-image" style="background: linear-gradient(135deg, rgba(${primaryRgb},0.85), rgba(${primaryRgb},1)), url(\\'https://images.unsplash.com/photo-1557682250-33bd709cbe85?q=80&w=800&auto=format&fit=crop\\') center/cover; padding: 32px 24px 24px; display: flex; align-items: flex-end; justify-content: flex-start; text-align: left;">' +
                        '  <h3 style="color: white; font-size: 26px; font-weight: 800; margin: 0; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, \\'Segoe UI\\', Roboto, sans-serif; text-shadow: 0 2px 4px rgba(0,0,0,0.15);">' + (blog.title || 'Untitled') + '</h3>' +
                        '</div>';
            titleHtml2 = '';
          }

            card.innerHTML =
              imageHtml2 +
              '<div class="cf-blog-content">' +
              (dateStr ? '  <div class="cf-blog-date">' + dateStr + '</div>' : '') +
              titleHtml2 +
              '  <p class="cf-blog-subtitle">' + (blog.subtitle || '') + '</p>' +
              '  <span class="cf-blog-read-more">Read More →</span>' +
              '</div>';
            card.addEventListener('click', function() {
              let baseUrl = redirectUrl2.split('?')[0].replace(/\\/$/, '');
              let params = redirectUrl2.split('?')[1] ? ('&' + redirectUrl2.split('?')[1]) : '';
              let targetUrl = baseUrl + '/' + (blog.slug || '') + '?id=' + blog.id + params;
              window.location.href = targetUrl;
            });
            gridEl2.appendChild(card);
          });
        }

        function renderPagination2(total) {
          const totalPages = Math.ceil(total / pageSize2);
          paginationEl2.innerHTML = '';
          if (totalPages <= 1) return;

          const prevBtn = document.createElement('button');
          prevBtn.className = 'cf-page-btn';
          prevBtn.innerHTML = '&#8592; Prev';
          prevBtn.disabled = currentPage2 === 1;
          prevBtn.addEventListener('click', function() {
            if (currentPage2 > 1) { currentPage2--; loadPage2(true); }
          });
          paginationEl2.appendChild(prevBtn);

          const info = document.createElement('span');
          info.className = 'cf-page-info';
          info.innerText = 'Page ' + currentPage2 + ' of ' + totalPages;
          paginationEl2.appendChild(info);

          const nextBtn = document.createElement('button');
          nextBtn.className = 'cf-page-btn';
          nextBtn.innerHTML = 'Next &#8594;';
          nextBtn.disabled = currentPage2 === totalPages;
          nextBtn.addEventListener('click', function() {
            if (currentPage2 < totalPages) { currentPage2++; loadPage2(true); }
          });
          paginationEl2.appendChild(nextBtn);
        }

        async function loadPage2(scrollToTop = false) {
          loaderEl2.style.display = 'block';
          gridEl2.innerHTML = '';
          paginationEl2.innerHTML = '';
          const offset = (currentPage2 - 1) * pageSize2;
          try {
            const res = await fetch(workerOrigin + '/adminApiBlog/api/blogs/public?projectId=' + projectId + '&limit=' + pageSize2 + '&offset=' + offset);
            const data = await res.json();
            if (data.blogs && data.blogs.length > 0) {
              totalBlogs2 = data.total || totalBlogs2 || data.blogs.length;
              renderCards2(data.blogs);
              renderPagination2(totalBlogs2);
              if (scrollToTop) postContainer.scrollIntoView({ behavior: "smooth", block: "start" });
            } else if (currentPage2 === 1) {
              gridEl2.innerHTML = '<p style="color:#64748b; font-size:14px; grid-column:1/-1; text-align:center;">No published stories yet.</p>';
            }
          } catch (err) {
            console.error("Error loading blogs:", err);
            gridEl2.innerHTML = '<p class="cf-blog-error">Failed to load stories.</p>';
          } finally {
            loaderEl2.style.display = 'none';
          }
        }
        loadPage2();
      }
    }
  }

  // Initial execution
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndRender);
  } else {
    checkAndRender();
  }

  // MutationObserver to watch for dynamically added elements (e.g. SPAs like React)
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(function(mutations) {
      checkAndRender();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
      `;
      return new Response(embedScript, {
        headers: {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          ...corsHeaders,
        },
      });
    }


    // --- SITEMAPS API ---
    if (path === '/adminApiBlog/api/sitemaps' && request.method === 'GET') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const token = authHeader.substring(7);
      const payload = await verifyJWT(env, token);
      if (!payload) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      
      const projectId = url.searchParams.get('projectId');
      const { data, error } = await supabaseAdmin.from('sitemaps').select('*').eq('project_id', projectId);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      return new Response(JSON.stringify({ sitemaps: data }), { status: 200, headers: corsHeaders });
    }

    if (path === '/adminApiBlog/api/sitemaps' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const token = authHeader.substring(7);
      const payload = await verifyJWT(env, token);
      if (!payload) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      
      const body = await request.json();
      const { data, error } = await supabaseAdmin.from('sitemaps').insert({
        project_id: body.project_id,
        loc: body.loc,
        changefreq: body.changefreq || 'monthly',
        priority: body.priority || 0.8
      }).select().single();
      
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      return new Response(JSON.stringify({ sitemap: data }), { status: 200, headers: corsHeaders });
    }

    if (path === '/adminApiBlog/api/sitemap.xml' && request.method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      const { data, error } = await supabaseAdmin.from('sitemaps').select('*').eq('project_id', projectId);
      if (error) return new Response("Error", { status: 500, headers: corsHeaders });
      
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
      for (const item of (data || [])) {
        xml += '  <url>\n    <loc>' + item.loc + '</loc>\n    <changefreq>' + item.changefreq + '</changefreq>\n    <priority>' + item.priority + '</priority>\n  </url>\n';
      }
      xml += '</urlset>';
      
      const xmlHeaders = new Headers(corsHeaders);
      xmlHeaders.set('Content-Type', 'application/xml');
      xmlHeaders.set('Cache-Control', 'public, max-age=3600');
      return new Response(xml, { status: 200, headers: xmlHeaders });
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

      const { data, error, count } = await supabase
        .from('blogs')
        .select('id, readable_id, title, subtitle, main_image_url, slug, created_at, paragraphs', { count: 'exact' })
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const formattedBlogs = data.map(b => {
        let snippet = b.subtitle || '';
        if (!snippet && b.paragraphs && Array.isArray(b.paragraphs)) {
          const firstText = b.paragraphs.find(p => p.type === 'text' && p.text);
          if (firstText) {
            snippet = firstText.text.replace(/<[^>]+>/g, '').substring(0, 150).trim() + '...';
          }
        }
        return {
          id: b.readable_id || b.id,
          uuid: b.id,
          title: b.title,
          subtitle: snippet,
          main_image_url: b.main_image_url,
          slug: b.slug,
          created_at: b.created_at
        };
      });

      return new Response(JSON.stringify({ blogs: formattedBlogs, total: count }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
        const { name, url: targetUrl, contact_email } = await request.json();
        if (!name) {
          return new Response(JSON.stringify({ error: "Project name is required" }), { status: 400, headers: corsHeaders });
        }
        
        // Define insert payload
        const insertPayload = { name };
        if (targetUrl) {
          insertPayload.base_url = targetUrl;
        }
        if (contact_email) {
          insertPayload.contact_email = contact_email.toLowerCase();
        }

        const { data, error } = await supabaseAdmin
          .from('projects')
          .insert(insertPayload)
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }

        // Automatically link a blog client record if a contact email is provided
        if (contact_email) {
          try {
            await supabaseAdmin.from('blog_clients').insert({
              project_id: data.id,
              email: contact_email.toLowerCase(),
              name: name
            });
          } catch (e) {
            console.error("Failed to auto-create blog_client:", e.message);
          }
        }

        await logAction(supabaseAdmin, payload.email, 'project_created', { name, id: data.id }, request.headers.get('CF-Connecting-IP') || '');
        return new Response(JSON.stringify(data), {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // GET & POST Blog Clients
    if (path === '/adminApiBlog/api/blog-clients') {
      if (request.method === 'GET') {
        let query = supabaseAdmin.from('blog_clients').select('*, projects(name)');
        if (payload.projectId) {
          query = query.eq('project_id', payload.projectId);
        }
        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ blogClients: data }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST') {
        if (payload.projectId) {
          return new Response(JSON.stringify({ error: "Access denied." }), { status: 403, headers: corsHeaders });
        }
        const { project_id, name, email } = await request.json();
        if (!project_id || !email) {
          return new Response(JSON.stringify({ error: "project_id and email are required" }), { status: 400, headers: corsHeaders });
        }

        const { data, error } = await supabaseAdmin
          .from('blog_clients')
          .insert({ project_id, name, email: email.toLowerCase() })
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }

        await logAction(supabaseAdmin, payload.email, 'blog_client_created', { email, id: data.id }, request.headers.get('CF-Connecting-IP') || '');
        return new Response(JSON.stringify(data), {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // DELETE Blog Client
    const blogClientDeleteMatch = path.match(/^\/adminApiBlog\/api\/blog-clients\/([a-zA-Z0-9_-]+)$/);
    if (blogClientDeleteMatch && request.method === 'DELETE') {
      if (payload.projectId) {
        return new Response(JSON.stringify({ error: "Access denied." }), { status: 403, headers: corsHeaders });
      }
      const { error } = await supabaseAdmin
        .from('blog_clients')
        .delete()
        .eq('id', blogClientDeleteMatch[1]);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
      await logAction(supabaseAdmin, payload.email, 'blog_client_deleted', { id: blogClientDeleteMatch[1] }, request.headers.get('CF-Connecting-IP') || '');
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
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

    
    // --- CONTACT FORM API ENDPOINT ---
    if (path === '/adminApiBlog/api/contact' && request.method === 'POST') {
      const projectId = url.searchParams.get('projectId');
      if (!projectId) {
        return new Response(JSON.stringify({ error: "projectId is required" }), { status: 400, headers: corsHeaders });
      }

      // Query project for domain and email
      const { data: project, error: projErr } = await supabaseAdmin
        .from('projects')
        .select('base_url, contact_email')
        .eq('id', projectId)
        .single();

      if (projErr || !project || !project.contact_email) {
        return new Response(JSON.stringify({ error: "Project not found or no contact email configured." }), { status: 404, headers: corsHeaders });
      }

      // Dynamic CORS enforcement based on project base_url
      const reqOrigin = request.headers.get('Origin');
      const baseHost = project.base_url ? new URL(project.base_url).host : null;
      const originHost = reqOrigin ? new URL(reqOrigin).host : null;

      // Allow requests if origin matches base_url, or allow all if base_url is not set strict
      // To be safe and testable, we set CORS to match the exact origin if it matches baseHost
      const strictCorsHeaders = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (baseHost && originHost && baseHost !== originHost && originHost !== 'localhost:8082' && originHost !== '127.0.0.1:8082') {
        // Enforce CORS
        return new Response(JSON.stringify({ error: "Unauthorized domain." }), { status: 403, headers: corsHeaders });
      }
      
      strictCorsHeaders['Access-Control-Allow-Origin'] = reqOrigin || '*';

      // Rate limiting
      const ip = request.headers.get('CF-Connecting-IP') || '';
      if (isRateLimited(ip)) {
        return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), { status: 429, headers: strictCorsHeaders });
      }

      try {
        const { sender_name, sender_email, phone_number, subject, message } = await request.json();

        if (!sender_email || !message) {
          return new Response(JSON.stringify({ error: "sender_email and message are required." }), { status: 400, headers: strictCorsHeaders });
        }

        if (!env.RESEND_API_KEY) {
           return new Response(JSON.stringify({ error: "RESEND_API_KEY is missing in server environment." }), { status: 500, headers: strictCorsHeaders });
        }

        // Send Email via Resend
        const emailHtml = `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${sender_name || 'N/A'}</p>
          <p><strong>Email:</strong> ${sender_email}</p>
          <p><strong>Phone:</strong> ${phone_number || 'N/A'}</p>
          <p><strong>Subject:</strong> ${subject || 'New Message'}</p>
          <hr/>
          <p><strong>Message:</strong></p>
          <p>${message.replace(/\n/g, '<br>')}</p>
          <br/><br/>
          <hr/>
          <div style="text-align: center; font-family: sans-serif; color: #666; margin-top: 20px;">
            <p style="font-size: 14px; margin-bottom: 10px;">This message was securely delivered by the Contact Service of Review Manager.</p>
            <p style="font-size: 14px; margin-bottom: 20px;">Thanks for choosing Review Manager!</p>
            <img src="https://www.reviewmanager.in/favicon.ico" alt="Review Manager Logo" style="height: 40px; width: auto;" />
          </div>
        `;

        const resendPayload = {
          from: 'Review Manager Contact <no-reply@send.certifyied.com>',
          to: project.contact_email,
          reply_to: sender_email,
          subject: subject || `New message from ${sender_name || sender_email}`,
          html: emailHtml
        };

        // Log to form_submissions first to prevent data loss, default status is 'pending'
        const { data: insertedRows, error: insertErr } = await supabaseAdmin.from('form_submissions').insert({
          project_id: projectId,
          sender_name,
          sender_email,
          phone_number,
          subject,
          message,
          ip_address: ip
        }).select();

        if (insertErr) {
          console.error("Database Insert Error:", insertErr);
          return new Response(JSON.stringify({ error: "Failed to save submission." }), { status: 500, headers: strictCorsHeaders });
        }

        const submissionId = insertedRows?.[0]?.id;

        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(resendPayload)
        });

        if (!resendRes.ok) {
          const resendErr = await resendRes.text();
          console.error("Resend Error (Submission saved successfully):", resendErr);
          
          if (submissionId) {
            // Update submission status to failed
            await supabaseAdmin.from('form_submissions')
              .update({ email_delivery_status: 'failed', delivery_error_message: resendErr.substring(0, 500) })
              .eq('id', submissionId);
          }

          return new Response(JSON.stringify({ success: true, warning: "Saved to database, but notification email failed." }), { status: 200, headers: strictCorsHeaders });
        }

        if (submissionId) {
          // Update submission status to success
          await supabaseAdmin.from('form_submissions')
            .update({ email_delivery_status: 'success' })
            .eq('id', submissionId);
        }

        // Log to audit_logs
        await logAction(supabaseAdmin, 'system', 'contact_form_submitted', { project_id: projectId, sender_email, ip }, ip);

        return new Response(JSON.stringify({ success: true, message: "Email sent successfully." }), { status: 200, headers: strictCorsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: strictCorsHeaders });
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
    if ((path === '/adminApiBlog' || path === '/blogLogin' || path === '/' || path === '') && request.method === 'GET') {
      const dashboardHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Certifyied SEO Blog Engine - Client Portal</title>
  <!-- Google Fonts & Quill CSS -->
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://cdn.quilljs.com/1.3.6/quill.snow.css" rel="stylesheet">
  <script src="https://cdn.quilljs.com/1.3.6/quill.js"></script>
  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #1e293b;
      --muted: #64748b;
      --primary: #467222;
      --primary-hover: #3b601d;
      --accent: #10b981;
      --danger: #ef4444;
      --font-sans: 'Poppins', sans-serif;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      padding: 40px 20px;
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
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
      transition: all 0.3s ease;
    }
    .card:hover {
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
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
      background: var(--primary);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 14px;
      box-shadow: 0 4px 6px rgba(70, 114, 34, 0.2);
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn:hover {
      background: var(--primary-hover);
      transform: translateY(-1px);
      box-shadow: 0 6px 12px rgba(70, 114, 34, 0.3);
    }
    .btn:active {
      transform: translateY(0);
    }
    .btn-secondary {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      color: #334155;
      box-shadow: none;
    }
    .btn-secondary:hover {
      background: #e2e8f0;
      border-color: #94a3b8;
      box-shadow: none;
    }
    .btn-danger {
      background: #ef4444;
      box-shadow: 0 4px 6px rgba(239, 68, 68, 0.2);
    }
    .btn-danger:hover {
      background: #dc2626;
      box-shadow: 0 6px 12px rgba(239, 68, 68, 0.3);
    }
    input, select, textarea {
      width: 100%;
      padding: 12px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #1e293b;
      border-radius: 8px;
      font-family: inherit;
      font-size: 14px;
      transition: all 0.3s ease;
      margin-top: 6px;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      background: #ffffff;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(70, 114, 34, 0.2);
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
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
    .blog-table-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      margin-top: 20px;
    }
    .blog-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    .blog-table th {
      padding: 16px;
      font-size: 13px;
      text-transform: uppercase;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      background: #f8fafc;
    }
    .blog-table td {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      color: var(--text);
    }
    .blog-table tr:hover td {
      background: #f1f5f9;
    }
    .fab-button {
      position: fixed;
      bottom: 40px;
      right: 40px;
      padding: 15px 30px;
      border-radius: 50px;
      font-size: 16px;
      box-shadow: 0 10px 25px rgba(70, 114, 34, 0.4);
      z-index: 1000;
      background: var(--primary);
    }
    .fab-button:hover {
      box-shadow: 0 15px 35px rgba(70, 114, 34, 0.5);
      transform: translateY(-2px);
    }
    /* Editor styling */
    .editor-block {
      background: #ffffff;
      border: 1px solid var(--border);
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
      background: #ffffff;
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
    <div id="view-auth" class="card auth-box tab-section tab-active" style="max-width: 400px; margin: 60px auto; padding: 35px; border-radius: 12px; background: #ffffff; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
      <div style="text-align: center; margin-bottom: 1.5rem;">
        <img id="logo-img" src="" alt="Certifyied Logo" style="height: 48px; object-fit: contain;">
      </div>
      <h2 style="margin-bottom: 20px; text-align: center; color: #0f172a; font-size: 1.5rem; font-weight: 700; letter-spacing: 0.05em;">Certifyied Blog & <span style="color: #467222;">Contact Portal</span></h2>
      
      <div id="email-step">
        <label style="color: #0f172a;"> Email</label>
        <input type="email" id="auth-email" placeholder="email@example.com" style="margin-top: 6px; margin-bottom: 20px; background: #ffffff; color: #0f172a; border: 1px solid #cbd5e1;">
        <button class="btn" style="width: 100%;" onclick="sendMagicLink()">Get Login Link</button>
      </div>
    </div>

    <!-- MAIN DASHBOARD -->
    <div id="view-dashboard" class="tab-section">

      <!-- PROJECTS VIEW -->
      <div id="panel-projects" class="tab-section tab-active">
        <div style="margin-bottom: 20px; display: flex; gap: 10px; justify-content: flex-end;">
          <button class="btn btn-secondary global-only" onclick="showUsersPanel()">👥 User Permissions</button>
          <button class="btn btn-secondary global-only" onclick="showAuditLogsPanel()">📜 Audit Logs</button>
          <button class="btn btn-danger" onclick="logout()" style="font-size: 13px; padding: 6px 12px; box-shadow: none;" title="Log Out">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Logout
          </button>
        </div>
        
        <div class="card dev-only" style="margin-bottom: 25px;">
          <h3>Provision New Blog Client</h3>
          <p style="margin-top: 5px; margin-bottom: 10px; font-size: 13px;">Authorizes a new client user to log in and manage stories for a specific parent project location.</p>
          <div class="flex-group" style="margin-top: 15px; display: flex; flex-direction: column; gap: 10px;">
            <label style="font-size:12px; font-weight:600;">Select Project *</label>
            <select id="new-client-project-id" style="padding:10px; border-radius:8px; border:1px solid var(--border); background: #fff;"></select>
            
            <label style="font-size:12px; font-weight:600; margin-top:5px;">Blogger Name</label>
            <input type="text" id="new-client-name" placeholder="e.g. John Doe, Lead Editor">
            
            <label style="font-size:12px; font-weight:600; margin-top:5px;">Login Email *</label>
            <input type="email" id="new-client-email" placeholder="e.g. editor@domain.com">
            
            <button class="btn" style="align-self: flex-start; margin-top:10px;" onclick="createBlogClient()">Add Blog Client</button>
          </div>
        </div>

        <h3 style="margin-bottom: 15px;">Your Blog Clients</h3>
        <div class="blog-table-container">
          <table class="blog-table">
            <thead>
              <tr>
                <th>Blogger</th>
                <th>Project / Domain</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody id="projects-list">
              <!-- Blog Clients load here -->
            </tbody>
          </table>
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
              <tr style="border-bottom:1px solid var(--border); background:#f8fafc;">
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
              <tr style="border-bottom:1px solid var(--border); background:#f8fafc;">
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
        <div style="margin-bottom: 20px; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;">
          <button id="btn-back-to-projects" class="btn btn-secondary" onclick="showPanel('panel-projects')">← Back to Projects</button>
          
          <button class="btn btn-secondary dev-only" onclick="showIntegrations()">🔌 Get CDN Embed Snippet</button>
          <button class="btn btn-secondary dev-only" onclick="showSitemaps()">🔗 Get Sitemap Links</button>
          <button class="btn btn-secondary" onclick="window.open('https://www.reviewmanager.in/reviewdash?clientId=' + selectedProjectId, '_blank')" style="background: #4285F4; color: #fff; border-color: #4285F4;">⭐ Review Manager Dashboard</button>
          <button class="btn btn-secondary global-only" onclick="showUsersPanel()">👥 User Permissions</button>
          <button class="btn btn-secondary global-only" onclick="showAuditLogsPanel()">📜 Audit Logs</button>
          <button class="btn btn-danger" onclick="logout()" style="font-size: 13px; padding: 6px 12px; box-shadow: none;" title="Log Out">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Logout
          </button>
        </div>

        <div style="margin-bottom: 25px;">
          <h2 id="detail-project-name" style="font-size: 28px;">Project Details</h2>
          <p id="detail-project-id" style="display: none;"></p>
        </div>

        <h3 style="margin-bottom: 15px; margin-top: 20px;">Published Stories</h3>
        <input type="text" id="search-blogs" placeholder="Search blogs by title..." onkeyup="filterBlogs()" style="max-width: 400px; margin-bottom: 15px; padding: 10px;">
        <div class="blog-table-container">
          <table class="blog-table">
            <thead>
              <tr>
                <th>Title</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody id="blogs-list">
              <!-- Blogs load here -->
            </tbody>
          </table>
        </div>
        <button class="btn fab-button" onclick="newBlog()">+ Add Blog</button>
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

        <div class="card" style="margin-top: 20px;">
          <h3>3. Contact Form API Endpoint</h3>
          <p style="margin-top: 5px; margin-bottom: 15px;">Send contact form submissions securely via POST request. Automatically handles emails and logging.</p>
          <label>API Endpoint URL</label>
          <div id="integration-snippet-contact-api" class="snippet-box"></div>
          <button class="btn" style="margin-top: 15px;" onclick="copyContactAPI()">Copy Endpoint</button>
          
          <label style="margin-top: 20px; display: block;">JSON Payload Format</label>
          <pre class="snippet-box" style="margin-top: 5px; background: #111827; border: 1px solid #374151; border-radius: 8px; color: #a5b4fc; font-family: monospace; white-space: pre-wrap; font-size: 13px;">{
  // Name of the sender (Optional)
  "sender_name": "John Doe",
  
  // Email address of the sender (Required, used for Reply-To)
  "sender_email": "john@example.com",
  
  // Phone number (Optional)
  "phone_number": "+1 555-123-4567",
  
  // Subject of the email (Optional)
  "subject": "Interested in your services",
  
  // The actual message (Required)
  "message": "Hello! I would like to learn more..."
}</pre>
        </div>
      </div>

      <!-- SITEMAP MODAL/PANEL -->
      <div id="panel-sitemaps" class="tab-section">
        <button class="btn btn-secondary" style="margin-bottom: 20px;" onclick="showPanel('panel-project-detail')">← Back to Blogs</button>
        
        <div class="card" style="margin-bottom: 20px;">
          <h3>Dynamic XML Sitemap</h3>
          <p style="margin-top: 5px; margin-bottom: 15px;">Your dynamic sitemap automatically updates whenever a blog is published. Use this CDN link directly in Google Search Console.</p>
          <label>Sitemap URL</label>
          <div id="sitemap-cdn-url" class="snippet-box"></div>
          
          <div style="display: flex; gap: 10px; margin-top: 15px;">
            <button class="btn" onclick="copySitemapCDN()">Copy Sitemap URL</button>
            <button class="btn btn-secondary" onclick="downloadSitemapXML()">📥 Download XML</button>
          </div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <h3>Add Static Link</h3>
          <p style="margin-top: 5px; margin-bottom: 15px;">Add other pages (like /about or /services) to the sitemap manually.</p>
          <div style="display: flex; gap: 10px;">
            <input type="text" id="new-static-link" placeholder="Full URL (e.g. https://domain.com/about)" style="flex-grow: 1; margin: 0; padding: 12px; border-radius: 8px;">
            <button class="btn" style="padding: 10px 20px;" onclick="addStaticLink()">Add Link</button>
          </div>
        </div>

        <div class="card">
          <h3>Raw Generated Links</h3>
          <p style="margin-top: 5px; margin-bottom: 15px;">Below are the raw public URLs generated for your blogs.</p>
          <div id="sitemap-list" style="margin-top: 15px; display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto;">
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

    // Toast Notification Logic
    function showToast(message, type = 'info') {
      let container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
      }
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      
      
      if (type === 'error' || message.toLowerCase().includes('error') || message.toLowerCase().includes('failed') || message.toLowerCase().includes('incorrect')) {
        toast.className = 'toast error';
      } else if (type === 'success' || message.toLowerCase().includes('success') || message.toLowerCase().includes('copied') || message.toLowerCase().includes('published')) {
        toast.className = 'toast success';
      }
      
      toast.innerHTML = '<span>' + message + '</span>';

      container.appendChild(toast);
      
      // Trigger reflow to play animation
      void toast.offsetWidth;
      toast.classList.add('show');
      
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    const baseUrl = window.location.origin + "/adminApiBlog";
    const params = new URLSearchParams(window.location.search);
    const parentOrigin = params.get('parent_origin') || window.location.origin;
    let token = localStorage.getItem('blog_auth_token');
    let selectedProjectId = '';
    let projectsCache = [];
    let blogsCache = [];
    let currentPanel = 'panel-projects';
    let previousPanel = 'panel-projects';



    // On Load Check for magic token first
    const magicToken = params.get('magic_token');
    
    // Resolve logo image from parent origin query parameter dynamically
    const logoEl = document.getElementById('logo-img');
    if (logoEl) {
      let logoSrc = parentOrigin + '/image.png';
      if (parentOrigin.includes('localhost') || parentOrigin.includes('127.0.0.1')) {
        logoSrc = 'https://certifyied.com/image.png';
      }
      logoEl.src = logoSrc;
    }

    if (magicToken) {
      verifyMagicToken(magicToken);
    } else if (token) {
      showDashboard();
    }

    async function verifyMagicToken(mToken) {
      showToast("Verifying secure link...", "info");
      try {
        const res = await fetch(baseUrl + "/auth/verify-magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: mToken })
        });
        const data = await res.json();
        if (res.ok && data.token) {
          token = data.token;
          localStorage.setItem('blog_auth_token', token);
          
          // Clean token from address bar
          const url = new URL(window.location.href);
          url.searchParams.delete('magic_token');
          window.history.replaceState({}, document.title, url.pathname + url.search);
          
          showToast("✅ Login successful!", "success");
          showDashboard();
        } else {
          showToast(data.error || "Login link invalid or expired.", "error");
        }
      } catch (e) {
        showToast("Verification failed: " + e.message, "error");
      }
    }

    async function sendMagicLink() {
      const email = document.getElementById('auth-email').value;
      if (!email) return showToast("Email is required!", "error");

      const btn = document.querySelector('#email-step button');
      btn.disabled = true;
      btn.innerText = 'Sending link...';

      try {
        const redirectUrl = parentOrigin + '/certlogin';
        const res = await fetch(baseUrl + "/auth/send-magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), redirectUrl, portalType: 'blog_admin' })
        });
        const data = await res.json();

        if (res.ok) {
          showToast("✅ Secure login link sent! Please check your email inbox.", "success");
        } else {
          showToast(data.error || "Failed to send login link.", "error");
        }
      } catch (e) {
        showToast("Network error: " + e.message, "error");
      } finally {
        btn.disabled = false;
        btn.innerText = 'Get Login Link';
      }
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
      if (!email) return showToast("Email is required!");

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
            showToast("⚠️ OTP generated but email delivery failed. Check wrangler logs for the code, or check your Resend API key.");
          } else {
            showToast("✅ OTP sent! Please check your email.");
          }
        } else {
          showToast(data.error || "Failed to send OTP.");
        }
      } catch (e) {
        showToast("Network error: " + e.message);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Send OTP';
      }
    }

    async function verifyOTP() {
      const email = document.getElementById('auth-email').value;
      const otp = document.getElementById('auth-otp').value;
      if (!otp) return showToast("OTP is required!");
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
          showToast(data.error || "Incorrect OTP.");
        }
      } catch (e) {
        showToast("Verification failed: " + e.message);
      }
    }

    // --- BLOG CLIENTS FLOW ---
    let blogClientsCache = [];
    
    async function loadProjects() {
      // Replaces old projects load: gets both projects for dropdown and clients list
      try {
        // A. Load parent projects list for creation dropdown select box
        const projRes = await fetch(baseUrl + "/api/projects", {
          headers: { "Authorization": "Bearer " + token }
        });
        if (projRes.status === 401) return logout();
        const projData = await projRes.json();
        projectsCache = projData.projects || [];
        
        const selectBox = document.getElementById('new-client-project-id');
        if (selectBox) {
          selectBox.innerHTML = '<option value="">-- Choose Project Parent --</option>';
          projectsCache.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.innerText = p.name;
            selectBox.appendChild(opt);
          });
        }

        // B. Load blog clients
        const clientRes = await fetch(baseUrl + "/api/blog-clients", {
          headers: { "Authorization": "Bearer " + token }
        });
        const clientData = await clientRes.json();
        blogClientsCache = clientData.blogClients || [];
        renderProjects();
      } catch (e) {
        showToast("Failed to load blog clients: " + e.message);
      }
    }

    function renderProjects() {
      const listEl = document.getElementById('projects-list');
      listEl.innerHTML = '';
      if (blogClientsCache.length === 0) {
        listEl.innerHTML = '<tr><td colspan="3" style="text-align:center;">No blog clients found.</td></tr>';
        return;
      }
      blogClientsCache.forEach(bc => {
        const tr = document.createElement('tr');
        
        const tdTitle = document.createElement('td');
        tdTitle.style.fontWeight = '600';
        tdTitle.innerHTML = '<div>' + (bc.name || 'Blogger') + '</div><div style="font-size: 11px; color: var(--muted); font-family: monospace; font-weight: normal; margin-top:2px;">' + bc.email + '</div>';
        
        const tdId = document.createElement('td');
        tdId.style.fontSize = '13px';
        const projectParentName = bc.projects ? bc.projects.name : 'Unknown parent project';
        tdId.innerText = projectParentName;
        
        const tdActions = document.createElement('td');
        tdActions.style.textAlign = 'right';
        
        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'inline-flex';
        btnGroup.style.gap = '8px';
        
        const manageBtn = document.createElement('button');
        manageBtn.className = 'btn';
        manageBtn.style.padding = '6px 12px';
        manageBtn.style.fontSize = '12px';
        manageBtn.innerText = 'Manage Blogs';
        manageBtn.onclick = () => viewProject(bc.project_id, projectParentName);
        
        btnGroup.appendChild(manageBtn);

        const payload = getPayload();
        const role = payload ? payload.role : 'blogger';
        if (role === 'admin' || role === 'developer') {
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'btn btn-danger';
          deleteBtn.style.padding = '6px 12px';
          deleteBtn.style.fontSize = '12px';
          deleteBtn.innerText = 'Delete';
          deleteBtn.onclick = () => deleteBlogClient(bc.id);
          btnGroup.appendChild(deleteBtn);
        }
        
        tdActions.appendChild(btnGroup);
        
        tr.appendChild(tdTitle);
        tr.appendChild(tdId);
        tr.appendChild(tdActions);
        
        listEl.appendChild(tr);
      });
    }

    async function createBlogClient() {
      const pId = document.getElementById('new-client-project-id').value;
      const cName = document.getElementById('new-client-name').value;
      const cEmail = document.getElementById('new-client-email').value;
      
      if (!pId || !cEmail) return showToast("Project selection and Login Email are required!");
      try {
        const res = await fetch(baseUrl + "/api/blog-clients", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
          },
          body: JSON.stringify({ project_id: pId, name: cName, email: cEmail })
        });
        if (res.ok) {
          document.getElementById('new-client-name').value = '';
          document.getElementById('new-client-email').value = '';
          document.getElementById('new-client-project-id').value = '';
          showToast("Blog client added successfully!");
          loadProjects();
        } else {
          const data = await res.json();
          showToast(data.error || "Failed to add blog client");
        }
      } catch (e) {
        showToast("Error adding blog client");
      }
    }

    async function deleteBlogClient(id) {
      if (!confirm("Are you sure you want to remove access for this blog client?")) return;
      try {
        const res = await fetch(baseUrl + "/api/blog-clients/" + id, {
          method: "DELETE",
          headers: { "Authorization": "Bearer " + token }
        });
        if (res.ok) {
          showToast("Blog client access removed.");
          loadProjects();
        } else {
          const data = await res.json();
          showToast(data.error || "Failed to delete client");
        }
      } catch (e) {
        showToast("Error deleting blog client");
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
        showToast("Failed to delete project");
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
      const listEl = document.getElementById('blogs-list');
      listEl.innerHTML = '<tr><td colspan="2" style="text-align:center; padding: 40px;"><div style="display:inline-block; border: 3px solid var(--border); border-top: 3px solid var(--primary); border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite;"></div><div style="margin-top:10px; color:var(--muted); font-size:13px;">Loading stories...</div></td></tr>';
      
      try {
        const res = await fetch(baseUrl + "/api/blogs?projectId=" + selectedProjectId, {
          headers: { "Authorization": "Bearer " + token }
        });
        const data = await res.json();
        blogsCache = data.blogs || [];
        renderBlogs();
      } catch (e) {
        showToast("Failed to load blogs");
      }
    }

    function renderBlogs() {
      const listEl = document.getElementById('blogs-list');
      listEl.innerHTML = '';
      if (blogsCache.length === 0) {
        listEl.innerHTML = '<tr><td colspan="2" style="text-align:center;">No published stories found. Click "+ Add Blog" to create one!</td></tr>';
        return;
      }
      blogsCache.forEach(b => {
        const tr = document.createElement('tr');
        tr.className = 'blog-row';
        tr.dataset.title = (b.title || '').toLowerCase();
        
        const tdTitle = document.createElement('td');
        tdTitle.style.fontWeight = '600';
        tdTitle.innerText = b.title || '(Untitled)';
        
        const tdActions = document.createElement('td');
        tdActions.style.textAlign = 'right';
        
        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'inline-flex';
        btnGroup.style.gap = '8px';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-secondary';
        editBtn.style.padding = '6px 12px';
        editBtn.innerText = 'Edit';
        editBtn.onclick = () => editBlog(b.id);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.style.padding = '6px 12px';
        deleteBtn.innerText = 'Delete';
        deleteBtn.onclick = () => deleteBlog(b.id);
        
        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(deleteBtn);
        tdActions.appendChild(btnGroup);
        
        tr.appendChild(tdTitle);
        tr.appendChild(tdActions);
        
        listEl.appendChild(tr);
      });
    }

    function filterBlogs() {
      const query = document.getElementById('search-blogs').value.toLowerCase();
      const rows = document.querySelectorAll('.blog-row');
      rows.forEach(row => {
        if (row.dataset.title.includes(query)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
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
        showToast("Error deleting blog");
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

      const contactApiSnippet = baseUrl + '/api/contact?projectId=' + selectedProjectId;

      document.getElementById('integration-snippet-home').innerText = homeSnippet;
      document.getElementById('integration-snippet-blog').innerText = blogSnippet;
      document.getElementById('integration-snippet-contact-api').innerText = contactApiSnippet;
      showPanel('panel-integrations');
    }

    function copySnippetHome() {
      navigator.clipboard.writeText(document.getElementById('integration-snippet-home').innerText);
      showToast("Home Page snippet code copied to clipboard!");
    }

    function copySnippetBlog() {
      navigator.clipboard.writeText(document.getElementById('integration-snippet-blog').innerText);
      showToast("Blog Page snippet code copied to clipboard!");
    }

    function copyContactAPI() {
      navigator.clipboard.writeText(document.getElementById('integration-snippet-contact-api').innerText);
      showToast("Contact API Endpoint URL copied to clipboard!");
    }

    // --- SITEMAPS GENERATOR ---
    function showSitemaps() {
      const container = document.getElementById('sitemap-list');
      container.innerHTML = '';
      
      const cdnUrl = baseUrl + '/api/sitemap.xml?projectId=' + selectedProjectId;
      document.getElementById('sitemap-cdn-url').innerText = cdnUrl;

      if (blogsCache.length === 0) {
        container.innerHTML = '<p>Publish some blogs to generate sitemap links.</p>';
      } else {
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
            showToast('Copied link!');
          };
          
          div.appendChild(span);
          div.appendChild(btn);
          container.appendChild(div);
        });
      }
      showPanel('panel-sitemaps');
    }

    function copyAllSitemaps() {
      const links = blogsCache.map(b => baseUrl + '/blog/' + b.slug + '?project=' + selectedProjectId).join('\\n');
      navigator.clipboard.writeText(links);
      showToast("All blog links copied to clipboard!");
    }

    function copySitemapCDN() {
      const url = document.getElementById('sitemap-cdn-url').innerText;
      navigator.clipboard.writeText(url);
      showToast("Sitemap CDN URL copied to clipboard!");
    }

    function downloadSitemapXML() {
      const url = document.getElementById('sitemap-cdn-url').innerText;
      window.open(url, '_blank');
    }

    async function addStaticLink() {
      const url = document.getElementById('new-static-link').value;
      if (!url || !url.startsWith('http')) return showToast("Please enter a valid URL starting with http:// or https://");
      
      try {
        const res = await fetch(baseUrl + "/api/sitemaps", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
          },
          body: JSON.stringify({
            project_id: selectedProjectId,
            loc: url,
            changefreq: 'monthly',
            priority: 0.8
          })
        });
        if (res.ok) {
          showToast("Static link added to XML sitemap successfully!");
          document.getElementById('new-static-link').value = '';
        } else {
          showToast("Failed to add link");
        }
      } catch (e) {
        showToast("Error adding link");
      }
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
        showToast("Failed to load audit logs: " + e.message);
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
        showToast("Failed to load users: " + e.message);
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
      if (!email) return showToast("Email is required!");
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
          showToast(data.error);
        }
      } catch (e) {
        showToast("Error adding user");
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
        showToast("Failed to delete user");
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
        showToast("Image uploaded to R2 successfully!");
      } catch (err) {
        showToast("Upload failed: " + err.message);
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

      if (!title) return showToast("Blog Title is required!");

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
          showToast("Story published successfully!");
          showPanel('panel-project-detail');
          loadBlogs();
        } else {
          const data = await res.json();
          showToast("Failed to save: " + data.error);
        }
      } catch (err) {
        showToast("Network error: " + err.message);
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

    return null;
}
