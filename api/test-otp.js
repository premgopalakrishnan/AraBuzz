/* ==========================================================================
   AraBuzz — api/test-otp.js
   Fires a real sign-in code at a real address, so the whole email chain can
   be proven working — Auth → our send-email hook → Resend → inbox — without
   anyone sitting in front of the app clicking buttons.

   Guarded by the internal key. It can only do what the public sign-in screen
   already lets anyone do (request a code for an address), so it grants no
   power — it just makes testing scriptable.
   ========================================================================== */

import { send } from './_lib.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'https://x');
  const key = url.searchParams.get('key') || '';
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase();

  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return send(res, 401, { error: 'no' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'email=? required' });

  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/otp`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ email, create_user: true })
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    return send(res, 200, { requested: email, authStatus: r.status, authBody: j });
  } catch (e) {
    return send(res, 502, { error: e.message });
  }
}
