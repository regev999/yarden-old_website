/** Admin accounts and sessions: scrypt password hashes, hashed session tokens, CSRF tokens. */
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { q, one } from '../db';
import { sha256, token } from '../security';

const SESSION_HOURS = 12;
export const COOKIE = 'yk_admin';

function scryptAsync(pw, salt, n = 16384) {
  return new Promise((resolve, reject) =>
    scrypt(pw.normalize('NFC'), salt, 64, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));
}

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt);
  return `scrypt$16384$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Used when the account doesn't exist, so the timing doesn't reveal it.
const DUMMY = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export async function verifyPassword(pw, stored) {
  const [kind, n, salt, key] = String(stored || DUMMY).split('$');
  if (kind !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64');
  const got = await scryptAsync(String(pw), Buffer.from(salt, 'base64'), +n);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function passwordProblem(pw) {
  return [...String(pw)].length < 10 ? 'הסיסמה צריכה להכיל לפחות 10 תווים.' : null;
}

export async function setPassword(userId, pw) {
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(pw), userId]);
  // Reset links and other sessions stop working once the password changes.
  await q('DELETE FROM password_resets WHERE user_id = $1', [userId]);
}

export async function userCount() {
  return (await one('SELECT count(*)::int AS n FROM users')).n;
}

export function cookieValue(request, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(request.headers.get('cookie') || '');
  return m ? decodeURIComponent(m[1]) : '';
}

function secure(request) {
  return new URL(request.url).protocol === 'https:' ? '; Secure' : '';
}

/** Returns { user, csrf } for a valid session, extending it (12 hours idle timeout). */
export async function currentSession(request) {
  const t = cookieValue(request, COOKIE);
  if (!t) return null;
  const row = await one(
    `UPDATE sessions SET expires_at = now() + make_interval(hours => $2) WHERE id = $1 AND expires_at > now()
     RETURNING user_id, csrf`, [sha256(t), SESSION_HOURS]);
  if (!row) return null;
  const user = await one('SELECT id, username, email FROM users WHERE id = $1', [row.user_id]);
  return user ? { user, csrf: row.csrf } : null;
}

/** Create a session; returns the Set-Cookie header value. */
export async function startSession(request, userId) {
  const t = token();
  await q(`INSERT INTO sessions(id, user_id, expires_at, ip, user_agent, csrf) VALUES($1, $2, now() + make_interval(hours => $3), '', $4, $5)`,
    [sha256(t), userId, SESSION_HOURS, (request.headers.get('user-agent') || '').slice(0, 200), token(24)]);
  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  if (Math.random() < 0.1) await q('DELETE FROM sessions WHERE expires_at < now()');
  return `${COOKIE}=${t}; Path=/admin; HttpOnly; SameSite=Strict${secure(request)}`;
}

export async function endSession(request) {
  const t = cookieValue(request, COOKIE);
  if (t) await q('DELETE FROM sessions WHERE id = $1', [sha256(t)]);
  return `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure(request)}`;
}

export async function endOtherSessions(userId, request) {
  await q('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, sha256(cookieValue(request, COOKIE))]);
}
