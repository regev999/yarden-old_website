/**
 * Credentials for the outside services (Cardcom, Resend, Rav-Messer), entered
 * in the admin under "חיבורים" and kept in the settings table. Secret values
 * are encrypted (AES-256-GCM) with a key derived from a server variable
 * (SETTINGS_SECRET, or else ADMIN_SETUP_KEY), so the database alone doesn't
 * reveal them. A variable of the same name set on the server always wins.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { q } from './db';

/** Every value the site reads, by its server-variable name. */
export const FIELDS = {
  CARDCOM_TERMINAL_NUMBER: { service: 'cardcom' },
  CARDCOM_API_NAME: { service: 'cardcom' },
  CARDCOM_API_PASSWORD: { service: 'cardcom', secret: true },
  CARDCOM_DOCUMENT_TYPE: { service: 'cardcom' },
  CARDCOM_CREATE_DOCUMENT: { service: 'cardcom' },
  MAIL_METHOD: { service: 'mail' },
  RESEND_API_KEY: { service: 'mail', secret: true },
  MAIL_FROM: { service: 'mail' },
  RAVMESSER_CLIENT_ID: { service: 'ravmesser' },
  RAVMESSER_CLIENT_SECRET: { service: 'ravmesser', secret: true },
  RAVMESSER_USER_TOKEN: { service: 'ravmesser', secret: true },
};

const PREFIX = 'integration:';
const TTL = 10_000;
let cache = null;
let cachedAt = 0;

function key() {
  const base = process.env.SETTINGS_SECRET || process.env.ADMIN_SETUP_KEY || '';
  return base ? createHash('sha256').update('yk-integrations|' + base).digest() : null;
}

/** Can secrets be stored here? (Needs a server variable to derive the key from.) */
export const canStoreSecrets = () => !!key();

function encrypt(text) {
  const k = key();
  if (!k) throw new Error('no key');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

/** The plain value, or null when it can't be read (the key changed). */
function decrypt(value) {
  const m = /^enc:v1:([^:]+):([^:]+):(.*)$/.exec(value || '');
  const k = key();
  if (!m || !k) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', k, Buffer.from(m[1], 'base64'));
    d.setAuthTag(Buffer.from(m[2], 'base64'));
    return Buffer.concat([d.update(Buffer.from(m[3], 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** The stored values, decrypted: { NAME: value }, plus the names that couldn't be read. */
async function stored() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  const values = {};
  const unreadable = [];
  try {
    const rows = await q('SELECT key, value FROM settings WHERE key LIKE $1', [PREFIX + '%']);
    for (const r of rows) {
      const name = r.key.slice(PREFIX.length);
      if (!(name in FIELDS)) continue;
      if (FIELDS[name].secret) {
        const v = decrypt(r.value);
        if (v === null) unreadable.push(name); else values[name] = v;
      } else values[name] = r.value;
    }
  } catch { /* no database: only server variables */ }
  cache = { values, unreadable };
  cachedAt = Date.now();
  return cache;
}

/** One setting: the server variable if set, else the value saved in the admin, else ''. */
export async function setting(name) {
  if (process.env[name]) return process.env[name];
  return (await stored()).values[name] || '';
}

/** Several settings at once: { NAME: value }. */
export async function settings(names) {
  const s = await stored();
  return Object.fromEntries(names.map((n) => [n, process.env[n] || s.values[n] || '']));
}

/** For the admin screen: where each value comes from, without revealing secrets. */
export async function describe() {
  const s = await stored();
  return Object.fromEntries(Object.entries(FIELDS).map(([name, f]) => {
    const fromServer = !!process.env[name];
    const saved = name in s.values;
    return [name, {
      fromServer,
      saved,
      unreadable: s.unreadable.includes(name),
      // Plain values are shown back; secrets only as "saved"
      value: f.secret ? '' : (fromServer ? process.env[name] : s.values[name] || ''),
    }];
  }));
}

/** Save values from the admin. An empty secret keeps the saved one; null removes a value. */
export async function save(values) {
  for (const [name, value] of Object.entries(values)) {
    if (!(name in FIELDS)) continue;
    if (value === null) {
      await q('DELETE FROM settings WHERE key = $1', [PREFIX + name]);
      continue;
    }
    const v = String(value).trim();
    if (FIELDS[name].secret && !v) continue;
    if (!v) { await q('DELETE FROM settings WHERE key = $1', [PREFIX + name]); continue; }
    await q('INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [PREFIX + name, FIELDS[name].secret ? encrypt(v) : v]);
  }
  cache = null;
}
