/* ==========================================================================
   AraBuzz — api/report-request.js
   A parent asking for a coach note out of turn.

   Notes publish themselves every Wednesday. Sometimes that is not when a
   parent needs one — a test on Friday, a parents' evening on Monday, a
   sudden worry on a Tuesday night. This is how they ask.

   A note that is asked for is not written on the spot. It goes to the team
   first, and an admin approves it. That is deliberate: writing a note is real
   work at the CoKindle Labs end, and the approval step keeps that decision
   with the people who carry it rather than with a button.

   What this endpoint does, in order:
     1. checks the person asking really is a parent of that child
     2. refuses a second request while one is still pending
     3. records the request
     4. emails arabuzz@cokindlelabs.com, with the parent copied in, so both
        sides have the same piece of paper

   It never writes a note. api/report-approve.js does that, once approved.
   ========================================================================== */

import {
  whoIs, serviceGet, serviceWrite, sendEmail, emailShell,
  APP_URL, ADMIN_INBOX, NOTE_TIME, send
} from './_lib.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const me = await whoIs(req);
  if (!me) return send(res, 401, { error: 'Sign in first' });

  const body = req.body || {};
  const childId = String(body.childId || '');
  const reason = String(body.reason || '').slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(childId)) return send(res, 400, { error: 'Which child?' });

  /* ---- 1 · is this child theirs? ------------------------------------- */
  const kids = await serviceGet(
    `children?id=eq.${childId}&select=id,name,family_id,active`);
  const kid = kids[0];
  if (!kid || kid.active === false) return send(res, 404, { error: 'No such child' });
  if (kid.family_id !== me.parent.family_id && !me.isAdmin) {
    return send(res, 403, { error: 'That is not your child' });
  }

  /* ---- 2 · one at a time -------------------------------------------- */
  const open = await serviceGet(
    `report_requests?child_id=eq.${childId}&status=eq.pending&select=id,requested_at`);
  if (open.length) {
    return send(res, 409, {
      error: 'already-pending',
      message: 'You already have a request waiting. We will email you the moment it is looked at.',
      since: open[0].requested_at
    });
  }

  /* And a light hand on the frequency. Not a hard cap — a note that has just
     been written is simply not worth writing again, and saying so is more
     honest than approving it and producing the same note twice. */
  const recent = await serviceGet(
    `reports?child_id=eq.${childId}&order=ts.desc&limit=1&select=ts`);
  const lastNoteAgeHrs = recent[0]
    ? (Date.now() - Date.parse(recent[0].ts)) / 36e5 : null;

  /* ---- 3 · record it ------------------------------------------------- */
  const rows = await serviceWrite('report_requests', {
    child_id: kid.id,
    family_id: kid.family_id,
    requested_by: me.parent.id,
    reason: reason || null,
    status: 'pending'
  });
  const reqId = rows && rows[0] ? rows[0].id : null;

  /* ---- 4 · tell the team, with the parent copied in ------------------ */
  const parentEmail = me.user.email || null;
  const who = me.parent.full_name || 'A parent';
  try {
    await sendEmail(ADMIN_INBOX,
      `On-demand report request — ${kid.name} (${who})`,
      emailShell(`
        <p style="margin:0 0 14px">An on-demand report has been requested and is
           <b>pending your approval</b>.</p>
        <table style="width:100%;font-size:15px;border-collapse:collapse;margin:0 0 16px">
          <tr><td style="padding:5px 0;color:#4C5D5A;width:120px">Child</td>
              <td style="padding:5px 0"><b>${esc(kid.name)}</b></td></tr>
          <tr><td style="padding:5px 0;color:#4C5D5A">Requested by</td>
              <td style="padding:5px 0">${esc(who)}${parentEmail ? ` &lt;${esc(parentEmail)}&gt;` : ''}</td></tr>
          <tr><td style="padding:5px 0;color:#4C5D5A">Last note</td>
              <td style="padding:5px 0">${lastNoteAgeHrs == null ? 'never' :
                 lastNoteAgeHrs < 48 ? `${Math.round(lastNoteAgeHrs)} hours ago`
                                     : `${Math.round(lastNoteAgeHrs / 24)} days ago`}</td></tr>
        </table>
        ${reason ? `<p style="margin:0 0 16px;padding:12px 14px;background:#F5F1EA;border-radius:10px;
           font-size:15px"><i>${esc(reason)}</i></p>` : ''}
        <p style="margin:0 0 20px;text-align:center">
          <a href="${APP_URL}#admin" style="display:inline-block;background:#B8862F;color:#fff;
             text-decoration:none;padding:12px 28px;border-radius:999px">Open the admin console</a></p>
        <p style="margin:0 0 14px;font-size:13px;color:#4C5D5A">Approve or decline it under
           <b>Requests</b>. Nothing is written until you approve.</p>
        <p style="margin:0;font-size:13px;color:#4C5D5A">${esc(kid.name)}'s next automatic note is
           due <b>${NOTE_TIME}</b>.</p>`),
      { cc: parentEmail });
  } catch (e) {
    /* The request is recorded either way — an email that did not send is not
       a reason to lose it. The admin console shows pending requests without
       needing the email at all. */
    console.warn('request email failed', e.message);
    return send(res, 200, { id: reqId, emailed: false, warning: e.message });
  }

  return send(res, 200, { id: reqId, emailed: true });
}
