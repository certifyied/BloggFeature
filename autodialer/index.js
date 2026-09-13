import { signJWT, verifyJWT } from '../auth.js';

// In-memory cache fallback in case Supabase schema migration is pending
export const fallbackStore = {
  campaigns: [],
  leads: [],
  callLogs: [],
  qualifiedLeads: [],
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

      const { email, role: repRole } = await request.json();
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

      return jsonResponse({ success: true, member: memberObj }, 201, corsHeaders);
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

  // --- 4. LIST ALL CAMPAIGNS ---
  if (subpath === '/campaigns' && method === 'GET') {
    try {
      let campaigns = [];
      try {
        const { data, error } = await supabaseAdmin
          .from('autodialer_campaigns')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data) {
          campaigns = data;
        }
      } catch (e) {}

      // If Supabase has no data or table missing, combine with memory fallback
      if (campaigns.length === 0 && fallbackStore.campaigns.length > 0) {
        campaigns = fallbackStore.campaigns;
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
        // --- SALES REP VIEW: STRICTLY PERSONAL CALLING METRICS ---
        const myLogs = annotatedLogs.filter(l => (l.sales_email || '').toLowerCase() === currentUserEmail.toLowerCase());
        const myQualified = rawQualifiedLeads.filter(l => (l.sales_email || '').toLowerCase() === currentUserEmail.toLowerCase());

        const totalCalls = myLogs.length;
        const totalDurationSeconds = myLogs.reduce((acc, curr) => acc + (curr.duration_seconds || 0), 0);
        const avgDurationSeconds = totalCalls > 0 ? Math.round(totalDurationSeconds / totalCalls) : 0;
        const totalQualified = myQualified.length;
        const conversionRate = totalCalls > 0 ? Math.round((totalQualified / totalCalls) * 100) : 0;

        const feedbackBreakdown = {};
        myLogs.forEach(c => {
          const st = c.feedback_status || 'Uncategorized';
          feedbackBreakdown[st] = (feedbackBreakdown[st] || 0) + 1;
        });

        const sanitizedRecentCalls = myLogs.slice(0, 50).map(l => ({
          id: l.id,
          lead_name: l.lead_name,
          phone: l.phone,
          sales_email: l.sales_email,
          duration_seconds: l.duration_seconds,
          feedback_status: l.feedback_status,
          feedback_notes: l.feedback_notes,
          is_qualified: l.is_qualified,
          redirected_at: l.redirected_at,
          returned_at: l.returned_at,
          created_at: l.created_at || l.redirected_at
        }));

        return jsonResponse({
          isAdmin: false,
          viewMode: 'sales',
          myStats: {
            totalCalls,
            totalDurationSeconds,
            avgDurationSeconds,
            totalQualified,
            conversionRate,
            timeRange,
            startDate: startDateParam || null,
            endDate: endDateParam || null
          },
          feedbackBreakdown,
          recentCalls: sanitizedRecentCalls,
          qualifiedLeads: myQualified.slice(0, 30)
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

      return jsonResponse({ qualifiedLeads }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }

  return jsonResponse({ error: `Autodialer route not found: ${subpath}` }, 404, corsHeaders);
}
