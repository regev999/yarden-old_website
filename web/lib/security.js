/** Request helpers shared by the lead form and the admin: IP hashing, throttling, origin checks, tokens. */
import { createHash, randomBytes } from 'node:crypto';
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
