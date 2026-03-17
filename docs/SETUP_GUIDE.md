# Step-by-Step Setup Guide

Complete setup from zero to a live, CDN-powered site at luzerge.com.

---

## Phase 1: Domain & Cloudflare (Day 1)

### 1.1 Register Domain via Cloudflare Registrar

```text
1. Go to https://dash.cloudflare.com
2. Create a free account (email + password)
3. Left sidebar → Domain Registration → Register Domains
4. Search: luzerge.com
5. Add to cart → Checkout
   - Price: ~$8.57/yr (at-cost, no markup)
   - Payment: Credit card or PayPal
6. Domain is registered AND added to Cloudflare automatically
```

### 1.2 Add Site to Cloudflare (if registered elsewhere)

```text
1. Cloudflare Dashboard → Add a Site → Enter luzerge.com
2. Select Free plan → Continue
3. Cloudflare scans existing DNS records
4. Review records → Continue
5. Copy the two nameservers shown, e.g.:
   ns1.cloudflare.com
   ns2.cloudflare.com
6. Go to your registrar (Namecheap/GoDaddy) → Domain → Custom Nameservers
7. Replace existing nameservers with Cloudflare's
8. Wait 1–48 hours for propagation
9. Cloudflare sends email when active
```

### 1.3 Verify DNS Propagation

```bash
# Run from terminal
nslookup luzerge.com 1.1.1.1
dig luzerge.com @1.1.1.1

# Expected output: Cloudflare IP addresses
# 104.21.x.x or 172.67.x.x
```

---

## Phase 2: GitHub Repository (Day 1)

### 2.1 Create Repository

```bash
# On GitHub.com:
# 1. Click + → New repository
# 2. Name: luzerge.com
# 3. Visibility: Private (to protect client code)
# 4. Initialize with README: YES
# 5. Add .gitignore: Node
# 6. Create repository

# Clone locally
git clone https://github.com/YOUR_USERNAME/luzerge.com.git
cd luzerge.com
```

### 2.2 Set Branch Protection

```text
GitHub → Repository → Settings → Branches → Add rule
  Branch name pattern: main
  ✅ Require pull request reviews before merging
  ✅ Require status checks to pass (after adding Actions)
  ✅ Restrict who can push to matching branches
```

### 2.3 Add Repository Secrets

```text
GitHub → Repository → Settings → Secrets and variables → Actions

Add the following secrets:
  SUPABASE_ACCESS_TOKEN    → from supabase.com/dashboard/account/tokens
  SUPABASE_PROJECT_ID      → from project settings URL
  SUPABASE_DB_PASSWORD     → your project database password
  CLOUDFLARE_API_TOKEN     → from Cloudflare → My Profile → API Tokens
  CLOUDFLARE_ZONE_ID       → from Cloudflare → your domain → Overview (right sidebar)
```

**Create Cloudflare API Token:**
```text
Cloudflare → My Profile → API Tokens → Create Token
Use template: "Edit zone DNS" or create custom:
  Permissions:
    Zone → Cache Purge → Purge
    Zone → Zone → Read
  Zone Resources: Include → Specific zone → luzerge.com
```

---

## Phase 3: Supabase Project (Day 1–2)

### 3.1 Create Supabase Project

```text
1. Go to https://supabase.com → Sign in with GitHub
2. New Project:
   - Organization: your-org
   - Name: luzerge-prod
   - Database Password: [generate strong password — SAVE IT]
   - Region: Southeast Asia (Singapore)  ← critical for Cebu latency
   - Plan: Free
3. Wait ~2 minutes for provisioning
4. Copy Project URL and anon key from Settings → API
```

### 3.2 Install Supabase CLI

```bash
# macOS / Linux
brew install supabase/tap/supabase

# Windows (via npm)
npm install -g supabase

# Verify
supabase --version
```

### 3.3 Initialize and Link Project

```bash
# In your project directory
supabase init

# Login
supabase login
# → Opens browser, authorize with GitHub

# Link to your project
supabase link --project-ref <YOUR_PROJECT_REF>
# Project ref is in the URL: supabase.com/dashboard/project/[PROJECT_REF]
```

### 3.4 Run Database Migrations

```bash
# Apply all migrations to remote
supabase db push

# Verify tables exist
supabase db remote changes

# Connect to DB directly (optional)
supabase db execute --command "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
```

### 3.5 Configure Row Level Security

```sql
-- Run in Supabase SQL Editor
-- Enable RLS on all tables
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Allow insert from anon (public contact forms)
CREATE POLICY "Allow public inserts on leads"
ON leads FOR INSERT
TO anon
WITH CHECK (true);

-- Only service_role can read leads
CREATE POLICY "Service role reads leads"
ON leads FOR SELECT
TO service_role
USING (true);
```

### 3.6 Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy api

# Set environment variables for functions
supabase secrets set RESEND_API_KEY=re_xxxxx
supabase secrets set NOTIFICATION_EMAIL=luzergeservices@gmail.com

# Test function locally
supabase functions serve api --env-file .env.local
```

---

## Phase 4: Frontend Deployment (Day 2)

### 4.1 Static Site via Supabase Storage

```bash
# Build your static site
npm run build   # or just use src/ directly

# Upload to Supabase Storage
supabase storage cp --recursive dist/ ss:///public-site/

# Make bucket public (for CDN access)
# Supabase Dashboard → Storage → New Bucket
#   Name: public-site
#   Public bucket: YES
```

### 4.2 Alternative: GitHub Pages (Free, Simpler)

```bash
# In repository settings
# GitHub → Settings → Pages
# Source: Deploy from branch
# Branch: main  /docs  or  main  /
# Custom domain: luzerge.com
# Enforce HTTPS: YES (after Cloudflare is set up)

# Add CNAME file in repo root
echo "luzerge.com" > CNAME
```

**Cloudflare DNS for GitHub Pages:**
```text
Type    Name    Content                    Proxy
──────  ──────  ─────────────────────────  ──────
A       @       185.199.108.153            ON
A       @       185.199.109.153            ON
A       @       185.199.110.153            ON
A       @       185.199.111.153            ON
CNAME   www     YOUR_USERNAME.github.io    ON
```

---

## Phase 5: Configure SSL and Caching (Day 2)

### 5.1 SSL Setup

```text
Cloudflare → SSL/TLS → Overview
  Mode: Full (Strict)

Cloudflare → SSL/TLS → Edge Certificates
  Always Use HTTPS: ON
  HTTP Strict Transport Security (HSTS): ON
    Max-Age: 15768000 (6 months)
    Include Subdomains: ON
    Preload: ON
  Minimum TLS Version: TLS 1.2
  TLS 1.3: ON
  Automatic HTTPS Rewrites: ON
```

### 5.2 Cache Rules Setup

```text
Cloudflare → Rules → Cache Rules → Create Rule

Rule 1: Static Assets
  Name: "Cache static assets"
  If: File extension in {css, js, jpg, jpeg, png, gif, svg, ico, woff, woff2}
  Then:
    Cache eligibility: Eligible for cache
    Browser TTL: Override → 31536000 (1 year)
    Edge TTL: Override → 2592000 (30 days)

Rule 2: Bypass API
  Name: "Bypass API cache"
  If: URI Path starts with "/api/"
     OR URI Path starts with "/auth/"
     OR URI Path starts with "/storage/"
  Then:
    Cache eligibility: Bypass cache
```

### 5.3 Test SSL and Cache Headers

```bash
# Check SSL grade (should be A or A+)
curl -I https://luzerge.com

# Check cache status header
curl -I https://luzerge.com/css/styles.css
# Look for: CF-Cache-Status: HIT or MISS

# Full header inspection
curl -v https://luzerge.com 2>&1 | grep -E "(HTTP|cache|CF-|x-|content)"
```

---

## Phase 6: GitHub Actions CI/CD (Day 3)

### 6.1 Trigger First Deployment

```bash
# Commit and push your code
git add .
git commit -m "feat: initial site setup"
git push origin main

# Watch the action run
# GitHub → Actions → latest workflow run
```

### 6.2 Verify Deployment

```bash
# Check if site is live
curl -I https://luzerge.com
# Expected: HTTP/2 200

# Check Cloudflare cache status
curl -I https://luzerge.com/css/styles.css
# Expected: CF-Cache-Status: HIT (after first request)

# Run CDN test script
bash scripts/test-cdn.sh
```

---

## Phase 7: Business Email Setup (Day 3–4)

### Option A: Cloudflare Email Routing (Free)

```text
Cloudflare → Email → Email Routing → Enable

Add address:
  Custom address: luzergeservices@gmail.com
  Action: Forward to → your-personal@gmail.com

This is FREE — no email server needed, forwards to Gmail.
```

Cloudflare auto-adds required MX and SPF records.

### Option B: Zoho Mail (Free tier, 5 users)

```text
1. Go to zoho.com/mail → Sign Up → Business Email
2. Enter luzerge.com → Choose Free plan (5 users)
3. Verify domain via TXT record in Cloudflare
4. Add MX records Zoho provides (DNS-only, grey cloud):
   Type  Name  Content                    Priority
   MX    @     mx.zoho.com                10
   MX    @     mx2.zoho.com               20
5. Create luzergeservices@gmail.com
```

### Option C: Google Workspace (₱300/mo per user, best UX)

```text
1. workspace.google.com → Get Started
2. Enter luzerge.com
3. Verify domain via TXT record
4. Add Google MX records to Cloudflare
5. Professional Gmail interface at your domain
```

---

## Phase 8: Analytics & SEO (Day 4–5)

### 8.1 Google Analytics 4

```bash
# In src/index.html, add before </head>:
# Replace G-XXXXXXXXXX with your Measurement ID
```

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

### 8.2 Google Search Console

```text
1. search.google.com/search-console → Add property
2. Select: Domain → Enter luzerge.com
3. Verify via DNS TXT record (add in Cloudflare → DNS-only)
4. Submit sitemap: https://luzerge.com/sitemap.xml
```

### 8.3 Cloudflare Web Analytics (Privacy-friendly, Free)

```text
Cloudflare → Web Analytics → Add Site → luzerge.com
Copy the JS snippet → add to index.html
No cookies, GDPR-compliant, shows Core Web Vitals
```

### 8.4 SEO Checklist

```text
[ ] Title tags on all pages (50–60 chars)
[ ] Meta descriptions (150–160 chars)
[ ] Open Graph tags for social sharing
[ ] robots.txt at luzerge.com/robots.txt
[ ] XML sitemap at luzerge.com/sitemap.xml
[ ] Schema.org markup (LocalBusiness for Cebu)
[ ] Core Web Vitals: LCP < 2.5s, FID < 100ms, CLS < 0.1
[ ] Mobile-responsive (Google Mobile-Friendly Test)
[ ] Page speed score > 90 (PageSpeed Insights)
```

---

## Quick Reference: Environment Variables

```bash
# .env.local (never commit this file!)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...   # server-side only!
CLOUDFLARE_ZONE_ID=abc123
CLOUDFLARE_API_TOKEN=xxx
RESEND_API_KEY=re_xxx
NOTIFICATION_EMAIL=luzergeservices@gmail.com
```

Add `.env.local` to `.gitignore` — never commit secrets.
