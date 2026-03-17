/**
 * Luzerge — PayMongo Checkout Edge Function
 *
 * Handles payment processing via PayMongo (GCash, Maya, Cards, GrabPay).
 *
 * Endpoints:
 *   POST /paymongo-checkout/create   — Create a checkout session (auth required)
 *   POST /paymongo-checkout/webhook  — PayMongo webhook handler (no auth)
 *   GET  /paymongo-checkout/status   — Get subscription status (auth required)
 *   POST /paymongo-checkout/cancel   — Cancel subscription (auth required)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

const PLAN_AMOUNTS: Record<string, number> = {
  solo: 9900,       // ₱99
  starter: 29900,   // ₱299
  pro: 99900,       // ₱999
  business: 199900, // ₱1,999
  enterprise: 349900, // ₱3,499
}

const PLAN_NAMES: Record<string, string> = {
  solo: 'Solo',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
}

const PAYMONGO_API = 'https://api.paymongo.com/v1'

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function getPayMongoHeaders(): Record<string, string> {
  const secretKey = Deno.env.get('PAYMONGO_SECRET_KEY')!
  return {
    'Authorization': 'Basic ' + btoa(secretKey + ':'),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
}

function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

async function authenticateUser(req: Request): Promise<{ user: any; error?: string } | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return { user: null, error: 'Unauthorized' }

  const jwt = authHeader.replace('Bearer ', '')
  const supabase = getSupabase()
  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  if (error || !user) return { user: null, error: 'Unauthorized' }
  return { user }
}

// ── Create Checkout Session ────────────────────────────────────
async function handleCreate(req: Request, cors: Record<string, string>) {
  const auth = await authenticateUser(req)
  if (!auth?.user) return json({ error: auth?.error || 'Unauthorized' }, 401, cors)
  const user = auth.user

  const { plan } = await req.json()

  if (!plan || !PLAN_AMOUNTS[plan]) {
    return json({ error: 'Invalid plan' }, 400, cors)
  }

  const supabase = getSupabase()

  // Get current profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, payment_status')
    .eq('id', user.id)
    .single()

  if (profile?.plan === plan && profile?.payment_status === 'paid') {
    return json({ error: 'You are already on this plan' }, 400, cors)
  }

  // Check for existing active subscription
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id, status, trial_ends_at')
    .eq('user_id', user.id)
    .in('status', ['trial', 'active', 'past_due'])
    .single()

  // Check if user has ever had a paid subscription (for trial eligibility)
  const { count: pastSubCount } = await supabase
    .from('subscriptions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const isFirstTime = (pastSubCount || 0) === 0
  const now = new Date()
  const thirtyDaysLater = new Date(now.getTime() + 30 * 86400000)

  // ── First-time user: start free trial ──────────────────────
  if (isFirstTime) {
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .insert({
        user_id: user.id,
        plan,
        status: 'trial',
        current_period_start: now.toISOString(),
        current_period_end: thirtyDaysLater.toISOString(),
        trial_ends_at: thirtyDaysLater.toISOString(),
      })
      .select()
      .single()

    if (subErr) {
      console.error('Failed to create trial:', subErr)
      return json({ error: 'Failed to start trial' }, 500, cors)
    }

    // Update profile
    await supabase.from('profiles').update({
      plan,
      payment_status: 'trial',
    }).eq('id', user.id)

    return json({
      type: 'trial',
      message: `Your 30-day free trial for the ${PLAN_NAMES[plan]} plan has started!`,
      subscription: { id: sub.id, status: 'trial', trial_ends_at: sub.trial_ends_at },
    }, 200, cors)
  }

  // ── Returning user or plan change: create PayMongo checkout ─
  // If changing plan on existing sub, update the sub plan
  const subscriptionId = existingSub?.id || null

  // Create or update subscription record as pending checkout
  let subId: string
  if (existingSub) {
    await supabase.from('subscriptions').update({
      plan,
      updated_at: now.toISOString(),
    }).eq('id', existingSub.id)
    subId = existingSub.id
  } else {
    const { data: newSub } = await supabase
      .from('subscriptions')
      .insert({
        user_id: user.id,
        plan,
        status: 'past_due',
      })
      .select('id')
      .single()
    subId = newSub!.id
  }

  // Create PayMongo Checkout Session
  const siteUrl = Deno.env.get('SITE_URL') || 'https://luzerge.com'
  const checkoutPayload = {
    data: {
      attributes: {
        line_items: [
          {
            name: `Luzerge ${PLAN_NAMES[plan]} Plan`,
            description: `Monthly subscription - ${PLAN_NAMES[plan]} plan`,
            amount: PLAN_AMOUNTS[plan],
            currency: 'PHP',
            quantity: 1,
          },
        ],
        payment_method_types: ['gcash', 'paymaya', 'card', 'grab_pay'],
        success_url: `${siteUrl}/dashboard.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/dashboard.html?payment=cancelled`,
        description: `Luzerge ${PLAN_NAMES[plan]} Plan - Monthly`,
        send_email_receipt: true,
        metadata: {
          user_id: user.id,
          plan,
          subscription_id: subId,
        },
      },
    },
  }

  const pmRes = await fetch(`${PAYMONGO_API}/checkout_sessions`, {
    method: 'POST',
    headers: getPayMongoHeaders(),
    body: JSON.stringify(checkoutPayload),
  })

  if (!pmRes.ok) {
    const errText = await pmRes.text()
    console.error('PayMongo error:', pmRes.status, errText)
    return json({ error: 'Failed to create checkout session' }, 502, cors)
  }

  const pmData = await pmRes.json()
  const checkoutId = pmData.data.id
  const checkoutUrl = pmData.data.attributes.checkout_url

  // Store checkout ID on subscription
  await supabase.from('subscriptions').update({
    paymongo_checkout_id: checkoutId,
  }).eq('id', subId)

  // Update profile to pending
  await supabase.from('profiles').update({
    plan,
    payment_status: 'pending',
  }).eq('id', user.id)

  return json({
    type: 'checkout',
    checkout_url: checkoutUrl,
    checkout_id: checkoutId,
  }, 200, cors)
}

// ── Webhook Handler ────────────────────────────────────────────
async function handleWebhook(req: Request) {
  // Webhooks come from PayMongo servers — no CORS needed
  const headers = { 'Content-Type': 'application/json' }

  try {
    const body = await req.json()
    const event = body?.data?.attributes

    if (!event) {
      return new Response(JSON.stringify({ error: 'Invalid webhook payload' }), { status: 400, headers })
    }

    const eventType = event.type
    console.log('PayMongo webhook event:', eventType)

    const supabase = getSupabase()

    if (eventType === 'checkout_session.payment.paid') {
      const checkoutData = event.data
      const metadata = checkoutData?.attributes?.metadata
      if (!metadata?.user_id || !metadata?.plan || !metadata?.subscription_id) {
        console.error('Missing metadata in webhook:', metadata)
        return new Response(JSON.stringify({ received: true }), { status: 200, headers })
      }

      const { user_id, plan, subscription_id } = metadata
      const now = new Date()
      const periodEnd = new Date(now.getTime() + 30 * 86400000)

      // Extract payment details
      const payments = checkoutData?.attributes?.payments || []
      const payment = payments[0]
      const paymentId = payment?.id || null
      const paymentMethod = payment?.attributes?.source?.type || 'unknown'
      const amountCents = payment?.attributes?.amount || PLAN_AMOUNTS[plan] || 0

      // Update subscription
      const { error: subErr } = await supabase.from('subscriptions').update({
        status: 'active',
        paymongo_payment_id: paymentId,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        trial_ends_at: null,
      }).eq('id', subscription_id)

      if (subErr) console.error('Subscription update error:', subErr)

      // Update profile
      await supabase.from('profiles').update({
        plan,
        payment_status: 'paid',
      }).eq('id', user_id)

      // Record payment history
      await supabase.from('payment_history').insert({
        user_id,
        subscription_id,
        paymongo_payment_id: paymentId,
        paymongo_checkout_id: checkoutData?.id,
        amount_cents: amountCents,
        currency: 'PHP',
        plan,
        status: 'paid',
        payment_method: paymentMethod,
      })

      console.log(`Payment confirmed: user=${user_id}, plan=${plan}, method=${paymentMethod}`)
    }

    if (eventType === 'payment.failed') {
      const paymentData = event.data
      const metadata = paymentData?.attributes?.metadata
      if (metadata?.user_id) {
        await supabase.from('profiles').update({
          payment_status: 'overdue',
        }).eq('id', metadata.user_id)

        if (metadata.subscription_id) {
          await supabase.from('subscriptions').update({
            status: 'past_due',
          }).eq('id', metadata.subscription_id)
        }

        // Record failed payment
        await supabase.from('payment_history').insert({
          user_id: metadata.user_id,
          subscription_id: metadata.subscription_id || null,
          paymongo_payment_id: paymentData?.id,
          amount_cents: paymentData?.attributes?.amount || 0,
          currency: 'PHP',
          plan: metadata.plan || 'unknown',
          status: 'failed',
          payment_method: paymentData?.attributes?.source?.type || 'unknown',
        })
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200, headers })
  } catch (err) {
    console.error('Webhook error:', err)
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), { status: 500, headers })
  }
}

// ── Get Subscription Status ────────────────────────────────────
async function handleStatus(req: Request, cors: Record<string, string>) {
  const auth = await authenticateUser(req)
  if (!auth?.user) return json({ error: 'Unauthorized' }, 401, cors)

  const supabase = getSupabase()

  // Get active subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', auth.user.id)
    .in('status', ['trial', 'active', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Get payment history
  const { data: payments } = await supabase
    .from('payment_history')
    .select('id, amount_cents, currency, plan, status, payment_method, created_at')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return json({
    subscription: sub || null,
    payments: payments || [],
  }, 200, cors)
}

// ── Cancel Subscription ────────────────────────────────────────
async function handleCancel(req: Request, cors: Record<string, string>) {
  const auth = await authenticateUser(req)
  if (!auth?.user) return json({ error: 'Unauthorized' }, 401, cors)

  const supabase = getSupabase()

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, status, current_period_end')
    .eq('user_id', auth.user.id)
    .in('status', ['trial', 'active'])
    .single()

  if (!sub) {
    return json({ error: 'No active subscription found' }, 404, cors)
  }

  // Mark as cancelled — stays active until period end
  await supabase.from('subscriptions').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
  }).eq('id', sub.id)

  return json({
    message: `Subscription cancelled. Your plan remains active until ${new Date(sub.current_period_end).toLocaleDateString()}.`,
    active_until: sub.current_period_end,
  }, 200, cors)
}

// ── Router ─────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req)
  const url = new URL(req.url)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  try {
    // Webhook — no auth, no CORS
    if (path.endsWith('/webhook') && req.method === 'POST') {
      return await handleWebhook(req)
    }

    if (path.endsWith('/create') && req.method === 'POST') {
      return await handleCreate(req, cors)
    }

    if (path.endsWith('/status') && req.method === 'GET') {
      return await handleStatus(req, cors)
    }

    if (path.endsWith('/cancel') && req.method === 'POST') {
      return await handleCancel(req, cors)
    }

    return json({ error: 'Not Found' }, 404, cors)
  } catch (err) {
    console.error('paymongo-checkout error:', err)
    return json({ error: 'Internal server error' }, 500, cors)
  }
})
