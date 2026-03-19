import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

/**
 * Email Marketing Edge Function
 * Manages subscribers and sends plain-text email campaigns.
 *
 * Routes (all require admin auth):
 *   GET    ?action=subscribers          — list subscribers
 *   POST   ?action=add_subscriber       — add one subscriber
 *   POST   ?action=bulk_add             — add multiple subscribers
 *   POST   ?action=remove_subscriber    — soft-delete (unsubscribe)
 *   POST   ?action=send_campaign        — send to all/selected
 *   POST   ?action=send_test            — send test email to admin
 *   GET    ?action=campaigns            — list past campaigns
 *   GET    ?action=unsubscribe&token=   — public unsubscribe (no auth)
 */

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || ''

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Public: unsubscribe link
  if (action === 'unsubscribe') {
    const token = url.searchParams.get('token') || ''
    if (!token) return json({ error: 'Missing token' }, 400, cors)

    // Token is base64(email)
    let email: string
    try { email = atob(token) } catch { return json({ error: 'Invalid token' }, 400, cors) }

    const { error } = await supabase
      .from('subscribers')
      .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
      .eq('email', email.toLowerCase())

    if (error) return json({ error: 'Unsubscribe failed' }, 500, cors)

    return new Response(
      'You have been unsubscribed successfully. You will no longer receive emails from Luzerge.',
      { status: 200, headers: { ...cors, 'Content-Type': 'text/plain' } },
    )
  }

  // All other actions require admin auth
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401, cors)

    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401, cors)

    // Check admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') return json({ error: 'Admin access required' }, 403, cors)

    // ─── Subscribers ───
    if (action === 'subscribers' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('subscribers')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) return json({ error: error.message }, 500, cors)
      return json({ subscribers: data }, 200, cors)
    }

    if (action === 'add_subscriber') {
      const body = await req.json()
      const email = (body.email || '').trim().toLowerCase()
      if (!email || !email.includes('@')) return json({ error: 'Valid email required' }, 400, cors)

      const { data, error } = await supabase
        .from('subscribers')
        .upsert(
          { email, name: body.name || null, status: 'active' },
          { onConflict: 'email' },
        )
        .select()
        .single()

      if (error) return json({ error: error.message }, 500, cors)
      return json({ subscriber: data }, 200, cors)
    }

    if (action === 'bulk_add') {
      const body = await req.json()
      const emails: string[] = (body.emails || [])
        .map((e: string) => e.trim().toLowerCase())
        .filter((e: string) => e && e.includes('@'))

      if (!emails.length) return json({ error: 'No valid emails provided' }, 400, cors)

      const rows = emails.map(email => ({ email, status: 'active' }))
      const { data, error } = await supabase
        .from('subscribers')
        .upsert(rows, { onConflict: 'email' })
        .select()

      if (error) return json({ error: error.message }, 500, cors)
      return json({ added: data?.length || 0 }, 200, cors)
    }

    if (action === 'remove_subscriber') {
      const body = await req.json()
      const email = (body.email || '').trim().toLowerCase()

      const { error } = await supabase
        .from('subscribers')
        .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
        .eq('email', email)

      if (error) return json({ error: error.message }, 500, cors)
      return json({ success: true }, 200, cors)
    }

    // ─── Campaigns ───
    if (action === 'campaigns' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('email_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) return json({ error: error.message }, 500, cors)
      return json({ campaigns: data }, 200, cors)
    }

    if (action === 'send_test') {
      const body = await req.json()
      if (!body.subject || !body.body) return json({ error: 'Subject and body required' }, 400, cors)

      const provider = body.provider || 'resend'
      const unsubLink = `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-marketing?action=unsubscribe&token=${btoa(user.email!)}`
      const fullBody = `${body.body}\n\n---\nYou are receiving this from Luzerge (luzerge.com).\nUnsubscribe: ${unsubLink}`

      const result = await sendEmail(provider, user.email!, body.subject, fullBody)
      if (!result.success) return json({ error: result.error }, 502, cors)
      return json({ success: true, message: `Test sent to ${user.email}` }, 200, cors)
    }

    if (action === 'send_campaign') {
      const body = await req.json()
      if (!body.subject || !body.body) return json({ error: 'Subject and body required' }, 400, cors)

      const provider = body.provider || 'resend'
      let recipients: { email: string }[]

      if (body.emails && body.emails.length) {
        // Selected subscribers only
        recipients = body.emails.map((e: string) => ({ email: e }))
      } else {
        // All active subscribers
        const { data } = await supabase
          .from('subscribers')
          .select('email')
          .eq('status', 'active')

        recipients = data || []
      }

      if (!recipients.length) return json({ error: 'No recipients' }, 400, cors)

      let sent = 0
      let failed = 0
      let usedProvider = provider
      let providerFailed = false

      for (const r of recipients) {
        const unsubLink = `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-marketing?action=unsubscribe&token=${btoa(r.email)}`
        const fullBody = `${body.body}\n\n---\nYou are receiving this from Luzerge (luzerge.com).\nUnsubscribe: ${unsubLink}`

        let result = await sendEmail(usedProvider, r.email, body.subject, fullBody)

        // Fallback to other provider on failure
        if (!result.success && !providerFailed) {
          providerFailed = true
          usedProvider = usedProvider === 'resend' ? 'gmail' : 'resend'
          result = await sendEmail(usedProvider, r.email, body.subject, fullBody)
        }

        if (result.success) sent++
        else failed++
      }

      // Log campaign
      await supabase.from('email_campaigns').insert({
        subject: body.subject,
        body: body.body,
        provider: usedProvider,
        recipient_count: sent,
        failed_count: failed,
        status: failed === 0 ? 'sent' : sent > 0 ? 'partial' : 'failed',
        sent_by: user.id,
      })

      return json({ success: true, sent, failed, provider: usedProvider }, 200, cors)
    }

    return json({ error: 'Unknown action' }, 400, cors)
  } catch (err) {
    return json({ error: 'Internal server error', detail: String(err) }, 500, cors)
  }
})

// ─── Email Senders ──────────────────────────────────────────────────────────

async function sendEmail(provider: string, to: string, subject: string, body: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (provider === 'resend') return await sendViaResend(to, subject, body)
    if (provider === 'gmail') return await sendViaGmail(to, subject, body)
    return { success: false, error: 'Unknown provider' }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

async function sendViaResend(to: string, subject: string, body: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return { success: false, error: 'RESEND_API_KEY not set' }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Luzerge <noreply@luzerge.com>',
      to: [to],
      subject,
      text: body,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return { success: false, error: `Resend: ${err}` }
  }
  return { success: true }
}

async function sendViaGmail(to: string, subject: string, body: string) {
  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!gmailUser || !gmailPass) return { success: false, error: 'Gmail credentials not set' }

  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPass },
    },
  })

  await client.send({
    from: gmailUser,
    to,
    subject,
    content: body,
  })

  await client.close()
  return { success: true }
}

function json(data: unknown, status = 200, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
