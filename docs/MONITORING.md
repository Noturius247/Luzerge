# Monitoring, Performance & Cache Analytics

---

## 1. Cloudflare Analytics (Free)

### Cache Hit Rate

```text
Cloudflare → Analytics → Traffic

Key metrics to watch:
  Cache Hit Rate      → Target: > 85% for static assets
  Bandwidth Saved     → Should be majority of total bandwidth
  Requests Served     → Total vs cached ratio
  Threats Blocked     → WAF rule matches
  Unique Visitors     → By country (should see PH high)
```

**Interpreting CF-Cache-Status header:**

| Value       | Meaning                                              |
|-------------|------------------------------------------------------|
| `HIT`       | Served from Cloudflare edge cache                    |
| `MISS`      | Not in cache, fetched from origin                    |
| `EXPIRED`   | Was cached but TTL expired, refetched                |
| `BYPASS`    | Cache explicitly bypassed (e.g., /api/* routes)      |
| `DYNAMIC`   | Not cacheable by Cloudflare                          |
| `REVALIDATED` | Served from cache after revalidation with origin  |

### Real-Time Monitoring

```bash
# Stream live Cloudflare logs (Enterprise only)
# For free tier, use the Analytics dashboard

# Check cache status for specific URLs
curl -sI https://luzerge.com/css/styles.css | grep -i "cf-cache"
curl -sI https://luzerge.com/js/app.js | grep -i "cf-cache"
curl -sI https://luzerge.com/ | grep -i "cf-cache"
```

---

## 2. Performance Testing

### Core Web Vitals Check

```bash
# Google PageSpeed Insights (CLI equivalent)
npx lighthouse https://luzerge.com --output=json --only-categories=performance

# Target scores:
#   Performance:    > 90
#   Accessibility:  > 90
#   Best Practices: > 90
#   SEO:            > 90
```

### Latency Testing from Multiple Locations

```bash
# WebPageTest (free) — test from Singapore closest to Cebu
# https://www.webpagetest.org/
# Location: Singapore — Chrome — 3G Fast connection
# Metrics to capture:
#   Time to First Byte (TTFB): < 200ms
#   First Contentful Paint:    < 1.0s
#   Largest Contentful Paint:  < 2.5s
#   Speed Index:               < 3.4s

# Quick curl timing
curl -w "@curl-format.txt" -o /dev/null -s https://luzerge.com
```

Create `curl-format.txt`:
```text
     time_namelookup:  %{time_namelookup}s\n
        time_connect:  %{time_connect}s\n
     time_appconnect:  %{time_appconnect}s\n
    time_pretransfer:  %{time_pretransfer}s\n
       time_redirect:  %{time_redirect}s\n
  time_starttransfer:  %{time_starttransfer}s\n
                     ----------\n
          time_total:  %{time_total}s\n
```

### Stress Test (Use responsibly — test environment only)

```bash
# Install hey (HTTP load generator)
# macOS: brew install hey
# Windows: download from github.com/rakyll/hey

# Light stress test — 100 requests, 10 concurrent
hey -n 100 -c 10 https://luzerge.com/

# API stress test
hey -n 50 -c 5 -m POST \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@test.com","message":"hello"}' \
  https://luzerge.com/api/contact
```

---

## 3. Supabase Monitoring

### Dashboard Metrics

```text
Supabase → Project → Reports

Monitor:
  Database:
    - Active connections (free tier limit: 60)
    - Database size (free tier limit: 500MB)
    - Query performance (slow query log)

  Storage:
    - Bucket size (free tier limit: 1GB)
    - Transfer usage

  Edge Functions:
    - Invocation count (free: 500K/month)
    - Execution time
    - Error rate

  API:
    - Request count (free: 500K/month)
    - Response time p50/p95
```

### Database Query Performance

```sql
-- Check slow queries in Supabase SQL Editor
SELECT
  query,
  calls,
  total_time / calls AS avg_time_ms,
  rows / calls AS avg_rows
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 20;

-- Check table sizes
SELECT
  table_name,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC;

-- Check active connections
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
```

### Supabase Usage Alerts

```bash
# Check usage via Supabase Management API
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_ID/usage"
```

---

## 4. Uptime Monitoring (Free Tools)

### Better Uptime / UptimeRobot

```text
1. Go to uptimerobot.com → Create Free Account
2. Add New Monitor:
   Monitor Type: HTTPS
   URL: https://luzerge.com
   Monitoring Interval: 5 minutes
   Alert Contacts: luzergeservices@gmail.com

3. Add endpoint monitors:
   https://luzerge.com/          → Main site
   https://luzerge.com/api/ping  → API health check
```

**API Health Check endpoint** (add to edge function):
```typescript
// Returns 200 OK with timestamp
if (req.method === 'GET' && url.pathname === '/api/ping') {
  return new Response(JSON.stringify({ status: 'ok', ts: Date.now() }), {
    headers: { 'Content-Type': 'application/json' }
  })
}
```

### Cloudflare Health Checks (Free)

```text
Cloudflare → Traffic → Health Checks → Create Health Check
  Name: luzerge-origin-check
  URL: https://luzerge.com/api/ping
  Type: HTTPS
  Interval: 60 seconds
  Retries: 2
  Expected Status: 200
  Notification: Email on failure
```

---

## 5. Monthly Performance Report Template

Run this checklist monthly and share with clients:

```text
LUZERGE.COM — MONTHLY PERFORMANCE REPORT
Month: [MONTH YEAR]
Generated: [DATE]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

UPTIME
  Target:   99.9% (< 43 min downtime/month)
  Actual:   [X]%
  Incidents: [list any]

CDN PERFORMANCE
  Cache Hit Rate:     [X]%    (target: > 85%)
  Bandwidth Saved:    [X] GB  (vs origin serving)
  Threats Blocked:    [X]     (WAF + bot protection)
  Edge Requests:      [X]

SPEED (PageSpeed Insights — Mobile)
  Performance Score:  [X]/100  (target: > 85)
  LCP:                [X]s     (target: < 2.5s)
  FID:                [X]ms    (target: < 100ms)
  CLS:                [X]      (target: < 0.1)
  TTFB (Philippines): [X]ms   (target: < 200ms)

ANALYTICS (Google Analytics)
  Sessions:        [X]
  Unique Users:    [X]
  Bounce Rate:     [X]%
  Top Pages:       [list top 5]
  Traffic Source:  [Organic/Social/Direct breakdown]

SUPABASE USAGE
  Database Size:   [X] MB / 500 MB
  API Requests:    [X] / 500,000
  Storage:         [X] MB / 1,000 MB
  Edge Invocations:[X] / 500,000

LEADS GENERATED
  Contact Form Submissions: [X]
  Email Inquiries:          [X]
  Conversion Rate:          [X]%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECOMMENDATIONS FOR NEXT MONTH:
[List any optimizations, needed upgrades, content suggestions]
```

---

## 6. Alerting Setup (GitHub Actions — Automated)

Add to `.github/workflows/monitor.yml` for weekly automated checks:

```yaml
name: Weekly Performance Check
on:
  schedule:
    - cron: '0 0 * * 1'  # Every Monday at midnight UTC

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Check site uptime
        run: |
          STATUS=$(curl -o /dev/null -s -w "%{http_code}" https://luzerge.com)
          if [ "$STATUS" != "200" ]; then
            echo "ALERT: Site returned $STATUS"
            exit 1
          fi
          echo "Site is up: $STATUS"

      - name: Check cache hit on static asset
        run: |
          CF_STATUS=$(curl -sI https://luzerge.com/css/styles.css | grep -i cf-cache-status | awk '{print $2}')
          echo "Cache status: $CF_STATUS"

      - name: Check API health
        run: |
          curl -f https://luzerge.com/api/ping || exit 1
```

---

## 7. Useful Commands Quick Reference

```bash
# Check DNS propagation
dig luzerge.com @1.1.1.1

# Check SSL certificate
echo | openssl s_client -connect luzerge.com:443 2>/dev/null | openssl x509 -noout -dates

# Purge Cloudflare cache manually
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'

# Check Supabase function logs
supabase functions logs api --tail

# Test contact form
curl -X POST https://luzerge.com/api/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","message":"Hello from Cebu!"}'

# Measure TTFB
curl -w "TTFB: %{time_starttransfer}s\nTotal: %{time_total}s\n" \
  -o /dev/null -s https://luzerge.com
```
