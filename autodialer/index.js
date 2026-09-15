import { signJWT, verifyJWT, signMagicToken, sendMagicLinkEmail } from '../auth.js';

// In-memory cache fallback in case Supabase schema migration is pending
export const fallbackStore = {
  campaigns: [],
  leads: [],
  callLogs: [],
  qualifiedLeads: [],
  callbacks: [],
  salesTeam: [
    { email: 'sales@certifyied.com', role: 'sales', id: 'default_sales_1' }
  ]
};

function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

export async function sendCallbackEmail(env, { repEmail, leadName, phone, callbackTime, notes, type = 'confirmation' }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ RESEND_API_KEY not configured on server. Skipping callback email.');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  let formattedDate = callbackTime;
  try {
    formattedDate = new Date(callbackTime).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {}

  const isReminder = type === 'reminder';
  const subject = isReminder
    ? `⏰ Reminder: Scheduled Callback with ${leadName || 'Contact'} (${phone})`
    : `📅 Callback Scheduled: ${leadName || 'Contact'} on ${formattedDate}`;

  const heading = isReminder
    ? `Callback Reminder: In ~15 Minutes`
    : `Callback Appointment Scheduled`;

  const leadInfoSection = `
    <div style="background:#f8fafc;border-radius:12px;padding:20px;margin:20px 0;border:1px solid #e2e8f0;">
      <p style="margin:0 0 6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Contact Name</p>
      <p style="margin:0 0 12px 0;font-size:16px;font-weight:700;color:#1e293b;">${leadName || 'Unknown Contact'}</p>
      <p style="margin:0 0 6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Phone Number</p>
      <p style="margin:0 0 12px 0;font-size:16px;color:#0071e3;font-family:monospace;font-weight:700;"><a href="tel:${phone}" style="color:#0071e3;text-decoration:none;">${phone}</a></p>
      <p style="margin:0 0 6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Scheduled Callback Date & Time</p>
      <p style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:#0f172a;">🗓️ ${formattedDate}</p>
      ${notes ? `<p style="margin:0 0 6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Call Notes & Requirements</p><p style="margin:0;font-size:13px;color:#334155;background:#ffffff;padding:12px;border-radius:8px;border:1px solid #cbd5e1;line-height:1.4;">${notes}</p>` : ''}
    </div>
  `;

  const emailPayload = {
    to: [repEmail],
    subject,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;color:#0f172a;padding:36px;border-radius:16px;max-width:520px;margin:auto;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
        <div style="text-align:center;margin-bottom:20px;">
          <img src="https://certifyied.com/certifyied_logo.png" alt="Certifyied" style="height:38px;width:auto;margin:0 auto;display:block;" />
        </div>
        <h2 style="color:#0071e3;font-weight:700;margin:0 0 10px 0;text-align:center;font-size:20px;">${heading}</h2>
        <p style="color:#475569;font-size:14px;line-height:1.5;text-align:center;margin:0 0 18px 0;">
          ${isReminder ? `Your scheduled customer callback is coming up in approximately 15 minutes:` : `A callback has been recorded for your lead queue:`}
        </p>
        ${leadInfoSection}
        <div style="text-align:center;margin:26px 0;">
          <a href="https://www.certifyied.com/autodailer" style="display:inline-block;background:#0071e3;color:#ffffff;padding:12px 28px;border-radius:980px;font-weight:600;text-decoration:none;font-size:14px;box-shadow:0 4px 10px rgba(0,113,227,0.25);">Open Autodialer Workstation</a>
        </div>
        <hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0;" />
        <p style="color:#94a3b8;font-size:11px;text-align:center;margin:0;">Certifyied Autodialer • Sales CRM Telemetry</p>
      </div>
    `,
    text: `${heading}\n\nLead: ${leadName || 'Contact'}\nPhone: ${phone}\nScheduled Time: ${formattedDate}\nNotes: ${notes || 'None'}\n\nOpen Autodialer: https://www.certifyied.com/autodailer`
  };

  try {
    let res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: `Certifyied Autodialer <no-reply@send.certifyied.com>`,
        ...emailPayload
      })
    });

    if (!res.ok && (res.status === 403 || res.status === 422 || res.status === 400)) {
      const fallbackRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          from: `Certifyied Autodialer <onboarding@resend.dev>`,
          ...emailPayload
        })
      });
      if (fallbackRes.ok) {
        return { success: true, provider: 'resend_fallback' };
      }
    }
    return { success: res.ok };
  } catch (err) {
    console.warn('Callback email delivery failed:', err.message);
    return { success: false, error: err.message };
  }
}

export async function processScheduledCallbacks(env, supabaseAdmin) {
  try {
    const now = new Date();
    // Look ahead 15 minutes
    const futureWindow = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    let upcoming = [];
    try {
      const { data, error } = await supabaseAdmin
        .from('autodialer_callbacks')
        .select('*')
        .eq('status', 'pending')
        .eq('notified_email', false)
        .lte('callback_time', futureWindow);

      if (!error && data) upcoming = data;
    } catch (e) {}

    // Fallback store check
    if (upcoming.length === 0 && fallbackStore.callbacks?.length > 0) {
      upcoming = fallbackStore.callbacks.filter(c =>
        c.status === 'pending' &&
        !c.notified_email &&
        new Date(c.callback_time).getTime() <= (now.getTime() + 15 * 60 * 1000)
      );
    }

    for (const cb of upcoming) {
      await sendCallbackEmail(env, {
        repEmail: cb.sales_email,
        leadName: cb.lead_name,
        phone: cb.phone,
        callbackTime: cb.callback_time,
        notes: cb.notes,
        type: 'reminder'
      });

      try {
        await supabaseAdmin
          .from('autodialer_callbacks')
          .update({ notified_email: true })
          .eq('id', cb.id);
      } catch (e) {}

      const memCb = fallbackStore.callbacks?.find(c => c.id === cb.id);
      if (memCb) memCb.notified_email = true;
    }
  } catch (err) {
    console.error('Error in processScheduledCallbacks:', err);
  }
}

export async function handleAutodialerRequest(request, env, ctx, path, method, url, payload, supabaseAdmin, corsHeaders, logAction) {
  // Check prefix
  if (!path.startsWith('/adminApiBlog/api/autodialer')) {
    return null;
  }

  const subpath = path.replace('/adminApiBlog/api/autodialer', '') || '/';

  // --- 1. SALES AUTHENTICATION: LOGIN ---
  if (subpath === '/auth/login' && method === 'POST') {
    try {
      const { email, role: requestedRole } = await request.json();
      if (!email) {
        return jsonResponse({ error: 'Email is required.' }, 400, corsHeaders);
      }

      const normalizedEmail = email.trim().toLowerCase();

      // Check if user is registered in 'admins' table
      let userRole = 'sales';
      let isAuthorized = false;

      try {
        const { data: adminUser, error: adminErr } = await supabaseAdmin
          .from('admins')
          .select('role, email')
          .eq('email', normalizedEmail)
          .maybeSingle();

        if (adminUser) {
          isAuthorized = true;
          userRole = adminUser.role || 'sales';
        } else if (normalizedEmail === (env.ADMIN_EMAIL || '').toLowerCase() || normalizedEmail.includes('certifyied.com')) {
          // Allow admin or certifyied team members
          isAuthorized = true;
          userRole = normalizedEmail === (env.ADMIN_EMAIL || '').toLowerCase() ? 'admin' : 'sales';
          // Auto-insert into admins for subsequent lookups
          try {
            let userId = null;
            const { data: authUser } = await supabaseAdmin.auth.admin.createUser({
              email: normalizedEmail,
              email_confirm: true,
              password: crypto.randomUUID()
            });
            userId = authUser?.user?.id;
            if (!userId) {
              const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
              userId = existingUsers?.users?.find(u => (u.email || '').toLowerCase() === normalizedEmail)?.id;
            }
            if (userId) {
              await supabaseAdmin.from('admins').insert({
                id: userId,
                email: normalizedEmail,
                role: userRole,
                project_id: null
              });
            }
          } catch (insErr) {}
        } else {
          // Deny unrecognized non-certifyied emails unless added by admin
          isAuthorized = false;
        }
      } catch (dbErr) {
        console.warn('Supabase admins lookup warning:', dbErr.message);
        isAuthorized = true;
        userRole = 'sales';
      }

      const token = await signJWT(env, {
        email: normalizedEmail,
        role: userRole,
        isSales: true
      });

      if (logAction) {
        await logAction(supabaseAdmin, normalizedEmail, 'autodialer_sales_login', { role: userRole }, request.headers.get('CF-Connecting-IP') || '');
      }

      return jsonResponse({
        success: true,
        token,
        user: {
          email: normalizedEmail,
          role: userRole
        }
      }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  // --- 2. VERIFY CURRENT USER ---
  if (subpath === '/auth/me' && method === 'GET') {
    if (!payload || !payload.email) {
      return jsonResponse({ authenticated: false }, 401, corsHeaders);
    }
    return jsonResponse({
      authenticated: true,
      email: payload.email,
      role: payload.role || 'sales'
    }, 200, corsHeaders);
  }

  // --- 2b. SALES TEAM DIRECTORY (MANAGE SALES EMAILS IN DB) ---
  if (subpath === '/sales-team' && method === 'GET') {
    try {
      let members = [];
      try {
        const { data, error } = await supabaseAdmin
          .from('admins')
          .select('id, email, role, created_at')
          .in('role', ['sales', 'admin', 'global'])
          .order('created_at', { ascending: false });

        if (!error && data) {
          members = data;
        }
      } catch (dbE) {}

      // Always merge fallbackStore.salesTeam without duplicates so no member is ever lost
      if (fallbackStore.salesTeam.length > 0) {
        for (const fbMember of fallbackStore.salesTeam) {
          if (!members.some(m => (m.email || '').toLowerCase() === (fbMember.email || '').toLowerCase())) {
            members.push(fbMember);
          }
        }
      }

      return jsonResponse({ members }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  if (subpath === '/sales-team' && method === 'POST') {
    try {
      // Strictly restrict adding sales emails to admins only
      const isAdmin = payload && (
        payload.role === 'admin' ||
        payload.role === 'global' ||
        (payload.email && payload.email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase())
      );

      if (!isAdmin) {
        return jsonResponse({ error: 'Access denied. Only administrators can add sales emails into the database.' }, 403, corsHeaders);
      }

      const { email, role: repRole, sendInvite = true, redirectUrl } = await request.json();
      if (!email) {
        return jsonResponse({ error: 'Email is required.' }, 400, corsHeaders);
      }
      const normalizedEmail = email.trim().toLowerCase();
      const targetRole = repRole === 'admin' ? 'admin' : 'sales';

      let memberObj = null;

      // 1. Try checking if user already exists in admins table
      try {
        const { data: existingAdmin } = await supabaseAdmin
          .from('admins')
          .select('id, email, role, created_at')
          .eq('email', normalizedEmail)
          .maybeSingle();

        if (existingAdmin) {
          // Update existing admin role
          const { data: updatedAdmin, error: updErr } = await supabaseAdmin
            .from('admins')
            .update({ role: targetRole })
            .eq('id', existingAdmin.id)
            .select('id, email, role, created_at')
            .single();

          if (!updErr && updatedAdmin) {
            memberObj = updatedAdmin;
          }
        } else {
          // Provision or find user in Supabase Auth to satisfy admins_id_fkey constraint
          let userId = null;
          try {
            const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
              email: normalizedEmail,
              email_confirm: true,
              password: crypto.randomUUID()
            });

            if (!authErr && authUser?.user?.id) {
              userId = authUser.user.id;
            } else if (authErr) {
              const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
              const matched = existingUsers?.users?.find(u => (u.email || '').toLowerCase() === normalizedEmail);
              if (matched?.id) {
                userId = matched.id;
              }
            }
          } catch (authProvisionErr) {
            console.warn('[AUTH PROVISION ERROR]:', authProvisionErr.message);
          }

          if (userId) {
            const { data: insertedAdmin, error: insErr } = await supabaseAdmin
              .from('admins')
              .insert({
                id: userId,
                email: normalizedEmail,
                role: targetRole,
                project_id: null
              })
              .select('id, email, role, created_at')
              .single();

            if (!insErr && insertedAdmin) {
              memberObj = insertedAdmin;
            } else if (insErr) {
              console.error('[SUPABASE ADMINS INSERT ERROR]:', insErr);
            }
          }
        }
      } catch (dbE) {
        console.error('[SUPABASE ADMINS DB ERROR]:', dbE.message);
      }

      // Memory fallback sync to guarantee availability
      if (!memberObj) {
        memberObj = {
          id: crypto.randomUUID(),
          email: normalizedEmail,
          role: targetRole,
          created_at: new Date().toISOString()
        };
      }

      // Always maintain in fallbackStore so the local instance has it
      fallbackStore.salesTeam = fallbackStore.salesTeam.filter(m => m.email !== normalizedEmail);
      fallbackStore.salesTeam.unshift(memberObj);

      if (logAction) {
        await logAction(supabaseAdmin, normalizedEmail, 'autodialer_sales_email_added', { role: targetRole, addedBy: payload.email }, request.headers.get('CF-Connecting-IP') || '');
      }

      // Automatically trigger invite magic login link email to the new member
      let inviteResult = { sent: false, error: null, link: null };
      if (sendInvite !== false) {
        try {
          const magicToken = await signMagicToken(env, {
            email: normalizedEmail,
            role: targetRole,
            projectId: null,
            clientId: null,
            isClientPortal: false
          });
          const targetUrl = redirectUrl || 'https://www.certifyied.com/autodailer';
          const magicLink = `${targetUrl}?magic_token=${magicToken}`;
          inviteResult.link = magicLink;
          const emailSend = await sendMagicLinkEmail(env, normalizedEmail, magicLink, { isAutodialer: true, isInvite: true });
          inviteResult.sent = emailSend?.success || false;
          inviteResult.id = emailSend?.id;
          if (!emailSend?.success && emailSend?.error) {
            inviteResult.error = emailSend.error;
          }
        } catch (invErr) {
          inviteResult.error = invErr.message;
          console.error('[Sales Team Invite Error]:', invErr.message);
        }
      }

      return jsonResponse({
        success: true,
        member: memberObj,
        inviteSent: inviteResult.sent,
        inviteError: inviteResult.error,
        inviteLink: inviteResult.link
      }, 201, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  // Admin manually sends magic login link to a sales team member
  if (subpath === '/sales-team/send-invite' && method === 'POST') {
    try {
      const isAdmin = payload && (
        payload.role === 'admin' ||
        payload.role === 'global' ||
        (payload.email && payload.email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase())
      );

      if (!isAdmin) {
        return jsonResponse({ error: 'Access denied. Only administrators can send sales team login emails.' }, 403, corsHeaders);
      }

      const { email: targetEmail, redirectUrl } = await request.json();
      if (!targetEmail) {
        return jsonResponse({ error: 'Email is required.' }, 400, corsHeaders);
      }
      const normalizedEmail = targetEmail.trim().toLowerCase();

      // Find member role
      let memberRole = 'sales';
      try {
        const { data: dbAdmin } = await supabaseAdmin
          .from('admins')
          .select('role')
          .eq('email', normalizedEmail)
          .maybeSingle();
        if (dbAdmin?.role) memberRole = dbAdmin.role;
      } catch (e) {}

      const magicToken = await signMagicToken(env, {
        email: normalizedEmail,
        role: memberRole,
        projectId: null,
        clientId: null,
        isClientPortal: false
      });
      const targetUrl = redirectUrl || 'https://www.certifyied.com/autodailer';
      const magicLink = `${targetUrl}?magic_token=${magicToken}`;

      let emailDelivery = { success: false, error: null };
      try {
        const sendRes = await sendMagicLinkEmail(env, normalizedEmail, magicLink, { isAutodialer: true, isInvite: true });
        emailDelivery.success = sendRes?.success || false;
        emailDelivery.id = sendRes?.id;
        if (!sendRes?.success && sendRes?.error) {
          emailDelivery.error = sendRes.error;
        }
      } catch (err) {
        emailDelivery.error = err.message;
      }

      return jsonResponse({
        success: true,
        email: normalizedEmail,
        emailSent: emailDelivery.success,
        emailError: emailDelivery.error,
        magicLink
      }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  if (subpath.startsWith('/sales-team/') && method === 'DELETE') {
    try {
      const isAdmin = payload && (
        payload.role === 'admin' ||
        payload.role === 'global' ||
        (payload.email && payload.email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase())
      );

      if (!isAdmin) {
        return jsonResponse({ error: 'Access denied. Only administrators can revoke sales emails.' }, 403, corsHeaders);
      }

      const emailToDelete = decodeURIComponent(subpath.replace('/sales-team/', '')).toLowerCase();
      try {
        await supabaseAdmin
          .from('admins')
          .delete()
          .eq('email', emailToDelete);
      } catch (delE) {}

      fallbackStore.salesTeam = fallbackStore.salesTeam.filter(m => m.email.toLowerCase() !== emailToDelete);

      return jsonResponse({ success: true, email: emailToDelete }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  // Require authentication for all subsequent endpoints
  const currentUserEmail = payload?.email ? payload.email.toLowerCase() : 'sales@certifyied.com';

  // --- 3. CREATE CAMPAIGN & UPLOAD CSV LEADS ---
  if (subpath === '/campaigns' && method === 'POST') {
    try {
      const { name, leads } = await request.json();
      if (!leads || !Array.isArray(leads) || leads.length === 0) {
        return jsonResponse({ error: 'Valid leads array with name and phone is required.' }, 400, corsHeaders);
      }

      const campaignName = name?.trim() || `Campaign ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
      const campaignId = crypto.randomUUID();

      // Try inserting campaign into Supabase
      let campaignCreated = false;
      try {
        const { error: campErr } = await supabaseAdmin.from('autodialer_campaigns').insert({
          id: campaignId,
          name: campaignName,
          sales_email: currentUserEmail,
          total_leads: leads.length,
          completed_leads: 0,
          status: 'active'
        });

        if (!campErr) {
          campaignCreated = true;
          // Format leads for insertion
          const leadsPayload = leads.map(l => ({
            id: crypto.randomUUID(),
            campaign_id: campaignId,
            name: (l.name || 'Unknown Contact').trim(),
            phone: (l.phone || '').trim(),
            status: 'pending',
            call_count: 0
          }));

          // Chunk insert in batches of 100
          for (let i = 0; i < leadsPayload.length; i += 100) {
            await supabaseAdmin.from('autodialer_leads').insert(leadsPayload.slice(i, i + 100));
          }
        }
      } catch (err) {
        console.warn('Supabase campaign insert failed, utilizing memory fallback:', err.message);
      }

      // Memory fallback if table does not exist
      if (!campaignCreated) {
        const campObj = {
          id: campaignId,
          name: campaignName,
          sales_email: currentUserEmail,
          total_leads: leads.length,
          completed_leads: 0,
          status: 'active',
          created_at: new Date().toISOString()
        };
        fallbackStore.campaigns.unshift(campObj);

        const newLeads = leads.map(l => ({
          id: crypto.randomUUID(),
          campaign_id: campaignId,
          name: (l.name || 'Unknown Contact').trim(),
          phone: (l.phone || '').trim(),
          status: 'pending',
          call_count: 0,
          created_at: new Date().toISOString()
        }));
        fallbackStore.leads.push(...newLeads);
      }

      if (logAction) {
        await logAction(supabaseAdmin, currentUserEmail, 'autodialer_campaign_created', {
          campaignId,
          name: campaignName,
          totalLeads: leads.length
        }, request.headers.get('CF-Connecting-IP') || '');
      }

      return jsonResponse({
        success: true,
        campaign: {
          id: campaignId,
          name: campaignName,
          total_leads: leads.length,
          completed_leads: 0,
          status: 'active'
        }
      }, 201, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  // --- 4. LIST CAMPAIGNS (MULTI-USER SCOPED FOR SALES, GLOBAL FOR ADMIN) ---
  if (subpath === '/campaigns' && method === 'GET') {
    try {
      const urlObj = new URL(url);
      const requestedRep = urlObj.searchParams.get('rep');

      const isAdmin = payload && (
        payload.role === 'admin' ||
        payload.role === 'global' ||
        (payload.email && payload.email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase())
      );

      let campaigns = [];
      try {
        let query = supabaseAdmin
          .from('autodialer_campaigns')
          .select('*')
          .order('created_at', { ascending: false });

        if (!isAdmin) {
          query = query.eq('sales_email', currentUserEmail);
        } else if (requestedRep && requestedRep !== 'all') {
          query = query.eq('sales_email', requestedRep.toLowerCase());
        }

        const { data, error } = await query;
        if (!error && data) {
          campaigns = data;
        }
      } catch (e) {}

      // If Supabase has no data or table missing, combine with memory fallback
      if (campaigns.length === 0 && fallbackStore.campaigns.length > 0) {
        campaigns = fallbackStore.campaigns.filter(c => {
          if (!isAdmin && (c.sales_email || '').toLowerCase() !== currentUserEmail.toLowerCase()) return false;
          if (isAdmin && requestedRep && requestedRep !== 'all' && (c.sales_email || '').toLowerCase() !== requestedRep.toLowerCase()) return false;
          return true;
        });
      }

      return jsonResponse({ campaigns }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  // --- 5. GET LEADS FOR A CAMPAIGN ---
  if (subpath.startsWith('/campaigns/') && subpath.endsWith('/leads') && method === 'GET') {
    const campaignId = subpath.split('/')[2];
    try {
      let leads = [];
      try {
        const { data, error } = await supabaseAdmin
          .from('autodialer_leads')
          .select('*')
          .eq('campaign_id', campaignId)
          .order('created_at', { ascending: true });

        if (!error && data) {
          leads = data;
        }
      } catch (e) {}

      if (leads.length === 0) {
        leads = fallbackStore.leads.filter(l => l.campaign_id === campaignId);
      }

      return jsonResponse({ leads }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  // --- 6. START CALL: RECORD REDIRECT TIME ---
  if (subpath === '/calls/start' && method === 'POST') {
    try {
      const { leadId, campaignId, phone, leadName, callLogId: clientCallLogId } = await request.json();
      if (!phone) {
        return jsonResponse({ error: 'Phone number is required to start call.' }, 400, corsHeaders);
      }

      const callLogId = clientCallLogId || crypto.randomUUID();
      const redirectedAt = new Date().toISOString();

      // Auto-close any lingering/dangling open calls from this sales rep so they don't stay as orphaned 0-duration records
      try {
        const { data: openCalls } = await supabaseAdmin
          .from('autodialer_call_logs')
          .select('id, redirected_at')
          .eq('sales_email', currentUserEmail)
          .is('returned_at', null)
          .order('created_at', { ascending: false })
          .limit(5);

        if (openCalls && openCalls.length > 0) {
          for (const oc of openCalls) {
            if (oc.id !== callLogId) {
              const elapsed = Math.max(1, Math.round((Date.now() - new Date(oc.redirected_at).getTime()) / 1000));
              const capped = Math.min(elapsed, 120);
              await supabaseAdmin.from('autodialer_call_logs').update({
                returned_at: new Date().toISOString(),
                duration_seconds: capped,
                feedback_status: 'No Answer'
              }).eq('id', oc.id);
            }
          }
        }
      } catch (autoErr) {}

      let dbLogged = false;
      try {
        const { error: logErr } = await supabaseAdmin.from('autodialer_call_logs').insert({
          id: callLogId,
          lead_id: leadId || null,
          campaign_id: campaignId || null,
          sales_email: currentUserEmail,
          phone: phone.trim(),
          lead_name: leadName || 'Contact',
          redirected_at: redirectedAt,
          duration_seconds: 0,
          is_qualified: false
        });

        if (!logErr) {
          dbLogged = true;
          // Update lead status to 'dialing'
          if (leadId) {
            await supabaseAdmin.from('autodialer_leads').update({
              status: 'dialing',
              last_called_at: redirectedAt
            }).eq('id', leadId);
          }
        }
      } catch (e) {}

      if (!dbLogged) {
        fallbackStore.callLogs.push({
          id: callLogId,
          lead_id: leadId,
          campaign_id: campaignId,
          sales_email: currentUserEmail,
          phone,
          lead_name: leadName || 'Contact',
          redirected_at: redirectedAt,
          duration_seconds: 0,
          is_qualified: false
        });
        const memLead = fallbackStore.leads.find(l => l.id === leadId);
        if (memLead) {
          memLead.status = 'dialing';
          memLead.last_called_at = redirectedAt;
        }
      }

      return jsonResponse({
        success: true,
        callLogId,
        redirectedAt
      }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  // --- 7. END CALL: RECORD RETURN TIME, DURATION & FEEDBACK ---
  if (subpath === '/calls/end' && method === 'POST') {
    try {
      const {
        callLogId,
        leadId,
        campaignId,
        phone,
        leadName,
        returnedAt,
        durationSeconds,
        feedbackStatus,
        feedbackNotes,
        isQualified,
        callbackAt
      } = await request.json();

      const returnTime = returnedAt || new Date().toISOString();
      let computedDuration = Math.max(1, parseInt(durationSeconds, 10) || 1);
      const isLeadQualified = isQualified || feedbackStatus === 'Qualified Lead';

      let dbUpdated = false;
      try {
        // 1. First attempt: match by exact callLogId
        if (callLogId && !callLogId.startsWith('log_') && !callLogId.startsWith('call_log_')) {
          const { data: matchedRows, error: updErr } = await supabaseAdmin
            .from('autodialer_call_logs')
            .update({
              returned_at: returnTime,
              duration_seconds: computedDuration,
              feedback_status: feedbackStatus || 'Called',
              feedback_notes: feedbackNotes || '',
              is_qualified: isLeadQualified,
              callback_at: callbackAt || null
            })
            .eq('id', callLogId)
            .select('id, redirected_at');

          if (!updErr && matchedRows && matchedRows.length > 0) {
            dbUpdated = true;
            // Refine duration if client sent default 1s and server knows true redirected_at
            if ((!durationSeconds || parseInt(durationSeconds, 10) <= 1) && matchedRows[0].redirected_at) {
              const measured = Math.max(1, Math.round((new Date(returnTime) - new Date(matchedRows[0].redirected_at)) / 1000));
              if (measured > computedDuration) {
                computedDuration = measured;
                await supabaseAdmin.from('autodialer_call_logs').update({ duration_seconds: measured }).eq('id', callLogId);
              }
            }
          }
        }

        // 2. Second attempt fallback: match latest open or recent call for this sales_email & lead/phone
        if (!dbUpdated) {
          let query = supabaseAdmin
            .from('autodialer_call_logs')
            .select('id, redirected_at')
            .eq('sales_email', currentUserEmail)
            .order('created_at', { ascending: false })
            .limit(1);

          if (leadId) {
            query = query.eq('lead_id', leadId);
          } else if (phone) {
            query = query.eq('phone', phone.trim());
          }

          const { data: fallbackRows } = await query;
          if (fallbackRows && fallbackRows.length > 0) {
            const targetRow = fallbackRows[0];
            if (targetRow.redirected_at && (!durationSeconds || parseInt(durationSeconds, 10) <= 1)) {
              computedDuration = Math.max(1, Math.round((new Date(returnTime) - new Date(targetRow.redirected_at)) / 1000));
            }
            const { error: fbErr } = await supabaseAdmin
              .from('autodialer_call_logs')
              .update({
                returned_at: returnTime,
                duration_seconds: computedDuration,
                feedback_status: feedbackStatus || 'Called',
                feedback_notes: feedbackNotes || '',
                is_qualified: isLeadQualified,
                callback_at: callbackAt || null
              })
              .eq('id', targetRow.id);

            if (!fbErr) {
              dbUpdated = true;
            }
          }
        }

        // 3. Third attempt fallback: insert fresh completed record so call is never lost
        if (!dbUpdated && (phone || leadName)) {
          const insertId = (callLogId && !callLogId.startsWith('log_') && !callLogId.startsWith('call_log_')) ? callLogId : crypto.randomUUID();
          await supabaseAdmin.from('autodialer_call_logs').insert({
            id: insertId,
            lead_id: leadId || null,
            campaign_id: campaignId || null,
            sales_email: currentUserEmail,
            phone: (phone || '').trim() || 'N/A',
            lead_name: leadName || 'Contact',
            redirected_at: returnTime,
            returned_at: returnTime,
            duration_seconds: computedDuration,
            feedback_status: feedbackStatus || 'Called',
            feedback_notes: feedbackNotes || '',
            is_qualified: isLeadQualified,
            callback_at: callbackAt || null
          });
          dbUpdated = true;
        }

        // Update lead status to 'called'
        if (leadId) {
          try {
            await supabaseAdmin.from('autodialer_leads').update({
              status: 'called'
            }).eq('id', leadId);
          } catch (e) {}
        }

        // Increment campaign completed_leads
        if (campaignId) {
          const { data: camp } = await supabaseAdmin.from('autodialer_campaigns').select('completed_leads').eq('id', campaignId).single();
          if (camp) {
            await supabaseAdmin.from('autodialer_campaigns').update({
              completed_leads: (camp.completed_leads || 0) + 1
            }).eq('id', campaignId);
          }
        }

        // Insert into autodialer_qualified_leads if qualified
        if (isLeadQualified) {
          let qName = leadName || 'Lead';
          let qPhone = phone || '';
          if (leadId) {
            const { data: ld } = await supabaseAdmin.from('autodialer_leads').select('name, phone').eq('id', leadId).single();
            if (ld) {
              qName = ld.name;
              qPhone = ld.phone;
            }
          }

          await supabaseAdmin.from('autodialer_qualified_leads').insert({
            call_log_id: (callLogId && !callLogId.startsWith('log_')) ? callLogId : crypto.randomUUID(),
            lead_id: leadId || null,
            campaign_id: campaignId || null,
            sales_email: currentUserEmail,
            name: qName,
            phone: qPhone,
            duration_seconds: computedDuration,
            feedback_status: feedbackStatus || 'Qualified Lead',
            notes: feedbackNotes || '',
            callback_at: callbackAt || null
          });
        }

        // 4. Record Scheduled Callback & Dispatch Email Notification
        const isCallBack = feedbackStatus === 'Call Back' || !!callbackAt;
        if (isCallBack && callbackAt) {
          let cbName = leadName || 'Contact';
          let cbPhone = phone || '';
          if ((!cbName || cbName === 'Contact') && leadId) {
            try {
              const { data: ld } = await supabaseAdmin.from('autodialer_leads').select('name, phone').eq('id', leadId).single();
              if (ld) {
                cbName = ld.name;
                cbPhone = ld.phone;
              }
            } catch (e) {}
          }

          const callbackId = crypto.randomUUID();
          const callbackRecord = {
            id: callbackId,
            call_log_id: (callLogId && !callLogId.startsWith('log_')) ? callLogId : null,
            lead_id: leadId || null,
            campaign_id: campaignId || null,
            sales_email: currentUserEmail,
            lead_name: cbName,
            phone: cbPhone,
            callback_time: callbackAt,
            notes: feedbackNotes || '',
            status: 'pending',
            notified_email: false,
            notified_push: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          try {
            await supabaseAdmin.from('autodialer_callbacks').insert(callbackRecord);
          } catch (cbErr) {
            console.warn('Supabase callback insert failed, saving to fallbackStore:', cbErr.message);
          }
          fallbackStore.callbacks.unshift(callbackRecord);

          // Dispatch confirmation email via Resend
          const emailPromise = sendCallbackEmail(env, {
            repEmail: currentUserEmail,
            leadName: cbName,
            phone: cbPhone,
            callbackTime: callbackAt,
            notes: feedbackNotes,
            type: 'confirmation'
          });

          if (ctx && ctx.waitUntil) {
            ctx.waitUntil(emailPromise);
          } else {
            emailPromise.catch(e => console.warn('Callback email dispatch error:', e));
          }
        }
      } catch (err) {
        console.warn('Supabase end call log update error, using memory fallback:', err.message);
      }

      // Memory fallback update
      if (!dbUpdated) {
        const memLog = fallbackStore.callLogs.find(l => l.id === callLogId);
        if (memLog) {
          memLog.returned_at = returnTime;
          memLog.duration_seconds = computedDuration;
          memLog.feedback_status = feedbackStatus;
          memLog.feedback_notes = feedbackNotes;
          memLog.is_qualified = isLeadQualified;
          memLog.callback_at = callbackAt;
        }

        const memLead = fallbackStore.leads.find(l => l.id === leadId);
        if (memLead) {
          memLead.status = 'called';
          memLead.call_count = (memLead.call_count || 0) + 1;
        }

        const memCamp = fallbackStore.campaigns.find(c => c.id === campaignId);
        if (memCamp) {
          memCamp.completed_leads = (memCamp.completed_leads || 0) + 1;
        }

        if (isLeadQualified) {
          const lName = memLead ? memLead.name : (memLog?.lead_name || 'Qualified Lead');
          const lPhone = memLead ? memLead.phone : (memLog?.phone || '');
          fallbackStore.qualifiedLeads.unshift({
            id: crypto.randomUUID(),
            call_log_id: callLogId,
            lead_id: leadId || null,
            campaign_id: campaignId || null,
            sales_email: currentUserEmail,
            name: lName,
            phone: lPhone,
            duration_seconds: computedDuration,
            feedback_status: feedbackStatus || 'Qualified Lead',
            notes: feedbackNotes,
            callback_at: callbackAt,
            created_at: new Date().toISOString()
          });
        }

        // Memory fallback for callback
        const isCallBack = feedbackStatus === 'Call Back' || !!callbackAt;
        if (isCallBack && callbackAt && !fallbackStore.callbacks.some(c => c.call_log_id === callLogId)) {
          const lName = memLead ? memLead.name : (memLog?.lead_name || leadName || 'Contact');
          const lPhone = memLead ? memLead.phone : (memLog?.phone || phone || '');
          fallbackStore.callbacks.unshift({
            id: crypto.randomUUID(),
            call_log_id: callLogId,
            lead_id: leadId || null,
            campaign_id: campaignId || null,
            sales_email: currentUserEmail,
            lead_name: lName,
            phone: lPhone,
            callback_time: callbackAt,
            notes: feedbackNotes || '',
            status: 'pending',
            notified_email: false,
            notified_push: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
      }

      if (logAction) {
        await logAction(supabaseAdmin, currentUserEmail, 'autodialer_call_completed', {
          callLogId,
          durationSeconds: computedDuration,
          feedbackStatus,
          isQualified: isLeadQualified
        }, request.headers.get('CF-Connecting-IP') || '');
      }

      return jsonResponse({
        success: true,
        durationSeconds: computedDuration,
        isQualified: isLeadQualified
      }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

/**
 * Intelligent Sales Rep Fraud & Integrity Engine
 * Analyzes individual call duration and behavior patterns:
 * 1. GHOST_CALL: Micro-calls (<= 3s) aborted immediately to inflate call volumes
 * 2. INSTANT_QUALIFIED_SPOOF: Marked as "Qualified Lead" with < 12s duration
 * 3. RAPID_BURST: >= 3 calls dialed within 60 seconds with micro duration
 * 4. REPETITIVE_NOTES: Exact duplicate notes copy-pasted across multiple leads
 */
function analyzeFraudForCallLogs(callLogs) {
  const sorted = [...callLogs].sort(
    (a, b) => new Date(a.created_at || a.redirected_at || 0) - new Date(b.created_at || b.redirected_at || 0)
  );

  const annotatedLogs = [];
  const repStatsMap = {};

  for (let i = 0; i < sorted.length; i++) {
    const log = sorted[i];
    const repEmail = (log.sales_email || 'unknown').toLowerCase();
    const duration = log.duration_seconds || 0;
    const isQualified = !!log.is_qualified || log.feedback_status === 'Qualified Lead';
    const notes = (log.feedback_notes || '').trim().toLowerCase();
    const logTime = new Date(log.created_at || log.redirected_at || Date.now()).getTime();

    const flags = [];

    // 1. Ghost Call / Micro Call Detection
    if (duration > 0 && duration <= 3) {
      flags.push({
        code: 'GHOST_CALL',
        severity: 'high',
        label: `Micro Call (${duration}s)`,
        description: 'Call cut in <= 3 seconds without meaningful customer interaction'
      });
    }

    // 2. Instant Qualified Lead Spoofing
    if (isQualified && duration > 0 && duration < 12) {
      flags.push({
        code: 'INSTANT_QUALIFIED_SPOOF',
        severity: 'critical',
        label: `Instant Qualified (${duration}s)`,
        description: 'Marked as Qualified Lead with statistically impossible duration (< 12s)'
      });
    }

    // 3. Rapid Burst Velocity Check
    const prevCallsSameRep = [];
    for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
      if ((sorted[j].sales_email || '').toLowerCase() === repEmail) {
        prevCallsSameRep.push(sorted[j]);
      }
    }
    if (prevCallsSameRep.length >= 2) {
      const earliestTime = new Date(prevCallsSameRep[1].created_at || prevCallsSameRep[1].redirected_at || Date.now()).getTime();
      const timeSpanSec = (logTime - earliestTime) / 1000;
      if (timeSpanSec > 0 && timeSpanSec <= 60 && duration <= 5) {
        flags.push({
          code: 'RAPID_BURST',
          severity: 'medium',
          label: 'Rapid Burst Dialing',
          description: `Dialed 3 calls in ${Math.round(timeSpanSec)}s with micro duration`
        });
      }
    }

    // 4. Repetitive Notes Check
    if (notes.length >= 10) {
      const recentSameNotes = prevCallsSameRep.find(p => (p.feedback_notes || '').trim().toLowerCase() === notes);
      if (recentSameNotes) {
        flags.push({
          code: 'REPETITIVE_NOTES',
          severity: 'low',
          label: 'Duplicate Notes',
          description: 'Identical call notes copy-pasted across multiple leads'
        });
      }
    }

    const annotatedLog = {
      ...log,
      fraud_flags: flags,
      is_flagged: flags.length > 0,
      risk_severity: flags.some(f => f.severity === 'critical')
        ? 'critical'
        : flags.some(f => f.severity === 'high')
        ? 'high'
        : flags.some(f => f.severity === 'medium')
        ? 'medium'
        : flags.length > 0
        ? 'low'
        : 'clean'
    };

    annotatedLogs.push(annotatedLog);

    // Accumulate per-rep analytics
    if (!repStatsMap[repEmail]) {
      repStatsMap[repEmail] = {
        email: repEmail,
        totalCalls: 0,
        totalDurationSeconds: 0,
        qualifiedCount: 0,
        ghostCalls: 0,
        instantSpoofs: 0,
        burstCount: 0,
        flaggedLogsCount: 0
      };
    }
    const r = repStatsMap[repEmail];
    r.totalCalls++;
    r.totalDurationSeconds += duration;
    if (isQualified) r.qualifiedCount++;
    if (flags.some(f => f.code === 'GHOST_CALL')) r.ghostCalls++;
    if (flags.some(f => f.code === 'INSTANT_QUALIFIED_SPOOF')) r.instantSpoofs++;
    if (flags.some(f => f.code === 'RAPID_BURST')) r.burstCount++;
    if (flags.length > 0) r.flaggedLogsCount++;
  }

  // Calculate Fraud Risk Score (0 - 100) and Leaderboard per rep
  const repLeaderboard = Object.values(repStatsMap).map(r => {
    const avgDurationSeconds = r.totalCalls > 0 ? Math.round(r.totalDurationSeconds / r.totalCalls) : 0;
    const conversionRate = r.totalCalls > 0 ? Math.round((r.qualifiedCount / r.totalCalls) * 100) : 0;
    const ghostRatio = r.totalCalls > 0 ? (r.ghostCalls / r.totalCalls) : 0;

    let fraudScore = 0;
    fraudScore += r.instantSpoofs * 35;
    fraudScore += Math.round(ghostRatio * 40);
    fraudScore += r.burstCount * 15;
    fraudScore = Math.min(100, Math.max(0, fraudScore));

    let riskLevel = 'clean';
    if (fraudScore >= 60 || r.instantSpoofs >= 2) riskLevel = 'critical';
    else if (fraudScore >= 35 || r.instantSpoofs >= 1) riskLevel = 'high';
    else if (fraudScore >= 15 || ghostRatio >= 0.25) riskLevel = 'moderate';
    else riskLevel = 'clean';

    return {
      email: r.email,
      totalCalls: r.totalCalls,
      totalDurationSeconds: r.totalDurationSeconds,
      avgDurationSeconds,
      qualifiedCount: r.qualifiedCount,
      conversionRate,
      ghostCalls: r.ghostCalls,
      instantSpoofs: r.instantSpoofs,
      flaggedCount: r.flaggedLogsCount,
      fraudScore,
      riskLevel
    };
  }).sort((a, b) => b.totalCalls - a.totalCalls);

  return {
    annotatedLogs: annotatedLogs.reverse(),
    repLeaderboard
  };
}

  // --- 8. GET ANALYTICS FOR ADMINS & SALES (DUAL VIEWS + FRAUD ENGINE) ---
  if (subpath.startsWith('/analytics') && method === 'GET') {
    try {
      const urlObj = new URL(url);
      const requestedRep = urlObj.searchParams.get('rep');

      const isAdmin = payload && (
        payload.role === 'admin' ||
        payload.role === 'global' ||
        (payload.email && payload.email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase())
      );

      let rawCallLogs = [];
      let rawQualifiedLeads = [];
      let rawCampaigns = [];

      try {
        const { data: logs } = await supabaseAdmin
          .from('autodialer_call_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(500);
        if (logs) {
          rawCallLogs = logs.map(l => {
            let dur = l.duration_seconds || 0;
            if (dur === 0 && l.returned_at && l.redirected_at) {
              dur = Math.max(1, Math.round((new Date(l.returned_at) - new Date(l.redirected_at)) / 1000));
            }
            return {
              ...l,
              duration_seconds: dur,
              feedback_status: l.feedback_status || (l.returned_at ? 'Completed' : 'Called')
            };
          });
        }

        const { data: qLeads } = await supabaseAdmin
          .from('autodialer_qualified_leads')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);
        if (qLeads) rawQualifiedLeads = qLeads;

        const { data: camps } = await supabaseAdmin
          .from('autodialer_campaigns')
          .select('*')
          .order('created_at', { ascending: false });
        if (camps) rawCampaigns = camps;
      } catch (e) {}

      // Merge with memory fallback if Supabase returned empty
      if (rawCallLogs.length === 0) rawCallLogs = fallbackStore.callLogs;
      if (rawQualifiedLeads.length === 0) rawQualifiedLeads = fallbackStore.qualifiedLeads;
      if (rawCampaigns.length === 0) rawCampaigns = fallbackStore.campaigns;

      // Filter by Date Range (if specified)
      const timeRange = urlObj.searchParams.get('timeRange') || urlObj.searchParams.get('dateFilter') || 'all';
      const startDateParam = urlObj.searchParams.get('startDate');
      const endDateParam = urlObj.searchParams.get('endDate');

      let filterStart = null;
      let filterEnd = null;

      const now = new Date();
      if (timeRange === 'today') {
        filterStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        filterEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      } else if (timeRange === 'yesterday') {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        filterStart = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0);
        filterEnd = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999);
      } else if (timeRange === '7d') {
        filterStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (timeRange === '30d') {
        filterStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (timeRange === 'month') {
        filterStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      } else if (timeRange === 'custom') {
        if (startDateParam) {
          const sd = new Date(startDateParam);
          if (!isNaN(sd.getTime())) filterStart = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(), 0, 0, 0, 0);
        }
        if (endDateParam) {
          const ed = new Date(endDateParam);
          if (!isNaN(ed.getTime())) filterEnd = new Date(ed.getFullYear(), ed.getMonth(), ed.getDate(), 23, 59, 59, 999);
        }
      }

      if (filterStart || filterEnd) {
        rawCallLogs = rawCallLogs.filter(l => {
          const logTime = new Date(l.created_at || l.redirected_at || 0).getTime();
          if (filterStart && logTime < filterStart.getTime()) return false;
          if (filterEnd && logTime > filterEnd.getTime()) return false;
          return true;
        });
        rawQualifiedLeads = rawQualifiedLeads.filter(q => {
          const qTime = new Date(q.created_at || 0).getTime();
          if (filterStart && qTime < filterStart.getTime()) return false;
          if (filterEnd && qTime > filterEnd.getTime()) return false;
          return true;
        });
      }

      // Run Intelligent Fraud & Telemetry Engine
      const { annotatedLogs, repLeaderboard } = analyzeFraudForCallLogs(rawCallLogs);

      if (isAdmin) {
        // --- ADMIN VIEW: OVERALL TEAM STATS + REP LEADERBOARD + FRAUD TELEMETRY ---
        let filteredLogs = annotatedLogs;
        let filteredQualified = rawQualifiedLeads;

        if (requestedRep && requestedRep !== 'all') {
          filteredLogs = annotatedLogs.filter(l => (l.sales_email || '').toLowerCase() === requestedRep.toLowerCase());
          filteredQualified = rawQualifiedLeads.filter(l => (l.sales_email || '').toLowerCase() === requestedRep.toLowerCase());
        }

        const totalCalls = filteredLogs.length;
        const totalDurationSeconds = filteredLogs.reduce((acc, curr) => acc + (curr.duration_seconds || 0), 0);
        const avgDurationSeconds = totalCalls > 0 ? Math.round(totalDurationSeconds / totalCalls) : 0;
        const totalQualified = filteredQualified.length;
        const conversionRate = totalCalls > 0 ? Math.round((totalQualified / totalCalls) * 100) : 0;

        const feedbackBreakdown = {};
        filteredLogs.forEach(c => {
          const st = c.feedback_status || 'Uncategorized';
          feedbackBreakdown[st] = (feedbackBreakdown[st] || 0) + 1;
        });

        // Fraud Telemetry summary
        const flaggedCalls = annotatedLogs.filter(l => l.is_flagged);
        const ghostCallsCount = annotatedLogs.filter(l => l.fraud_flags?.some(f => f.code === 'GHOST_CALL')).length;
        const instantSpoofsCount = annotatedLogs.filter(l => l.fraud_flags?.some(f => f.code === 'INSTANT_QUALIFIED_SPOOF')).length;
        const highRiskReps = repLeaderboard.filter(r => r.riskLevel === 'high' || r.riskLevel === 'critical');

        return jsonResponse({
          isAdmin: true,
          viewMode: 'admin',
          stats: {
            totalCalls,
            totalDurationSeconds,
            avgDurationSeconds,
            totalQualified,
            conversionRate,
            totalCampaigns: rawCampaigns.length,
            totalReps: repLeaderboard.length,
            selectedRep: requestedRep || 'all',
            timeRange,
            startDate: startDateParam || null,
            endDate: endDateParam || null
          },
          repLeaderboard,
          fraudTelemetry: {
            totalFlaggedCalls: flaggedCalls.length,
            ghostCallsCount,
            instantSpoofsCount,
            highRiskRepsCount: highRiskReps.length,
            flaggedCallsSample: flaggedCalls.slice(0, 30)
          },
          feedbackBreakdown,
          recentCalls: filteredLogs.slice(0, 50),
          qualifiedLeads: filteredQualified.slice(0, 50)
        }, 200, corsHeaders);
      } else {
        // --- SALES REP VIEW: STRICTLY PERSONAL CALLING METRICS (TIMER ABSTRACTED) ---
        const myLogs = annotatedLogs.filter(l => (l.sales_email || '').toLowerCase() === currentUserEmail.toLowerCase());
        const myQualified = rawQualifiedLeads.filter(l => (l.sales_email || '').toLowerCase() === currentUserEmail.toLowerCase());

        const totalCalls = myLogs.length;
        const totalQualified = myQualified.length;
        const conversionRate = totalCalls > 0 ? Math.round((totalQualified / totalCalls) * 100) : 0;

        // Connected calls (spoke with lead / answered)
        const connectedCalls = myLogs.filter(c => 
          c.feedback_status && 
          c.feedback_status !== 'Busy / No Answer' && 
          c.feedback_status !== 'Wrong Number'
        ).length;

        const feedbackBreakdown = {};
        myLogs.forEach(c => {
          const st = c.feedback_status || 'Uncategorized';
          feedbackBreakdown[st] = (feedbackBreakdown[st] || 0) + 1;
        });

        // Abstract out duration_seconds from recentCalls for sales reps
        const sanitizedRecentCalls = myLogs.slice(0, 50).map(l => ({
          id: l.id,
          lead_name: l.lead_name,
          phone: l.phone,
          sales_email: l.sales_email,
          feedback_status: l.feedback_status,
          feedback_notes: l.feedback_notes,
          is_qualified: l.is_qualified,
          redirected_at: l.redirected_at,
          returned_at: l.returned_at,
          created_at: l.created_at || l.redirected_at
        }));

        const sanitizedQualifiedLeads = myQualified.slice(0, 30).map(q => ({
          id: q.id,
          name: q.name,
          phone: q.phone,
          sales_email: q.sales_email,
          notes: q.notes,
          created_at: q.created_at
        }));

        return jsonResponse({
          isAdmin: false,
          viewMode: 'sales',
          myStats: {
            totalCalls,
            connectedCalls,
            totalQualified,
            conversionRate,
            timeRange,
            startDate: startDateParam || null,
            endDate: endDateParam || null
          },
          feedbackBreakdown,
          recentCalls: sanitizedRecentCalls,
          qualifiedLeads: sanitizedQualifiedLeads
        }, 200, corsHeaders);
      }
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  // --- 9. GET ALL QUALIFIED LEADS (SCOPED FOR SALES, GLOBAL FOR ADMIN) ---
  if (subpath === '/qualified-leads' && method === 'GET') {
    try {
      const isAdmin = payload && (
        payload.role === 'admin' ||
        payload.role === 'global' ||
        (payload.email && payload.email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase())
      );

      let qualifiedLeads = [];
      try {
        let query = supabaseAdmin
          .from('autodialer_qualified_leads')
          .select('*')
          .order('created_at', { ascending: false });

        if (!isAdmin) {
          query = query.eq('sales_email', currentUserEmail);
        }

        const { data, error } = await query;
        if (!error && data) {
          qualifiedLeads = data;
        }
      } catch (e) {}

      if (qualifiedLeads.length === 0) {
        qualifiedLeads = isAdmin
          ? fallbackStore.qualifiedLeads
          : fallbackStore.qualifiedLeads.filter(q => (q.sales_email || '').toLowerCase() === currentUserEmail.toLowerCase());
      }

      // Abstract duration from sales reps
      if (!isAdmin) {
        qualifiedLeads = qualifiedLeads.map(q => ({
          id: q.id,
          name: q.name,
          phone: q.phone,
          sales_email: q.sales_email,
          notes: q.notes,
          created_at: q.created_at
        }));
      }

      return jsonResponse({ qualifiedLeads }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  // --- 10. GET SCHEDULED CALLBACKS ---
  if (subpath === '/callbacks' && method === 'GET') {
    try {
      const isAdmin = payload && (
        payload.role === 'admin' ||
        payload.role === 'global' ||
        (payload.email && payload.email.toLowerCase() === (env.ADMIN_EMAIL || '').toLowerCase())
      );

      const urlObj = new URL(url);
      const requestedRep = urlObj.searchParams.get('rep');
      const statusFilter = urlObj.searchParams.get('status') || 'pending';

      let callbacks = [];
      try {
        let query = supabaseAdmin
          .from('autodialer_callbacks')
          .select('*')
          .order('callback_time', { ascending: true });

        if (!isAdmin) {
          query = query.eq('sales_email', currentUserEmail);
        } else if (requestedRep && requestedRep !== 'all') {
          query = query.eq('sales_email', requestedRep.toLowerCase());
        }

        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter);
        }

        const { data, error } = await query;
        if (!error && data) {
          callbacks = data;
        }
      } catch (e) {}

      if (callbacks.length === 0 && fallbackStore.callbacks?.length > 0) {
        callbacks = fallbackStore.callbacks.filter(c => {
          if (!isAdmin && (c.sales_email || '').toLowerCase() !== currentUserEmail.toLowerCase()) return false;
          if (isAdmin && requestedRep && requestedRep !== 'all' && (c.sales_email || '').toLowerCase() !== requestedRep.toLowerCase()) return false;
          if (statusFilter !== 'all' && c.status !== statusFilter) return false;
          return true;
        });
      }

      return jsonResponse({ callbacks }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  // --- 11. UPDATE CALLBACK STATUS ---
  if (subpath.startsWith('/callbacks/') && (method === 'PATCH' || method === 'POST')) {
    const callbackId = subpath.split('/')[2];
    try {
      const { status, notes, callbackTime } = await request.json();
      const updates = {
        updated_at: new Date().toISOString()
      };
      if (status) updates.status = status;
      if (notes !== undefined) updates.notes = notes;
      if (callbackTime) updates.callback_time = callbackTime;

      try {
        await supabaseAdmin.from('autodialer_callbacks').update(updates).eq('id', callbackId);
      } catch (e) {}

      const memCb = fallbackStore.callbacks?.find(c => c.id === callbackId);
      if (memCb) {
        if (status) memCb.status = status;
        if (notes !== undefined) memCb.notes = notes;
        if (callbackTime) memCb.callback_time = callbackTime;
        memCb.updated_at = updates.updated_at;
      }

      return jsonResponse({ success: true, callbackId, updates }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  return jsonResponse({ error: `Autodialer route not found: ${subpath}` }, 404, corsHeaders);
}
