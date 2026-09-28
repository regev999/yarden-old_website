import { neon } from '@neondatabase/serverless';

let sql;
function client() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Connect a Neon database to the Vercel project.');
  sql ??= neon(url);
  return sql;
}

/** Run a parameterized query ($1, $2, …) and return the rows. */
export async function q(text, params = []) {
  return client().query(text, params);
}

/** First row or null. */
export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] ?? null;
}

/** Several statements in one transaction (neon HTTP batch). */
export async function tx(queries) {
  const s = client();
  return s.transaction(queries.map(([text, params]) => s.query(text, params ?? [])));
}

export async function getSetting(key, fallback = '') {
  try {
    const r = await one('SELECT value FROM settings WHERE key = $1', [key]);
    return r?.value ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting(key, value) {
  await q('INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
}
