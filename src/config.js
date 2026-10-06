import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function parseAllowedIps(raw) {
  if (!raw || typeof raw !== 'string') return new Set();
  const list = raw
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  return new Set(list);
}

function parseUsers(rawUsers, defaultUser, defaultPass) {
  const userMap = new Map();

  if (defaultUser && defaultPass) {
    userMap.set(defaultUser.trim(), defaultPass.trim());
  }

  if (rawUsers && typeof rawUsers === 'string') {
    const pairs = rawUsers.split(',').map((p) => p.trim()).filter(Boolean);
    for (const pair of pairs) {
      const idx = pair.indexOf(':');
      if (idx > 0) {
        const u = pair.slice(0, idx).trim();
        const p = pair.slice(idx + 1).trim();
        if (u && p) {
          userMap.set(u, p);
        }
      }
    }
  }

  return userMap;
}

export const config = Object.freeze({
  bindHost: process.env.BIND_HOST || '0.0.0.0',
  httpPort: parseInt(process.env.HTTP_PORT || '8080', 10),
  socks5Port: parseInt(process.env.SOCKS5_PORT || '1080', 10),
  users: parseUsers(
    process.env.PROXY_USERS,
    process.env.PROXY_USER || 'admin',
    process.env.PROXY_PASS || 'ProxySecretPass123!'
  ),
  allowedIps: parseAllowedIps(process.env.ALLOWED_IPS),
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
});
