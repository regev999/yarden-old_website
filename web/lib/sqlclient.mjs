/**
 * One small SQL client for both hosts:
 * - Neon (Vercel): the HTTP driver, no open connections between requests.
 * - Any other Postgres (e.g. the database on a Proginter server): a regular
 *   connection pool through postgres.js.
 * Both expose query(text, params) → rows and transaction([[text, params], …]).
 */
import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';

export function connect(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  if (/\.neon\.tech$/.test(host)) {
    const sql = neon(url);
    return {
      query: (text, params = []) => sql.query(text, params),
      transaction: (queries) => sql.transaction(queries.map(([text, params]) => sql.query(text, params ?? []))),
    };
  }
  const sql = postgres(url, {
    max: 5, idle_timeout: 60, onnotice: () => {},
    // Like the Neon driver: a string sent to a json/jsonb parameter is already JSON.
    types: { json: { to: 114, from: [114, 3802], serialize: (x) => (typeof x === 'string' ? x : JSON.stringify(x)), parse: (x) => JSON.parse(x) } },
  });
  return {
    query: async (text, params = []) => [...(await sql.unsafe(text, params))],
    transaction: (queries) => sql.begin(async (t) => {
      const out = [];
      for (const [text, params] of queries) out.push([...(await t.unsafe(text, params ?? []))]);
      return out;
    }),
    end: () => sql.end(),
  };
}
