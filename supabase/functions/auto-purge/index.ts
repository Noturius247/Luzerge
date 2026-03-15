import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Auto-Purge Edge Function
 *
 * Triggered by pg_cron (or Supabase Cron) on a schedule (e.g. every hour).
 * Queries all domains with auto_purge_enabled = true, checks if enough time
 * has passed since last_purged_at based on their auto_purge_interval,
 * then calls Cloudflare's purge_cache API for each eligible domain.
 *
 * This runs server-side — works 24/7 even when the user's PC is off.
 *
 * To set up pg_cron in Supabase SQL Editor:
 *   SELECT cron.schedule(
 *     'auto-purge-domains',
 *     '0 * * * *',  -- every hour
 *     $$
 *     SELECT net.http_post(
 *       url := 'https://byzuraeyhrxxpztredri.supabase.co/functions/v1/auto-purge',
 *       headers := jsonb_build_object(
 *         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
 *         'Content-Type', 'application/json'
 *       ),
 *       body := '{}'::jsonb
 *     );
 *     $$
 *   );
 */

const INTERVAL_HOURS: Record<string, number> = {
  hourly: 1,
  every6h: 6,
  every12h: 12,
  daily: 24,
  weekly: 168,
}

serve(async (req: Request) => {
  try {
    // Use service role to bypass RLS — this is a server-to-server call
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Fetch all domains with auto-purge enabled and CF credentials configured
    const { data: domains, error } = await supabase
      .from('user_domains')
      .select('id, domain, user_id, cloudflare_zone_id, cloudflare_api_token, auto_purge_interval, last_purged_at')
      .eq('auto_purge_enabled', true)
      .eq('status', 'active')
      .not('cloudflare_zone_id', 'is', null)
      .not('cloudflare_api_token', 'is', null)

    if (error) {
      return new Response(JSON.stringify({ error: 'Failed to fetch domains', detail: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!domains?.length) {
      return new Response(JSON.stringify({ message: 'No domains to auto-purge', count: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const now = Date.now()
    const results: Array<{ domain: string; success: boolean; skipped?: boolean }> = []

    for (const d of domains) {
      const intervalHours = INTERVAL_HOURS[d.auto_purge_interval] || 24
      const intervalMs = intervalHours * 60 * 60 * 1000

      // Check if enough time has passed since last purge
      if (d.last_purged_at) {
        const lastPurged = new Date(d.last_purged_at).getTime()
        if (now - lastPurged < intervalMs) {
          results.push({ domain: d.domain, success: true, skipped: true })
          continue
        }
      }

      // Call Cloudflare purge API
      try {
        const cfRes = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${d.cloudflare_zone_id}/purge_cache`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${d.cloudflare_api_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ purge_everything: true }),
          }
        )
        const cfJson = await cfRes.json()
        const success = cfRes.ok && cfJson.success

        // Log purge
        await supabase.from('cache_purge_history').insert({
          domain_id: d.id,
          user_id: d.user_id,
          purge_type: 'auto',
          cf_response: cfJson,
          success,
        })

        // Update last_purged_at
        if (success) {
          await supabase
            .from('user_domains')
            .update({ last_purged_at: new Date().toISOString() })
            .eq('id', d.id)
        }

        results.push({ domain: d.domain, success })
      } catch (cfErr) {
        results.push({ domain: d.domain, success: false })

        await supabase.from('cache_purge_history').insert({
          domain_id: d.id,
          user_id: d.user_id,
          purge_type: 'auto',
          cf_response: { error: String(cfErr) },
          success: false,
        })
      }
    }

    const purged = results.filter(r => r.success && !r.skipped).length
    const skipped = results.filter(r => r.skipped).length
    const failed = results.filter(r => !r.success).length

    return new Response(JSON.stringify({ purged, skipped, failed, results }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
