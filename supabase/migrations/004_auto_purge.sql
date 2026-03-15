-- ============================================================
-- Migration 004: Auto-Purge Scheduling
-- Adds columns to user_domains for automated cache purging
-- ============================================================

ALTER TABLE user_domains
  ADD COLUMN IF NOT EXISTS auto_purge_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_purge_interval TEXT NOT NULL DEFAULT 'daily'
    CHECK (auto_purge_interval IN ('hourly', 'every6h', 'every12h', 'daily', 'weekly'));

-- Index for the auto-purge cron job to quickly find domains that need purging
CREATE INDEX IF NOT EXISTS idx_user_domains_auto_purge
  ON user_domains (auto_purge_enabled, auto_purge_interval)
  WHERE auto_purge_enabled = true;

-- Add 'auto' as a valid purge_type in cache_purge_history
-- (existing check only allows 'everything' and 'urls')
ALTER TABLE cache_purge_history DROP CONSTRAINT IF EXISTS cache_purge_history_purge_type_check;
ALTER TABLE cache_purge_history ADD CONSTRAINT cache_purge_history_purge_type_check
  CHECK (purge_type IN ('everything', 'urls', 'auto'));
