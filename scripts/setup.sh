#!/usr/bin/env bash
#
# Debian/Ubuntu setup for pi-chatbot (native install).
#
# Usage:
#   bash scripts/setup.sh
#
# Non-interactive: provide values via env vars and the script won't prompt.
#   POSTGRES_URL=postgres://user:pass@host:5432/db \
#   BRAVE_API_KEY=xxxx \
#   bash scripts/setup.sh
#
# Re-running is safe (idempotent): an existing .env.local is left untouched.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ----- 1. System prerequisites -------------------------------------------------
info "Checking system prerequisites"

missing_pkgs=()
need_apt() { command -v "$1" >/dev/null 2>&1 || missing_pkgs+=("$2"); }
need_apt curl curl
need_apt python3 python3
need_apt git git

if [ "${#missing_pkgs[@]}" -gt 0 ]; then
  warn "Missing: ${missing_pkgs[*]}"
  if command -v apt-get >/dev/null 2>&1; then
    info "Installing missing packages via apt-get (needs sudo)"
    sudo apt-get update -y
    sudo apt-get install -y "${missing_pkgs[@]}"
  else
    die "Please install: ${missing_pkgs[*]}"
  fi
fi

# Node.js >= 20
if ! command -v node >/dev/null 2>&1; then
  die "Node.js is not installed. Install Node 20+ first, e.g.:
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required (found $(node -v))."
info "Node $(node -v) OK"

# pnpm via corepack (no sudo)
if ! command -v pnpm >/dev/null 2>&1; then
  info "Enabling pnpm via corepack"
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate >/dev/null 2>&1 || \
    die "Could not enable pnpm. Install it: npm i -g pnpm"
fi
info "pnpm $(pnpm -v) OK"

# ----- 2. Dependencies ---------------------------------------------------------
info "Installing dependencies"
pnpm install --frozen-lockfile

# ----- 3. Environment ----------------------------------------------------------
if [ -f .env.local ]; then
  info ".env.local already exists — leaving it untouched"
else
  info "Creating .env.local"

  AUTH_SECRET_VALUE="${AUTH_SECRET:-$(openssl rand -base64 32)}"

  if [ -z "${POSTGRES_URL:-}" ]; then
    if [ -t 0 ]; then
      read -r -p "POSTGRES_URL (postgres://user:pass@host:5432/db): " POSTGRES_URL
    fi
  fi
  [ -n "${POSTGRES_URL:-}" ] || die "POSTGRES_URL is required (set it as an env var or enter it when prompted)."

  if [ -z "${BRAVE_API_KEY:-}" ]; then
    if [ -t 0 ]; then
      read -r -p "BRAVE_API_KEY (blank to skip web search): " BRAVE_API_KEY
    fi
  fi

  {
    echo "AUTH_SECRET=${AUTH_SECRET_VALUE}"
    echo "POSTGRES_URL=${POSTGRES_URL}"
    [ -n "${BRAVE_API_KEY:-}" ] && echo "BRAVE_API_KEY=${BRAVE_API_KEY}"
    [ -n "${REDIS_URL:-}" ] && echo "REDIS_URL=${REDIS_URL}"
  } > .env.local
  chmod 600 .env.local
  info "Wrote .env.local (chmod 600)"
fi

# ----- 4. Database migrations --------------------------------------------------
info "Running database migrations"
pnpm db:migrate

# ----- 5. Build ----------------------------------------------------------------
info "Building the app"
pnpm build

cat <<EOF

$(info "Setup complete.")

Start the app:
  pnpm start            # serves on http://localhost:3000

Run as a service (systemd):
  see deploy/pi-chatbot.service and INSTALL.md

Web search is provided by the bundled skill in ./skills/brave-search
(it just needs BRAVE_API_KEY in .env.local). python3 + curl are required at runtime.
EOF
