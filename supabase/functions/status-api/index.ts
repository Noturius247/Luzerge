import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Public Status API
 *
 * Unauthenticated endpoint that returns uptime data for domains
 * with public_status_enabled = true.
 *
 * Usage: GET /status-api?token=<public_status_token>
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: CORS })
  }

  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing token parameter' }), { status: 400, headers: CORS })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Find domain by public status token
    const { data: domain, error } = await supabase
      .from('user_domains')
      .select('id, domain, ssl_expires_at, ssl_issuer')
      .eq('public_status_token', token)
      .eq('public_status_enabled', true)
      .eq('status', 'active')
      .single()

    if (error || !domain) {
      return new Response(JSON.stringify({ error: 'Domain not found or status page not enabled' }), {
        status: 404,
        headers: CORS,
      })
    }

    const now = new Date()

    // Current status (last check)
    const { data: lastCheck } = await supabase
      .from('uptime_checks')
      .select('status, http_status, latency_ms, checked_at')
      .eq('domain_id', domain.id)
      .order('checked_at', { ascending: false })
      .limit(1)
      .single()

    // Uptime percentages for different periods
    const periods = [
      { label: '24h', ms: 24 * 60 * 60 * 1000 },
      { label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
      { label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
      { label: '90d', ms: 90 * 24 * 60 * 60 * 1000 },
    ]

    const uptime: Record<string, string> = {}
    for (const p of periods) {
      const since = new Date(now.getTime() - p.ms).toISOString()

      const { count: total } = await supabase
        .from('uptime_checks')
        .select('*', { count: 'exact', head: true })
        .eq('domain_id', domain.id)
        .gte('checked_at', since)

      const { count: up } = await supabase
        .from('uptime_checks')
        .select('*', { count: 'exact', head: true })
        .eq('domain_id', domain.id)
        .eq('status', 'up')
        .gte('checked_at', since)

      uptime[p.label] = total && total > 0
        ? ((up || 0) / total * 100).toFixed(3)
        : 'N/A'
    }

    // Daily uptime for last 90 days (aggregated by day)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const { data: dailyChecks } = await supabase
      .from('uptime_checks')
      .select('status, checked_at')
      .eq('domain_id', domain.id)
      .gte('checked_at', ninetyDaysAgo.toISOString())
      .order('checked_at', { ascending: true })

    // Aggregate by day
    const dailyMap: Record<string, { up: number; total: number }> = {}
    if (dailyChecks) {
      for (const c of dailyChecks) {
        const day = c.checked_at.substring(0, 10) // YYYY-MM-DD
        if (!dailyMap[day]) dailyMap[day] = { up: 0, total: 0 }
        dailyMap[day].total++
        if (c.status === 'up') dailyMap[day].up++
      }
    }

    const daily = Object.entries(dailyMap).map(([date, stats]) => ({
      date,
      uptime_pct: ((stats.up / stats.total) * 100).toFixed(2),
      checks: stats.total,
    }))

    // Recent incidents (last 90 days)
    const { data: incidents } = await supabase
      .from('downtime_incidents')
      .select('started_at, ended_at, duration_seconds, cause')
      .eq('domain_id', domain.id)
      .gte('started_at', ninetyDaysAgo.toISOString())
      .order('started_at', { ascending: false })
      .limit(20)

    return new Response(JSON.stringify({
      domain: domain.domain,
      current_status: lastCheck?.status || 'unknown',
      last_checked: lastCheck?.checked_at || null,
      latency_ms: lastCheck?.latency_ms || null,
      uptime,
      daily,
      incidents: (incidents || []).map(i => ({
        started_at: i.started_at,
        ended_at: i.ended_at,
        duration_seconds: i.duration_seconds,
        cause: i.cause,
      })),
      ssl: {
        expires_at: domain.ssl_expires_at,
        issuer: domain.ssl_issuer,
      },
    }), { headers: CORS })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', detail: String(err) }), {
      status: 500,
      headers: CORS,
    })
  }
})
