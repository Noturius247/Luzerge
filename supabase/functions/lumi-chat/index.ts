/**
 * Lumi — Luzerge AI Assistant
 * Proxies chat requests to Google Gemini API
 * Fetches user-specific data when authenticated
 * Keeps the API key server-side
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

const BASE_SYSTEM_PROMPT = `You are Lumi, the friendly AI assistant for Luzerge — a website monitoring and performance platform based in Cebu City, Philippines.

About Luzerge:
- Monitors website uptime, boosts load speed with global edge caching (300+ Cloudflare locations), and shields from DDoS attacks
- Free plan: 1 domain, self-managed (you provide your own Cloudflare credentials)
- Solo plan: ₱99/mo, 1 domain, fully managed
- Starter plan: ₱299/mo, up to 3 domains
- Pro plan: ₱999/mo, up to 10 domains
- Business plan: ₱1,999/mo, up to 50 domains
- Enterprise plan: ₱3,499/mo, unlimited domains
- First month is FREE on all paid plans
- Payment methods: GCash, Maya, bank transfer (BDO/BPI/UnionBank), PayPal
- Monthly billing, cancel anytime, no setup fees
- Setup takes about 24 hours after domain submission

Features:
- Uptime monitoring with instant downtime/recovery alerts via email
- CDN management with one-click cache purge
- SSL certificate monitoring with expiry warnings
- Real-time analytics dashboard
- Free website scanner (checks Cloudflare, DNS, hosting, nameservers)
- DDoS protection (L3/L4/L7)
- Web Application Firewall (WAF)
- Bot & threat detection

How it works:
1. Sign in with Google
2. Submit your domain
3. Luzerge team configures Cloudflare (for managed plans)
4. Use the dashboard to monitor and manage

Contact: hello@luzerge.com

Rules:
- Be concise and helpful. Keep responses short (2-3 sentences max unless explaining something complex).
- Only answer questions related to Luzerge, websites, DNS, CDN, hosting, security, and web performance.
- For unrelated questions, politely redirect: "I'm here to help with Luzerge and web performance topics!"
- Never make up features or pricing that isn't listed above.
- If unsure, suggest contacting hello@luzerge.com.
- Use a friendly, professional tone. No emojis unless the user uses them first.
- When the user asks about their own data (domains, plan, uptime, etc.), refer to the USER CONTEXT section below if available.
- Never expose sensitive fields like API tokens, zone IDs, or encryption keys.
- If user context is not available, let them know they can sign in to get personalized info.`

const MAX_HISTORY = 10 // max conversation turns to send

// Rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  entry.count++
  return entry.count > 15 // 15 messages per minute per IP
}

// ─── Fetch user-specific context ─────────────────────────────────
async function getUserContext(accessToken: string): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Create a client authenticated as the user to respect RLS
    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })

    // Verify the user
    const { data: { user }, error: authError } = await userClient.auth.getUser(accessToken)
    if (authError || !user) return null

    // Use service role client for querying (RLS via user's JWT)
    const db = createClient(supabaseUrl, supabaseServiceKey)

    // Fetch profile
    const { data: profile } = await db
      .from('profiles')
      .select('full_name, email, role, plan, payment_status, status, created_at')
      .eq('id', user.id)
      .single()

    if (!profile) return null

    const isAdmin = profile.role === 'admin'
    const lines: string[] = []

    lines.push(`\n--- USER CONTEXT (authenticated user) ---`)
    lines.push(`Name: ${profile.full_name || 'Not set'}`)
    lines.push(`Email: ${profile.email}`)
    lines.push(`Plan: ${profile.plan || 'none'}`)
    lines.push(`Payment status: ${profile.payment_status || 'unpaid'}`)
    lines.push(`Account status: ${profile.status || 'active'}`)
    lines.push(`Member since: ${new Date(profile.created_at).toLocaleDateString()}`)

    // Fetch user's domains
    const { data: domains } = await db
      .from('user_domains')
      .select('domain, status, cdn_provider, auto_purge_enabled, auto_purge_interval, last_purged_at, uptime_check_enabled, uptime_check_interval, ssl_expires_at, ssl_issuer, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (domains && domains.length > 0) {
      lines.push(`\nDomains (${domains.length}):`)
      for (const d of domains) {
        lines.push(`- ${d.domain} | Status: ${d.status} | CDN: ${d.cdn_provider || 'none'} | Auto-purge: ${d.auto_purge_enabled ? d.auto_purge_interval : 'off'} | Uptime monitoring: ${d.uptime_check_enabled ? d.uptime_check_interval : 'off'}${d.ssl_expires_at ? ` | SSL expires: ${new Date(d.ssl_expires_at).toLocaleDateString()} (${d.ssl_issuer || 'unknown issuer'})` : ''}${d.last_purged_at ? ` | Last purged: ${new Date(d.last_purged_at).toLocaleString()}` : ''}`)
      }

      // Fetch latest uptime checks for each domain
      const domainIds = domains.map((d: any) => d.domain)
      const { data: uptimeChecks } = await db
        .from('uptime_checks')
        .select('status, latency_ms, checked_at, user_domains!inner(domain)')
        .eq('user_id', user.id)
        .order('checked_at', { ascending: false })
        .limit(20)

      if (uptimeChecks && uptimeChecks.length > 0) {
        // Group by domain, show latest per domain
        const latestByDomain = new Map<string, any>()
        for (const check of uptimeChecks) {
          const domainName = (check as any).user_domains?.domain
          if (domainName && !latestByDomain.has(domainName)) {
            latestByDomain.set(domainName, check)
          }
        }
        lines.push(`\nLatest uptime status:`)
        for (const [domain, check] of latestByDomain) {
          lines.push(`- ${domain}: ${check.status.toUpperCase()} | Latency: ${check.latency_ms}ms | Checked: ${new Date(check.checked_at).toLocaleString()}`)
        }
      }

      // Fetch recent downtime incidents
      const { data: incidents } = await db
        .from('downtime_incidents')
        .select('started_at, ended_at, duration_seconds, cause, user_domains!inner(domain)')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(5)

      if (incidents && incidents.length > 0) {
        lines.push(`\nRecent downtime incidents:`)
        for (const inc of incidents) {
          const domainName = (inc as any).user_domains?.domain
          const duration = inc.duration_seconds ? `${Math.round(inc.duration_seconds / 60)}min` : 'ongoing'
          lines.push(`- ${domainName}: ${new Date(inc.started_at).toLocaleString()} | Duration: ${duration}${inc.cause ? ` | Cause: ${inc.cause}` : ''}`)
        }
      }
    } else {
      lines.push(`\nNo domains registered yet.`)
    }

    // Fetch notification preferences
    const { data: notifPrefs } = await db
      .from('notification_preferences')
      .select('notify_downtime, notify_recovery, notify_ssl_expiry, notify_weekly_report, alert_email')
      .eq('user_id', user.id)
      .single()

    if (notifPrefs) {
      lines.push(`\nNotification settings:`)
      lines.push(`- Downtime alerts: ${notifPrefs.notify_downtime ? 'on' : 'off'}`)
      lines.push(`- Recovery alerts: ${notifPrefs.notify_recovery ? 'on' : 'off'}`)
      lines.push(`- SSL expiry alerts: ${notifPrefs.notify_ssl_expiry ? 'on' : 'off'}`)
      lines.push(`- Weekly reports: ${notifPrefs.notify_weekly_report ? 'on' : 'off'}`)
      lines.push(`- Alert email: ${notifPrefs.alert_email || profile.email}`)
    }

    // Fetch recent cache purges
    const { data: purges } = await db
      .from('cache_purge_history')
      .select('purge_type, success, created_at, user_domains!inner(domain)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)

    if (purges && purges.length > 0) {
      lines.push(`\nRecent cache purges:`)
      for (const p of purges) {
        const domainName = (p as any).user_domains?.domain
        lines.push(`- ${domainName}: ${p.purge_type} | ${p.success ? 'success' : 'failed'} | ${new Date(p.created_at).toLocaleString()}`)
      }
    }

    // Fetch API tokens (names only, no secrets)
    const { data: tokens } = await db
      .from('api_tokens')
      .select('name, last_used, expires_at, created_at')
      .eq('user_id', user.id)

    if (tokens && tokens.length > 0) {
      lines.push(`\nAPI tokens (${tokens.length}):`)
      for (const t of tokens) {
        lines.push(`- "${t.name}" | Created: ${new Date(t.created_at).toLocaleDateString()}${t.expires_at ? ` | Expires: ${new Date(t.expires_at).toLocaleDateString()}` : ' | No expiry'}${t.last_used ? ` | Last used: ${new Date(t.last_used).toLocaleString()}` : ''}`)
      }
    }

    // ─── Admin-only aggregate data ─────────────────────────────
    if (isAdmin) {
      lines.push(`\n--- ADMIN CONTEXT ---`)

      const { count: totalUsers } = await db
        .from('profiles')
        .select('*', { count: 'exact', head: true })

      const { count: totalDomains } = await db
        .from('user_domains')
        .select('*', { count: 'exact', head: true })

      const { count: pendingDomains } = await db
        .from('user_domains')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')

      const { count: activeDomains } = await db
        .from('user_domains')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')

      lines.push(`Total users: ${totalUsers || 0}`)
      lines.push(`Total domains: ${totalDomains || 0} (${activeDomains || 0} active, ${pendingDomains || 0} pending)`)

      // Plan distribution
      const { data: planDist } = await db
        .from('profiles')
        .select('plan')

      if (planDist) {
        const counts: Record<string, number> = {}
        for (const p of planDist) {
          counts[p.plan || 'none'] = (counts[p.plan || 'none'] || 0) + 1
        }
        lines.push(`Plan distribution: ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
      }

      // Payment status overview
      const { data: payDist } = await db
        .from('profiles')
        .select('payment_status')

      if (payDist) {
        const counts: Record<string, number> = {}
        for (const p of payDist) {
          counts[p.payment_status || 'unpaid'] = (counts[p.payment_status || 'unpaid'] || 0) + 1
        }
        lines.push(`Payment status: ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
      }

      // Recent signups (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const { count: recentSignups } = await db
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekAgo)

      lines.push(`New signups (last 7 days): ${recentSignups || 0}`)

      // Recent pending domains needing review
      const { data: pendingList } = await db
        .from('user_domains')
        .select('domain, created_at, profiles!inner(full_name, email)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10)

      if (pendingList && pendingList.length > 0) {
        lines.push(`\nPending domains needing review:`)
        for (const d of pendingList) {
          const owner = (d as any).profiles
          lines.push(`- ${d.domain} | By: ${owner?.full_name || owner?.email} | Submitted: ${new Date(d.created_at).toLocaleDateString()}`)
        }
      }
    }

    return lines.join('\n')
  } catch (err) {
    console.error('Failed to fetch user context:', err)
    return null
  }
}

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(clientIp)) {
    return new Response(JSON.stringify({ error: 'Too many messages. Please wait a moment.' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { message, history } = await req.json()

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (message.length > 1000) {
      return new Response(JSON.stringify({ error: 'Message too long (max 1000 characters)' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const groqKey = Deno.env.get('GROQ_API_KEY')
    if (!geminiKey && !groqKey) {
      return new Response(JSON.stringify({ error: 'Chat is temporarily unavailable' }), {
        status: 503,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ─── Build system prompt with user context if authenticated ───
    let systemPrompt = BASE_SYSTEM_PROMPT

    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''

    // Only fetch user context if the token is a real user JWT (not the anon key)
    if (token && token !== anonKey && token.length > 100) {
      const userContext = await getUserContext(token)
      if (userContext) {
        systemPrompt += userContext
      }
    }

    // Build conversation history (OpenAI/Groq format — also used to build Gemini format)
    const recentHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY) : []

    // ─── Try Gemini first, fall back to Groq ───
    let reply: string | null = null

    if (geminiKey) {
      reply = await callGemini(geminiKey, systemPrompt, recentHistory, message.trim())
    }

    if (!reply && groqKey) {
      console.log('Gemini unavailable, falling back to Groq')
      reply = await callGroq(groqKey, systemPrompt, recentHistory, message.trim())
    }

    if (!reply) {
      return new Response(JSON.stringify({ error: 'Failed to get response. Please try again.' }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Lumi chat error:', err)
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})

// ─── Gemini API call ─────────────────────────────────────────────
async function callGemini(apiKey: string, systemPrompt: string, history: Array<{ role: string; text: string }>, message: string): Promise<string | null> {
  try {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []
    for (const turn of history) {
      if (turn.role && turn.text) {
        contents.push({
          role: turn.role === 'user' ? 'user' : 'model',
          parts: [{ text: turn.text }],
        })
      }
    }
    contents.push({ role: 'user', parts: [{ text: message }] })

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 500 },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          ],
        }),
      },
    )

    if (!res.ok) {
      console.error('Gemini error:', res.status, await res.text().catch(() => ''))
      return null // triggers Groq fallback
    }

    const data = await res.json()
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null
  } catch (err) {
    console.error('Gemini exception:', err)
    return null
  }
}

// ─── Groq API call (fallback) ────────────────────────────────────
async function callGroq(apiKey: string, systemPrompt: string, history: Array<{ role: string; text: string }>, message: string): Promise<string | null> {
  try {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ]
    for (const turn of history) {
      if (turn.role && turn.text) {
        messages.push({
          role: turn.role === 'user' ? 'user' : 'assistant',
          content: turn.text,
        })
      }
    }
    messages.push({ role: 'user', content: message })

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.7,
        max_tokens: 500,
      }),
    })

    if (!res.ok) {
      console.error('Groq error:', res.status, await res.text().catch(() => ''))
      return null
    }

    const data = await res.json()
    return data?.choices?.[0]?.message?.content || null
  } catch (err) {
    console.error('Groq exception:', err)
    return null
  }
}
