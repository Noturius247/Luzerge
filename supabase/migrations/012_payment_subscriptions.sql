-- ============================================================
-- Migration 012: Payment Subscriptions & History (PayMongo)
-- ============================================================

-- Add 'pending' to payment_status CHECK constraint
-- Drop old constraint and re-create with pending included
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_payment_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'overdue', 'trial', 'cancelled', 'pending'));

-- ── Subscriptions table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('solo', 'starter', 'pro', 'business', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  paymongo_checkout_id TEXT,
  paymongo_payment_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active/trial subscription per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_active_user
  ON subscriptions (user_id) WHERE status IN ('trial', 'active', 'past_due');

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON subscriptions (current_period_end);

-- ── Payment history table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  paymongo_payment_id TEXT,
  paymongo_checkout_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'failed', 'refunded')),
  payment_method TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history (user_id, created_at DESC);

-- ── RLS policies ─────────────────────────────────────────────
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscriptions
DROP POLICY IF EXISTS "Users read own subscriptions" ON subscriptions;
CREATE POLICY "Users read own subscriptions" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Service role manages subscriptions (edge functions)
DROP POLICY IF EXISTS "Service role manages subscriptions" ON subscriptions;
CREATE POLICY "Service role manages subscriptions" ON subscriptions
  FOR ALL USING (auth.role() = 'service_role');

-- Users can read their own payment history
DROP POLICY IF EXISTS "Users read own payment history" ON payment_history;
CREATE POLICY "Users read own payment history" ON payment_history
  FOR SELECT USING (auth.uid() = user_id);

-- Service role manages payment history
DROP POLICY IF EXISTS "Service role manages payment history" ON payment_history;
CREATE POLICY "Service role manages payment history" ON payment_history
  FOR ALL USING (auth.role() = 'service_role');

-- Admins can read all subscriptions and payment history
DROP POLICY IF EXISTS "Admins read all subscriptions" ON subscriptions;
CREATE POLICY "Admins read all subscriptions" ON subscriptions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Admins read all payment history" ON payment_history;
CREATE POLICY "Admins read all payment history" ON payment_history
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── Updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_subscriptions_updated_at();
