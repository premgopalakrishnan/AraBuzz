/* ==========================================================================
   AraBuzz — api/auth-email.js
   Every email the sign-in system sends now goes through HERE.

   Why this exists: the invitation email always arrived (it goes out through
   Resend's HTTP API, from our own server) while the sign-in code kept not
   arriving (it went out through Supabase's SMTP relay — a different road,
   which also depended on hand-edited dashboard templates). Two roads, one
   flaky. This is Supabase's "Send Email hook": instead of mailing anything
   itself, Auth POSTs us the code and the link, and we send the email down
   the road that provably works — same sender, same look as every other
   AraBuzz email, code always included, no dashboard templates involved.

   Guarded by the same internal key as the cron: the hook URL carries
   ?key=CRON_SECRET, which only Supabase's config and Vercel's env know.
   ========================================================================== */

import { sendEmail, emailShell, APP_URL, send } from './_lib.js';

const SUPA = process.env.SUPABASE_URL;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const key = new URL(req.url, 'https://x').searchParams.get('key') || '';
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return send(res, 401, { error: 'not the hook' });
  }

  const b = req.body || {};
  const email = b.user && b.user.email;
  const d = b.email_data || {};
  const type = d.email_action_type || '';
  if (!email || !type) return send(res, 400, { error: 'malformed hook payload' });

  const link = `${SUPA}/auth/v1/verify?token=${encodeURIComponent(d.token_hash || '')}` +
               `&type=${encodeURIComponent(type)}` +
               `&redirect_to=${encodeURIComponent(d.redirect_to || APP_URL)}`;

  let subject, inner;

  if (type === 'recovery') {
    subject = 'Choose your AraBuzz password';
    inner = `
      <p style="margin:0 0 14px">Tap the button to choose (or reset) your AraBuzz
         admin password. You'll land straight on the choose-a-password screen.</p>
      <p style="margin:0 0 20px;text-align:center">
        <a href="${link}" style="display:inline-block;background:#B8862F;color:#fff;
           text-decoration:none;padding:12px 28px;border-radius:999px">Choose a password</a></p>
      <p style="margin:0;font-size:13px;color:#4C5D5A">If you didn't ask for this,
         you can ignore this email — nothing changes until the link is used.</p>`;
  } else if (type === 'email_change' || type === 'email_change_current') {
    subject = 'Confirm your new email for AraBuzz';
    inner = `
      <p style="margin:0 0 14px">Tap to confirm the change to your AraBuzz email.</p>
      <p style="margin:0 0 20px;text-align:center">
        <a href="${link}" style="display:inline-block;background:#B8862F;color:#fff;
           text-decoration:none;padding:12px 28px;border-radius:999px">Confirm</a></p>`;
  } else {
    // signup, magiclink, invite — every flavour of "let me in" gets the same
    // email: the code first and big, the link underneath. First-time and
    // returning parents now receive identical emails, always with a code.
    subject = 'Your AraBuzz sign-in code';
    inner = `
      <p style="margin:0 0 6px">Type this code into AraBuzz:</p>
      <p style="margin:0 0 18px;text-align:center;font-size:34px;letter-spacing:.25em;
         font-weight:bold">${String(d.token || '').replace(/[^0-9a-zA-Z]/g, '')}</p>
      <p style="margin:0 0 6px;font-size:14px;color:#4C5D5A">Or, if AraBuzz is open on
         this same device, you can simply
         <a href="${link}" style="color:#2C4A6B">tap this link</a> — both work.</p>
      <p style="margin:14px 0 0;font-size:12px;color:#8A9793">If you didn't ask for
         this, you can ignore this email.</p>`;
  }

  try {
    await sendEmail(email, subject, emailShell(inner));
    return send(res, 200, { sent: true });
  } catch (e) {
    console.error('auth email failed', e.message);
    return send(res, 500, { error: e.message });
  }
}
