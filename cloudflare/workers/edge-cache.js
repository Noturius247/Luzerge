/**
 * Luzerge.com — Cloudflare Worker
 * Edge-side cache control, request routing, and optimization
 *
 * Deploy: wrangler deploy
 * Docs: https://developers.cloudflare.com/workers/
 */

// ─── Cache TTL Configuration ────────────────────────────────────────────────

const CACHE_RULES = [
  // Static assets — cache 1 year at edge + browser
  {
    pattern: /\.(css|js|woff2?|ttf|otf|eot)(\?.*)?$/i,
    edgeTTL: 365 * 24 * 3600,    // 1 year
    browserTTL: 365 * 24 * 3600,
    cacheEverything: true,
  },
  // Images — cache 30 days
  {
    pattern: /\.(jpg|jpeg|png|gif|svg|ico|webp|avif)(\?.*)?$/i,
    edgeTTL: 30 * 24 * 3600,     // 30 days
    browserTTL: 30 * 24 * 3600,
    cacheEverything: true,
  },
  // HTML pages — cache 4 hours
  {
    pattern: /\.(html?)(\?.*)?$/i,
    edgeTTL: 4 * 3600,           // 4 hours
    browserTTL: 4 * 3600,
    cacheEverything: true,
  },
  // API calls — never cache
  {
    pattern: /^\/(api|auth|storage)\//i,
    edgeTTL: 0,
    browserTTL: 0,
    cacheEverything: false,
    bypass: true,
  },
]

// ─── Security headers added at edge ─────────────────────────────────────────

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://www.googletagmanager.com https://static.cloudflareinsights.com https://cdn.jsdelivr.net",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://lh3.googleusercontent.com https://www.googletagmanager.com",
    "connect-src 'self' https://*.supabase.co https://www.google-analytics.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join('; '),
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCacheRule(url) {
  const path = new URL(url).pathname
  return CACHE_RULES.find(rule => rule.pattern.test(path)) ?? null
}

function applySecurityHeaders(response) {
  const newHeaders = new Headers(response.headers)
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    newHeaders.set(key, value)
  }
  // Remove server fingerprinting headers
  newHeaders.delete('Server')
  newHeaders.delete('X-Powered-By')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  })
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const rule = getCacheRule(request.url)

    // Redirect HTTP → HTTPS
    if (url.protocol === 'http:') {
      url.protocol = 'https:'
      return Response.redirect(url.toString(), 301)
    }

    // Redirect www → apex
    if (url.hostname === 'www.luzerge.com') {
      url.hostname = 'luzerge.com'
      return Response.redirect(url.toString(), 301)
    }

    // Bypass cache for API/auth routes
    if (rule?.bypass) {
      const response = await fetch(request)
      return applySecurityHeaders(response)
    }

    // For cacheable resources — use Cloudflare cache API
    if (rule?.cacheEverything) {
      const cache = caches.default
      const cacheKey = new Request(url.toString(), request)

      // Serve from cache if available
      let response = await cache.match(cacheKey)

      if (response) {
        // Cache hit — add debug header
        const headers = new Headers(response.headers)
        headers.set('X-Cache-Status', 'HIT')
        response = new Response(response.body, { ...response, headers })
        return applySecurityHeaders(response)
      }

      // Cache miss — fetch from origin
      response = await fetch(request)

      if (response.ok) {
        const headers = new Headers(response.headers)
        headers.set('Cache-Control', `public, max-age=${rule.browserTTL}, s-maxage=${rule.edgeTTL}`)
        headers.set('X-Cache-Status', 'MISS')
        headers.set('Vary', 'Accept-Encoding')

        const cachedResponse = new Response(response.clone().body, {
          status: response.status,
          headers,
        })

        // Store in cache asynchronously
        ctx.waitUntil(cache.put(cacheKey, cachedResponse.clone()))
        return applySecurityHeaders(cachedResponse)
      }

      return applySecurityHeaders(response)
    }

    // Default: pass through with security headers
    const response = await fetch(request)
    return applySecurityHeaders(response)
  },
}
