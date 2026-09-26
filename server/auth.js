// Passwords (scrypt) and cookie sessions. Two users: Leila (admin) and Cierra (approver).

import crypto from 'node:crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function randomPassword() {
  const words = crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 14);
  return `${words.slice(0, 4)}-${words.slice(4, 9)}-${words.slice(9, 14)}`;
}

export function createSessions(ttlDays = 14) {
  const sessions = new Map();
  const ttl = ttlDays * 86400000;
  return {
    create(userId) {
      const id = crypto.randomBytes(32).toString('base64url');
      sessions.set(id, { userId, expires: Date.now() + ttl });
      return id;
    },
    get(id) {
      const s = id && sessions.get(id);
      if (!s) return null;
      if (s.expires < Date.now()) { sessions.delete(id); return null; }
      return s;
    },
    destroy(id) { sessions.delete(id); },
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Simple login throttle: 8 failures per 15 minutes per IP.
export function createThrottle(limit = 8, windowMs = 15 * 60000) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      return h && h.count >= limit && Date.now() - h.first < windowMs;
    },
    fail(key) {
      const h = hits.get(key);
      if (!h || Date.now() - h.first > windowMs) hits.set(key, { count: 1, first: Date.now() });
      else h.count++;
    },
    clear(key) { hits.delete(key); },
  };
}
