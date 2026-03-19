import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { decrypt } from '../_shared/crypto.ts'

/**
 * Email Routing Edge Function
 * GET    — list email routing rules for a zone
 * POST   — create a new routing rule
 * DELETE — delete a routing rule
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
      // Get email routing status and rules
      const [settingsRes, rulesRes] = await Promise.all([
        cfFetch(`/zones/${zoneId}/email/routing`, cfToken),
        cfFetch(`/zones/${zoneId}/email/routing/rules`, cfToken),
      ])

      return json({
        enabled: settingsRes.result?.enabled ?? false,
        rules: (rulesRes.result || []).map((r: Record<string, unknown>) => ({
          id: r.tag,
          name: r.name,
          enabled: r.enabled,
          matchers: r.matchers,
          actions: r.actions,
        })),
      }, 200, cors)
    }

    if (req.method === 'POST') {
      const body = await req.json()
      const action = body.action || 'create'

      if (action === 'enable') {
        // Enable/disable email routing
        const res = await cfFetch(`/zones/${zoneId}/email/routing`, cfToken, {
          method: 'PUT',
          body: JSON.stringify({ enabled: body.enabled !== false }),
        })
        if (!res.success) return json({ error: 'Failed to update email routing', cf_errors: res.errors }, 502, cors)
        return json({ success: true, enabled: res.result?.enabled }, 200, cors)
      }

      if (action === 'create') {
        // Create a forwarding rule
        if (!body.from || !body.to) {
          return json({ error: 'from and to email addresses are required' }, 400, cors)
        }

        const res = await cfFetch(`/zones/${zoneId}/email/routing/rules`, cfToken, {
          method: 'POST',
          body: JSON.stringify({
            name: body.name || `Forward ${body.from}`,
            enabled: true,
            matchers: [{ type: 'literal', field: 'to', value: body.from }],
            actions: [{ type: 'forward', value: [body.to] }],
          }),
        })

        if (!res.success) return json({ error: 'Failed to create rule', cf_errors: res.errors }, 502, cors)
        return json({ success: true, rule: res.result }, 200, cors)
      }

      if (action === 'delete') {
        if (!body.rule_id) return json({ error: 'rule_id is required' }, 400, cors)
        const res = await cfFetch(`/zones/${zoneId}/email/routing/rules/${body.rule_id}`, cfToken, {
          method: 'DELETE',
        })
        if (!res.success) return json({ error: 'Failed to delete rule', cf_errors: res.errors }, 502, cors)
        return json({ success: true }, 200, cors)
      }

      return json({ error: 'Unknown action' }, 400, cors)
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
