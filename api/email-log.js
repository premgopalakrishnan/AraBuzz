/* ==========================================================================
   AraBuzz — api/email-log.js
   "Did the email actually go?" — answered with facts instead of waiting by
   an inbox. Returns the last ~20 emails Resend handled for us: who they went
   to, the subject, and what happened (delivered, bounced, opened…).

   Diagnostic endpoint, guarded by the internal key. Nothing here can send
   anything — it only reads the delivery log.
   ========================================================================== */

import { send } from './_lib.js';

export default async function handler(req, res) {
  const key = new URL(req.url, 'https://x').searchParams.get('key') || '';
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return send(res, 401, { error: 'no' });
  }

  try {
    const r = await fetch('https://api.resend.com/emails?limit=20', {
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` }
    });
    const j = await r.json();
    const rows = (j.data || j.emails || []).map(e => ({
      at: e.created_at,
      to: e.to,
      subject: e.subject,
      status: e.last_event || e.status || 'unknown'
    }));
    return send(res, 200, { ok: r.ok, emails: rows });
  } catch (e) {
    return send(res, 502, { error: e.message });
  }
}
