import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Weekly Report Edge Function
 *
 * Triggered by pg_cron every Monday at 9:00 AM UTC.
 * Sends each user a weekly summary of their domains' performance.
 *
 * pg_cron setup:
 *   SELECT cron.schedule(
 *     'weekly-email-report',
 *     '0 9 * * 1',  -- Every Monday 9 AM UTC
 *     $$
 *     SELECT net.http_post(
 *       url := 'https://byzuraeyhrxxpztredri.supabase.co/functions/v1/weekly-report',
 *       headers := jsonb_build_object(
 *         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
 *         'Content-Type', 'application/json'
 *       ),
 *       body := '{}'::jsonb
 *     );
 *     $$
 *   );
 */

serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Get all users who want weekly reports
    const { data: prefs, error: prefsErr } = await supabase
      .from('notification_preferences')
      .select('user_id, alert_email')
      .eq('notify_weekly_report', true)

    if (prefsErr || !prefs?.length) {
      return new Response(JSON.stringify({ message: 'No users opted in', count: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    let sent = 0

    for (const pref of prefs) {
      try {
        // Get user's active domains
        const { data: domains } = await supabase
          .from('user_domains')
          .select('id, domain, ssl_expires_at')
          .eq('user_id', pref.user_id)
          .eq('status', 'active')

        if (!domains?.length) continue

        // Get user email
        const email = pref.alert_email || await getUserEmail(supabase, pref.user_id)
        if (!email) continue

        // Build per-domain stats
        const domainRows: string[] = []

        for (const dom of domains) {
          // Uptime stats
          const { count: totalChecks } = await supabase
            .from('uptime_checks')
            .select('*', { count: 'exact', head: true })
            .eq('domain_id', dom.id)
            .gte('checked_at', weekAgo.toISOString())

          const { count: upChecks } = await supabase
            .from('uptime_checks')
            .select('*', { count: 'exact', head: true })
            .eq('domain_id', dom.id)
            .eq('status', 'up')
            .gte('checked_at', weekAgo.toISOString())

          const uptimePct = totalChecks && totalChecks > 0
            ? ((upChecks || 0) / totalChecks * 100).toFixed(2)
            : 'N/A'

          // Average latency
          const { data: latencyData } = await supabase
            .from('uptime_checks')
            .select('latency_ms')
            .eq('domain_id', dom.id)
            .eq('status', 'up')
            .gte('checked_at', weekAgo.toISOString())
            .not('latency_ms', 'is', null)

          const avgLatency = latencyData?.length
            ? Math.round(latencyData.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / latencyData.length)
            : null

          // Downtime incidents
          const { count: incidents } = await supabase
            .from('downtime_incidents')
            .select('*', { count: 'exact', head: true })
            .eq('domain_id', dom.id)
            .gte('started_at', weekAgo.toISOString())

          // Purge count
          const { count: purges } = await supabase
            .from('cache_purge_history')
            .select('*', { count: 'exact', head: true })
            .eq('domain_id', dom.id)
            .gte('created_at', weekAgo.toISOString())

          // SSL days remaining
          let sslDays = '—'
          if (dom.ssl_expires_at) {
            const days = Math.round((new Date(dom.ssl_expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            const color = days <= 7 ? '#ef4444' : days <= 14 ? '#f59e0b' : days <= 30 ? '#3b82f6' : '#22c55e'
            sslDays = `<span style="color:${color};font-weight:600">${days}d</span>`
          }

          const uptimeColor = uptimePct === 'N/A' ? '#94a3b8'
            : parseFloat(uptimePct) >= 99.9 ? '#22c55e'
            : parseFloat(uptimePct) >= 99 ? '#f59e0b'
            : '#ef4444'

          domainRows.push(`
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0"><strong>${dom.domain}</strong></td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center">
                <span style="color:${uptimeColor};font-weight:600">${uptimePct}%</span>
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${avgLatency ? `${avgLatency}ms` : '—'}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${incidents || 0}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${purges || 0}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${sslDays}</td>
            </tr>
          `)
        }

        // Send email
        const weekStart = weekAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const weekEnd = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

        const html = `
          <div style="font-family:Inter,sans-serif;max-width:700px;margin:0 auto">
            <div style="background:linear-gradient(135deg,#3b82f6,#06b6d4);color:#fff;padding:24px;border-radius:8px 8px 0 0">
              <h2 style="margin:0">⚡ Luzerge Weekly Report</h2>
              <p style="margin:8px 0 0;opacity:0.9">${weekStart} — ${weekEnd}</p>
            </div>
            <div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px">
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <thead>
                  <tr style="background:#f8fafc">
                    <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Domain</th>
                    <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Uptime</th>
                    <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Avg Latency</th>
                    <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Incidents</th>
                    <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Purges</th>
                    <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">SSL</th>
                  </tr>
                </thead>
                <tbody>
                  ${domainRows.join('')}
                </tbody>
              </table>
              <div style="margin-top:24px;text-align:center">
                <a href="https://luzerge.com/dashboard.html" style="display:inline-block;padding:12px 24px;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">View Full Dashboard →</a>
              </div>
              <p style="color:#94a3b8;font-size:12px;margin-top:24px;text-align:center">
                You're receiving this because you enabled weekly reports in your Luzerge dashboard.
              </p>
            </div>
          </div>
        `

        const resendKey = Deno.env.get('RESEND_API_KEY')
        if (resendKey) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Luzerge Reports <reports@luzerge.com>',
              to: email,
              subject: `Weekly Report: ${domains.map(d => d.domain).join(', ')} — ${weekEnd}`,
              html,
            }),
          })

          // Log it
          for (const dom of domains) {
            await supabase.from('alert_log').insert({
              user_id: pref.user_id,
              domain_id: dom.id,
              alert_type: 'weekly_report',
              details: { week_start: weekAgo.toISOString(), week_end: now.toISOString() },
            })
          }

          sent++
        }
      } catch (err) {
        console.error(`Failed to send report for user ${pref.user_id}:`, err)
      }
    }

    return new Response(JSON.stringify({ sent, total_users: prefs.length }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

async function getUserEmail(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .single()
  return data?.email || null
}
