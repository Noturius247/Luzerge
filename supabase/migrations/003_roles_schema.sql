-- ============================================================
-- Migration 003: Role-Based Access (User / Admin)
-- Users submit domains → Admins configure Cloudflare credentials
-- ============================================================

-- ─── Profiles table (role assignment) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  full_name  TEXT,
  avatar_url TEXT,
  role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- Auto-create profile on signup via trigger
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', ''),
    'user'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Modify user_domains: add status values for submission flow ───────────────
-- Add new allowed statuses: 'pending', 'active', 'rejected', 'paused', 'error'
ALTER TABLE user_domains DROP CONSTRAINT IF EXISTS user_domains_status_check;
ALTER TABLE user_domains ADD CONSTRAINT user_domains_status_check
  CHECK (status IN ('pending', 'active', 'rejected', 'paused', 'error'));

-- Default new domains to 'pending' instead of 'active'
ALTER TABLE user_domains ALTER COLUMN status SET DEFAULT 'pending';

-- Add admin notes column for rejection reasons / setup notes
ALTER TABLE user_domains ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- ─── RLS for profiles ────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "admins read all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Users can update their own profile (but not role)
CREATE POLICY "users update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ─── Update user_domains RLS: admins can see & manage all domains ─────────────
-- Drop old policy and recreate with admin access
DROP POLICY IF EXISTS "users own domains" ON user_domains;

-- Users can SELECT their own domains
CREATE POLICY "users select own domains"
  ON user_domains FOR SELECT
  USING (auth.uid() = user_id);

-- Users can INSERT their own domains
CREATE POLICY "users insert own domains"
  ON user_domains FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can DELETE their own domains
CREATE POLICY "users delete own domains"
  ON user_domains FOR DELETE
  USING (auth.uid() = user_id);

-- Admins can SELECT all domains
CREATE POLICY "admins select all domains"
  ON user_domains FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can UPDATE all domains (to set zone_id, api_token, status, notes)
CREATE POLICY "admins update all domains"
  ON user_domains FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can DELETE any domain
CREATE POLICY "admins delete all domains"
  ON user_domains FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── Update cache_purge_history RLS: admins can see all ───────────────────────
DROP POLICY IF EXISTS "users own purge history" ON cache_purge_history;

CREATE POLICY "users select own purge history"
  ON cache_purge_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own purge history"
  ON cache_purge_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins select all purge history"
  ON cache_purge_history FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admins insert all purge history"
  ON cache_purge_history FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

