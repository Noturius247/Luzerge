/**
 * Lumi — Luzerge AI Assistant
 * Proxies chat requests to Google Gemini API
 * Keeps the API key server-side
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

const SYSTEM_PROMPT = `You are Lumi, the friendly AI assistant for Luzerge — a website monitoring and performance platform based in Cebu City, Philippines.

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
- Use a friendly, professional tone. No emojis unless the user uses them first.`

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

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Chat is temporarily unavailable' }), {
        status: 503,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Build conversation history for Gemini
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

    // Add conversation history (limited)
    const recentHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY) : []
    for (const turn of recentHistory) {
      if (turn.role && turn.text) {
        contents.push({
          role: turn.role === 'user' ? 'user' : 'model',
          parts: [{ text: turn.text }],
        })
      }
    }

    // Add current message
    contents.push({
      role: 'user',
      parts: [{ text: message.trim() }],
    })

    // Call Gemini API
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 500,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          ],
        }),
      },
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      console.error('Gemini API error:', geminiRes.status, errText)
      return new Response(JSON.stringify({ error: 'Failed to get response. Please try again.' }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const geminiData = await geminiRes.json()
    const reply =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I couldn't generate a response. Please try again."

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
