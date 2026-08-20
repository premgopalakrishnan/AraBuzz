/* ==========================================================================
   AraBuzz — api/weekly.js
   The weekly note, published on Wednesday mornings.

   Vercel wakes this every Wednesday (02:30 UTC — mid-morning in Manila,
   breakfast in India). For each child it asks one question: has enough
   genuinely happened since their last note to be worth a parent's
   attention? The bar is the agreed one — at least TWO sessions and
   TWENTY-FIVE answers since the last note. A child who didn't practise
   simply doesn't get a note that week, which is far better than a note
   with nothing in it.

   The note itself is written in _report.js, which the on-demand path shares,
   so a note a parent asks for is the same note in every respect. This file
   is now only the schedule, the bar, and the email.
   ========================================================================== */

import { serviceGet, emailOf, sendEmail, emailShell, APP_URL, NOTE_TIME, send } from './_lib.js';
import { gather, writeNote, MIN_SESSIONS, MIN_ANSWERS, MIN_DAYS_BETWEEN } from './_report.js';

export default async function handler(req, res) {
  /* Only Vercel's own scheduler (which carries CRON_SECRET) may run this. */
  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers.authorization || '');
  if (!secret || auth !== `Bearer ${secret}`) {
    return send(res, 401, { error: 'cron only' });
  }

  const out = { checked: 0, written: 0, emailed: 0, skipped: [], errors: [] };

  try {
    const children = await serviceGet(
      'children?select=id,name,pronoun,family_id,baseline,active,families!inner(id,active)' +
      '&active=is.true&families.active=is.true');

    for (const kid of children) {
      out.checked++;
      try {
        const done = await maybeWriteNote(kid);
        if (done === true) { out.written++; out.emailed++; }
        else out.skipped.push(`${kid.name}: ${done}`);
      } catch (e) {
        out.errors.push(`${kid.name}: ${e.message}`);
      }
    }
    return send(res, 200, out);
  } catch (e) {
    out.errors.push(e.message);
    return send(res, 500, out);
  }
}

async function maybeWriteNote(kid) {
  const g = await gather(kid, { windowDays: 14 });

  if (g.lastTs && (Date.now() - Date.parse(g.lastTs)) < MIN_DAYS_BETWEEN * 864e5) {
    return 'a note went recently';
  }
  if (g.sessions < MIN_SESSIONS) return `only ${g.sessions} session(s)`;
  if (g.answers < MIN_ANSWERS) return `only ${g.answers} answer(s)`;

  await writeNote(g, { detail: 'weekly cron' });
  await tellTheParents(kid);
  return true;
}

/* ---- one short email; the note itself stays in the app ----
   Recipients are looked up by THIS child's family_id, taken from the database
   row of the child the note was just written for — never from a list, never
   "everyone". A different family cannot receive it. */
export async function tellTheParents(kid, opts) {
  const o = opts || {};
  const parents = await serviceGet(
    `parents?family_id=eq.${kid.family_id}&role=eq.parent&active=is.true&select=id,full_name`);
  let sent = 0;
  for (const p of parents) {
    const email = await emailOf(p.id);
    if (!email) continue;
    await sendEmail(email, `${kid.name}'s note is ready`, emailShell(`
      <p style="margin:0 0 14px">Hi ${esc(p.full_name || '')},</p>
      <p style="margin:0 0 14px">${esc(kid.name)}'s ${o.onRequest ? '' : 'weekly '}note is ready — a few
         minutes' read on what has moved since last time and the one or two things worth
         helping with.</p>
      <p style="margin:0 0 20px;text-align:center">
        <a href="${APP_URL}" style="display:inline-block;background:#B8862F;color:#fff;
           text-decoration:none;padding:12px 28px;border-radius:999px">Open AraBuzz</a></p>
      <p style="margin:0 0 14px;font-size:13px;color:#4C5D5A">Tap <b>Grown-ups</b>, enter your PIN,
         and open <b>Coach Report</b>. The note never travels by email — it stays behind
         your PIN.</p>
      <p style="margin:0 0 14px;font-size:13px;color:#4C5D5A">The next note comes
         <b>${NOTE_TIME}</b> — as long as ${esc(kid.name)} has done a couple of practice rounds in
         AraBuzz by then.</p>
      <p style="margin:0;font-size:13px;color:#4C5D5A">Everything AraBuzz has used on your family is
         always there for you to look at, under <b>Usage</b> in Grown-ups.</p>`),
      o.cc ? { cc: o.cc } : null);
    sent++;
  }
  return sent;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
