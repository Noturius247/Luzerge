-- ============================================================
-- 013: Analytics History — store daily snapshots for long-term views
-- Cloudflare API only retains ~30 days; this table enables 12-month+ views.
-- ============================================================

CREATE TABLE analytics_daily (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id  UUID        NOT NULL REFERENCES user_domains(id) ON DELETE CASCADE,
  date       DATE        NOT NULL,
  requests   INT         NOT NULL DEFAULT 0,
  cached_requests INT    NOT NULL DEFAULT 0,
  bytes      BIGINT      NOT NULL DEFAULT 0,
  cached_bytes BIGINT    NOT NULL DEFAULT 0,
  threats    INT         NOT NULL DEFAULT 0,
  uniques    INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(domain_id, date)
);

-- Index for fast range queries
CREATE INDEX idx_analytics_daily_domain_date ON analytics_daily(domain_id, date DESC);

-- ─── Row-Level Security ─────────────────────────────────────────────────────

ALTER TABLE analytics_daily ENABLE ROW LEVEL SECURITY;

-- Users can read analytics for their own domains
CREATE POLICY "Users read own domain analytics"
  ON analytics_daily FOR SELECT
  USING (
    domain_id IN (SELECT id FROM user_domains WHERE user_id = auth.uid())
  );

-- Service role can insert/update (edge functions use service role)
CREATE POLICY "Service role manages analytics"
  ON analytics_daily FOR ALL
  USING (true)
  WITH CHECK (true);

-- Admins can read all analytics
CREATE POLICY "Admins read all analytics"
  ON analytics_daily FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
