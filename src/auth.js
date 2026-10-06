import crypto from 'node:crypto';
import { config } from './config.js';

export function normalizeIp(ip) {
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  if (ip === '::1') {
    return '127.0.0.1';
  }
  return ip;
}

export function isIpAllowed(clientIp) {
  if (!config.allowedIps || config.allowedIps.size === 0) {
    return true;
  }
  const normalized = normalizeIp(clientIp);
  return config.allowedIps.has(normalized);
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Constant time dummy check to avoid length leak
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function validateCredentials(username, password) {
  if (!username || !password) return false;
  const expectedPassword = config.users.get(username);
  if (!expectedPassword) return false;
  return safeCompare(password, expectedPassword);
}

export function parseBasicAuthHeader(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const [scheme, token] = authHeader.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'basic' || !token) return null;

  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) return null;
    return {
      username: decoded.slice(0, colonIdx),
      password: decoded.slice(colonIdx + 1),
    };
  } catch {
    return null;
  }
}
