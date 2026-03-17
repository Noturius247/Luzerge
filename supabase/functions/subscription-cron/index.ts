/**
 * Luzerge — Subscription Cron Edge Function
 *
 * Runs daily via pg_cron to handle:
 *   1. Trial expirations → set to past_due
 *   2. Active subscription expirations → set to past_due
 *   3. Past-due grace period (3 days) → downgrade to free
 *   4. Cancelled subscriptions past period end → expire
 *
 * Schedule (pg_cron):
 *   SELECT cron.schedule(
 *     'subscription-cron',
 *     '0 0 * * *',  -- daily at midnight UTC
 *     $$
 *     SELECT net.http_post(
 *       url := 'https://byzuraeyhrxxpztredri.supabase.co/functions/v1/subscription-cron',
 *       headers := jsonb_build_object(
 *         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
 *         'Content-Type', 'application/json'
 *       ),
 *       body := '{}'::jsonb
 *     );
 *     $$
 *   );
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

const GRACE_PERIOD_DAYS = 3

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  // Only accept POST from cron or service role
  const authHeader = req.headers.get('Authorization') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!authHeader.includes(serviceKey) && !authHeader.includes('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const now = new Date()
  const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * 86400000)
  const results = { trials_expired: 0, active_expired: 0, grace_expired: 0, cancelled_expired: 0 }

  try {
    // ── 1. Expire trials past trial_ends_at ────────────────────
    const { data: expiredTrials } = await supabase
      .from('subscriptions')
      .select('id, user_id, plan')
      .eq('status', 'trial')
      .lt('trial_ends_at', now.toISOString())

    for (const sub of expiredTrials || []) {
      await supabase.from('subscriptions').update({
        status: 'past_due',
      }).eq('id', sub.id)

      await supabase.from('profiles').update({
        payment_status: 'overdue',
      }).eq('id', sub.user_id)

      results.trials_expired++
    }

    // ── 2. Expire active subscriptions past current_period_end ─
    const { data: expiredActive } = await supabase
      .from('subscriptions')
      .select('id, user_id, plan')
      .eq('status', 'active')
      .lt('current_period_end', now.toISOString())

    for (const sub of expiredActive || []) {
      await supabase.from('subscriptions').update({
        status: 'past_due',
      }).eq('id', sub.id)

      await supabase.from('profiles').update({
        payment_status: 'overdue',
      }).eq('id', sub.user_id)

      results.active_expired++
    }

    // ── 3. Downgrade past-due subs after grace period ──────────
    const { data: pastDueSubs } = await supabase
      .from('subscriptions')
      .select('id, user_id, current_period_end, trial_ends_at')
      .eq('status', 'past_due')

    for (const sub of pastDueSubs || []) {
      const expiredAt = sub.current_period_end || sub.trial_ends_at
      if (!expiredAt) continue

      const expiredDate = new Date(expiredAt)
      if (expiredDate < graceCutoff) {
        // Grace period exceeded — downgrade to free
        await supabase.from('subscriptions').update({
          status: 'expired',
        }).eq('id', sub.id)

        await supabase.from('profiles').update({
          plan: 'none',
          payment_status: 'unpaid',
        }).eq('id', sub.user_id)

        results.grace_expired++
      }
    }

    // ── 4. Expire cancelled subscriptions past period end ──────
    const { data: cancelledSubs } = await supabase
      .from('subscriptions')
      .select('id, user_id, current_period_end')
      .eq('status', 'cancelled')
      .lt('current_period_end', now.toISOString())

    for (const sub of cancelledSubs || []) {
      await supabase.from('subscriptions').update({
        status: 'expired',
      }).eq('id', sub.id)

      await supabase.from('profiles').update({
        plan: 'none',
        payment_status: 'unpaid',
      }).eq('id', sub.user_id)

      results.cancelled_expired++
    }

    console.log('Subscription cron results:', results)

    return new Response(JSON.stringify({ success: true, ...results }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Subscription cron error:', err)
    return new Response(JSON.stringify({ error: 'Cron failed' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
