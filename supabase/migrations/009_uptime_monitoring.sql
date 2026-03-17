-- ============================================================
-- Migration 009: Uptime Monitoring, Alerts & SSL Tracking
-- Adds uptime checks, downtime incidents, notification prefs,
-- alert logging, and SSL expiry tracking
-- ============================================================

-- ─── Uptime check results ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uptime_checks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id   UUID NOT NULL REFERENCES user_domains(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('up', 'down')),
  http_status INT,
  latency_ms  INT,
  protocol    TEXT NOT NULL DEFAULT 'https' CHECK (protocol IN ('https', 'http')),
  error       TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uptime_checks_domain_time
  ON uptime_checks (domain_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_uptime_checks_user_id
  ON uptime_checks (user_id);

-- ─── Downtime incidents ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS downtime_incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id       UUID NOT NULL REFERENCES user_domains(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  duration_seconds INT,
  cause           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_downtime_incidents_domain_time
  ON downtime_incidents (domain_id, started_at DESC);

-- ─── Notification preferences (replaces localStorage) ─────────────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  notify_downtime     BOOLEAN NOT NULL DEFAULT true,
  notify_recovery     BOOLEAN NOT NULL DEFAULT true,
  notify_ssl_expiry   BOOLEAN NOT NULL DEFAULT true,
  notify_weekly_report BOOLEAN NOT NULL DEFAULT true,
  alert_email         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Alert log (deduplication + audit) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  domain_id   UUID NOT NULL REFERENCES user_domains(id) ON DELETE CASCADE,
  alert_type  TEXT NOT NULL CHECK (alert_type IN (
    'downtime', 'recovery', 'ssl_expiry_30d', 'ssl_expiry_14d', 'ssl_expiry_7d', 'weekly_report'
  )),
  details     JSONB,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_log_domain_type
  ON alert_log (domain_id, alert_type, sent_at DESC);

-- ─── Add uptime & SSL columns to user_domains ────────────────────────────────
ALTER TABLE user_domains
  ADD COLUMN IF NOT EXISTS uptime_check_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS uptime_check_interval TEXT NOT NULL DEFAULT '5min'
    CHECK (uptime_check_interval IN ('1min', '5min', '15min', '30min', '60min')),
  ADD COLUMN IF NOT EXISTS last_uptime_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ssl_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ssl_issuer TEXT,
  ADD COLUMN IF NOT EXISTS ssl_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_status_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_status_token TEXT DEFAULT encode(gen_random_bytes(16), 'hex');

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE uptime_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE downtime_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users own uptime checks" ON uptime_checks;
CREATE POLICY "users own uptime checks"
  ON uptime_checks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users own downtime incidents" ON downtime_incidents;
CREATE POLICY "users own downtime incidents"
  ON downtime_incidents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users own notification prefs" ON notification_preferences;
CREATE POLICY "users own notification prefs"
  ON notification_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users own alert log" ON alert_log;
CREATE POLICY "users own alert log"
  ON alert_log FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Admin policies (admins can view all monitoring data) ────────────────────
DROP POLICY IF EXISTS "admins select all uptime checks" ON uptime_checks;
CREATE POLICY "admins select all uptime checks"
  ON uptime_checks FOR SELECT
  USING (is_admin());

DROP POLICY IF EXISTS "admins select all downtime incidents" ON downtime_incidents;
CREATE POLICY "admins select all downtime incidents"
  ON downtime_incidents FOR SELECT
  USING (is_admin());

DROP POLICY IF EXISTS "admins select all alert log" ON alert_log;
CREATE POLICY "admins select all alert log"
  ON alert_log FOR SELECT
  USING (is_admin());

DROP POLICY IF EXISTS "admins select all notification prefs" ON notification_preferences;
CREATE POLICY "admins select all notification prefs"
  ON notification_preferences FOR SELECT
  USING (is_admin());

-- ─── Cleanup: auto-delete uptime checks older than 90 days ──────────────────
-- Run via pg_cron daily:
-- SELECT cron.schedule('cleanup-uptime-checks', '0 3 * * *',
--   $$ DELETE FROM uptime_checks WHERE checked_at < NOW() - INTERVAL '90 days' $$
-- );
