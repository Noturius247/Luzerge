-- 010: API Token Expiration & Scoping
-- Adds expiration, scope, and auto-cleanup for API tokens

-- Add expires_at column (NULL = never expires, for backwards compat)
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Add scope column (default 'full' for existing tokens)
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'full';

-- Index for efficient expired-token cleanup
CREATE INDEX IF NOT EXISTS idx_api_tokens_expires_at ON api_tokens(expires_at)
  WHERE expires_at IS NOT NULL;

-- Function to clean up expired tokens (run via pg_cron or scheduled job)
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
