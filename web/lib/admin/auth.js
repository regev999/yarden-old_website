/**
 * The admin account and its sessions: scrypt password hashes, hashed session
 * tokens, CSRF tokens, the half-way state of a two-step sign-in, and a log of
 * every sign-in.
 */
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { q, one } from '../db';
import { ipHash, ipHint, sha256, token } from '../security';

const SESSION_HOURS = 12;        // signed out after 12 hours without activity
const SESSION_MAX_DAYS = 7;      // and after a week in any case
const PENDING_MINUTES = 5;       // time to type the code after the password
export const COOKIE = 'yk_admin';
export const MFA_COOKIE = 'yk_mfa';

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

// Passwords that are long enough but guessed first (with any digits or symbols after them)
const COMMON = new Set(['password', 'passw0rd', 'qwertyuiop', 'qwertyuiopasdf', 'asdfghjkl', '1q2w3e4r5t', 'iloveyou', 'letmein',
  'admin', 'administrator', 'welcome', 'yardenkerem', 'yarden', 'focusing', 'ירדןכרם']);
function tooCommon(flat) {
  if (/^(.)\1+$/u.test(flat)) return true;                                    // aaaaaaaaaa
  if ('01234567890123456789'.includes(flat) || '98765432109876543210'.includes(flat)) return true;
  return COMMON.has(flat.replace(/[0-9!@#$%^&*()_+=.,?~-]+$/, ''));
}

/** Why a new password isn't good enough, or null. */
export function passwordProblem(pw, { username = '', email = '' } = {}) {
  const p = String(pw);
  if ([...p].length < 10) return 'הסיסמה צריכה להכיל לפחות 10 תווים.';
  const flat = p.toLowerCase().replace(/\s+/g, '');
  if (tooCommon(flat)) return 'הסיסמה הזו נפוצה מדי ונפרצת ראשונה. בחרו משפט או צירוף מילים משלכם.';
  const names = [username, String(email).split('@')[0]].map((s) => String(s).toLowerCase()).filter((s) => s.length >= 4);
  if (names.some((n) => flat.includes(n))) return 'הסיסמה לא יכולה לכלול את שם המשתמש או את המייל.';
  return null;
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

/** Secure cookies everywhere but a local test server (the proxy doesn't always say the visit was https). */
function secure(request) {
  const host = request.headers.get('host') || '';
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return '; Secure';
}

const userAgent = (request) => (request.headers.get('user-agent') || '').slice(0, 200);

/** Returns { user, csrf, sessionId } for a valid session, extending it (idle timeout, weekly cap). */
export async function currentSession(request) {
  const t = cookieValue(request, COOKIE);
  if (!t) return null;
  const row = await one(
    `UPDATE sessions SET expires_at = LEAST(now() + make_interval(hours => $2), created_at + make_interval(days => $3))
     WHERE id = $1 AND expires_at > now() AND created_at > now() - make_interval(days => $3)
     RETURNING id, user_id, csrf`, [sha256(t), SESSION_HOURS, SESSION_MAX_DAYS]);
  if (!row) return null;
  const user = await one('SELECT id, username, email, totp_enabled FROM users WHERE id = $1', [row.user_id]);
  return user ? { user, csrf: row.csrf, sessionId: row.id } : null;
}

/** Create a session; returns the Set-Cookie header value. */
export async function startSession(request, userId) {
  const t = token();
  await q(`INSERT INTO sessions(id, user_id, expires_at, ip, user_agent, csrf) VALUES($1, $2, now() + make_interval(hours => $3), $4, $5, $6)`,
    [sha256(t), userId, SESSION_HOURS, ipHint(request), userAgent(request), token(24)]);
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

/* ------------------------------------------------ two-step sign-in, half way */

/** The password was right and a code is still needed; returns the Set-Cookie value. */
export async function startPending(request, userId, next) {
  const t = token();
  await q('DELETE FROM mfa_pending WHERE user_id = $1 OR expires_at < now()', [userId]);
  await q(`INSERT INTO mfa_pending(id, user_id, next, expires_at) VALUES($1, $2, $3, now() + make_interval(mins => $4))`,
    [sha256(t), userId, next, PENDING_MINUTES]);
  return `${MFA_COOKIE}=${t}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${PENDING_MINUTES * 60}${secure(request)}`;
}

export async function currentPending(request) {
  const t = cookieValue(request, MFA_COOKIE);
  if (!t) return null;
  return one(`SELECT p.id, p.user_id, p.next, p.tries, u.username, u.totp_secret, u.totp_last_step, u.recovery_codes
              FROM mfa_pending p JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND p.expires_at > now()`, [sha256(t)]);
}

export async function endPending(request, id) {
  if (id) await q('DELETE FROM mfa_pending WHERE id = $1', [id]);
  return `${MFA_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure(request)}`;
}

/* ------------------------------------------------------------- sign-in log */

export async function logSignin(request, { username, ok, step = 'password' }) {
  await q('INSERT INTO signins(username, ok, step, ip_hash, ip_hint, user_agent) VALUES($1, $2, $3, $4, $5, $6)',
    [String(username || '').slice(0, 80), ok, step, ipHash(request), ipHint(request), userAgent(request)]);
  if (Math.random() < 0.05) await q(`DELETE FROM signins WHERE at < now() - interval '180 days'`);
}

/** Has this browser, from this address, signed in to this account before? */
export async function knownDevice(request, username) {
  return !!(await one(`SELECT 1 FROM signins WHERE ok AND lower(username) = lower($1) AND ip_hash = $2 AND user_agent = $3
                       AND at > now() - interval '60 days' LIMIT 1`, [String(username || ''), ipHash(request), userAgent(request)]));
}

/** "Chrome on Windows"-style name for a browser's user agent. */
export function deviceName(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /Firefox\//.test(s) ? 'Firefox' : /CriOS|Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'דפדפן';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} ב־${os}` : browser;
}
