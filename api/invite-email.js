/* ==========================================================================
   AraBuzz — api/invite-email.js
   Sends the invitation for real. The admin console creates the code, calls
   this, and the friend finds a proper email in their inbox instead of waiting
   for a WhatsApp message.

   Admin only — this endpoint can send email as arabuzz@cokindlelabs.com,
   which is not a power to hand to anyone else.
   ========================================================================== */

import { whoIs, sendEmail, emailShell, APP_URL, send } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const who = await whoIs(req);
  if (!who || !who.isAdmin) return send(res, 403, { error: 'Only the admin can send invitations.' });

  const b = req.body || {};
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const code = String(b.code || '').trim().toUpperCase();

  if (!name || !code || !/^\S+@\S+\.\S+$/.test(email)) {
    return send(res, 400, { error: 'Need a name, a valid email and the invite code.' });
  }

  const link = `${APP_URL}/?join=${encodeURIComponent(code)}`;

  const inner = `
    <p style="margin:0 0 14px">Hi ${escapeHtml(name)},</p>
    <p style="margin:0 0 14px">I built a small spelling app for the kids in the class.
       It takes the weekly Spell Buzz sheet and turns it into game-based practice they
       genuinely enjoy — to the kids it feels like playing; what they're really doing is
       training their spellings. Once a week it sends you a short note on what your child
       is finding tricky, and what's worth helping with.</p>
    <p style="margin:0 0 20px">It's not a business — I made it for our own kids, and I'm
       sharing it only with close friends.</p>
    <p style="margin:0 0 22px;text-align:center">
      <a href="${link}" style="display:inline-block;background:#B8862F;color:#fff;
         text-decoration:none;padding:13px 30px;border-radius:999px;font-size:16px">
         Set up AraBuzz — about 3 minutes</a></p>
    <p style="margin:0 0 6px;font-size:13px;color:#4C5D5A">If the button doesn't work,
       open this link: <a href="${link}" style="color:#2C4A6B">${link}</a></p>
    <p style="margin:14px 0 0">Any trouble at all, just reply to this email — it comes
       straight to me.</p>
    <p style="margin:14px 0 0">— Prem</p>`;

  try {
    await sendEmail(email, `${name}, your kids' class now has a spelling app`, emailShell(inner));
    return send(res, 200, { sent: true, to: email });
  } catch (e) {
    return send(res, 502, { error: e.message });
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
