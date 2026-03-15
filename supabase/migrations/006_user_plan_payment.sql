-- ============================================================
-- Migration 006: User Plan & Payment Status
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'none'
    CHECK (plan IN ('none', 'solo', 'starter', 'pro', 'business', 'enterprise')),
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid', 'overdue', 'trial', 'cancelled'));
