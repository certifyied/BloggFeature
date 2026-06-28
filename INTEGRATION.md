# Blog & Sitemap Integration Guide

This document outlines how to integrate the dynamic blog engine and automated XML sitemap into a client's website.

## 1. Dynamic XML Sitemap Integration

The blog engine automatically generates a live XML sitemap. Every time a new blog is published, it is instantly added to this endpoint.

**Your Dynamic Sitemap URL:**
```
https://bloggfeature.certifyied.workers.dev/adminApiBlog/api/sitemap.xml?projectId=YOUR_PROJECT_ID
```

### How to use it:

**Method A: Google Search Console (Direct)**
You can simply paste the exact URL above into Google Search Console as the sitemap URL.

**Method B: Next.js App Router (Proxy)**
To make the sitemap appear perfectly at `https://clientdomain.com/sitemap.xml`, create a Next.js App Router API route or proxy it in `next.config.js`:

```javascript
// next.config.js
module.exports = {
  async rewrites() {
    return [
      {
        source: '/sitemap.xml',
        destination: 'https://bloggfeature.certifyied.workers.dev/adminApiBlog/api/sitemap.xml?projectId=4024d9ee-af39-411b-a70f-c388fe32dd47',
      },
    ]
  },
}
```

## 2. Blog UI Integration (CDN)

You don't need to build any React components to render the blogs. Just drop the provided CDN script into your React/Next.js page.

### 🎨 Customizing Brand Colors

You can easily match the blog embed to your website's branding by passing a `color` parameter to the embed script. 

Simply append `?color=YOUR_HEX_CODE` (without the `#`) to the embed URL. This color will be used for buttons, links, hover effects, and the beautiful gradient fallback when blogs don't have a main image.

**Example:** If your brand color is `#2563eb`, your script URL will be:
`https://bloggfeature.certifyied.workers.dev/adminApiBlog/api/embed?color=2563eb`

### 🚀 Routing Setup for SEO-Friendly URLs

When a user clicks a blog card, the script will automatically redirect them to an SEO-friendly URL format like:
`/blog/your-story-slug-here?id=123`

To ensure your app handles these dynamic routes correctly and doesn't show a 404 error, follow the routing instructions for your framework below:

#### React Router (Vite / CRA)
Ensure you have a parameterized route catching the slug in your `App.jsx` or router config:

```jsx
// App.jsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import BlogPage from "./pages/BlogPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/blog" element={<BlogPage />} />
        <Route path="/blog/:slug" element={<BlogPage />} /> {/* Catches the SEO slug */}
      </Routes>
    </BrowserRouter>
  );
}
```

#### Next.js (App Router)
If using Next.js 13+ App Router, use a dynamic catch-all or a parameter folder:

1. Create `app/blog/page.tsx` (for the grid)
2. Create `app/blog/[slug]/page.tsx` (for the single post)

You can just reuse the exact same CDN script in both pages!

### 💻 Code Snippet Example:

```jsx
import { useEffect, useState } from 'react';

const BlogPage = () => {
  const [blogId, setBlogId] = useState(null);

  useEffect(() => {
    // Determine if we should show a single post by checking the URL
    const urlParams = new URLSearchParams(window.location.search);
    setBlogId(urlParams.get('id') || urlParams.get('slug'));

    // 1. Remove old script if exists to prevent duplicates on route changes
    const oldScript = document.getElementById('certifyied-blog-script');
    if (oldScript) oldScript.remove();
    
    // 2. Inject the CDN script
    const script = document.createElement('script');
    script.id = 'certifyied-blog-script';
    script.src = 'https://bloggfeature.certifyied.workers.dev/adminApiBlog/api/embed?color=2563eb';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      const existing = document.getElementById('certifyied-blog-script');
      if (existing) existing.remove();
    };
  }, []);

  return (
    <div className="container mx-auto px-4 max-w-6xl py-20">
      {blogId ? (
        /* Render Single Post (triggered when ?id= is present) */
        <div id="certifyied-blog-post" data-project-id="YOUR_PROJECT_ID"></div>
      ) : (
        /* Render Blog Grid (triggered when no query params exist) */
        <div id="certifyied-blog-container" data-project-id="YOUR_PROJECT_ID" data-limit="9" data-redirect-url="/blog"></div>
      )}
    </div>
  );
};

export default BlogPage;
```


## 3. Contact Form API Integration

The worker also exposes a secure, rate-limited Contact Form API that uses Resend to deliver emails. Each project can configure its destination email in the database (`contact_email` in the `projects` table), and the API is restricted by CORS so it can only be called from your project's `base_url`.

### Endpoint Configuration
- **URL:** `https://bloggfeature.certifyied.workers.dev/adminApiBlog/api/contact?projectId=YOUR_PROJECT_ID`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`
- **Rate Limit:** 3 requests per minute per IP address.

### Payload Structure
The API expects a JSON body with the following fields:
- `sender_name` (optional): The name of the person contacting you.
- `sender_email` (required): The email address of the person contacting you (used as Reply-To).
- `phone_number` (optional): The phone number of the person contacting you.
- `subject` (optional): The subject of the message.
- `message` (required): The actual message content.

### Code Snippet Example (React/Next.js)

```javascript
async function handleContactSubmit(event) {
  event.preventDefault();
  
  const payload = {
    sender_name: "John Doe",
    sender_email: "john@example.com",
    phone_number: "+1 555-123-4567",
    subject: "Interested in your services",
    message: "Hello! I would like to learn more about your industrial automation solutions."
  };

  try {
    const response = await fetch('https://bloggfeature.certifyied.workers.dev/adminApiBlog/api/contact?projectId=YOUR_PROJECT_ID', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (response.ok) {
      alert("Message sent successfully!");
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Network error occurred.");
  }
}
```

All submissions are automatically logged to the `form_submissions` and `audit_logs` tables in your Supabase database for auditing and monitoring purposes.
