/** Request helpers shared by the lead form and the admin: IP hashing, throttling, origin checks, tokens. */
import { createHash, randomBytes } from 'node:crypto';
import { q, one } from './db';

export function clientIp(request) {
  const h = request.headers;
  return (h.get('x-real-ip') || h.get('x-forwarded-for')?.split(',')[0] || '').trim();
}

export function sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex');
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
