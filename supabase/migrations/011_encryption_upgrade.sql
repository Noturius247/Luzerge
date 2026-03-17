-- 011: Encryption Upgrade
-- Adds salt column to api_tokens and encrypted credential columns to user_domains

-- ─── API Tokens: add per-token salt for HMAC-SHA256 ────────────────────────

-- Salt column (NULL for legacy tokens that used plain SHA-256)
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS salt TEXT;

-- Hash algorithm version (1 = legacy SHA-256, 2 = HMAC-SHA256 with pepper+salt)
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS hash_version INTEGER NOT NULL DEFAULT 1;

-- ─── User Domains: encrypted credential columns ───────────────────────────

-- Encrypted versions of Cloudflare credentials (AES-256-GCM)
ALTER TABLE user_domains ADD COLUMN IF NOT EXISTS cloudflare_api_token_enc TEXT;
ALTER TABLE user_domains ADD COLUMN IF NOT EXISTS cdn_api_key_enc TEXT;

-- After migration completes and all tokens are encrypted:
-- 1. Run the encrypt-credentials edge function to backfill encrypted columns
-- 2. Verify all rows have encrypted values
-- 3. Then NULL out the plaintext columns:
--    UPDATE user_domains SET cloudflare_api_token = NULL WHERE cloudflare_api_token_enc IS NOT NULL;
--    UPDATE user_domains SET cdn_api_key = NULL WHERE cdn_api_key_enc IS NOT NULL;
-- 4. Eventually drop the plaintext columns in a future migration
