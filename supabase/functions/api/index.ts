/**
 * Luzerge.com — Supabase Edge Function
 * Handles all API endpoints for the website backend
 * Runtime: Deno (deployed at Supabase edge)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, corsHeaders as defaultCorsHeaders } from '../_shared/cors.ts'

// Module-level variable set per-request for use in helper functions
let corsHeaders = defaultCorsHeaders

// ─── Types ───────────────────────────────────────────────────────────────────

interface ContactPayload {
  name: string
  email: string
  phone?: string
  company?: string
  service?: string
  message: string
}

interface AnalyticsPayload {
  event_type: string
  page_path?: string
  referrer?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  session_id?: string
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function sanitize(str: string): string {
  return str.trim().replace(/[<>]/g, '')
}

// ─── Email notification via Resend ─────────────────────────────────────────

async function sendNotificationEmail(lead: ContactPayload): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const notifyEmail = Deno.env.get('NOTIFICATION_EMAIL') ?? 'hello@luzerge.com'

  if (!resendKey) return  // Skip if not configured

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Luzerge Contact Form <noreply@luzerge.com>',
      to: notifyEmail,
      subject: `New Lead: ${lead.name} (${lead.service ?? 'General'})`,
      html: `
        <h2>New Contact Form Submission</h2>
        <table cellpadding="8" style="border-collapse:collapse">
          <tr><td><strong>Name:</strong></td><td>${lead.name}</td></tr>
          <tr><td><strong>Email:</strong></td><td>${lead.email}</td></tr>
          ${lead.phone ? `<tr><td><strong>Phone:</strong></td><td>${lead.phone}</td></tr>` : ''}
          ${lead.company ? `<tr><td><strong>Company:</strong></td><td>${lead.company}</td></tr>` : ''}
          ${lead.service ? `<tr><td><strong>Service:</strong></td><td>${lead.service}</td></tr>` : ''}
          <tr><td><strong>Message:</strong></td><td>${lead.message}</td></tr>
        </table>
        <p style="color:#666;font-size:12px">
          Submitted via luzerge.com contact form
        </p>
      `,
    }),
  })
}

// ─── Route handlers ──────────────────────────────────────────────────────────

async function handleContact(
  req: Request,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  let body: ContactPayload
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Validate required fields
  if (!body.name || !body.email || !body.message) {
    return new Response(
      JSON.stringify({ error: 'name, email, and message are required' }),
      { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!isValidEmail(body.email)) {
    return new Response(
      JSON.stringify({ error: 'Invalid email address' }),
      { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (body.message.length < 10 || body.message.length > 2000) {
    return new Response(
      JSON.stringify({ error: 'Message must be 10–2000 characters' }),
      { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Extract IP and User-Agent from Cloudflare headers
  const ip = req.headers.get('CF-Connecting-IP') ?? req.headers.get('X-Forwarded-For')
  const ua = req.headers.get('User-Agent')

  // Insert lead into database
  const { error } = await supabase.from('leads').insert({
    name: sanitize(body.name),
    email: body.email.toLowerCase().trim(),
    phone: body.phone ? sanitize(body.phone) : null,
    company: body.company ? sanitize(body.company) : null,
    service: body.service ?? null,
    message: sanitize(body.message),
    ip_address: ip,
    user_agent: ua,
    source: 'website',
  })

  if (error) {
    console.error('DB insert error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to save your message. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Send notification email (non-blocking)
  sendNotificationEmail(body).catch(console.error)

  return new Response(
    JSON.stringify({ success: true, message: 'Thank you! We will contact you within 24 hours.' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleAnalytics(
  req: Request,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  let body: AnalyticsPayload
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders })
  }

  if (!body.event_type) {
    return new Response('event_type required', { status: 422, headers: corsHeaders })
  }

  // Get geo data from Cloudflare headers
  const country = req.headers.get('CF-IPCountry') ?? null
  const city = null  // Available via Cloudflare Workers, not edge functions directly

  await supabase.from('analytics_events').insert({
    event_type: body.event_type,
    page_path: body.page_path ?? null,
    referrer: body.referrer ?? null,
    utm_source: body.utm_source ?? null,
    utm_medium: body.utm_medium ?? null,
    utm_campaign: body.utm_campaign ?? null,
    session_id: body.session_id ?? null,
    country,
    city,
  })

  return new Response(null, { status: 204, headers: corsHeaders })
}

function handlePing(): Response {
  return new Response(
    JSON.stringify({ status: 'ok', ts: Date.now(), region: Deno.env.get('SUPABASE_REGION') ?? 'sg' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  corsHeaders = getCorsHeaders(req)
  const url = new URL(req.url)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // Initialize Supabase client with service role for server-side ops
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  // Route requests (pathname may be /functions/v1/api/... on Supabase)
  const path = url.pathname
  if (path.endsWith('/contact')) return handleContact(req, supabase)
  if (path.endsWith('/analytics')) return handleAnalytics(req, supabase)
  if (path.endsWith('/ping')) return handlePing()

  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
