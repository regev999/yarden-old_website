/**
 * Two-step sign-in with an authenticator app (Google Authenticator, Microsoft
 * Authenticator, 1Password…): time-based one-time codes, RFC 6238 (SHA-1,
 * 6 digits, 30 seconds), plus one-time recovery codes for a lost phone.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import qrcode from 'qrcode-generator';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;
export const ISSUER = 'Yarden Kerem';

/** A new shared secret: 160 random bits as base32 (what the apps expect). */
export function newSecret() {
  let bits = '';
  for (const b of randomBytes(20)) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function fromBase32(s) {
  let bits = '';
  for (const c of String(s).replace(/[\s=]/g, '').toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error('bad base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

export function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP);

/**
 * The time step a code belongs to, or null. Allows one step of clock drift
 * either way, and never accepts a step at or before `lastStep`, so a code that
 * was already used (or an older one) can't be replayed.
 */
export function matchCode(secret, code, lastStep = 0, now = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6 || !secret) return null;
  const t = stepAt(now);
  for (const s of [t - 1, t, t + 1]) {
    if (s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(codeAt(secret, s)), Buffer.from(c))) return s;
  }
  return null;
}

export function otpauthUrl(secret, account) {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

/** The setup QR code as inline SVG. */
export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true, alt: 'קוד QR להוספת האתר לאפליקציית האימות' });
}

/** Group the secret in fours, for typing it in by hand. */
export const spaced = (secret) => String(secret).replace(/(.{4})/g, '$1 ').trim();

const hashCode = (c) => createHash('sha256').update(String(c).replace(/[^a-z0-9]/gi, '').toLowerCase()).digest('hex');

/** Eight one-time recovery codes; only their hashes are kept. */
export function newRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < 8; i++) {
    const raw = randomBytes(8).toString('hex').slice(0, 10);
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return { codes, hashes: codes.map(hashCode) };
}

/** Index of the matching recovery code hash, or -1. */
export function matchRecoveryCode(hashes, code) {
  const c = String(code || '').replace(/[^a-z0-9]/gi, '');
  if (c.length !== 10 || !Array.isArray(hashes)) return -1;
  return hashes.indexOf(hashCode(c));
}
