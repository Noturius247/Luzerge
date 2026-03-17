import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Uptime Monitor Edge Function
 *
 * Triggered by pg_cron every minute. For each active domain:
 * 1. Performs HTTP HEAD checks (HTTPS + HTTP)
 * 2. Stores results in uptime_checks
 * 3. Detects downtime incidents (up→down / down→up transitions)
 * 4. Sends email alerts for downtime, recovery, and SSL expiry
 * 5. Checks SSL certificate expiry once per day via crt.sh
 *
 * pg_cron setup:
 *   SELECT cron.schedule(
 *     'uptime-monitor',
 *     '* * * * *',  -- every minute
 *     $$
 *     SELECT net.http_post(
 *       url := 'https://byzuraeyhrxxpztredri.supabase.co/functions/v1/uptime-monitor',
 *       headers := jsonb_build_object(
 *         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
 *         'Content-Type', 'application/json'
 *       ),
 *       body := '{}'::jsonb
 *     );
 *     $$
 *   );
 */

const INTERVAL_MS: Record<string, number> = {
  '1min': 60_000,
  '5min': 300_000,
  '15min': 900_000,
  '30min': 1_800_000,
  '60min': 3_600_000,
}

const SSL_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

// ─── Uptime check ────────────────────────────────────────────────────────────

async function checkUptime(domain: string): Promise<{
  status: 'up' | 'down'
  http_status: number | null
  latency_ms: number | null
  protocol: string
  error: string | null
}> {
  // Try HTTPS first, fall back to HTTP
  for (const proto of ['https', 'http']) {
    const url = `${proto}://${domain}`
    try {
      const start = Date.now()
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      })
      return {
        status: res.ok || res.status < 500 ? 'up' : 'down',
        http_status: res.status,
        latency_ms: Date.now() - start,
        protocol: proto,
        error: null,
      }
    } catch {
      // Continue to HTTP if HTTPS fails
    }
  }
  return {
    status: 'down',
    http_status: null,
    latency_ms: null,
    protocol: 'https',
    error: 'Connection failed on both HTTPS and HTTP',
  }
}

// ─── SSL expiry check via crt.sh ─────────────────────────────────────────────

async function checkSslExpiry(domain: string): Promise<{
  expires_at: string | null
  issuer: string | null
}> {
  try {
    const res = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      { signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) return { expires_at: null, issuer: null }

    const certs = await res.json()
    if (!Array.isArray(certs) || certs.length === 0) {
      return { expires_at: null, issuer: null }
    }

    // Find the most recent certificate that hasn't expired
    const now = new Date()
    const valid = certs
      .filter((c: Record<string, string>) =>
        c.not_after && new Date(c.not_after) > now &&
        c.common_name && (c.common_name === domain || c.common_name === `*.${domain}`)
      )
      .sort((a: Record<string, string>, b: Record<string, string>) =>
        new Date(b.not_after).getTime() - new Date(a.not_after).getTime()
      )

    if (valid.length === 0) return { expires_at: null, issuer: null }

    return {
      expires_at: valid[0].not_after,
      issuer: valid[0].issuer_name || null,
    }
  } catch {
    return { expires_at: null, issuer: null }
  }
}

// ─── Email alerts via Resend ─────────────────────────────────────────────────

async function sendAlert(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Luzerge Alerts <alerts@luzerge.com>',
      to,
      subject,
      html,
    }),
  })
}

function downtimeEmailHtml(domain: string, error: string | null): string {
  return `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#ef4444;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">⚠ Site Down: ${domain}</h2>
      </div>
      <div style="padding:24px;background:#f8fafc;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px">
        <p>Your website <strong>${domain}</strong> is currently <strong style="color:#ef4444">unreachable</strong>.</p>
        ${error ? `<p style="color:#64748b">Error: ${error}</p>` : ''}
        <p>We'll notify you when it comes back online.</p>
        <a href="https://luzerge.com/dashboard.html" style="display:inline-block;padding:10px 20px;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;margin-top:12px">View Dashboard</a>
        <p style="color:#94a3b8;font-size:12px;margin-top:24px">— Luzerge Monitoring</p>
      </div>
    </div>
  `
}

function recoveryEmailHtml(domain: string, downMinutes: number): string {
  return `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#22c55e;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">✓ Site Recovered: ${domain}</h2>
      </div>
      <div style="padding:24px;background:#f8fafc;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px">
        <p>Your website <strong>${domain}</strong> is back <strong style="color:#22c55e">online</strong>.</p>
        <p>Total downtime: <strong>${downMinutes < 1 ? 'less than 1 minute' : `${downMinutes} minute${downMinutes === 1 ? '' : 's'}`}</strong></p>
        <a href="https://luzerge.com/dashboard.html" style="display:inline-block;padding:10px 20px;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;margin-top:12px">View Dashboard</a>
        <p style="color:#94a3b8;font-size:12px;margin-top:24px">— Luzerge Monitoring</p>
      </div>
    </div>
  `
}

function sslExpiryEmailHtml(domain: string, daysLeft: number, expiresAt: string): string {
  const urgency = daysLeft <= 7 ? '#ef4444' : daysLeft <= 14 ? '#f59e0b' : '#3b82f6'
  return `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:${urgency};color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">SSL Certificate Expiring: ${domain}</h2>
      </div>
      <div style="padding:24px;background:#f8fafc;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px">
        <p>The SSL certificate for <strong>${domain}</strong> will expire in <strong style="color:${urgency}">${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.</p>
        <p>Expiry date: <strong>${expiresAt}</strong></p>
        <p>Please renew your certificate to avoid downtime and security warnings for your visitors.</p>
        <a href="https://luzerge.com/dashboard.html" style="display:inline-block;padding:10px 20px;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;margin-top:12px">View Dashboard</a>
        <p style="color:#94a3b8;font-size:12px;margin-top:24px">— Luzerge Monitoring</p>
      </div>
    </div>
  `
}

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Fetch all active domains with uptime monitoring enabled
    const { data: domains, error } = await supabase
      .from('user_domains')
      .select('id, domain, user_id, uptime_check_interval, last_uptime_check_at, ssl_last_checked_at, ssl_expires_at')
      .eq('uptime_check_enabled', true)
      .eq('status', 'active')

    if (error) {
      return new Response(JSON.stringify({ error: 'Failed to fetch domains', detail: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!domains?.length) {
      return new Response(JSON.stringify({ message: 'No domains to monitor', count: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const now = Date.now()
    const results: Array<{ domain: string; status: string; skipped?: boolean; alert?: string }> = []

    for (const d of domains) {
      // ── Check if interval has elapsed ──
      const intervalMs = INTERVAL_MS[d.uptime_check_interval] || 300_000
      if (d.last_uptime_check_at) {
        const lastCheck = new Date(d.last_uptime_check_at).getTime()
        if (now - lastCheck < intervalMs) {
          results.push({ domain: d.domain, status: 'skipped', skipped: true })
          continue
        }
      }

      // ── Perform uptime check ──
      const check = await checkUptime(d.domain)

      // Store result
      await supabase.from('uptime_checks').insert({
        domain_id: d.id,
        user_id: d.user_id,
        status: check.status,
        http_status: check.http_status,
        latency_ms: check.latency_ms,
        protocol: check.protocol,
        error: check.error,
      })

      // Update last check time
      await supabase
        .from('user_domains')
        .update({ last_uptime_check_at: new Date().toISOString() })
        .eq('id', d.id)

      // ── Detect state transitions ──
      const { data: prevChecks } = await supabase
        .from('uptime_checks')
        .select('status')
        .eq('domain_id', d.id)
        .order('checked_at', { ascending: false })
        .limit(2)

      const prevStatus = prevChecks && prevChecks.length >= 2 ? prevChecks[1].status : 'up'
      let alertSent = ''

      if (prevStatus === 'up' && check.status === 'down') {
        // ── Site went DOWN ──
        await supabase.from('downtime_incidents').insert({
          domain_id: d.id,
          user_id: d.user_id,
          cause: check.error,
        })

        // Send downtime alert
        const { data: prefs } = await supabase
          .from('notification_preferences')
          .select('notify_downtime, alert_email')
          .eq('user_id', d.user_id)
          .single()

        if (prefs?.notify_downtime !== false) {
          // Check dedup: don't send if already alerted in last 5 min
          const { data: recentAlerts } = await supabase
            .from('alert_log')
            .select('id')
            .eq('domain_id', d.id)
            .eq('alert_type', 'downtime')
            .gte('sent_at', new Date(now - 300_000).toISOString())
            .limit(1)

          if (!recentAlerts?.length) {
            // Get user email
            const alertEmail = prefs?.alert_email || await getUserEmail(supabase, d.user_id)
            if (alertEmail) {
              await sendAlert(
                alertEmail,
                `⚠ ${d.domain} is DOWN`,
                downtimeEmailHtml(d.domain, check.error),
              )
              await supabase.from('alert_log').insert({
                user_id: d.user_id,
                domain_id: d.id,
                alert_type: 'downtime',
                details: { error: check.error },
              })
              alertSent = 'downtime'
            }
          }
        }
      } else if (prevStatus === 'down' && check.status === 'up') {
        // ── Site came BACK UP ──
        const { data: openIncident } = await supabase
          .from('downtime_incidents')
          .select('id, started_at')
          .eq('domain_id', d.id)
          .is('ended_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .single()

        if (openIncident) {
          const duration = Math.round((now - new Date(openIncident.started_at).getTime()) / 1000)
          await supabase
            .from('downtime_incidents')
            .update({
              ended_at: new Date().toISOString(),
              duration_seconds: duration,
            })
            .eq('id', openIncident.id)

          // Send recovery alert
          const { data: prefs } = await supabase
            .from('notification_preferences')
            .select('notify_recovery, alert_email')
            .eq('user_id', d.user_id)
            .single()

          if (prefs?.notify_recovery !== false) {
            const alertEmail = prefs?.alert_email || await getUserEmail(supabase, d.user_id)
            if (alertEmail) {
              const downMinutes = Math.round(duration / 60)
              await sendAlert(
                alertEmail,
                `✓ ${d.domain} is back UP`,
                recoveryEmailHtml(d.domain, downMinutes),
              )
              await supabase.from('alert_log').insert({
                user_id: d.user_id,
                domain_id: d.id,
                alert_type: 'recovery',
                details: { duration_seconds: duration },
              })
              alertSent = 'recovery'
            }
          }
        }
      }

      // ── SSL expiry check (once per day) ──
      const shouldCheckSsl = !d.ssl_last_checked_at ||
        (now - new Date(d.ssl_last_checked_at).getTime()) > SSL_CHECK_INTERVAL_MS

      if (shouldCheckSsl) {
        const ssl = await checkSslExpiry(d.domain)

        if (ssl.expires_at) {
          await supabase
            .from('user_domains')
            .update({
              ssl_expires_at: ssl.expires_at,
              ssl_issuer: ssl.issuer,
              ssl_last_checked_at: new Date().toISOString(),
            })
            .eq('id', d.id)

          // Check for expiry alerts
          const daysLeft = Math.round(
            (new Date(ssl.expires_at).getTime() - now) / (1000 * 60 * 60 * 24)
          )

          if (daysLeft <= 30) {
            const threshold = daysLeft <= 7 ? '7d' : daysLeft <= 14 ? '14d' : '30d'
            const alertType = `ssl_expiry_${threshold}` as 'ssl_expiry_7d' | 'ssl_expiry_14d' | 'ssl_expiry_30d'

            const { data: prefs } = await supabase
              .from('notification_preferences')
              .select('notify_ssl_expiry, alert_email')
              .eq('user_id', d.user_id)
              .single()

            if (prefs?.notify_ssl_expiry !== false) {
              // Check dedup: one alert per threshold per domain
              const { data: existing } = await supabase
                .from('alert_log')
                .select('id')
                .eq('domain_id', d.id)
                .eq('alert_type', alertType)
                .limit(1)

              if (!existing?.length) {
                const alertEmail = prefs?.alert_email || await getUserEmail(supabase, d.user_id)
                if (alertEmail) {
                  await sendAlert(
                    alertEmail,
                    `SSL expiring in ${daysLeft} days: ${d.domain}`,
                    sslExpiryEmailHtml(d.domain, daysLeft, ssl.expires_at),
                  )
                  await supabase.from('alert_log').insert({
                    user_id: d.user_id,
                    domain_id: d.id,
                    alert_type: alertType,
                    details: { days_left: daysLeft, expires_at: ssl.expires_at },
                  })
                }
              }
            }
          }
        } else {
          // Just update the check timestamp even if crt.sh returned nothing
          await supabase
            .from('user_domains')
            .update({ ssl_last_checked_at: new Date().toISOString() })
            .eq('id', d.id)
        }
      }

      results.push({ domain: d.domain, status: check.status, alert: alertSent || undefined })
    }

    const checked = results.filter(r => !r.skipped).length
    const skipped = results.filter(r => r.skipped).length
    const down = results.filter(r => r.status === 'down').length

    return new Response(JSON.stringify({ checked, skipped, down, results }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
