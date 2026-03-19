import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * Header Inspector Edge Function
 * Fetches HTTP response headers from any URL and returns them for debugging.
 */

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const url = new URL(req.url)
    const target = url.searchParams.get('url')

    if (!target) {
      return json({ error: 'url parameter is required' }, 400, cors)
    }

    // Ensure the target has a protocol
    const targetUrl = target.startsWith('http') ? target : `https://${target}`

    const start = Date.now()
    const res = await fetch(targetUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })
    const latency = Date.now() - start

    // Collect all response headers
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })

    // Categorize security headers
    const securityHeaders = [
      'strict-transport-security',
      'content-security-policy',
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection',
      'referrer-policy',
      'permissions-policy',
      'cross-origin-opener-policy',
      'cross-origin-resource-policy',
      'cross-origin-embedder-policy',
    ]

    const security: Record<string, string | null> = {}
    for (const h of securityHeaders) {
      security[h] = headers[h] || null
    }

    return json({
      url: targetUrl,
      status: res.status,
      status_text: res.statusText,
      latency_ms: latency,
      redirected: res.redirected,
      headers,
      security,
      server: headers['server'] || null,
      powered_by: headers['x-powered-by'] || null,
      cdn: headers['cf-ray'] ? 'Cloudflare' : headers['x-amz-cf-id'] ? 'CloudFront' : headers['x-served-by'] ? 'Fastly' : null,
    }, 200, cors)
  } catch (err) {
    return json({ error: 'Failed to inspect headers', detail: String(err) }, 502, cors)
  }
})

function json(data: unknown, status = 200, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
