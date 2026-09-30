/** Request helpers shared by the lead form and the admin: IP hashing, throttling, origin checks, tokens. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { q, one } from './db';

/**
 * The visitor's address as the server's own proxy saw it: X-Real-IP, set by
 * nginx, or else the last X-Forwarded-For hop (the one the proxy appended).
 * The first hop is whatever the client claims, so it is never trusted.
 */
export function clientIp(request) {
  const h = request.headers;
  const hops = (h.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (h.get('x-real-ip') || hops[hops.length - 1] || '').trim();
}

export function sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

/** Enough of an address to recognise it (84.229.x.x), not enough to identify anyone. */
export function ipHint(request) {
  const ip = clientIp(request).replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.split('.').slice(0, 2).join('.') + '.x.x';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':…';
  return '';
}

/** IP addresses are only kept as a salted hash. */
export function ipHash(request) {
  return sha256((process.env.ADMIN_SETUP_KEY || 'yk') + '|' + clientIp(request)).slice(0, 32);
}

export function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export async function tooManyAttempts(key, max, seconds) {
  const r = await one(`SELECT count(*)::int AS n FROM attempts WHERE key = $1 AND at > now() - make_interval(secs => $2)`, [key, seconds]);
  return (r?.n ?? 0) >= max;
}

/**
 * Counts this attempt first, then says whether it went over the limit. Recording
 * before checking means many requests sent at the same moment can't all pass
 * a count that none of them has added to yet.
 */
export async function takeAttempt(key, max, seconds) {
  await q('INSERT INTO attempts(key) VALUES($1)', [key]);
  const r = await one(`SELECT count(*)::int AS n FROM attempts WHERE key = $1 AND at > now() - make_interval(secs => $2)`, [key, seconds]);
  return (r?.n ?? 0) > max;
}

/**
 * True when a request body is bigger than `max` bytes, or its size isn't
 * declared (browsers always declare it for forms and fetch). Checked before
 * reading, so an oversized upload never fills the server's memory.
 */
export function bodyTooLarge(request, max) {
  const len = request.headers.get('content-length');
  if (len === null) return request.headers.has('transfer-encoding');
  const n = Number(len);
  return !Number.isFinite(n) || n > max;
}

/** Compares two secrets in constant time. */
export function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export async function recordAttempt(key) {
  await q('INSERT INTO attempts(key) VALUES($1)', [key]);
  if (Math.random() < 0.05) await q(`DELETE FROM attempts WHERE at < now() - interval '1 day'`);
}

export async function clearAttempts(key) {
  await q('DELETE FROM attempts WHERE key = $1', [key]);
}

/** True when the request comes from this site's own pages (or sends no origin at all). */
export function sameOrigin(request) {
  const origin = request.headers.get('origin') || request.headers.get('referer') || '';
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === request.headers.get('host') || host === request.headers.get('x-forwarded-host');
  } catch {
    return false;
  }
}
