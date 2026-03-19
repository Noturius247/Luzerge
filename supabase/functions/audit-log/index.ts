import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * Audit Log Edge Function
 * GET  — fetch audit logs (user sees own, admin sees all)
 * POST — record a new audit log entry (called by other functions or frontend)
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

    if (req.method === 'GET') {
      const page = parseInt(url.searchParams.get('page') || '1')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)
      const offset = (page - 1) * limit
      const domainFilter = url.searchParams.get('domain')
      const actionFilter = url.searchParams.get('action')

      // Check if admin
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      const isAdmin = profile?.role === 'admin'

      let query = supabase
        .from('audit_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      // Non-admin users see only their own logs
      if (!isAdmin) {
        query = query.eq('user_id', user.id)
      }

      if (domainFilter) query = query.eq('domain', domainFilter)
      if (actionFilter) query = query.eq('action', actionFilter)

      const { data: logs, count, error } = await query

      if (error) return json({ error: 'Failed to fetch logs', detail: error.message }, 500, cors)

      return json({
        logs: logs || [],
        total: count || 0,
        page,
        limit,
        pages: Math.ceil((count || 0) / limit),
      }, 200, cors)
    }

    if (req.method === 'POST') {
      const body = await req.json()

      if (!body.action) return json({ error: 'action is required' }, 400, cors)

      const { error } = await supabase.from('audit_log').insert({
        user_id: user.id,
        action: body.action,
        domain: body.domain || null,
        detail: body.detail || null,
        ip_address: req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || null,
      })

      if (error) return json({ error: 'Failed to write log', detail: error.message }, 500, cors)

      return json({ success: true }, 201, cors)
    }

    return json({ error: 'Method not allowed' }, 405, cors)
  } catch (err) {
    return json({ error: 'Internal server error', detail: String(err) }, 500, cors)
  }
})

function json(data: unknown, status = 200, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
