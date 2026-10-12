/**
 * The site's mail: lead and sale notices, password resets, new-device notes.
 *
 * By default it goes through the hosting server's own mail server (Proginter
 * runs one on the same machine, port 25, which relays for the sites on it), so
 * nothing needs to be set up. Resend (resend.com) can be used instead from the
 * admin's "חיבורים" screen. MAIL_METHOD: 'server' (default), 'resend' or 'off'.
 */
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { settings } from './integrations';

const NAMES = ['MAIL_METHOD', 'RESEND_API_KEY', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_PORT'];
const DEFAULT_FROM = 'אתר ירדן כרם <no-reply@yarden.to-web.co.il>';

async function config() {
  const v = await settings(NAMES);
  const method = ['server', 'resend', 'off'].includes(v.MAIL_METHOD) ? v.MAIL_METHOD : (v.RESEND_API_KEY ? 'resend' : 'server');
  return { method, key: v.RESEND_API_KEY, from: v.MAIL_FROM || DEFAULT_FROM, host: v.SMTP_HOST || '127.0.0.1', port: Number(v.SMTP_PORT) || 25 };
}

/** Is sending mail switched on? */
export async function mailReady() {
  const c = await config();
  return c.method === 'server' || (c.method === 'resend' && !!c.key);
}

/** How mail goes out, for the admin: 'server', 'resend' or 'off'. */
export async function mailMethod() {
  return (await config()).method;
}

export async function sendMail({ to, subject, text, replyTo }) {
  if (!to) return false;
  const c = await config();
  try {
    if (c.method === 'resend' && c.key) return await viaResend(c, { to, subject, text, replyTo });
    if (c.method === 'server') return await viaSmtp(c, { to, subject, text, replyTo });
  } catch (e) {
    console.error('[mail]', e?.message || e);
  }
  return false;
}

async function viaResend(c, { to, subject, text, replyTo }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: c.from, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) console.error('[mail] resend', res.status, await res.text());
  return res.ok;
}

/* ------------------------------------------------ the server's own SMTP */

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
/** A header value that may hold Hebrew (RFC 2047). */
const word = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
/** "Name <a@b>" with the name encoded; or a bare address. */
function mailbox(s) {
  const m = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(String(s));
  return m ? (m[1] ? `${word(m[1].replace(/"/g, ''))} <${m[2]}>` : `<${m[2]}>`) : `<${String(s).trim()}>`;
}
const address = (s) => (/<([^<>\s]+@[^<>\s]+)>/.exec(String(s))?.[1] || String(s).trim());
const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

function message(c, { to, subject, text, replyTo }) {
  const from = address(c.from);
  const headers = [
    `From: ${mailbox(c.from)}`,
    `To: <${clean(to)}>`,
    `Subject: ${word(clean(subject))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${from.split('@')[1] || 'localhost'}>`,
    ...(replyTo ? [`Reply-To: <${clean(replyTo)}>`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = b64(String(text).replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n');
  return headers.join('\r\n') + '\r\n\r\n' + body;
}

/** One message through an SMTP server that relays for this site (no login). */
function viaSmtp(c, mail) {
  const from = address(c.from);
  const to = address(mail.to);
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(to) || !/^[^\s@<>]+@[^\s@<>]+$/.test(from)) return Promise.resolve(false);
  const data = message(c, mail).replace(/^\./gm, '..') + '\r\n.';
  const steps = [
    [`EHLO ${from.split('@')[1]}`, 250], [`MAIL FROM:<${from}>`, 250], [`RCPT TO:<${to}>`, 250],
    ['DATA', 354], [data, 250], ['QUIT', 221],
  ];
  return new Promise((resolve) => {
    const s = net.connect(c.port, c.host);
    let buf = '';
    let expect = 220;
    let done = false;
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      if (!ok) console.error('[mail] smtp', why);
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(15000, () => finish(false, 'timeout'));
    s.on('error', (e) => finish(false, e.message));
    s.on('data', (d) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue; // more lines of the same reply
        const code = Number(line.slice(0, 3));
        if (code !== expect) return finish(false, line.slice(0, 200));
        const next = steps.shift();
        if (!next) return finish(true);
        expect = next[1];
        s.write(next[0] + '\r\n');
        if (next[0] === 'QUIT') return finish(true); // the message was accepted at the DATA step
      }
    });
  });
}
