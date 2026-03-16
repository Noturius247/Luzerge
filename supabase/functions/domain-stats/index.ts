import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jwt = authHeader.replace('Bearer ', '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const url = new URL(req.url)
    const domainId = url.searchParams.get('domain_id')

    if (!domainId) {
      return new Response(JSON.stringify({ error: 'domain_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch domain (RLS enforces ownership)
    const { data: domain, error: domainError } = await supabase
      .from('user_domains')
      .select('id, domain, cloudflare_zone_id, cloudflare_api_token, last_purged_at')
      .eq('id', domainId)
      .single()

    if (domainError || !domain) {
      return new Response(JSON.stringify({ error: 'Domain not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Purge history (last 10)
    const { data: history } = await supabase
      .from('cache_purge_history')
      .select('id, purge_type, urls_purged, success, created_at')
      .eq('domain_id', domainId)
      .order('created_at', { ascending: false })
      .limit(10)

    // Purge count (last 30 days)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { count: purgeCount } = await supabase
      .from('cache_purge_history')
      .select('id', { count: 'exact', head: true })
      .eq('domain_id', domainId)
      .gte('created_at', since)

    // Optionally fetch Cloudflare zone analytics (last 24h) via GraphQL
    let cfAnalytics = null
    if (domain.cloudflare_zone_id && domain.cloudflare_api_token) {
      try {
        const now = new Date()
        const sinceDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        const query = `query {
          viewer {
            zones(filter: {zoneTag: "${domain.cloudflare_zone_id}"}) {
              httpRequests1dGroups(limit: 1, filter: {date_geq: "${sinceDate.toISOString().split('T')[0]}", date_leq: "${now.toISOString().split('T')[0]}"}) {
                sum { requests cachedRequests bytes cachedBytes threats }
                uniq { uniques }
              }
            }
          }
        }`
        const gqlRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${domain.cloudflare_api_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query }),
        })

        if (gqlRes.ok) {
          const gqlData = await gqlRes.json()
          const groups = gqlData?.data?.viewer?.zones?.[0]?.httpRequests1dGroups
          if (groups?.length) {
            const g = groups[0]
            const total = g.sum?.bytes ?? 0
            const cached = g.sum?.cachedBytes ?? 0
            cfAnalytics = {
              requests_total: g.sum?.requests ?? 0,
              requests_cached: g.sum?.cachedRequests ?? 0,
              bandwidth_total_bytes: total,
              bandwidth_cached_bytes: cached,
              cache_hit_rate: total > 0 ? Math.round((cached / total) * 100) : 0,
              threats_total: g.sum?.threats ?? 0,
            }
          }
        }
      } catch {
        // CF analytics is optional — don't fail the whole request
      }
    }

    return new Response(JSON.stringify({
      domain: domain.domain,
      last_purged_at: domain.last_purged_at,
      purge_count_30d: purgeCount ?? 0,
      recent_history: history ?? [],
      cf_analytics: cfAnalytics,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
