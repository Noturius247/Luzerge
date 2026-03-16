-- 008: API Access Tokens
-- Allows users to create personal API tokens for programmatic access

CREATE TABLE IF NOT EXISTS api_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Default',
  token_hash  TEXT NOT NULL,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);

-- RLS
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own tokens" ON api_tokens;
CREATE POLICY "users manage own tokens"
  ON api_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins read all tokens" ON api_tokens;
CREATE POLICY "admins read all tokens"
  ON api_tokens FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
