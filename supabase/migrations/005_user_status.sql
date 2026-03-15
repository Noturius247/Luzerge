-- ============================================================
-- Migration 005: User Account Status
-- Adds status column to profiles for account management
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended', 'blocked'));

CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);

-- Allow admins to update any profile (for status changes, etc.)
DROP POLICY IF EXISTS "admins update all profiles" ON profiles;
CREATE POLICY "admins update all profiles"
  ON profiles FOR UPDATE
  USING (is_admin());
