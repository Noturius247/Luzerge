import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

/**
 * CF-Proxy Edge Function
 * Proxies Cloudflare API calls for user domains.
 * Supports: settings, ssl_certs, dns_records, analytics, update_setting, uptime_check
 */

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const url = new URL(req.url)
    const domainId = url.searchParams.get('domain_id')
    const action = url.searchParams.get('action')

    if (!domainId || !action) {
      return json({ error: 'domain_id and action are required' }, 400)
    }

    // Fetch domain (RLS enforces ownership)
    const { data: domain, error: domainError } = await supabase
      .from('user_domains')
      .select('id, domain, cloudflare_zone_id, cloudflare_api_token')
      .eq('id', domainId)
      .single()

    if (domainError || !domain) {
      return json({ error: 'Domain not found' }, 404)
    }

    if (!domain.cloudflare_zone_id || !domain.cloudflare_api_token) {
      return json({ error: 'Domain not connected to Cloudflare', cf_missing: true }, 400)
    }

    const zoneId = domain.cloudflare_zone_id
    const token = domain.cloudflare_api_token

    switch (action) {
      case 'settings':
        return await getZoneSettings(zoneId, token)

      case 'ssl_certs':
        return await getSslCerts(zoneId, token, domain.domain)

      case 'dns_records':
        return await getDnsRecords(zoneId, token)

      case 'analytics': {
        const since = url.searchParams.get('since') || '24h'
        return await getAnalytics(zoneId, token, since)
      }

      case 'update_setting': {
        if (req.method !== 'POST') {
          return json({ error: 'POST required for update_setting' }, 405)
        }
        const body = await req.json()
        return await updateSetting(zoneId, token, body.setting, body.value)
      }

      case 'uptime_check':
        return await uptimeCheck(domain.domain)

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    return json({ error: 'Internal server error', detail: String(err) }, 500)
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function cfFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  })
  return res.json()
}

// ─── Zone Settings ───────────────────────────────────────────────────────────

async function getZoneSettings(zoneId: string, token: string) {
  const data = await cfFetch(`/zones/${zoneId}/settings`, token)
  if (!data.success) {
    return json({ error: 'Failed to fetch settings', cf_errors: data.errors }, 502)
  }

  // Build a map of setting_id → value
  const settings: Record<string, unknown> = {}
  for (const item of data.result || []) {
    settings[item.id] = item.value
  }

  return json({ settings })
}

// ─── Update Setting ──────────────────────────────────────────────────────────

async function updateSetting(zoneId: string, token: string, setting: string, value: unknown) {
  if (!setting) {
    return json({ error: 'setting name is required' }, 400)
  }

  const data = await cfFetch(`/zones/${zoneId}/settings/${setting}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  })

  if (!data.success) {
    return json({ error: 'Failed to update setting', cf_errors: data.errors }, 502)
  }

  return json({ success: true, setting: data.result?.id, value: data.result?.value })
}

// ─── SSL Certificates ────────────────────────────────────────────────────────

async function getSslCerts(zoneId: string, token: string, domain: string) {
  // Try certificate packs first (Universal SSL)
  const packs = await cfFetch(`/zones/${zoneId}/ssl/certificate_packs?status=active`, token)

  const certs: Array<Record<string, unknown>> = []

  if (packs.success && packs.result?.length) {
    for (const pack of packs.result) {
      certs.push({
        id: pack.id,
        type: pack.type || 'universal',
        status: pack.status,
        hosts: pack.hosts || [domain],
        issuer: pack.certificate_authority || 'Cloudflare',
        expires_on: pack.validity_days
          ? new Date(Date.now() + pack.validity_days * 86400000).toISOString()
          : null,
      })
    }
  }

  // Also get SSL verification status
  const verify = await cfFetch(`/zones/${zoneId}/ssl/verification`, token)
  const verificationStatus = verify.success ? verify.result : []

  return json({ certs, verification: verificationStatus })
}

// ─── DNS Records ─────────────────────────────────────────────────────────────

async function getDnsRecords(zoneId: string, token: string) {
  const data = await cfFetch(`/zones/${zoneId}/dns_records?per_page=100`, token)
  if (!data.success) {
    return json({ error: 'Failed to fetch DNS records', cf_errors: data.errors }, 502)
  }

  const records = (data.result || []).map((r: Record<string, unknown>) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    proxied: r.proxied,
    priority: r.priority,
  }))

  return json({ records })
}

// ─── Analytics ───────────────────────────────────────────────────────────────

async function getAnalytics(zoneId: string, token: string, since: string) {
  const now = new Date()
  let sinceDate: Date

  switch (since) {
    case '7d':
      sinceDate = new Date(now.getTime() - 7 * 86400000)
      break
    case '30d':
      sinceDate = new Date(now.getTime() - 30 * 86400000)
      break
    case '24h':
    default:
      sinceDate = new Date(now.getTime() - 86400000)
      break
  }

  const cfUrl = `/zones/${zoneId}/analytics/dashboard?since=${sinceDate.toISOString()}&until=${now.toISOString()}&continuous=false`
  const data = await cfFetch(cfUrl, token)

  if (!data.success) {
    return json({ error: 'Failed to fetch analytics', cf_errors: data.errors }, 502)
  }

  const totals = data.result?.totals
  if (!totals) {
    return json({ analytics: null })
  }

  const bwTotal = totals.bandwidth?.all ?? 0
  const bwCached = totals.bandwidth?.cached ?? 0

  return json({
    analytics: {
      requests_total: totals.requests?.all ?? 0,
      requests_cached: totals.requests?.cached ?? 0,
      requests_uncached: totals.requests?.uncached ?? 0,
      bandwidth_total: bwTotal,
      bandwidth_cached: bwCached,
      cache_hit_rate: bwTotal > 0 ? Math.round((bwCached / bwTotal) * 100) : 0,
      unique_visitors: totals.uniques?.all ?? 0,
      threats_total: totals.threats?.all ?? 0,
      pageviews_total: totals.pageviews?.all ?? 0,
    },
    timeseries: (data.result?.timeseries || []).map((t: Record<string, unknown>) => ({
      since: (t as { since: string }).since,
      requests: ((t as Record<string, Record<string, number>>).requests)?.all ?? 0,
      bandwidth: ((t as Record<string, Record<string, number>>).bandwidth)?.all ?? 0,
      threats: ((t as Record<string, Record<string, number>>).threats)?.all ?? 0,
    })),
  })
}

// ─── Uptime Check ────────────────────────────────────────────────────────────

async function uptimeCheck(domain: string) {
  const results: Array<{ url: string; status: number | null; latency: number | null; ok: boolean }> = []

  for (const proto of ['https', 'http']) {
    const url = `${proto}://${domain}`
    try {
      const start = Date.now()
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      })
      results.push({
        url,
        status: res.status,
        latency: Date.now() - start,
        ok: res.ok,
      })
    } catch {
      results.push({ url, status: null, latency: null, ok: false })
    }
  }

  return json({ checks: results })
}
