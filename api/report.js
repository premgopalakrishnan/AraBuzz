/* ==========================================================================
   AraBuzz — api/report.js
   Everything about a coach note's lifecycle, in one function.

   These were three endpoints — report-request, report-approve, note-ready —
   until the first deployment carrying all of them failed: Vercel's plan
   allows TWELVE serverless functions per deployment, and we were at
   fourteen. Every js file in api/ is a function; files starting with _ are
   the only free ones. So endpoints are a budget now, and this file is where
   the note-lifecycle spends one instead of three.

   One POST, dispatched on `action`:

     action: "request"   a parent asks for a note out of turn
     action: "decide"    an admin approves or declines it (writes the note)
     action: "ready"     the app says a starting-point note is filed;
                         this checks, then emails the parent

   The three handlers below are the original files' bodies, unchanged in
   behaviour. Their histories and reasoning live in git with the old files.
   ========================================================================== */

import {
  whoIs, serviceGet, serviceWrite, emailOf, sendEmail, emailShell,
  APP_URL, ADMIN_INBOX, NOTE_TIME, send
} from './_lib.js';
import { gather, writeNote } from './_report.js';
import { tellTheParents } from './weekly.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escHtml = esc;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* A note a parent asked for is worth writing from a shorter run of data than
   the Wednesday bar demands — they asked precisely because something has
   changed. But a note written from nothing at all is worse than no note, so
   there is still a floor. */
const MIN_ANSWERS_ON_REQUEST = 10;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const me = await whoIs(req);
  if (!me || !me.parent) return send(res, 401, { error: 'Please sign in again.' });
  const who = me;                                   // the "ready" body's name for the caller

  const action = String((req.body && req.body.action) || '');
  if (action === 'request') return doRequest(req, res, me);
  if (action === 'decide')  return doDecide(req, res, me);
  if (action === 'ready')   return doReady(req, res, who);
  return send(res, 400, { error: 'Unknown action.' });
}

/* ---------------------------------------------------- a parent asks ------ */
async function doRequest(req, res, me) {
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

/* ------------------------------------------------- an admin decides ------ */
async function doDecide(req, res, me) {
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

/* ------------------------------------- the starting-point note email ----- */
async function doReady(req, res, who) {
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
