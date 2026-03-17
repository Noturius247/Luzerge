/**
 * Luzerge — Credential Encryption Edge Function
 *
 * Handles server-side encryption of CDN credentials and
 * HMAC token hashing. Runs as a Supabase edge function.
 *
 * Endpoints:
 *   POST /encrypt-credentials/encrypt   — Encrypt a CDN credential before storage
 *   POST /encrypt-credentials/hash      — HMAC-hash an API token with salt
 *   POST /encrypt-credentials/backfill  — Migrate existing plaintext credentials (admin only)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { encrypt, decrypt, isEncrypted, hmacHashToken, generateSalt } from '../_shared/crypto.ts'

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    // Auth required for all endpoints
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Unauthorized' }, 401, corsHeaders)
    }

    const jwt = authHeader.replace('Bearer ', '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401, corsHeaders)
    }

    const url = new URL(req.url)
    const path = url.pathname

    // ── Encrypt a CDN credential ──────────────────────────────────────────
    if (path.endsWith('/encrypt')) {
      if (req.method !== 'POST') return json({ error: 'POST required' }, 405, corsHeaders)

      const { domain_id, field, value } = await req.json()
      if (!domain_id || !field || !value) {
        return json({ error: 'domain_id, field, and value are required' }, 400, corsHeaders)
      }

      // Validate field name (whitelist to prevent injection)
      const ALLOWED_FIELDS: Record<string, string> = {
        cloudflare_api_token: 'cloudflare_api_token_enc',
        cdn_api_key: 'cdn_api_key_enc',
      }
      const encField = ALLOWED_FIELDS[field]
      if (!encField) {
        return json({ error: 'Invalid field name' }, 400, corsHeaders)
      }

      // Verify user owns this domain
      const { data: domain, error: domainErr } = await supabase
        .from('user_domains')
        .select('id, user_id')
        .eq('id', domain_id)
        .single()

      if (domainErr || !domain) {
        return json({ error: 'Domain not found' }, 404, corsHeaders)
      }

      // Allow domain owner or admin
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (domain.user_id !== user.id && profile?.role !== 'admin') {
        return json({ error: 'Forbidden' }, 403, corsHeaders)
      }

      // Encrypt and store
      const encrypted = await encrypt(value)

      const { error: updateErr } = await supabase
        .from('user_domains')
        .update({
          [encField]: encrypted,
          [field]: null,  // Clear plaintext
        })
        .eq('id', domain_id)

      if (updateErr) {
        console.error('Encryption update error:', updateErr)
        return json({ error: 'Failed to store encrypted credential' }, 500, corsHeaders)
      }

      return json({ success: true, field: encField }, 200, corsHeaders)
    }

    // ── Hash an API token with HMAC ───────────────────────────────────────
    if (path.endsWith('/hash')) {
      if (req.method !== 'POST') return json({ error: 'POST required' }, 405, corsHeaders)

      const { raw_token, token_name, expires_at } = await req.json()
      if (!raw_token || !token_name) {
        return json({ error: 'raw_token and token_name are required' }, 400, corsHeaders)
      }

      // Generate salt and HMAC hash server-side
      const salt = generateSalt()
      const tokenHash = await hmacHashToken(raw_token, salt)

      // Store hashed token with salt
      const insertData: Record<string, unknown> = {
        user_id: user.id,
        name: token_name.trim().substring(0, 100),
        token_hash: tokenHash,
        salt,
        hash_version: 2,  // HMAC-SHA256
      }
      if (expires_at) insertData.expires_at = expires_at

      const { error: insertErr } = await supabase
        .from('api_tokens')
        .insert(insertData)

      if (insertErr) {
        console.error('Token insert error:', insertErr)
        return json({ error: 'Failed to create token' }, 500, corsHeaders)
      }

      return json({ success: true }, 200, corsHeaders)
    }

    // ── Backfill: encrypt existing plaintext credentials (admin only) ─────
    if (path.endsWith('/backfill')) {
      if (req.method !== 'POST') return json({ error: 'POST required' }, 405, corsHeaders)

      // Admin only
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile?.role !== 'admin') {
        return json({ error: 'Admin access required' }, 403, corsHeaders)
      }

      // Find domains with plaintext tokens that haven't been encrypted yet
      const { data: domains, error: fetchErr } = await supabase
        .from('user_domains')
        .select('id, cloudflare_api_token, cdn_api_key')
        .or('cloudflare_api_token.not.is.null,cdn_api_key.not.is.null')

      if (fetchErr) {
        return json({ error: 'Failed to fetch domains' }, 500, corsHeaders)
      }

      let encrypted = 0
      let skipped = 0
      const errors: string[] = []

      for (const domain of domains || []) {
        try {
          const updates: Record<string, string | null> = {}

          if (domain.cloudflare_api_token && !isEncrypted(domain.cloudflare_api_token)) {
            updates.cloudflare_api_token_enc = await encrypt(domain.cloudflare_api_token)
            updates.cloudflare_api_token = null
          }

          if (domain.cdn_api_key && !isEncrypted(domain.cdn_api_key)) {
            updates.cdn_api_key_enc = await encrypt(domain.cdn_api_key)
            updates.cdn_api_key = null
          }

          if (Object.keys(updates).length > 0) {
            await supabase.from('user_domains').update(updates).eq('id', domain.id)
            encrypted++
          } else {
            skipped++
          }
        } catch (err) {
          errors.push(`${domain.id}: ${String(err)}`)
        }
      }

      return json({
        success: true,
        encrypted,
        skipped,
        total: domains?.length ?? 0,
        errors: errors.length ? errors : undefined,
      }, 200, corsHeaders)
    }

    return json({ error: 'Not Found' }, 404, corsHeaders)

  } catch (err) {
    console.error('encrypt-credentials error:', err)
    return json({ error: 'Internal server error' }, 500, getCorsHeaders(req))
  }
})

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}
