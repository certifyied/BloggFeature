import * as jose from 'jose';

// Helper for JWT signing and verification using Web Crypto API via 'jose'
export async function signJWT(env, payload) {
  const secret = new TextEncoder().encode(env.JWT_SECRET || 'fallback-secret-for-dev-only');
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .sign(secret);
}

export async function verifyJWT(env, token) {
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET || 'fallback-secret-for-dev-only');
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
  } catch (e) {
    return null;
  }
}

// Helpers for short-lived Magic Tokens (15 minutes)
export async function signMagicToken(env, payload) {
  const secret = new TextEncoder().encode(env.JWT_SECRET || 'fallback-secret-for-dev-only');
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .sign(secret);
}

export async function verifyMagicToken(env, token) {
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET || 'fallback-secret-for-dev-only');
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
  } catch (e) {
    return null;
  }
}

// Email delivery via Resend API (OTP Fallback)
export async function sendOTPEmail(env, email, otp) {
  const apiKey = env.RESEND_API_KEY;

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
      from: 'Review Manager Portal <no-reply@send.certifyied.com>',
      to: [email],
      subject: 'Your Review Manager Login OTP',
      html: `<div style="font-family:sans-serif;background:#0b0f19;color:#f9fafb;padding:40px;border-radius:12px;max-width:500px;margin:auto;border:1px solid #1f2937;">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="https://www.reviewmanager.in/image.png" alt="Review Manager Logo" style="height:48px;width:auto;display:block;margin:0 auto;" />
  </div>
  <h2 style="color:#6366f1;font-weight:700;margin-bottom:20px;text-align:center;">Portal Access</h2>
  <p style="color:#9ca3af;font-size:14px;line-height:1.6;text-align:center;">A login request was made. Use the OTP below to authenticate:</p>
  <div style="font-size:36px;font-weight:800;color:#10b981;letter-spacing:6px;text-align:center;margin:30px 0;background:#161e2e;padding:20px;border-radius:8px;border:1px solid #1f2937;">${otp}</div>
  <p style="color:#9ca3af;font-size:12px;text-align:center;">Valid for 10 minutes. If you did not request this, please ignore this email.</p>
</div>`,
      text: `Your Review Manager login OTP is: ${otp}\n\nValid for 10 minutes.`,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.warn(`[OTP EMAIL] Resend failed (${res.status}): ${err}`);
    console.warn(`🔑 DEV FALLBACK — OTP for ${email}: ${otp}`);
    if (res.status >= 500) return; 
    throw new Error(`Email delivery failed: ${res.status} ${err}`);
  }
}

// Magic Link Email Delivery
export async function sendMagicLinkEmail(env, email, magicLink) {
  const apiKey = env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('⚠️  RESEND_API_KEY not set.');
    console.warn(`🔑 DEV FALLBACK — Magic Link for ${email}: ${magicLink}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'Review Manager Portal <no-reply@send.certifyied.com>',
      to: [email],
      subject: 'Log in to your Review Manager Portal',
      html: `<div style="font-family:sans-serif;background:#ffffff;color:#0f172a;padding:40px;border-radius:12px;max-width:500px;margin:auto;border:1px solid #e2e8f0;box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="https://www.reviewmanager.in/image.png" alt="Review Manager Logo" style="height:48px;width:auto;display:block;margin:0 auto;" />
  </div>
  <h2 style="color:#6366f1;font-weight:700;margin-bottom:20px;text-align:center;">Portal Access</h2>
  <p style="color:#475569;font-size:14px;line-height:1.6;text-align:center;">Click the button below to log in to your dashboard instantly. No password or verification code required:</p>
  <div style="text-align:center;margin:30px 0;">
    <a href="${magicLink}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:8px;font-weight:600;text-decoration:none;font-size:15px;box-shadow:0 2px 4px rgba(79,70,229,0.2);">Log In to Dashboard</a>
  </div>
  <p style="color:#94a3b8;font-size:12px;line-height:1.4;word-break:break-all;">Or copy and paste this link in your browser:<br/><a href="${magicLink}" style="color:#6366f1;">${magicLink}</a></p>
  <hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0;"/>
  <p style="color:#94a3b8;font-size:11px;text-align:center;">This link is valid for 15 minutes. If you did not request this, you can safely ignore this email.</p>
</div>`,
      text: `Click the link below to log in to your Review Manager dashboard:\n\n${magicLink}\n\nValid for 15 minutes.`,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.warn(`[MAGIC LINK EMAIL] Resend failed (${res.status}): ${err}`);
    console.warn(`🔑 DEV FALLBACK — Magic Link for ${email}: ${magicLink}`);
    if (res.status >= 500) return; 
    throw new Error(`Email delivery failed: ${res.status} ${err}`);
  }
}

// Router handler for auth endpoints
export async function handleAuthRequest(request, env, ctx, path, method, supabaseAdmin, corsHeaders, logAction) {
  // POST Send Magic Link
  if (path === '/adminApiBlog/auth/send-magic-link' && method === 'POST') {
    try {
      const { email, redirectUrl, portalType } = await request.json();
      if (!email || !redirectUrl) {
        return new Response(JSON.stringify({ error: "Email and redirectUrl are required." }), { 
          status: 400, 
          headers: corsHeaders 
        });
      }

      const isClientReviewsPortal = portalType === 'client_reviews' || redirectUrl.includes('clientReview');
      const isReviewsAdminPortal = portalType === 'admin_reviews' || redirectUrl.includes('reviewdash') || redirectUrl.includes('reviews.');
      
      let isAuthorized = false;
      let role = 'client';
      let projectId = null;
      let clientId = null;

      if (isClientReviewsPortal || isReviewsAdminPortal) {
        // --- 1 & 2. REVIEWS PORTAL LOGINS (CLIENT OR ADMIN) ---
        try {
          const { data: clientUsers } = await supabaseAdmin
            .from('review_clients')
            .select('id, project_id')
            .eq('email', email.toLowerCase());

          if (clientUsers && clientUsers.length > 0) {
            isAuthorized = true;
            role = 'client';
            clientId = clientUsers[0].id;
            projectId = clientUsers[0].project_id;
          }
        } catch (e) {
          console.error("review_clients lookup failed:", e.message);
        }

        // B. Check if the user is an admin in admins
        if (!isAuthorized) {
          try {
            const { data: adminUser } = await supabaseAdmin
              .from('admins')
              .select('role, project_id')
              .eq('email', email.toLowerCase())
              .maybeSingle();

            if (adminUser && (adminUser.role === 'admin' || adminUser.role === 'global')) {
              isAuthorized = true;
              role = adminUser.role;
              projectId = adminUser.project_id;
            }
          } catch (e) {
            console.error("Admins lookup failed:", e.message);
          }
        }

        // C. Check global admin email fallback
        if (!isAuthorized && email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase()) {
          isAuthorized = true;
          role = 'admin';
        }
      } else {
        // --- 3. BLOG ADMIN PORTAL LOGIN ---
        // Allow admins (admin, global, blogger) and project-level clients (blogger / client)
        
        // 1. Check if admin in admins table
        try {
          const { data: adminUser } = await supabaseAdmin
            .from('admins')
            .select('role, project_id')
            .eq('email', email.toLowerCase())
            .maybeSingle();

          if (adminUser && adminUser.role !== 'client') {
            isAuthorized = true;
            role = adminUser.role || 'blogger';
            projectId = adminUser.project_id;
          }
        } catch (e) {
          console.error("Admins lookup failed for Blog Admin:", e.message);
        }

        // 2. Check if global email fallback
        if (!isAuthorized && email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase()) {
          isAuthorized = true;
          role = 'admin';
        }

        // 3. Check if email is in the new blog_clients table for blog management login
        if (!isAuthorized) {
          try {
            const { data: blogClientUser } = await supabaseAdmin
              .from('blog_clients')
              .select('id, project_id')
              .eq('email', email.toLowerCase())
              .limit(1)
              .maybeSingle();

            if (blogClientUser) {
              isAuthorized = true;
              role = 'blogger';
              projectId = blogClientUser.project_id;
              clientId = blogClientUser.id;
            }
          } catch (e) {
            console.error("blog_clients lookup failed:", e.message);
          }
        }
      }

      if (!isAuthorized) {
        await logAction(supabaseAdmin, email, 'magic_link_failed_unauthorized', { email, redirectUrl }, request.headers.get('CF-Connecting-IP') || '');
        return new Response(JSON.stringify({ error: "Unauthorized email address." }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate verification token (15 mins)
      const magicToken = await signMagicToken(env, { 
        email: email.toLowerCase(), 
        role, 
        projectId, 
        clientId,
        isClientPortal: role === 'client'
      });

      const magicLink = `${redirectUrl}?magic_token=${magicToken}`;
      await logAction(supabaseAdmin, email, 'magic_link_requested', { email, redirectUrl }, request.headers.get('CF-Connecting-IP') || '');

      try {
        await sendMagicLinkEmail(env, email, magicLink);
      } catch (emailErr) {
        console.error('[MagicLink] Email delivery failed:', emailErr.message);
      }

      return new Response(JSON.stringify({ success: true, message: "Magic link sent successfully." }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }

  // POST Verify Magic Link
  if (path === '/adminApiBlog/auth/verify-magic-link' && method === 'POST') {
    try {
      const { token } = await request.json();
      if (!token) {
        return new Response(JSON.stringify({ error: "Token is required." }), { status: 400, headers: corsHeaders });
      }

      const payload = await verifyMagicToken(env, token);
      if (!payload) {
        return new Response(JSON.stringify({ error: "Invalid or expired login link." }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate long-lived final session token (24h)
      const sessionToken = await signJWT(env, { 
        email: payload.email, 
        role: payload.role, 
        projectId: payload.projectId, 
        clientId: payload.clientId 
      });

      await logAction(supabaseAdmin, payload.email, 'login_success_magic_link', { email: payload.email, role: payload.role }, request.headers.get('CF-Connecting-IP') || '');

      return new Response(JSON.stringify({ token: sessionToken }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }

  // POST Send OTP (LEGACY FALLBACK)
  if (path === '/adminApiBlog/auth/send-otp' && method === 'POST') {
    try {
      const { email } = await request.json();
      if (!email) {
        return new Response(JSON.stringify({ error: "Email is required." }), { status: 400, headers: corsHeaders });
      }

      let isAuthorized = false;

      try {
        const { data: adminUser } = await supabaseAdmin
          .from('admins')
          .select('email')
          .eq('email', email.toLowerCase())
          .maybeSingle();

        if (adminUser && adminUser.email) {
          isAuthorized = true;
        }
      } catch (e) {}

      if (!isAuthorized && email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase()) {
        isAuthorized = true;
      }

      if (!isAuthorized) {
        try {
          const { data: blogClientUser } = await supabaseAdmin
            .from('blog_clients')
            .select('email')
            .eq('email', email.toLowerCase())
            .limit(1)
            .maybeSingle();

          if (blogClientUser && blogClientUser.email) {
            isAuthorized = true;
          }
        } catch (e) {}
      }



      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: "Unauthorized email address." }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await supabaseAdmin
        .from('auth_otps')
        .upsert({ email: email.toLowerCase(), otp, expires_at: expiresAt.toISOString() }, { onConflict: 'email' });

      try {
        await sendOTPEmail(env, email, otp);
      } catch (emailErr) {}

      return new Response(JSON.stringify({ success: true, message: "OTP sent successfully." }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }

  // POST Verify OTP (LEGACY FALLBACK)
  if (path === '/adminApiBlog/auth/verify-otp' && method === 'POST') {
    try {
      const { email, otp } = await request.json();
      if (!email || !otp) {
        return new Response(JSON.stringify({ error: "Email and OTP are required." }), { status: 400, headers: corsHeaders });
      }

      const { data, error } = await supabaseAdmin
        .from('auth_otps')
        .select('otp, expires_at')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (error || !data || data.otp !== otp || new Date() > new Date(data.expires_at)) {
        return new Response(JSON.stringify({ error: "Incorrect or expired OTP." }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let role = 'client';
      let projectId = null;
      let clientId = null;

      try {
        const { data: adminUser } = await supabaseAdmin
          .from('admins')
          .select('role, project_id')
          .eq('email', email.toLowerCase())
          .maybeSingle();

        if (adminUser) {
          role = adminUser.role || 'blogger';
          projectId = adminUser.project_id;
          if (role === 'client') {
            const { data: clientUser } = await supabaseAdmin
              .from('review_clients')
              .select('id')
              .eq('email', email.toLowerCase())
              .maybeSingle();
            if (clientUser) clientId = clientUser.id;
          }
        } else if (email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase()) {
          role = 'admin';
        } else {
          const { data: blogClientUser } = await supabaseAdmin
            .from('blog_clients')
            .select('id, project_id')
            .eq('email', email.toLowerCase())
            .limit(1)
            .maybeSingle();
          if (blogClientUser) {
            role = 'blogger';
            projectId = blogClientUser.project_id;
            clientId = blogClientUser.id;
          }
        }
      } catch (e) {}

      const token = await signJWT(env, { email: email.toLowerCase(), role, projectId, clientId });
      await supabaseAdmin.from('auth_otps').delete().eq('email', email.toLowerCase());

      return new Response(JSON.stringify({ token }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }

  return null;
}
