-- ============================================================
-- Migration 007: Multi-CDN Provider Support
-- ============================================================

-- Add provider column and generic credential fields
ALTER TABLE user_domains
  ADD COLUMN IF NOT EXISTS cdn_provider TEXT NOT NULL DEFAULT 'cloudflare'
    CHECK (cdn_provider IN ('cloudflare', 'cloudfront', 'fastly', 'none')),
  ADD COLUMN IF NOT EXISTS cdn_api_key TEXT,
  ADD COLUMN IF NOT EXISTS cdn_distribution_id TEXT;

-- cdn_provider = 'cloudflare'  → uses cloudflare_zone_id + cloudflare_api_token (existing)
-- cdn_provider = 'cloudfront'  → uses cdn_distribution_id + cdn_api_key (AWS access key)
-- cdn_provider = 'fastly'      → uses cdn_api_key (Fastly API token) + cdn_distribution_id (service ID)
-- cdn_provider = 'none'        → no CDN, basic monitoring only (uptime, DNS, SSL)
