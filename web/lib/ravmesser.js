/**
 * Rav-Messer / Responder: after a successful payment, add the buyer to the
 * mailing list of what they bought. Server side only; the same client as the
 * storytelling site (api/_ravmesser.js there).
 *
 * Auth is OAuth2 client_credentials (Responder API v2): the permanent client
 * credentials are exchanged for a fresh access token on every call, so there
 * is nothing to store or renew. A failure here never touches the payment; it
 * only marks the order's delivery as failed, with the reason, in the admin.
 */

function config() {
  return {
    baseUrl: (process.env.RAVMESSER_BASE_URL || 'https://graph.responder.live/v2').replace(/\/$/, ''),
    clientId: process.env.RAVMESSER_CLIENT_ID || '',
    clientSecret: process.env.RAVMESSER_CLIENT_SECRET || '',
    userToken: process.env.RAVMESSER_USER_TOKEN || '',
    subscribePath: process.env.RAVMESSER_SUBSCRIBE_PATH || '/subscribers',
  };
}

export function isConfigured() {
  const c = config();
  return !!(c.clientId && c.clientSecret && c.userToken);
}

async function accessToken(c) {
  const res = await fetch(`${c.baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      scope: '*',
      client_id: /^\d+$/.test(c.clientId) ? Number(c.clientId) : c.clientId,
      client_secret: c.clientSecret,
      user_token: c.userToken,
    }),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* keep {} */ }
  const token = data.token || data.access_token;
  return res.ok && token ? { ok: true, token } : { ok: false, error: `Rav-Messer auth ${res.status}: ${String(text).slice(0, 200)}` };
}

/** Add a subscriber to one list (or several, comma-separated). Returns { ok, error }. */
export async function addSubscriber({ listId, email, name, phone }) {
  const c = config();
  if (!isConfigured()) return { ok: false, error: 'Rav-Messer credentials not set' };
  if (!listId) return { ok: false, error: 'missing list id' };
  if (!email) return { ok: false, error: 'missing email' };
  try {
    const auth = await accessToken(c);
    if (!auth.ok) return auth;
    const listIds = String(listId).split(',').map((s) => s.trim()).filter(Boolean).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
    // override: true updates someone who is already on the list instead of failing
    const payload = { email, name: name || '', list_ids: listIds, override: true };
    if (phone) payload.phone = String(phone).trim();
    const res = await fetch(`${c.baseUrl}${c.subscribePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `Rav-Messer ${res.status}: ${String(await res.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
