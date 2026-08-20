/* ==========================================================================
   AraBuzz — api/note-ready.js
   "The starting-point note is ready" — sent when it actually is.

   This used to live inside /api/ai and fire the instant the model returned
   the note. That was a promise made too early. The note still had to be
   rendered on the device, filed into the child's records and written to the
   account, and any one of those could fail — in which case the parent opened
   the Coach Report, found it empty, and rightly asked what the email was
   about.

   So the order is now: the app writes the note into `reports`, and only then
   asks this endpoint to knock on the door. This endpoint does not take the
   app's word for it either — it looks the note up first, inside the caller's
   own family, and stays silent if it is not there.
   ========================================================================== */

import { whoIs, serviceGet, emailOf, NOTE_TIME, sendEmail, emailShell, APP_URL, send } from './_lib.js';

const escHtml = t => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const who = await whoIs(req);
  if (!who || !who.parent) return send(res, 401, { error: 'Please sign in again.' });

  const childId = String((req.body && req.body.childId) || '');
  const kind    = String((req.body && req.body.kind) || 'onboarding');
  if (!UUID_RE.test(childId)) return send(res, 400, { error: 'Which child?' });
  if (kind !== 'onboarding') return send(res, 400, { error: 'Unknown kind.' });

  /* The child must belong to the family making the request. A child id from
     anywhere else finds nothing and this ends here. */
  let kidName = 'your kid';
  const kids = await serviceGet(
    `children?id=eq.${childId}&family_id=eq.${who.parent.family_id}&select=name`);
  if (!kids || !kids[0]) return send(res, 404, { error: 'No such child on this account.' });
  if (kids[0].name) kidName = kids[0].name;

  /* Is the note really there? This is the whole point of the endpoint. */
  const all = await serviceGet(
    `reports?child_id=eq.${childId}&order=ts.asc&select=id,ts,payload`);
  const notes = (all || []).filter(r => r.payload && r.payload.kind === 'onboarding');
  if (!notes.length) {
    // Nothing was saved. Say nothing to the parent — there is nothing to read.
    return send(res, 200, { sent: false, reason: 'not-written' });
  }
  /* Written more than once — the first one already earned the email, and a
     parent should not be told twice about the same note. */
  if (notes.length > 1) return send(res, 200, { sent: false, reason: 'already-announced' });

  const email = await emailOf(who.user.id);
  if (!email) return send(res, 200, { sent: false, reason: 'no-address' });
  const parentName = (who.parent && who.parent.full_name) || '';

  await sendEmail(email, `${kidName}'s starting-point note is ready`, emailShell(`
    <p style="margin:0 0 14px">Hi ${escHtml(parentName)},</p>
    <p style="margin:0 0 14px">${escHtml(kidName)} finished the first check, and the
       starting-point note is written and waiting for you — a short read on where
       ${escHtml(kidName)} is starting from and what the practice will aim at first.</p>
    <p style="margin:0 0 20px;text-align:center">
      <a href="${APP_URL}" style="display:inline-block;background:#B8862F;color:#fff;
         text-decoration:none;padding:12px 28px;border-radius:999px">Open AraBuzz</a></p>
    <p style="margin:0 0 14px;font-size:13px;color:#4C5D5A">Tap <b>Grown-ups</b>, enter
       your PIN, and open <b>Coach Report</b>. The note never travels by email — it stays
       behind your PIN.</p>
    <p style="margin:0 0 14px;font-size:13px;color:#4C5D5A">From here, a fresh note is published
       every <b>${NOTE_TIME}</b> — as long as ${escHtml(kidName)} has done a couple
       of practice rounds in AraBuzz by then.</p>
    <p style="margin:0;font-size:13px;color:#4C5D5A">Everything AraBuzz has used on your family is
       always there for you to look at, under <b>Usage</b> in Grown-ups.</p>`));

  return send(res, 200, { sent: true });
}
