#!/usr/bin/env bash
# ==============================================================================
# VPS Proxy Automated Setup Script
# Prompts user for credentials and ports, creates .env automatically,
# installs Node.js & PM2, configures firewall, and starts service.
# Supports:
# 1. Local execution inside cloned directory: ./setup.sh
# 2. Remote one-liner execution:
#    bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/vps-proxy/main/setup.sh)
# ==============================================================================

set -euo pipefail

# Check root or sudo
if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This setup script must be run as root or with sudo."
  exit 1
fi

echo "=================================================="
echo "    VPS Dual-Protocol Proxy Installer (PM2)"
echo "=================================================="

# Detect package manager
PKG_MGR=""
if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG_MGR="yum"
fi

# Detect application directory or clone if executed via remote pipe/subshell
REPO_URL="${REPO_URL:-https://github.com/nourddinak/vps-proxy.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-proxy}"

if [ -f "./package.json" ] && [ -f "./ecosystem.config.cjs" ]; then
  APP_DIR="$(pwd)"
elif [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/package.json" ]; then
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  APP_DIR="$INSTALL_DIR"
  echo "[INFO] Remote execution detected. Setting up repository in ${APP_DIR}..."

  if ! command -v git >/dev/null 2>&1; then
    echo "[INFO] Installing git..."
    if [ "$PKG_MGR" = "apt" ]; then
      apt-get update -y && apt-get install -y git
    elif [ "$PKG_MGR" = "dnf" ] || [ "$PKG_MGR" = "yum" ]; then
      $PKG_MGR install -y git
    fi
  fi

  if [ -d "$APP_DIR/.git" ]; then
    echo "[INFO] Updating existing repository in ${APP_DIR}..."
    git -C "$APP_DIR" pull --ff-only || true
  else
    mkdir -p "$APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
  fi
fi

cd "$APP_DIR"
echo "[INFO] Working directory: $(pwd)"

# Helper for interactive prompts (reads from /dev/tty even when executed via pipe)
prompt_input() {
  local prompt_text="$1"
  local default_val="$2"
  local user_val=""

  if [ -e /dev/tty ] && [ "${NON_INTERACTIVE:-false}" != "true" ] && [ "${CI:-false}" != "true" ]; then
    read -r -p "$prompt_text" user_val </dev/tty || true
  fi

  if [ -z "$user_val" ]; then
    echo "$default_val"
  else
    echo "$user_val"
  fi
}

# 1. Interactive configuration & .env generation
echo ""
echo "--- Configuration Setup ---"

RECONFIGURE=true
if [ -f .env ]; then
  EXISTING_USER=$(grep '^PROXY_USER=' .env | cut -d'=' -f2 | tr -d '\r' || echo "admin")
  EXISTING_HTTP=$(grep '^HTTP_PORT=' .env | cut -d'=' -f2 | tr -d '\r' || echo "8080")
  EXISTING_SOCKS=$(grep '^SOCKS5_PORT=' .env | cut -d'=' -f2 | tr -d '\r' || echo "1080")
  echo "[INFO] Existing .env found (User: ${EXISTING_USER}, HTTP: ${EXISTING_HTTP}, SOCKS5: ${EXISTING_SOCKS})."
  ASK_RECONFIG=$(prompt_input "Do you want to reconfigure proxy settings? [y/N]: " "n")
  if [[ ! "$ASK_RECONFIG" =~ ^[Yy]$ ]]; then
    RECONFIGURE=false
    echo "[INFO] Keeping existing .env configuration."
  fi
fi

if [ "$RECONFIGURE" = "true" ]; then
  CHOSEN_USER=$(prompt_input "Enter proxy username [default: admin]: " "admin")

  AUTO_PASS=$(openssl rand -hex 12 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom 2>/dev/null | head -c 24 || echo "SecurePass$(date +%s)")
  CHOSEN_PASS=$(prompt_input "Enter proxy password [press Enter to auto-generate: ${AUTO_PASS}]: " "$AUTO_PASS")

  CHOSEN_HTTP_PORT=$(prompt_input "Enter HTTP/HTTPS proxy port [default: 8080]: " "8080")
  CHOSEN_SOCKS5_PORT=$(prompt_input "Enter SOCKS5 proxy port [default: 1080]: " "1080")
  CHOSEN_ALLOWED_IPS=$(prompt_input "Enter allowed client IPs (comma-separated, press Enter for all): " "")

  cat <<EOF > .env
# Server Binding
BIND_HOST=0.0.0.0
HTTP_PORT=${CHOSEN_HTTP_PORT}
SOCKS5_PORT=${CHOSEN_SOCKS5_PORT}

# Primary Authentication Credentials
PROXY_USER=${CHOSEN_USER}
PROXY_PASS=${CHOSEN_PASS}

# Optional: Multiple users (comma-separated username:password pairs)
# PROXY_USERS=admin:pass1,user2:pass2

# Optional: Restrict access to specific client IP addresses (comma-separated)
ALLOWED_IPS=${CHOSEN_ALLOWED_IPS}

# Logging level: info | debug | error | silent
LOG_LEVEL=info
EOF
  chmod 600 .env
  echo "[INFO] Successfully created .env file."
fi

# 2. Install Node.js LTS if missing
echo ""
echo "--- System & Dependency Verification ---"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 18 ]; then
  echo "[INFO] Installing Node.js LTS..."
  if [ "$PKG_MGR" = "apt" ]; then
    apt-get update -y
    apt-get install -y curl ca-certificates gnupg
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
    NODE_MAJOR=20
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    apt-get install -y nodejs
  elif [ "$PKG_MGR" = "dnf" ] || [ "$PKG_MGR" = "yum" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    $PKG_MGR install -y nodejs
  else
    echo "[ERROR] Unsupported package manager. Please install Node.js (v18+) manually."
    exit 1
  fi
fi

echo "[INFO] Node.js version: $(node -v)"
echo "[INFO] NPM version: $(npm -v)"

# 3. Install PM2 globally if missing
if ! command -v pm2 >/dev/null 2>&1; then
  echo "[INFO] Installing PM2 globally..."
  npm install -g pm2
fi
echo "[INFO] PM2 version: $(pm2 -v)"

# 4. Install Project Dependencies
echo "[INFO] Installing proxy project dependencies..."
npm install --omit=dev

# 5. Configure Firewall (UFW if enabled)
HTTP_PORT=$(grep '^HTTP_PORT=' .env | cut -d'=' -f2 | tr -d '\r' || echo "8080")
SOCKS5_PORT=$(grep '^SOCKS5_PORT=' .env | cut -d'=' -f2 | tr -d '\r' || echo "1080")

if command -v ufw >/dev/null 2>&1; then
  if ufw status | grep -qw "active"; then
    echo "[INFO] UFW firewall active. Opening port ${HTTP_PORT}/tcp and ${SOCKS5_PORT}/tcp..."
    ufw allow "${HTTP_PORT}/tcp" comment "VPS HTTP Proxy"
    ufw allow "${SOCKS5_PORT}/tcp" comment "VPS SOCKS5 Proxy"
    ufw reload
  fi
fi

# 6. Start / Reload with PM2
echo "[INFO] Starting proxy service with PM2..."
pm2 delete vps-proxy 2>/dev/null || true
pm2 start ecosystem.config.cjs

# 7. Enable PM2 Startup on Boot
echo "[INFO] Configuring PM2 system boot persistence..."
pm2 startup systemd -u root --hp /root || true
pm2 save

# 8. Detection and Summary
SERVER_IP=$(curl -s --max-time 3 https://api.ipify.org || curl -s --max-time 3 https://ifconfig.me || echo "YOUR_VPS_IP")
PROXY_USER=$(grep '^PROXY_USER=' .env | cut -d'=' -f2 | tr -d '\r' || echo "admin")
PROXY_PASS=$(grep '^PROXY_PASS=' .env | cut -d'=' -f2 | tr -d '\r' || echo "password")

echo ""
echo "=================================================="
echo "    VPS Proxy Setup Successfully Completed!     "
echo "=================================================="
echo "Status: Running via PM2"
echo ""
echo "Connection Details:"
echo "  VPS Public IP : ${SERVER_IP}"
echo "  Username      : ${PROXY_USER}"
echo "  Password      : ${PROXY_PASS}"
echo ""
echo "Endpoints:"
echo "  HTTP/HTTPS    : http://${PROXY_USER}:${PROXY_PASS}@${SERVER_IP}:${HTTP_PORT}"
echo "  SOCKS5        : socks5://${PROXY_USER}:${PROXY_PASS}@${SERVER_IP}:${SOCKS5_PORT}"
echo ""
echo "Testing commands (run from your local machine):"
echo "  HTTP Proxy    : curl -x http://${PROXY_USER}:${PROXY_PASS}@${SERVER_IP}:${HTTP_PORT} https://api.ipify.org"
echo "  SOCKS5 Proxy  : curl --socks5 ${PROXY_USER}:${PROXY_PASS}@${SERVER_IP}:${SOCKS5_PORT} https://api.ipify.org"
echo ""
echo "PM2 Commands:"
echo "  Check Status  : pm2 status"
echo "  View Logs     : pm2 logs vps-proxy"
echo "  Restart       : pm2 restart vps-proxy"
echo "  Stop          : pm2 stop vps-proxy"
echo "=================================================="
