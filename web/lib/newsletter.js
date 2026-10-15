/**
 * Newsletter sign-ups: the form at the bottom of every page (and the one on
 * the article pages) keeps each address in the subscribers table and adds it
 * to the Rav-Messer list chosen in the admin (הגדרות ← ניוזלטר). A sign-up is
 * never lost when that fails: it stays in the admin's list as not sent, with
 * the reason, and can be sent again from there.
 */
import { q, getSetting } from './db';
import { addSubscriber, isConfigured } from './ravmesser';

export const LIST_SETTING = 'newsletter_list_id';
export const LIST_STATUSES = { sent: 'נוסף לרב־מסר', failed: 'לא נוסף (שגיאה)', waiting: 'עוד לא נשלח' };

/** The Rav-Messer list id(s) new sign-ups go to ('' = none chosen yet). */
export async function listId() {
  return String(await getSetting(LIST_SETTING, process.env.NEWSLETTER_LIST_ID || '')).trim();
}

function withTimeout(promise, ms) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, error: 'Rav-Messer did not answer in time' }), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Add one subscriber to the list and record how it went. Returns { ok, error, skipped }. */
export async function sendToList(row, list) {
  list ??= await listId();
  if (!list || !(await isConfigured())) return { ok: false, skipped: true };
  const r = await withTimeout(addSubscriber({ listId: list, email: row.email, name: row.name }), 10_000);
  await q(`UPDATE subscribers SET list_status = $2, list_id = $3, list_error = $4,
             sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id = $1`,
    [row.id, r.ok ? 'sent' : 'failed', list, r.ok ? '' : String(r.error || '').slice(0, 300)]);
  return r;
}

/** A sign-up from the site. Signing up again only fills in a missing name and re-sends it to the list. */
export async function subscribe({ email, name = '', page = '', ipHash = '' }) {
  const [row] = await q(
    `INSERT INTO subscribers (email, name, page, ip_hash) VALUES (lower($1), $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET name = CASE WHEN subscribers.name = '' THEN EXCLUDED.name ELSE subscribers.name END
     RETURNING *`, [email, name, page, ipHash]);
  await sendToList(row);
  return row;
}
