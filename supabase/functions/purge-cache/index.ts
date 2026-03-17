import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { decrypt } from '../_shared/crypto.ts'

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Auth: require logged-in user
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

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { domain_id, purge_type = 'everything', urls } = await req.json()

    if (!domain_id) {
      return new Response(JSON.stringify({ error: 'domain_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch domain (RLS ensures user owns it)
    const { data: domain, error: domainError } = await supabase
      .from('user_domains')
      .select('id, domain, cloudflare_zone_id, cloudflare_api_token, cloudflare_api_token_enc, status')
      .eq('id', domain_id)
      .single()

    if (domainError || !domain) {
      return new Response(JSON.stringify({ error: 'Domain not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Decrypt credential if stored encrypted (AES-256-GCM)
    if (domain.cloudflare_api_token_enc) {
      try {
        domain.cloudflare_api_token = await decrypt(domain.cloudflare_api_token_enc)
      } catch (err) {
        console.error('Failed to decrypt CF token:', err)
        return new Response(JSON.stringify({ error: 'Failed to decrypt credentials' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    if (!domain.cloudflare_zone_id || !domain.cloudflare_api_token) {
      return new Response(JSON.stringify({ error: 'Cloudflare credentials not configured for this domain' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Call Cloudflare API to purge
    const cfUrl = `https://api.cloudflare.com/client/v4/zones/${domain.cloudflare_zone_id}/purge_cache`
    const cfBody = purge_type === 'everything'
      ? { purge_everything: true }
      : { files: urls }

    const cfRes = await fetch(cfUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${domain.cloudflare_api_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cfBody),
    })

    const cfJson = await cfRes.json()
    const success = cfRes.ok && cfJson.success

    // Log the purge
    await supabase.from('cache_purge_history').insert({
      domain_id: domain.id,
      user_id: user.id,
      purge_type,
      urls_purged: purge_type === 'urls' ? urls : null,
      cf_response: cfJson,
      success,
    })

    // Update last_purged_at if successful
    if (success) {
      await supabase
        .from('user_domains')
        .update({ last_purged_at: new Date().toISOString() })
        .eq('id', domain.id)
    }

    return new Response(JSON.stringify({ success, cf_response: cfJson }), {
      status: success ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
