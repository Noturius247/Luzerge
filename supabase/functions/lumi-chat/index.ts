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

Contact: luzergeservices@gmail.com
Setup guide page: /setup.html (direct users here for full step-by-step instructions)

--- CLOUDFLARE + DOMAIN SETUP GUIDE ---

STEP 1 — Create a Cloudflare account:
- Go to cloudflare.com, click Sign Up, verify your email
- Select the Free plan — Luzerge provides advanced features on top, no paid Cloudflare plan needed
- One account handles all domains

STEP 2 — Add your domain to Cloudflare:
- Click "+ Add a site", enter your root domain (e.g. example.com, no www or https)
- Select Free plan, click Continue
- Cloudflare auto-scans and imports existing DNS records — review to confirm all A records (server IP), CNAME records, and MX records (email) are present
- Enable proxy (orange cloud) on all A/CNAME records pointing to your website — this enables CDN, DDoS protection, and analytics
- Keep MX records and SPF/DKIM TXT records as DNS-only (grey cloud)

STEP 3 — Update nameservers at your domain registrar:
- Cloudflare gives you 2 nameservers (e.g. ada.ns.cloudflare.com, bob.ns.cloudflare.com) — yours will be different
- Log in to your registrar (GoDaddy: My Domains → Manage DNS → Nameservers; Namecheap: Domain List → Manage → Nameservers; Google Domains: DNS → Custom nameservers; Hostinger: Domains → DNS/Nameservers)
- Delete all existing nameservers, paste in Cloudflare's 2 nameservers, save
- Propagation takes 5 minutes to 48 hours (usually under 1 hour)
- Check progress at dnschecker.org searching for your domain's NS records
- Cloudflare sends an email and domain status changes to Active when done

STEP 4 — Required Cloudflare settings (after nameservers are active):
- SSL/TLS → Overview: Set encryption mode to "Full" (not Flexible — Flexible causes infinite redirect loops!) or "Full (Strict)" if you have a valid CA cert
- SSL/TLS → Edge Certificates → Always Use HTTPS: Turn ON (redirects all HTTP to HTTPS)
- SSL/TLS → Edge Certificates → Minimum TLS Version: Set to TLS 1.2
- DNS → Records: Confirm A/CNAME records for your website are proxied (orange cloud)
- Speed → Optimization → Auto Minify: Enable (optional) for HTML/CSS/JS minification
- Caching → Configuration → Caching Level: Keep at Standard

STEP 5 — Get API credentials (FREE PLAN ONLY — managed plans skip this):
- API Token: cloudflare.com → Profile (top-right) → API Tokens → Create Token → Get started (Custom Token)
  Give token name "Luzerge", add permissions: Zone:Read, Zone Settings:Edit, DNS:Edit, Cache Purge:Purge, Firewall Services:Edit, Page Rules:Edit
  Set Zone Resources to "Specific zone" → your domain → Create Token → COPY IMMEDIATELY (shown only once)
- Zone ID: cloudflare.com → click your domain → right sidebar → Zone ID (32-char hex string) → Copy

STEP 6 — Submit domain to Luzerge:
- Sign in at luzerge.com → Dashboard (Google login)
- Overview panel → click "Add Domain" → enter root domain
- Free plan: paste API Token and Zone ID when prompted
- Managed plans (Solo/Starter/Pro/Business/Enterprise): just enter domain name — Luzerge team configures everything within 24 hours
- Status shows "Pending" then changes to "Active"

--- DASHBOARD FEATURES GUIDE ---

OVERVIEW PANEL:
- Shows all domains with status, last purge time, uptime status
- "Purge Cache" button: clears all CDN cache globally instantly — use after deploying updates

ANALYTICS (Performance → Analytics):
- Network-level analytics from Cloudflare (no JS tracking needed, not blocked by ad blockers)
- Shows: total requests, bandwidth, unique visitors, cache hit rate, status codes, top countries
- Time ranges: 24h, 7 days, 30 days

UPTIME MONITORING (Security → Uptime Monitoring):
- Checks site every 1, 2, or 5 minutes from multiple locations
- Enable: toggle "Enable uptime checks", choose interval
- Shows: uptime %, average latency, incident history, downtime timeline
- To get alerts: Settings → Notifications → enable Downtime alerts + Recovery alerts

SSL/TLS (Network → SSL/TLS):
- Shows: certificate issuer, expiry date, TLS version, encryption mode
- Enable SSL expiry alerts: Settings → Notifications → SSL expiry alerts (warns 30 days before expiry)
- Cloudflare provides free auto-renewing SSL — proxied domains never need manual renewal

CDN & CACHE (Overview panel + Settings → Domain Defaults):
- Cloudflare CDN: 300+ global edge locations, caches site near visitors
- Manual purge: Overview → Purge Cache button next to domain
- Auto-purge: Settings → Domain Defaults → enable Auto-purge, choose interval (1h/6h/12h/24h)
- Purge history: Performance → Analytics

DNS MANAGEMENT (Network → DNS Management):
- View/add/edit all DNS records (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA)
- Changes apply instantly via Cloudflare API — no propagation wait
- Add Record button to create new entries, click existing record to edit

WAF / FIREWALL (Security → WAF/Firewall) — Managed Plans:
- Cloudflare managed WAF rules auto-block SQLi, XSS, path traversal, bad bots
- View blocked requests, top threat types, attacking IPs
- Create custom rules: block/allow by IP, country, ASN, user-agent, URL path
- Bot Fight Mode: automatically challenges known scrapers and credential stuffers

DDOS PROTECTION (Security → DDoS Protection):
- Always-on L3/L4 and L7 DDoS protection through Cloudflare — no configuration needed
- Dashboard shows protection status, attack history, peak attack traffic
- Under Attack Mode: enable from dashboard for active attacks — adds JS challenge to all new visitors

IMAGE OPTIMIZATION (Performance → Image Optimization):
- Cloudflare Polish: auto-compress JPEG/PNG images (lossless by default)
- WebP conversion: serve WebP format to compatible browsers (25-34% smaller than JPEG)
- Enable both for maximum performance

MINIFICATION (Performance → Minification):
- Auto-minify HTML, CSS, JavaScript files — strips whitespace and comments
- Reduces file sizes 10-30%
- After enabling, purge cache so visitors get minified files immediately

NOTIFICATIONS (Settings → Notifications):
- Downtime alerts: instant email when site goes down (strongly recommended)
- Recovery alerts: email when site comes back up with downtime duration (strongly recommended)
- SSL expiry alerts: email 30 days before cert expires (recommended)
- Weekly reports: Monday digest with uptime %, traffic stats, purge history (optional)
- Can use different alert email than login email (e.g. team inbox)

CDN CREDENTIALS (Settings → CDN Credentials):
- Where to update/change your Cloudflare API token and Zone ID (Free plan)
- Tokens are stored encrypted

--- COMMON TROUBLESHOOTING ---

Problem: Domain stuck "Pending" after 24h → Check nameserver propagation at dnschecker.org, email luzergeservices@gmail.com with domain name
Problem: ERR_TOO_MANY_REDIRECTS or SSL loop → SSL mode set to Flexible — change to Full in Cloudflare → SSL/TLS → Overview
Problem: "Invalid credentials" error → API token missing permissions or expired — delete and recreate following Step 5
Problem: Cache purge not working → Verify DNS records are proxied (orange cloud), not DNS-only (grey)
Problem: No alert emails → Check Settings → Notifications, verify email, check spam folder, add luzergeservices@gmail.com to contacts
Problem: No analytics data → Domain must be Active with proxied DNS records; data appears within hours of activation
Problem: Email broke after switching nameservers → MX records may be missing or accidentally proxied — MX records must be DNS-only (grey cloud) in Cloudflare DNS

For full step-by-step instructions with screenshots and examples, direct users to /setup.html

Rules:
- For general questions, keep responses short (2-3 sentences).
- For setup, troubleshooting, or "how to" questions, give FULL step-by-step instructions using the guide above. Include every sub-step. Do NOT summarize or shorten setup guides — users need the complete details. Never just say "contact support" — actually answer with the specific steps.
- Only answer questions related to Luzerge, websites, DNS, CDN, hosting, security, and web performance.
- For unrelated questions, politely redirect: "I'm here to help with Luzerge and web performance topics!"
- Never make up features or pricing that isn't listed above.
- If unsure, suggest contacting luzergeservices@gmail.com or visiting /setup.html.
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
          generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 1500 },
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
        max_tokens: 1500,
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
