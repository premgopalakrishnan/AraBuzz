/* ==========================================================================
   AraBuzz — api/announce.js
   The admin writes one message and it lands in parents' inboxes — all of
   them, a chosen few, or a single parent. The console supplies the parent
   ids; this end confirms the sender really is the admin, looks up each
   address itself, and sends through the same proven road as every other
   AraBuzz email.

   Nothing here can be reached by a parent: whoIs() must come back isAdmin.
   The message travels as plain paragraphs — a blank line starts a new one —
   with no markup interpreted, so nothing pasted in can break the email.
   ========================================================================== */

import { whoIs, serviceGet, serviceWrite, emailOf, sendEmail, emailShell, send } from './_lib.js';

const escHtml = t => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const me = await whoIs(req);
  if (!me || !me.isAdmin) return send(res, 403, { error: 'Only the admin can send updates.' });

  const body = req.body || {};
  const subject = String(body.subject || '').trim().slice(0, 140);
  const message = String(body.message || '').trim().slice(0, 8000);
  const parentIds = Array.isArray(body.parentIds) ? body.parentIds.map(String) : null;

  if (!subject) return send(res, 400, { error: 'Give the update a subject line.' });
  if (!message) return send(res, 400, { error: 'The message is empty.' });

  /* Who can receive: active parents in active families. The admin's own seat
     is never a recipient — this is for the families. An explicit id list
     narrows it down to the chosen few (or the chosen one). */
  let rows = await serviceGet(
    'parents?role=eq.parent&active=eq.true&select=id,full_name,family_id,families(name,active)');
  rows = (rows || []).filter(p => !p.families || p.families.active !== false);
  if (parentIds && parentIds.length) {
    const want = new Set(parentIds);
    rows = rows.filter(p => want.has(String(p.id)));
  }
  if (!rows.length) return send(res, 400, { error: 'Nobody matched that selection.' });
  if (rows.length > 50) return send(res, 400, { error: 'That is more recipients than AraBuzz should ever have.' });

  const paragraphs = message.split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 14px">${escHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const sent = [], failed = [];
  for (const p of rows) {
    try {
      const email = await emailOf(p.id);
      if (!email) throw new Error('no email on file');
      const html = emailShell(
        `<p style="margin:0 0 14px">Hi ${escHtml(p.full_name || 'there')},</p>
         ${paragraphs}
         <p style="margin:14px 0 0">— Prem</p>`);
      await sendEmail(email, subject, html);
      sent.push({ id: p.id, name: p.full_name });
    } catch (e) {
      failed.push({ id: p.id, name: p.full_name, error: e.message || String(e) });
    }
  }

  /* Into the record book, so the Message tab shows the history instead of a
     toast that evaporates. Never fatal — the emails are already out. */
  try {
    await serviceWrite('announcements', {
      subject, message, sent_to: sent, sent_count: sent.length, failed
    });
  } catch (e) { console.warn('announcement not recorded', e.message); }

  return send(res, 200, { ok: failed.length === 0, sentCount: sent.length, sent, failed });
}
