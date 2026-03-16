/**
 * CORS headers for Supabase Edge Functions
 * Allows luzerge.com + common local dev origins
 */
const ALLOWED_ORIGINS = [
  'https://luzerge.com',
  'https://www.luzerge.com',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://localhost:5501',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5501',
]

export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get('Origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, apikey',
    'Access-Control-Max-Age': '86400',
  }
}

// Legacy export — edge functions that don't pass `req` still work (defaults to production origin)
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://luzerge.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, apikey',
  'Access-Control-Max-Age': '86400',
}
