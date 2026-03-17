import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, corsHeaders } from '../_shared/cors.ts'
import { decrypt, isEncrypted } from '../_shared/crypto.ts'

/**
 * CDN Proxy Edge Function
 * Supports: Cloudflare, AWS CloudFront, Fastly, and no-CDN monitoring.
 * Actions: settings, ssl_certs, dns_records, analytics, update_setting, uptime_check, ssl_check
 */

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const jwt = authHeader.replace('Bearer ', '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const url = new URL(req.url)
    const domainId = url.searchParams.get('domain_id')
    const action = url.searchParams.get('action')

    if (!domainId || !action) return json({ error: 'domain_id and action are required' }, 400)

    const { data: domain, error: domainError } = await supabase
      .from('user_domains')
      .select('id, domain, cloudflare_zone_id, cloudflare_api_token, cloudflare_api_token_enc, cdn_provider, cdn_api_key, cdn_api_key_enc, cdn_distribution_id')
      .eq('id', domainId)
      .single()

    if (domainError || !domain) return json({ error: 'Domain not found' }, 404)

    // Decrypt credentials if stored encrypted (Layer 2: AES-256-GCM)
    if (domain.cloudflare_api_token_enc) {
      try {
        domain.cloudflare_api_token = await decrypt(domain.cloudflare_api_token_enc)
      } catch (err) {
        console.error('Failed to decrypt CF token:', err)
        return json({ error: 'Failed to decrypt credentials' }, 500)
      }
    }
    if (domain.cdn_api_key_enc) {
      try {
        domain.cdn_api_key = await decrypt(domain.cdn_api_key_enc)
      } catch (err) {
        console.error('Failed to decrypt CDN key:', err)
        return json({ error: 'Failed to decrypt credentials' }, 500)
      }
    }

    const provider = domain.cdn_provider || 'cloudflare'

    // Universal actions (work for all providers)
    switch (action) {
      case 'uptime_check':
        return await uptimeCheck(domain.domain)
      case 'dns_lookup':
        return await dnsLookup(domain.domain)
      case 'ssl_check':
        return await sslCheck(domain.domain)
    }

    // Provider-specific actions
    switch (provider) {
      case 'cloudflare':
        return await handleCloudflare(req, domain, action, url)
      case 'cloudfront':
        return await handleCloudFront(req, domain, action)
      case 'fastly':
        return await handleFastly(req, domain, action)
      case 'none':
        return await handleNoCdn(domain, action)
      default:
        return json({ error: `Unknown provider: ${provider}` }, 400)
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

// ═══════════════════════════════════════════════════════════════════════════════
// UNIVERSAL ACTIONS (all providers)
// ═══════════════════════════════════════════════════════════════════════════════

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
      results.push({ url, status: res.status, latency: Date.now() - start, ok: res.ok })
    } catch {
      results.push({ url, status: null, latency: null, ok: false })
    }
  }
  return json({ checks: results })
}

async function dnsLookup(domain: string) {
  const types = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT']
  const results: Record<string, Array<{ data: string; ttl?: number }>> = {}

  await Promise.all(types.map(async (type) => {
    try {
      const res = await fetch(
        `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
        { headers: { Accept: 'application/dns-json' } }
      )
      if (!res.ok) return
      const data = await res.json()
      const answers = (data.Answer || [])
        .filter((a: Record<string, unknown>) => a.data)
        .map((a: Record<string, unknown>) => ({
          data: String(a.data).replace(/\.$/, ''),
          ttl: a.TTL as number,
        }))
      if (answers.length) results[type] = answers
    } catch { /* skip */ }
  }))

  return json({ records: results })
}

async function sslCheck(domain: string) {
  // Check SSL by making HTTPS request and reading headers
  try {
    const res = await fetch(`https://${domain}`, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })

    // We can't access TLS details from fetch, but we know if HTTPS works
    const headers: Record<string, string> = {}
    const interestingHeaders = [
      'strict-transport-security', 'x-frame-options', 'x-content-type-options',
      'content-security-policy', 'server', 'x-powered-by',
    ]
    interestingHeaders.forEach(h => {
      const val = res.headers.get(h)
      if (val) headers[h] = val
    })

    return json({
      ssl_valid: true,
      status: res.status,
      headers,
      hsts: !!res.headers.get('strict-transport-security'),
    })
  } catch (err) {
    return json({
      ssl_valid: false,
      error: String(err),
      hsts: false,
      headers: {},
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLOUDFLARE
// ═══════════════════════════════════════════════════════════════════════════════

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

async function handleCloudflare(req: Request, domain: Record<string, unknown>, action: string, url: URL) {
  const zoneId = domain.cloudflare_zone_id as string
  const token = domain.cloudflare_api_token as string

  if (!zoneId || !token) {
    return json({ error: 'Cloudflare credentials not configured', cf_missing: true }, 400)
  }

  switch (action) {
    case 'settings': {
      const data = await cfFetch(`/zones/${zoneId}/settings`, token)
      if (!data.success) return json({ error: 'Failed to fetch settings', cf_errors: data.errors }, 502)
      const settings: Record<string, unknown> = {}
      for (const item of data.result || []) settings[item.id] = item.value
      return json({ settings, provider: 'cloudflare' })
    }

    case 'ssl_certs': {
      const packs = await cfFetch(`/zones/${zoneId}/ssl/certificate_packs?status=active`, token)
      const certs: Array<Record<string, unknown>> = []
      if (packs.success && packs.result?.length) {
        for (const pack of packs.result) {
          certs.push({
            id: pack.id, type: pack.type || 'universal', status: pack.status,
            hosts: pack.hosts || [domain.domain], issuer: pack.certificate_authority || 'Cloudflare',
            expires_on: pack.validity_days ? new Date(Date.now() + pack.validity_days * 86400000).toISOString() : null,
          })
        }
      }
      const verify = await cfFetch(`/zones/${zoneId}/ssl/verification`, token)
      return json({ certs, verification: verify.success ? verify.result : [], provider: 'cloudflare' })
    }

    case 'dns_records': {
      const data = await cfFetch(`/zones/${zoneId}/dns_records?per_page=100`, token)
      if (!data.success) return json({ error: 'Failed to fetch DNS records', cf_errors: data.errors }, 502)
      const records = (data.result || []).map((r: Record<string, unknown>) => ({
        id: r.id, type: r.type, name: r.name, content: r.content,
        ttl: r.ttl, proxied: r.proxied, priority: r.priority,
      }))
      return json({ records, provider: 'cloudflare' })
    }

    case 'analytics': {
      const since = url.searchParams.get('since') || '24h'
      const now = new Date()
      let sinceDate: Date
      switch (since) {
        case '7d': sinceDate = new Date(now.getTime() - 7 * 86400000); break
        case '30d': sinceDate = new Date(now.getTime() - 30 * 86400000); break
        default: sinceDate = new Date(now.getTime() - 86400000); break
      }
      const query = `query {
        viewer {
          zones(filter: {zoneTag: "${zoneId}"}) {
            httpRequests1dGroups(limit: 1000, filter: {date_geq: "${sinceDate.toISOString().split('T')[0]}", date_leq: "${now.toISOString().split('T')[0]}"}) {
              dimensions { date }
              sum {
                requests
                cachedRequests
                bytes
                cachedBytes
                threats
                responseStatusMap { edgeResponseStatus requests }
                contentTypeMap { edgeResponseContentTypeName requests bytes }
                countryMap { clientCountryName requests threats bytes }
                clientSSLMap { clientSSLProtocol requests }
              }
              uniq { uniques }
            }
          }
        }
      }`
      const gqlRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      })
      const gqlData = await gqlRes.json()
      const groups = gqlData?.data?.viewer?.zones?.[0]?.httpRequests1dGroups
      if (!groups || !groups.length) return json({ analytics: null, provider: 'cloudflare' })

      // Aggregate totals
      const totals = { requests: 0, cachedRequests: 0, bytes: 0, cachedBytes: 0, threats: 0, uniques: 0 }
      const daily: Array<Record<string, unknown>> = []
      const countryMap: Record<string, Record<string, number>> = {}
      const statusMap: Record<number, number> = {}
      const contentMap: Record<string, Record<string, number>> = {}
      const sslMap: Record<string, number> = {}

      for (const g of groups) {
        totals.requests += g.sum?.requests ?? 0
        totals.cachedRequests += g.sum?.cachedRequests ?? 0
        totals.bytes += g.sum?.bytes ?? 0
        totals.cachedBytes += g.sum?.cachedBytes ?? 0
        totals.threats += g.sum?.threats ?? 0
        totals.uniques += g.uniq?.uniques ?? 0

        daily.push({
          date: g.dimensions?.date,
          requests: g.sum?.requests ?? 0,
          cachedRequests: g.sum?.cachedRequests ?? 0,
          bytes: g.sum?.bytes ?? 0,
          cachedBytes: g.sum?.cachedBytes ?? 0,
          threats: g.sum?.threats ?? 0,
          uniques: g.uniq?.uniques ?? 0,
        })

        for (const c of g.sum?.countryMap || []) {
          const k = c.clientCountryName || 'Unknown'
          if (!countryMap[k]) countryMap[k] = { requests: 0, threats: 0, bytes: 0 }
          countryMap[k].requests += c.requests ?? 0
          countryMap[k].threats += c.threats ?? 0
          countryMap[k].bytes += c.bytes ?? 0
        }
        for (const s of g.sum?.responseStatusMap || []) {
          statusMap[s.edgeResponseStatus] = (statusMap[s.edgeResponseStatus] || 0) + (s.requests ?? 0)
        }
        for (const ct of g.sum?.contentTypeMap || []) {
          const k = ct.edgeResponseContentTypeName || 'Other'
          if (!contentMap[k]) contentMap[k] = { requests: 0, bytes: 0 }
          contentMap[k].requests += ct.requests ?? 0
          contentMap[k].bytes += ct.bytes ?? 0
        }
        for (const sl of g.sum?.clientSSLMap || []) {
          const k = sl.clientSSLProtocol || 'None'
          sslMap[k] = (sslMap[k] || 0) + (sl.requests ?? 0)
        }
      }

      // Sort and limit breakdowns
      const sortedCountries = Object.entries(countryMap)
        .map(([name, v]) => ({ country: name, ...v }))
        .sort((a, b) => b.requests - a.requests).slice(0, 20)
      const sortedStatus = Object.entries(statusMap)
        .map(([code, reqs]) => ({ status: Number(code), requests: reqs }))
        .sort((a, b) => b.requests - a.requests)
      const sortedContent = Object.entries(contentMap)
        .map(([name, v]) => ({ type: name, ...v }))
        .sort((a, b) => b.requests - a.requests).slice(0, 15)
      const sortedSsl = Object.entries(sslMap)
        .map(([proto, reqs]) => ({ protocol: proto, requests: reqs }))
        .sort((a, b) => b.requests - a.requests)

      return json({
        analytics: {
          requests_total: totals.requests, requests_cached: totals.cachedRequests,
          bandwidth_total: totals.bytes, bandwidth_cached: totals.cachedBytes,
          cache_hit_rate: totals.bytes > 0 ? Math.round((totals.cachedBytes / totals.bytes) * 100) : 0,
          unique_visitors: totals.uniques, threats_total: totals.threats,
          daily,
          countryMap: sortedCountries,
          responseStatusMap: sortedStatus,
          contentTypeMap: sortedContent,
          clientSSLMap: sortedSsl,
        },
        provider: 'cloudflare',
      })
    }

    case 'update_setting': {
      if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
      const body = await req.json()
      if (!body.setting) return json({ error: 'setting name is required' }, 400)
      const data = await cfFetch(`/zones/${zoneId}/settings/${body.setting}`, token, {
        method: 'PATCH', body: JSON.stringify({ value: body.value }),
      })
      if (!data.success) return json({ error: 'Failed to update setting', cf_errors: data.errors }, 502)
      return json({ success: true, setting: data.result?.id, value: data.result?.value })
    }

    default:
      return json({ error: `Unknown action for Cloudflare: ${action}` }, 400)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AWS CLOUDFRONT
// ═══════════════════════════════════════════════════════════════════════════════

async function handleCloudFront(req: Request, domain: Record<string, unknown>, action: string) {
  const distributionId = domain.cdn_distribution_id as string
  const apiKey = domain.cdn_api_key as string

  if (!distributionId || !apiKey) {
    return json({ error: 'CloudFront credentials not configured', cf_missing: true }, 400)
  }

  // AWS CloudFront requires Signature V4 — we use a simplified approach
  // by calling the CloudFront API via the AWS SDK pattern
  switch (action) {
    case 'analytics': {
      // CloudFront analytics aren't available via simple API — use CloudWatch
      // For now, return basic distribution info
      return json({
        analytics: null,
        provider: 'cloudfront',
        message: 'CloudFront analytics require CloudWatch. Use AWS Console for detailed metrics.',
      })
    }

    case 'settings': {
      return json({
        settings: { distribution_id: distributionId },
        provider: 'cloudfront',
        features: ['cache_purge', 'uptime', 'dns', 'ssl'],
      })
    }

    case 'ssl_certs': {
      // Check SSL via HTTPS
      const sslData = await sslCheck(domain.domain as string)
      const body = await sslData.json()
      return json({ ...body, provider: 'cloudfront' })
    }

    case 'dns_records': {
      const dnsData = await dnsLookup(domain.domain as string)
      const body = await dnsData.json()
      return json({ ...body, provider: 'cloudfront' })
    }

    case 'purge_cache': {
      if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
      // CloudFront invalidation requires AWS Sig V4 — complex to implement without SDK
      return json({
        error: 'CloudFront cache invalidation requires AWS SDK. Use AWS Console or CLI.',
        provider: 'cloudfront',
      }, 501)
    }

    default:
      return json({ error: `Action '${action}' not supported for CloudFront`, provider: 'cloudfront' }, 400)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASTLY
// ═══════════════════════════════════════════════════════════════════════════════

async function fastlyFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`https://api.fastly.com${path}`, {
    ...options,
    headers: {
      'Fastly-Key': token,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  })
  return res.json()
}

async function handleFastly(req: Request, domain: Record<string, unknown>, action: string) {
  const serviceId = domain.cdn_distribution_id as string
  const token = domain.cdn_api_key as string

  if (!serviceId || !token) {
    return json({ error: 'Fastly credentials not configured', cf_missing: true }, 400)
  }

  switch (action) {
    case 'analytics': {
      // Fastly real-time stats
      try {
        const data = await fastlyFetch(`/service/${serviceId}/stats/summary?from=1+day+ago`, token)
        if (data.data) {
          const d = data.data
          return json({
            analytics: {
              requests_total: d.requests ?? 0,
              bandwidth_total: d.bandwidth ?? 0,
              bandwidth_cached: d.body_size ?? 0,
              cache_hit_rate: d.hit_ratio ? Math.round(d.hit_ratio * 100) : 0,
              unique_visitors: null,
              threats_total: d.waf_blocked ?? 0,
            },
            provider: 'fastly',
          })
        }
        return json({ analytics: null, provider: 'fastly' })
      } catch {
        return json({ analytics: null, provider: 'fastly' })
      }
    }

    case 'settings': {
      try {
        const data = await fastlyFetch(`/service/${serviceId}/details`, token)
        return json({
          settings: {
            name: data.name,
            active_version: data.active_version,
          },
          provider: 'fastly',
          features: ['analytics', 'cache_purge', 'uptime', 'dns', 'ssl'],
        })
      } catch {
        return json({ settings: {}, provider: 'fastly' })
      }
    }

    case 'ssl_certs': {
      const sslData = await sslCheck(domain.domain as string)
      const body = await sslData.json()
      return json({ ...body, provider: 'fastly' })
    }

    case 'dns_records': {
      const dnsData = await dnsLookup(domain.domain as string)
      const body = await dnsData.json()
      return json({ ...body, provider: 'fastly' })
    }

    case 'purge_cache': {
      if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
      try {
        const data = await fastlyFetch(`/service/${serviceId}/purge_all`, token, { method: 'POST' })
        return json({ success: !!data.status, provider: 'fastly' })
      } catch (err) {
        return json({ error: 'Purge failed: ' + String(err), provider: 'fastly' }, 502)
      }
    }

    case 'update_setting':
      return json({ error: 'Settings update not supported for Fastly via this API', provider: 'fastly' }, 501)

    default:
      return json({ error: `Action '${action}' not supported for Fastly`, provider: 'fastly' }, 400)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NO CDN (monitoring only)
// ═══════════════════════════════════════════════════════════════════════════════

async function handleNoCdn(domain: Record<string, unknown>, action: string) {
  const domainName = domain.domain as string

  switch (action) {
    case 'ssl_certs': {
      const sslData = await sslCheck(domainName)
      const body = await sslData.json()
      return json({ ...body, provider: 'none' })
    }

    case 'dns_records': {
      const dnsData = await dnsLookup(domainName)
      const body = await dnsData.json()
      return json({ ...body, provider: 'none' })
    }

    case 'analytics':
      return json({ analytics: null, provider: 'none', message: 'Analytics not available without a CDN provider.' })

    case 'settings':
      return json({ settings: {}, provider: 'none', features: ['uptime', 'dns', 'ssl'] })

    default:
      return json({ error: `Action '${action}' not available for monitoring-only domains`, provider: 'none' }, 400)
  }
}
