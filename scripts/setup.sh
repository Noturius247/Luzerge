#!/usr/bin/env bash
# ============================================================
# Luzerge.com — One-Time Setup Script
# Run: bash scripts/setup.sh
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*" >&2; exit 1; }

echo -e "\n${BOLD}Luzerge.com Setup Script${NC}"
echo "=============================="

# ─── 1. Check required tools ────────────────────────────────────────────────

info "Checking required tools..."

command -v git    >/dev/null 2>&1 || error "git is not installed. Install from: https://git-scm.com"
command -v node   >/dev/null 2>&1 || error "node is not installed. Install from: https://nodejs.org"
command -v npm    >/dev/null 2>&1 || error "npm is not installed (comes with node)"
command -v curl   >/dev/null 2>&1 || error "curl is not installed"

success "All required tools found"

# ─── 2. Install Supabase CLI ─────────────────────────────────────────────────

info "Installing/updating Supabase CLI..."
if command -v supabase >/dev/null 2>&1; then
  SUPABASE_VER=$(supabase --version 2>&1 | head -1)
  success "Supabase CLI already installed: $SUPABASE_VER"
else
  npm install -g supabase
  success "Supabase CLI installed"
fi

# ─── 3. Install Wrangler (Cloudflare Workers CLI) ────────────────────────────

info "Installing/updating Wrangler CLI..."
if command -v wrangler >/dev/null 2>&1; then
  success "Wrangler already installed: $(wrangler --version 2>&1 | head -1)"
else
  npm install -g wrangler
  success "Wrangler installed"
fi

# ─── 4. Create .env.local if not exists ─────────────────────────────────────

if [ ! -f ".env.local" ]; then
  info "Creating .env.local template..."
  cat > .env.local << 'ENVEOF'
# Supabase
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

# Cloudflare
CLOUDFLARE_ZONE_ID=YOUR_ZONE_ID
CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN

# Email (Resend)
RESEND_API_KEY=re_YOUR_KEY
NOTIFICATION_EMAIL=luzergeservices@gmail.com
ENVEOF
  warn ".env.local created — fill in your credentials before proceeding"
else
  success ".env.local already exists"
fi

# ─── 5. Set up .gitignore ────────────────────────────────────────────────────

if ! grep -q ".env.local" .gitignore 2>/dev/null; then
  info "Adding .env.local to .gitignore..."
  cat >> .gitignore << 'GITIGNEOF'

# Environment secrets — NEVER commit these
.env.local
.env.*.local
.env

# Supabase local dev
supabase/.branches
supabase/.temp

# Build outputs
dist/
build/
.cache/

# Node
node_modules/

# OS
.DS_Store
Thumbs.db
GITIGNEOF
  success ".gitignore updated"
fi

# ─── 6. Supabase login check ─────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Next Steps:${NC}"
echo "──────────────────────────────────────────"
echo ""
echo "1. Fill in .env.local with your credentials"
echo ""
echo "2. Login to Supabase:"
echo "   supabase login"
echo ""
echo "3. Link your project:"
echo "   supabase link --project-ref YOUR_PROJECT_REF"
echo ""
echo "4. Push database migrations:"
echo "   supabase db push --password YOUR_DB_PASSWORD"
echo ""
echo "5. Deploy edge functions:"
echo "   supabase functions deploy api"
echo ""
echo "6. Login to Cloudflare Workers:"
echo "   wrangler login"
echo ""
echo "7. Deploy Cloudflare Worker:"
echo "   cd cloudflare && wrangler deploy"
echo ""
echo "8. Add GitHub repository secrets (see docs/SETUP_GUIDE.md)"
echo ""
echo "9. Push to main branch to trigger first deployment:"
echo "   git add . && git commit -m 'feat: initial setup' && git push origin main"
echo ""
echo -e "${GREEN}Setup complete! Follow the steps above to go live.${NC}"
