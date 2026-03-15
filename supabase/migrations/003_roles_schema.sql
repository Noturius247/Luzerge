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
  INSERT INTO public.profiles (id, email, full_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    '',
    '',
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
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

-- ─── Admin check function (SECURITY DEFINER bypasses RLS, prevents recursion) ─
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- Drop existing policies first to make migration idempotent
DROP POLICY IF EXISTS "users read own profile" ON profiles;
DROP POLICY IF EXISTS "admins read all profiles" ON profiles;
DROP POLICY IF EXISTS "users update own profile" ON profiles;
DROP POLICY IF EXISTS "users insert own profile" ON profiles;

CREATE POLICY "users read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "admins read all profiles"
  ON profiles FOR SELECT
  USING (is_admin());

CREATE POLICY "users update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ─── Update user_domains RLS: admins can see & manage all domains ─────────────
DROP POLICY IF EXISTS "users own domains" ON user_domains;
DROP POLICY IF EXISTS "users select own domains" ON user_domains;
DROP POLICY IF EXISTS "users insert own domains" ON user_domains;
DROP POLICY IF EXISTS "users delete own domains" ON user_domains;
DROP POLICY IF EXISTS "admins select all domains" ON user_domains;
DROP POLICY IF EXISTS "admins update all domains" ON user_domains;
DROP POLICY IF EXISTS "admins delete all domains" ON user_domains;

CREATE POLICY "users select own domains"
  ON user_domains FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own domains"
  ON user_domains FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own domains"
  ON user_domains FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "admins select all domains"
  ON user_domains FOR SELECT
  USING (is_admin());

CREATE POLICY "admins update all domains"
  ON user_domains FOR UPDATE
  USING (is_admin());

CREATE POLICY "admins delete all domains"
  ON user_domains FOR DELETE
  USING (is_admin());

-- ─── Update cache_purge_history RLS: admins can see all ───────────────────────
DROP POLICY IF EXISTS "users own purge history" ON cache_purge_history;
DROP POLICY IF EXISTS "users select own purge history" ON cache_purge_history;
DROP POLICY IF EXISTS "users insert own purge history" ON cache_purge_history;
DROP POLICY IF EXISTS "admins select all purge history" ON cache_purge_history;
DROP POLICY IF EXISTS "admins insert all purge history" ON cache_purge_history;

CREATE POLICY "users select own purge history"
  ON cache_purge_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own purge history"
  ON cache_purge_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins select all purge history"
  ON cache_purge_history FOR SELECT
  USING (is_admin());

CREATE POLICY "admins insert all purge history"
  ON cache_purge_history FOR INSERT
  WITH CHECK (is_admin());

