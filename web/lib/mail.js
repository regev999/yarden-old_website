/** Email through Resend (https://resend.com). Without an API key (admin → חיבורים, or RESEND_API_KEY) nothing is sent. */
import { settings } from './integrations';

/** Is sending mail connected? */
export async function mailReady() {
  return !!(await settings(['RESEND_API_KEY'])).RESEND_API_KEY;
}

export async function sendMail({ to, subject, text, replyTo }) {
  const v = await settings(['RESEND_API_KEY', 'MAIL_FROM']);
  if (!v.RESEND_API_KEY || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${v.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: v.MAIL_FROM || 'אתר ירדן כרם <onboarding@resend.dev>',
        to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!res.ok) console.error('[mail]', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error('[mail]', e);
    return false;
  }
}
