/* ==========================================================================
   AraBuzz — api/reset-pin.js
   A parent forgot their PIN and asked for help. The admin presses one button
   in the console; this end clears the PIN and — in the same breath — emails
   the parent so they know it happened and what to do next.

   Why the email matters: a silently-reset PIN looks like a broken app the
   next time the parent opens it. Told, it is a two-line story: "your PIN was
   reset, the app will ask you for a new one." The email also acts as the
   safety valve — a parent who never asked for a reset finds out immediately.

   No temporary PIN exists at any point, so nothing secret travels by email.
   Admin-gated by whoIs(); the admin's own seat cannot be reset from here.
   ========================================================================== */

import {
  whoIs, serviceGet, serviceWrite, emailOf, sendEmail, emailShell, APP_URL, send
} from './_lib.js';

const escHtml = t => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const me = await whoIs(req);
  if (!me || !me.isAdmin) return send(res, 403, { error: 'Only the admin can reset a PIN.' });

  const parentId = String((req.body || {}).parentId || '');
  if (!parentId) return send(res, 400, { error: 'parentId required' });

  const rows = await serviceGet(`parents?id=eq.${parentId}&select=id,full_name,role`);
  const target = rows && rows[0];
  if (!target) return send(res, 404, { error: 'No such parent.' });
  if (target.role === 'admin') return send(res, 400, { error: "The admin seat's PIN is not reset from here." });

  await serviceWrite(`parents?id=eq.${parentId}`, {
    pin_hash: null, pin_set_at: null, pin_fails: 0, pin_locked_until: null
  }, 'PATCH');

  let emailed = false;
  try {
    const email = await emailOf(parentId);
    if (email) {
      await sendEmail(email, 'Your AraBuzz PIN has been reset', emailShell(`
        <p style="margin:0 0 14px">Hi ${escHtml(target.full_name || '')},</p>
        <p style="margin:0 0 14px">Your grown-ups' PIN has been reset, as you asked. Your old
           PIN no longer works, and nothing else about your family has changed.</p>
        <p style="margin:0 0 20px;text-align:center">
          <a href="${APP_URL}" style="display:inline-block;background:#B8862F;color:#fff;
             text-decoration:none;padding:12px 28px;border-radius:999px">Open AraBuzz</a></p>
        <p style="margin:0 0 14px;font-size:13px;color:#4C5D5A">The next time you open AraBuzz,
           it will simply ask you to choose a new PIN — pick something your kid won't guess.</p>
        <p style="margin:0;font-size:13px;color:#4C5D5A">Didn't ask for this? Reply to this
           email and tell Prem straight away.</p>`));
      emailed = true;
    }
  } catch (e) {
    console.warn('reset-pin email not sent', e.message);
  }

  return send(res, 200, { ok: true, emailed, name: target.full_name });
}
