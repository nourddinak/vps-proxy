# VPS Dual-Protocol Proxy (HTTP/HTTPS CONNECT & SOCKS5)

A production-ready, dual-protocol forward proxy server managed with **PM2** on Linux VPS instances.

## Features

- **Dual-Protocol Support**:
  - **HTTP/HTTPS CONNECT Proxy** (Default Port: `8080`): Handles regular HTTP requests and encrypted HTTPS tunneling with standard `407 Proxy Authentication Required` challenges.
  - **SOCKS5 Proxy** (Default Port: `1080`): Fully compliant with RFC 1928 and RFC 1929 username/password authentication (Method `0x02`), routing raw TCP streams to IPv4, domain names, and IPv6.
- **Access Control & Security**:
  - Single and multi-user credential authentication via `.env`.
  - Constant-time password verification preventing timing side-channel attacks.
  - Optional client IP whitelisting (`ALLOWED_IPS`).
- **PM2 Process Management**:
  - Auto-restart on unexpected crashes or memory leaks (`max_memory_restart: 300M`).
  - Persistent background execution surviving VPS system reboots (`pm2 startup`).
  - Unified log aggregation (`logs/out.log` and `logs/err.log`).
- **Turnkey Automation**:
  - 1-command installer script for Ubuntu/Debian/RHEL VPS servers.
  - 1-command uninstaller script that completely removes PM2 tasks, firewall rules, and files.

---

## One-Line Quick Install

Run this single command on your clean VPS as `root` or with `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/nourddinak/vps-proxy/main/setup.sh | sudo bash
```
*(Or alternatively: `sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/nourddinak/vps-proxy/main/setup.sh)"`)*

> **Note:** If your GitHub repository name or branch differs, you can pass custom environment variables:
> ```bash
> curl -fsSL https://raw.githubusercontent.com/nourddinak/vps-proxy/main/setup.sh | sudo REPO_URL="https://github.com/nourddinak/vps-proxy.git" bash
> ```

The installer will automatically:
1. Install Node.js LTS (v20) and PM2 if not already present.
2. Clone the repository into `/opt/vps-proxy`.
3. Interactively prompt you for:
   - **Username** (defaults to `admin`)
   - **Password** (allows custom password or auto-generates a secure 24-character random password)
   - **HTTP & SOCKS5 Ports** (defaults to `8080` and `1080`)
   - **Allowed Client IPs** (optional whitelist or open to all)
4. Automatically write and secure your `.env` file (`chmod 600 .env`).
5. Install production dependencies (`npm install --omit=dev`).
6. Open ports `8080/tcp` and `1080/tcp` in `ufw` firewall (if enabled).
7. Start the proxy via PM2 and register systemd persistence across reboots.
8. Print your active VPS public IP, configured credentials, and sample `curl` test commands.

---

## One-Line Complete Uninstall

To completely stop the proxy, delete the PM2 task, remove firewall rules, and delete all installed files:

```bash
curl -fsSL https://raw.githubusercontent.com/nourddinak/vps-proxy/main/uninstall.sh | sudo bash
```
*(Or alternatively: `sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/nourddinak/vps-proxy/main/uninstall.sh)"`)*

---

## Alternative: Manual Clone & Setup

If you prefer to clone and configure the repository manually:

```bash
# 1. Clone repository
git clone https://github.com/nourddinak/vps-proxy.git /opt/vps-proxy
cd /opt/vps-proxy

# 2. Make scripts executable
chmod +x setup.sh uninstall.sh

# 3. Run setup
sudo ./setup.sh
```

Or step-by-step without the setup script:

```bash
# 1. Install Node.js (v18+) and PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# 2. Configure credentials
cp .env.example .env
nano .env   # Customize PROXY_USER and PROXY_PASS

# 3. Install dependencies
npm install --omit=dev

# 4. Open firewall ports (if using UFW)
sudo ufw allow 8080/tcp comment "HTTP Proxy"
sudo ufw allow 1080/tcp comment "SOCKS5 Proxy"

# 5. Start with PM2
pm2 start ecosystem.config.cjs

# 6. Save PM2 state for automatic reboot persistence
pm2 startup
pm2 save
```

---

## Configuration (`.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `BIND_HOST` | `0.0.0.0` | IP interface to listen on (`0.0.0.0` for all interfaces) |
| `HTTP_PORT` | `8080` | Port for HTTP and HTTPS CONNECT forward proxy |
| `SOCKS5_PORT` | `1080` | Port for RFC 1928 / RFC 1929 SOCKS5 proxy |
| `AUTH_REQUIRED` | `true` | Set to `false` for open proxy (no username/password needed) |
| `PROXY_USER` | `admin` | Default username for authentication |
| `PROXY_PASS` | `ChangeThisSecurePassword123!` | Default password for authentication |
| `PROXY_USERS` | *empty* | Optional multi-user list: `user1:pass1,user2:pass2` |
| `ALLOWED_IPS` | *empty* | Optional comma-separated IP whitelist (e.g. `198.51.100.5,203.0.113.12`) |
| `LOG_LEVEL` | `info` | Logging verbosity: `info`, `debug`, `error`, `silent` |

---

## Testing & Verifying Connections

Replace `YOUR_VPS_IP`, `username`, and `password` with your actual settings:

### Linux / macOS Terminal:
```bash
# Test HTTP/HTTPS Proxy
curl -x http://YOUR_VPS_IP:8080 -U "username:password" https://api.ipify.org?format=json

# Test SOCKS5 Proxy
curl --socks5 YOUR_VPS_IP:1080 --proxy-user "username:password" https://api.ipify.org?format=json
```

### Windows PowerShell (use `curl.exe` to bypass PowerShell's Invoke-WebRequest):
```powershell
# Test HTTP/HTTPS Proxy
curl.exe -x http://YOUR_VPS_IP:8080 -U "username:password" https://api.ipify.org?format=json

# Test SOCKS5 Proxy
curl.exe --socks5 YOUR_VPS_IP:1080 --proxy-user "username:password" https://api.ipify.org?format=json
```

> **Note on Passwords with Special Characters (e.g. `@`, `#`, `%`):**
> Using `-U "user:pass"` and `--proxy-user "user:pass"` handles special characters safely without URL syntax issues.

If successful, the response will display your **VPS public IP address**.

---

## PM2 Operational Commands

```bash
# Check service status and CPU/memory usage
pm2 status

# Stream live real-time connection logs
pm2 logs vps-proxy

# View recent log history
pm2 logs vps-proxy --lines 100

# Restart the proxy (e.g., after editing .env)
pm2 restart vps-proxy

# Stop the proxy
pm2 stop vps-proxy

# Delete the PM2 process registration
pm2 delete vps-proxy
```

---

## Client Configuration Guide

### Browser Setup (Chrome / Firefox / Edge)
Use an extension like **Proxy SwitchyOmega** or **FoxyProxy**:
- **Protocol**: HTTP or SOCKS5
- **Server**: `YOUR_VPS_IP`
- **Port**: `8080` (for HTTP) or `1080` (for SOCKS5)
- **Authentication**: Enable username and password

### Python (`requests`)
```python
import requests

proxies = {
    'http': 'http://admin:password@YOUR_VPS_IP:8080',
    'https': 'http://admin:password@YOUR_VPS_IP:8080',
}

response = requests.get('https://api.ipify.org?format=json', proxies=proxies)
print(response.json())
```

### Telegram Desktop / Mobile
- Go to **Settings** -> **Advanced** -> **Connection type** -> **Use custom proxy**
- Select **SOCKS5**
- Host: `YOUR_VPS_IP`
- Port: `1080` (or your configured SOCKS5 port)
- Username & Password: As configured in `.env`

---

### Mobile Devices (iOS & Android Wi-Fi Proxy)

#### iPhone & iPad (Native iOS Wi-Fi Settings)
iOS has built-in support for authenticated HTTP proxies:
1. Open **Settings** &rarr; **Wi-Fi**.
2. Tap the blue **(i)** info icon next to your connected Wi-Fi network.
3. Scroll down to the bottom and tap **Configure Proxy**.
4. Select **Manual**.
5. Fill in the details:
   - **Server**: `YOUR_VPS_IP`
   - **Port**: Your configured HTTP port (e.g., `4001` or `8080`)
   - **Authentication**: Toggle **ON**
   - **Username**: Your proxy username
   - **Password**: Your proxy password
6. Tap **Save** in the top right.
7. Open Safari and browse to `https://api.ipify.org` &mdash; your connection will now show your VPS IP!

#### Android (Native Wi-Fi Settings)
1. Open **Settings** &rarr; **Network & internet** &rarr; **Internet** (or **Wi-Fi**).
2. Tap the **gear icon** next to your active Wi-Fi network &rarr; tap the **Pencil / Edit icon**.
3. Expand **Advanced options** &rarr; under **Proxy**, choose **Manual**.
4. Fill in:
   - **Proxy hostname**: `YOUR_VPS_IP`
   - **Proxy port**: Your configured HTTP port (e.g., `4001` or `8080`)
   - **Bypass proxy for**: Leave default (or empty)
5. Tap **Save**.
6. When you open Chrome, Android will display a sign-in dialogue (*"Sign in to proxy server"*). Enter your configured username and password.

#### System-Wide & Mobile Data (4G / 5G / Wi-Fi)
If you want to use the proxy across all phone apps (and on cellular data), use a lightweight proxy client:
- **iOS**: **Shadowrocket** or **Potatso Lite** (App Store) &rarr; Add SOCKS5 or HTTP proxy with your VPS IP, port, and credentials.
- **Android**: **Super Proxy** or **v2rayNG** (Play Store) &rarr; Select `HTTP` or `SOCKS5`, enter VPS IP, port, username, password, and tap Start.

---

## Cloud Provider Firewall Reminder

In addition to `ufw` on your VPS, remember to check your cloud hosting provider's firewall / Security Group rules:
- **Hetzner Cloud**: Add inbound rules for TCP `8080` and `1080` under Firewall Settings.
- **AWS EC2**: Add Inbound Rule under Security Group: Custom TCP, Port Range `8080` and `1080`, Source `0.0.0.0/0` (or your IP).
- **DigitalOcean**: Add Inbound Rule under Cloud Firewalls: TCP `8080` and `1080`.
- **Linode / Vultr / OVH**: Enable ports in Cloud Firewall if applied.
