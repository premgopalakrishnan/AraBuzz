/* ==========================================================================
   AraBuzz — api/report-approve.js
   The admin end of an on-demand note.

   An admin approves or declines a request. On approval the parent is told
   straight away — before the note exists — because writing one takes a
   minute or two and silence in that gap reads as nothing having happened.
   Then the note is written, and the ordinary "your note is ready" email
   goes out exactly as it does on a Wednesday.

   The three emails, in order:
     1. (report-request.js) to the team, parent copied — pending approval
     2. here, on approval: to the parent, admin copied — approved, note coming
     3. here, when written: the usual ready-to-read note email

   If the note cannot be written the request is marked failed with the reason,
   and the parent is told plainly rather than left waiting for an email that
   is never coming.
   ========================================================================== */

import {
  whoIs, serviceGet, serviceWrite, emailOf, sendEmail, emailShell,
  APP_URL, ADMIN_INBOX, NOTE_TIME, send
} from './_lib.js';
import { gather, writeNote } from './_report.js';
import { tellTheParents } from './weekly.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* A note a parent asked for is worth writing from a shorter run of data than
   the Wednesday bar demands — they asked precisely because something has
   changed. But a note written from nothing at all is worse than no note, so
   there is still a floor. */
const MIN_ANSWERS_ON_REQUEST = 10;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const me = await whoIs(req);
  if (!me) return send(res, 401, { error: 'Sign in first' });
  if (!me.isAdmin) return send(res, 403, { error: 'Admins only' });

  const body = req.body || {};
  const id = String(body.id || '');
  const decision = String(body.decision || '');
  const note = String(body.note || '').slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: 'Which request?' });
  if (decision !== 'approve' && decision !== 'decline') {
    return send(res, 400, { error: 'approve or decline' });
  }

  const rows = await serviceGet(
    `report_requests?id=eq.${id}&select=id,child_id,family_id,requested_by,reason,status`);
  const rq = rows[0];
  if (!rq) return send(res, 404, { error: 'No such request' });
  if (rq.status !== 'pending') {
    return send(res, 409, { error: 'already-decided', status: rq.status });
  }

  const kids = await serviceGet(
    `children?id=eq.${rq.child_id}&select=id,name,pronoun,family_id,baseline`);
  const kid = kids[0];
  if (!kid) return send(res, 404, { error: 'No such child' });

  const parentRows = await serviceGet(
    `parents?id=eq.${rq.requested_by}&select=id,full_name`);
  const parent = parentRows[0] || null;
  const parentEmail = parent ? await emailOf(parent.id) : null;
  const adminEmail = me.user.email || ADMIN_INBOX;

  const patch = async fields => serviceWrite(
    `report_requests?id=eq.${id}`, fields, 'PATCH');

  /* ------------------------------------------------------------ decline -- */
  if (decision === 'decline') {
    await patch({ status: 'declined', decided_at: new Date().toISOString(),
                  decided_by: me.parent.id, decline_note: note || null });
    if (parentEmail) {
      try {
        await sendEmail(parentEmail, `About your request for ${kid.name}'s note`, emailShell(`
          <p style="margin:0 0 14px">Hi ${esc(parent.full_name || '')},</p>
          <p style="margin:0 0 14px">Thanks for asking for a note on ${esc(kid.name)}. We are not
             going to write one right now.</p>
          ${note ? `<p style="margin:0 0 14px;padding:12px 14px;background:#F5F1EA;border-radius:10px">
             ${esc(note)}</p>` : ''}
          <p style="margin:0 0 14px">${esc(kid.name)}'s next note comes automatically on
             <b>${NOTE_TIME}</b>, and you are very welcome to ask again after that.</p>
          <p style="margin:0;font-size:13px;color:#4C5D5A">Just reply to this email if you would
             like to talk about it.</p>`), { cc: adminEmail });
      } catch (e) { console.warn('decline email failed', e.message); }
    }
    return send(res, 200, { status: 'declined' });
  }

  /* ------------------------------------------------------------ approve -- */
  await patch({ status: 'approved', decided_at: new Date().toISOString(),
                decided_by: me.parent.id });

  /* Tell them now, not when the note lands. The gap between approving and
     writing is a minute or two of an empty screen otherwise. */
  if (parentEmail) {
    try {
      await sendEmail(parentEmail, `Your request for ${kid.name}'s note is approved`, emailShell(`
        <p style="margin:0 0 14px">Hi ${esc(parent.full_name || '')},</p>
        <p style="margin:0 0 14px">Your request for a note on <b>${esc(kid.name)}</b> has been
           approved. It is being written now.</p>
        <p style="margin:0 0 14px">We will email you again the moment it is ready to read —
           usually within a couple of minutes.</p>
        <p style="margin:0;font-size:13px;color:#4C5D5A">As always, the note itself stays behind
           your PIN in the app. It never travels by email.</p>`), { cc: adminEmail });
    } catch (e) { console.warn('approval email failed', e.message); }
  }

  /* ---- write it ---- */
  try {
    const g = await gather(kid, { windowDays: 21 });

    if (g.answers < MIN_ANSWERS_ON_REQUEST) {
      /* Widen the window rather than refuse: if the last note was yesterday
         there is nothing new, but there is plenty of older work to write a
         fuller picture from. */
      const wide = await gather({ ...kid }, { windowDays: 60 });
      wide.lastTs = null;
      wide.sinceIso = new Date(Date.now() - 60 * 864e5).toISOString();
      if (wide.answers < MIN_ANSWERS_ON_REQUEST) {
        await patch({ status: 'failed',
                      error: `only ${wide.answers} answers recorded — not enough to write from` });
        if (parentEmail) {
          try {
            await sendEmail(parentEmail, `About ${kid.name}'s note`, emailShell(`
              <p style="margin:0 0 14px">Hi ${esc(parent.full_name || '')},</p>
              <p style="margin:0 0 14px">We started writing ${esc(kid.name)}'s note and stopped,
                 because there is not yet enough practice recorded to say anything you could rely
                 on — only ${wide.answers} answers so far.</p>
              <p style="margin:0 0 14px">A few practice rounds in AraBuzz and there will be plenty
                 to write about, and you are welcome to ask again whenever you like. The next
                 automatic note comes <b>${NOTE_TIME}</b>.</p>`),
              { cc: adminEmail });
          } catch (e) { console.warn('thin-data email failed', e.message); }
        }
        return send(res, 200, { status: 'failed', reason: 'not enough practice recorded' });
      }
      const out = await writeNote(wide, { onRequest: true, detail: 'on-demand, approved' });
      await patch({ status: 'done', report_id: out.id });
      await tellTheParents(kid, { onRequest: true });
      return send(res, 200, { status: 'done', reportId: out.id });
    }

    const out = await writeNote(g, { onRequest: true, detail: 'on-demand, approved' });
    await patch({ status: 'done', report_id: out.id });
    await tellTheParents(kid, { onRequest: true });
    return send(res, 200, { status: 'done', reportId: out.id });

  } catch (e) {
    await patch({ status: 'failed', error: String(e.message || e).slice(0, 400) });
    if (parentEmail) {
      try {
        await sendEmail(parentEmail, `About ${kid.name}'s note`, emailShell(`
          <p style="margin:0 0 14px">Hi ${esc(parent.full_name || '')},</p>
          <p style="margin:0 0 14px">Something went wrong while writing ${esc(kid.name)}'s note,
             so it has not been produced. We can see what happened and will sort it out.</p>
          <p style="margin:0">Nothing has been lost, and you do not need to do anything —
             ${esc(kid.name)}'s next automatic note still comes on <b>${NOTE_TIME}</b>.</p>`),
          { cc: adminEmail });
      } catch (_) {}
    }
    return send(res, 500, { status: 'failed', error: String(e.message || e) });
  }
}
