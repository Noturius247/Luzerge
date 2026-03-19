import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { decrypt } from '../_shared/crypto.ts'

/**
 * Always Online Edge Function
 * GET  — reads current Always Online setting from Cloudflare
 * POST — toggles Always Online on/off
 */

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401, cors)

    const jwt = authHeader.replace('Bearer ', '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401, cors)

    const url = new URL(req.url)
    const domainId = url.searchParams.get('domain_id')
    if (!domainId) return json({ error: 'domain_id is required' }, 400, cors)

    const { data: domain, error: domainError } = await supabase
      .from('user_domains')
      .select('id, domain, cloudflare_zone_id, cloudflare_api_token, cloudflare_api_token_enc')
      .eq('id', domainId)
      .single()

    if (domainError || !domain) return json({ error: 'Domain not found' }, 404, cors)

    let cfToken = domain.cloudflare_api_token
    if (domain.cloudflare_api_token_enc) {
      cfToken = await decrypt(domain.cloudflare_api_token_enc)
    }
    if (!domain.cloudflare_zone_id || !cfToken) {
      return json({ error: 'Cloudflare credentials not configured' }, 400, cors)
    }

    const zoneId = domain.cloudflare_zone_id

    if (req.method === 'GET') {
      const res = await cfFetch(`/zones/${zoneId}/settings/always_online`, cfToken)
      return json({
        enabled: res.result?.value === 'on',
        value: res.result?.value ?? 'off',
      }, 200, cors)
    }

    if (req.method === 'POST') {
      const body = await req.json()
      const value = body.enabled ? 'on' : 'off'

      const res = await cfFetch(`/zones/${zoneId}/settings/always_online`, cfToken, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
      })

      if (!res.success) {
        return json({ error: 'Failed to update Always Online', cf_errors: res.errors }, 502, cors)
      }

      return json({ success: true, enabled: res.result?.value === 'on' }, 200, cors)
    }

    return json({ error: 'Method not allowed' }, 405, cors)
  } catch (err) {
    return json({ error: 'Internal server error', detail: String(err) }, 500, cors)
  }
})

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

function json(data: unknown, status = 200, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
