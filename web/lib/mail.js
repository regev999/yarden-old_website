/** Email through Resend (https://resend.com). Without RESEND_API_KEY nothing is sent. */
export async function sendMail({ to, subject, text, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'אתר ירדן כרם <onboarding@resend.dev>',
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
