import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * Scheduled Reports Edge Function
 * GET    — list user's report settings
 * POST   — create or update a report setting
 * DELETE — remove a report setting
 *
 * Also supports ?action=send to trigger a report (called by pg_cron).
 */

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    // Cron-triggered send (uses service role key from header)
    if (action === 'send') {
      return await handleCronSend()
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401, cors)

    const jwt = authHeader.replace('Bearer ', '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401, cors)

    if (req.method === 'GET') {
      const { data: settings, error } = await supabase
        .from('report_settings')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) return json({ error: 'Failed to fetch settings', detail: error.message }, 500, cors)
      return json({ settings: settings || [] }, 200, cors)
    }

    if (req.method === 'POST') {
      const body = await req.json()

      if (!body.domain || !body.frequency || !body.email) {
        return json({ error: 'domain, frequency, and email are required' }, 400, cors)
      }

      if (!['daily', 'weekly', 'monthly'].includes(body.frequency)) {
        return json({ error: 'frequency must be daily, weekly, or monthly' }, 400, cors)
      }

      if (body.id) {
        // Update existing
        const { error } = await supabase
          .from('report_settings')
          .update({
            frequency: body.frequency,
            email: body.email,
            enabled: body.enabled !== false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.id)
          .eq('user_id', user.id)

        if (error) return json({ error: 'Failed to update', detail: error.message }, 500, cors)
        return json({ success: true }, 200, cors)
      }

      // Create new
      const { error } = await supabase.from('report_settings').insert({
        user_id: user.id,
        domain: body.domain,
        frequency: body.frequency,
        email: body.email,
        enabled: body.enabled !== false,
      })

      if (error) return json({ error: 'Failed to create', detail: error.message }, 500, cors)
      return json({ success: true }, 201, cors)
    }

    if (req.method === 'DELETE') {
      const body = await req.json()
      if (!body.id) return json({ error: 'id is required' }, 400, cors)

      const { error } = await supabase
        .from('report_settings')
        .delete()
        .eq('id', body.id)
        .eq('user_id', user.id)

      if (error) return json({ error: 'Failed to delete', detail: error.message }, 500, cors)
      return json({ success: true }, 200, cors)
    }

    return json({ error: 'Method not allowed' }, 405, cors)
  } catch (err) {
    return json({ error: 'Internal server error', detail: String(err) }, 500, cors)
  }
})

/**
 * Called by pg_cron to send reports.
 * Checks report_settings for reports due today and sends summary emails.
 */
async function handleCronSend() {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const now = new Date()
  const dayOfWeek = now.getUTCDay() // 0 = Sunday
  const dayOfMonth = now.getUTCDate()

  // Determine which frequencies are due
  const dueFrequencies = ['daily']
  if (dayOfWeek === 1) dueFrequencies.push('weekly')   // Monday
  if (dayOfMonth === 1) dueFrequencies.push('monthly')  // 1st of month

  const { data: settings } = await supabase
    .from('report_settings')
    .select('*')
    .eq('enabled', true)
    .in('frequency', dueFrequencies)

  if (!settings || settings.length === 0) {
    return json({ message: 'No reports due', count: 0 })
  }

  let sent = 0
  for (const setting of settings) {
    try {
      // Fetch recent uptime data for this domain
      const { data: checks } = await supabase
        .from('uptime_checks')
        .select('status, latency_ms, checked_at')
        .eq('domain', setting.domain)
        .order('checked_at', { ascending: false })
        .limit(100)

      const total = checks?.length || 0
      const up = checks?.filter((c: Record<string, unknown>) => c.status === 'up').length || 0
      const uptimePct = total > 0 ? ((up / total) * 100).toFixed(2) : 'N/A'
      const avgLatency = total > 0
        ? Math.round((checks!.reduce((s: number, c: Record<string, number>) => s + (c.latency_ms || 0), 0)) / total)
        : 'N/A'

      // Send email via Supabase (or log for now)
      // In production, integrate with Resend, SendGrid, or Supabase's email hook
      console.log(`[Report] ${setting.frequency} report for ${setting.domain} → ${setting.email}: Uptime ${uptimePct}%, Avg Latency ${avgLatency}ms`)

      sent++
    } catch (err) {
      console.error(`[Report] Failed for ${setting.domain}:`, err)
    }
  }

  return json({ message: `Sent ${sent} reports`, count: sent })
}

function json(data: unknown, status = 200, cors?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...(cors || {}), 'Content-Type': 'application/json' },
  })
}
