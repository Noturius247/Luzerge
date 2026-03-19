import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * Page Speed Insights Edge Function
 * Calls Google PageSpeed Insights API (free, no key required for basic usage).
 */

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const url = new URL(req.url)
    const target = url.searchParams.get('url')
    const strategy = url.searchParams.get('strategy') || 'mobile'

    if (!target) {
      return json({ error: 'url parameter is required' }, 400, cors)
    }

    const targetUrl = target.startsWith('http') ? target : `https://${target}`

    // Google PageSpeed Insights API (free tier, no key needed)
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo`

    const psiRes = await fetch(apiUrl, {
      signal: AbortSignal.timeout(60000),
    })

    if (!psiRes.ok) {
      const errText = await psiRes.text()
      return json({ error: 'PageSpeed API error', detail: errText }, 502, cors)
    }

    const data = await psiRes.json()
    const lhr = data.lighthouseResult

    if (!lhr) {
      return json({ error: 'No Lighthouse result returned' }, 502, cors)
    }

    // Extract scores (0-100)
    const categories: Record<string, number | null> = {}
    for (const [key, cat] of Object.entries(lhr.categories || {})) {
      categories[key] = Math.round(((cat as Record<string, number>).score || 0) * 100)
    }

    // Extract key metrics
    const audits = lhr.audits || {}
    const metrics: Record<string, unknown> = {}
    const metricKeys = [
      'first-contentful-paint',
      'largest-contentful-paint',
      'total-blocking-time',
      'cumulative-layout-shift',
      'speed-index',
      'interactive',
    ]
    for (const key of metricKeys) {
      if (audits[key]) {
        metrics[key] = {
          score: Math.round((audits[key].score || 0) * 100),
          value: audits[key].displayValue || null,
          numeric: audits[key].numericValue || null,
        }
      }
    }

    return json({
      url: targetUrl,
      strategy,
      scores: categories,
      metrics,
      final_url: lhr.finalUrl || targetUrl,
      fetch_time: lhr.fetchTime || null,
    }, 200, cors)
  } catch (err) {
    return json({ error: 'Page speed analysis failed', detail: String(err) }, 502, cors)
  }
})

function json(data: unknown, status = 200, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
