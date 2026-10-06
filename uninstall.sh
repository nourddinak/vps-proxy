#!/usr/bin/env bash
# ==============================================================================
# VPS Proxy Automated Uninstaller
# Stops PM2 service, cleans firewall rules, and deletes installation files
# Supports:
# 1. Local execution: ./uninstall.sh
# 2. Remote one-liner:
#    bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/vps-proxy/main/uninstall.sh)
# ==============================================================================

set -euo pipefail

# Check root or sudo
if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This uninstall script must be run as root or with sudo."
  exit 1
fi

echo "=================================================="
echo "      VPS Dual-Protocol Proxy Uninstaller        "
echo "=================================================="

INSTALL_DIR="${INSTALL_DIR:-/opt/vps-proxy}"
HTTP_PORT="8080"
SOCKS5_PORT="1080"

# Read configured ports from .env if available
if [ -f "${INSTALL_DIR}/.env" ]; then
  HTTP_PORT=$(grep '^HTTP_PORT=' "${INSTALL_DIR}/.env" | cut -d'=' -f2 | tr -d '\r' || echo "8080")
  SOCKS5_PORT=$(grep '^SOCKS5_PORT=' "${INSTALL_DIR}/.env" | cut -d'=' -f2 | tr -d '\r' || echo "1080")
elif [ -f "./.env" ]; then
  HTTP_PORT=$(grep '^HTTP_PORT=' .env | cut -d'=' -f2 | tr -d '\r' || echo "8080")
  SOCKS5_PORT=$(grep '^SOCKS5_PORT=' .env | cut -d'=' -f2 | tr -d '\r' || echo "1080")
fi

# 1. Stop and remove PM2 process
if command -v pm2 >/dev/null 2>&1; then
  echo "[INFO] Stopping and deleting PM2 process 'vps-proxy'..."
  pm2 stop vps-proxy 2>/dev/null || true
  pm2 delete vps-proxy 2>/dev/null || true
  pm2 save 2>/dev/null || true
  echo "[INFO] PM2 process removed."
fi

# 2. Remove UFW and iptables firewall rules
if command -v ufw >/dev/null 2>&1; then
  if ufw status | grep -qw "active"; then
    echo "[INFO] Removing UFW firewall rules for port ${HTTP_PORT} and ${SOCKS5_PORT}..."
    ufw delete allow "${HTTP_PORT}/tcp" 2>/dev/null || true
    ufw delete allow "${SOCKS5_PORT}/tcp" 2>/dev/null || true
    ufw reload 2>/dev/null || true
    echo "[INFO] UFW firewall rules removed."
  fi
fi

if command -v iptables >/dev/null 2>&1; then
  iptables -D INPUT -p tcp --dport "${HTTP_PORT}" -j ACCEPT 2>/dev/null || true
  iptables -D INPUT -p tcp --dport "${SOCKS5_PORT}" -j ACCEPT 2>/dev/null || true
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save 2>/dev/null || true
  fi
fi

# 3. Remove application files
if [ -d "$INSTALL_DIR" ]; then
  echo "[INFO] Removing installation directory: $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
  echo "[INFO] Installation files removed."
fi

# Also clean local directory if running from an existing local folder
if [ -f "./package.json" ] && [ -f "./ecosystem.config.cjs" ] && [ "$(pwd)" != "$INSTALL_DIR" ]; then
  echo "[INFO] Local repository files detected at $(pwd). Application has been unregistered from PM2."
fi

echo ""
echo "=================================================="
echo "     Proxy Uninstallation Complete!              "
echo "=================================================="
echo "The VPS proxy service, PM2 task, firewall rules,"
echo "and files have been cleanly removed."
echo "=================================================="
