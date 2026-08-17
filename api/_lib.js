/* ==========================================================================
   AraBuzz — api/_lib.js
   The small toolbox every serverless function shares.

   These functions run on Vercel, not in anyone's browser. This is the only
   place in the whole product that ever sees the Anthropic key, the Resend key
   or the Supabase service key. Nothing here is reachable without either a
   signed-in person's token or Vercel's own cron secret.
   ========================================================================== */

const SUPA    = process.env.SUPABASE_URL;
const ANON    = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const APP_URL = process.env.APP_URL || 'https://arabuzz.cokindlelabs.com';

/* ----------------------------------------------------------------- people */
/**
 * Who is calling? Verifies the Supabase token the browser sent, then looks up
 * their parent row. Returns null for anyone unknown — the caller turns that
 * into a 401. The service key is used only to READ the parent row; every
 * write goes back through the caller's own token so row-level security keeps
 * doing its job.
 */
export async function whoIs(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const r = await fetch(`${SUPA}/auth/v1/user`, {
    headers: { apikey: ANON, authorization: `Bearer ${token}` }
  });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user || !user.id) return null;

  const rows = await serviceGet(`parents?id=eq.${user.id}&select=id,family_id,role,active`);
  const parent = (rows && rows[0]) || null;
  if (!parent || parent.active === false) return null;

  return { user, token, parent, isAdmin: parent.role === 'admin' };
}

/* --------------------------------------------------------------- database */
/** Read from the arabuzz schema with the service key. Reading only. */
export async function serviceGet(path) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE, authorization: `Bearer ${SERVICE}`,
      'accept-profile': 'arabuzz'
    }
  });
  if (!r.ok) throw new Error(`db read failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** Count rows without fetching them. */
export async function serviceCount(path) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    method: 'HEAD',
    headers: {
      apikey: SERVICE, authorization: `Bearer ${SERVICE}`,
      'accept-profile': 'arabuzz', prefer: 'count=exact'
    }
  });
  const range = r.headers.get('content-range') || '/0';
  return parseInt(range.split('/')[1], 10) || 0;
}

/** Write with the service key — used only by the weekly cron, which has no
 *  signed-in person to act as. */
export async function serviceWrite(path, rows, method = 'POST') {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE, authorization: `Bearer ${SERVICE}`,
      'content-profile': 'arabuzz', 'content-type': 'application/json',
      prefer: 'return=representation'
    },
    body: JSON.stringify(rows)
  });
  if (!r.ok) throw new Error(`db write failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** Call a database function AS the signed-in person, so auth.uid() is them
 *  and row-level security judges them, not us. */
export async function rpcAsUser(token, fn, args) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON, authorization: `Bearer ${token}`,
      'content-profile': 'arabuzz', 'content-type': 'application/json'
    },
    body: JSON.stringify(args || {})
  });
  if (!r.ok) throw new Error(`rpc ${fn} failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** …and as the server itself, for the cron. */
export async function rpcAsServer(fn, args) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE, authorization: `Bearer ${SERVICE}`,
      'content-profile': 'arabuzz', 'content-type': 'application/json'
    },
    body: JSON.stringify(args || {})
  });
  if (!r.ok) throw new Error(`rpc ${fn} failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** A parent's email address, via the auth admin API. */
export async function emailOf(userId) {
  const r = await fetch(`${SUPA}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.email ? u.email : null;
}

/* -------------------------------------------------------------- anthropic */
export const RATES = {
  'claude-opus-5':             { in: 5, out: 25 },
  'claude-sonnet-5':           { in: 3, out: 15 },
  'claude-fable-5':            { in: 1, out: 5 },
  'claude-opus-4-8':           { in: 5, out: 25 },
  'claude-sonnet-4-6':         { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  _default:                    { in: 3, out: 15 }
};

export function estCost(model, inTok, outTok) {
  const r = RATES[model] || RATES._default;
  return +(inTok / 1e6 * r.in + outTok / 1e6 * r.out).toFixed(6);
}

export const ALLOWED_MODELS = new Set(Object.keys(RATES).filter(k => k !== '_default'));

/** One structured call to Anthropic. Returns { result, usage } or throws. */
export async function askClaude({ model, maxTokens, system, content, tool }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name }
    })
  });

  if (!r.ok) {
    let msg = String(r.status);
    try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch (e) {}
    const err = new Error(msg); err.status = r.status; throw err;
  }

  const json = await r.json();
  if (json.stop_reason === 'max_tokens') {
    throw new Error('The answer was cut short — try a smaller batch.');
  }
  const block = (json.content || []).find(b => b.type === 'tool_use');
  if (!block) throw new Error('The model returned no structured result.');

  const use = json.usage || {};
  return {
    result: block.input,
    usage: {
      inTok: use.input_tokens || 0,
      outTok: use.output_tokens || 0,
      est: estCost(model, use.input_tokens || 0, use.output_tokens || 0),
      model
    }
  };
}

/* ------------------------------------------------------------------ email */
/** Send one email through Resend, as AraBuzz, replying to Prem. */
export async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set in Vercel');
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'AraBuzz <arabuzz@cokindlelabs.com>',
      reply_to: 'prem@cokindle.com',
      to: [to],
      subject,
      html
    })
  });
  if (!r.ok) throw new Error(`email failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** The shared shell every AraBuzz email sits inside — same parchment feel as
 *  the app, rendered with table-safe inline styles. */
export function emailShell(inner) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F5F1EA">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;
              font-family:Georgia,'Times New Roman',serif;color:#1B2B29">
    <div style="font-size:26px;font-weight:bold;margin-bottom:18px">
      Ara<span style="color:#B8862F">Buzz</span></div>
    <div style="background:#FFFDF9;border:1px solid rgba(27,43,41,.12);border-radius:14px;
                padding:26px 28px;font-size:16px;line-height:1.65">
      ${inner}
    </div>
    <p style="font-size:12px;color:#8A9793;margin-top:16px">
      AraBuzz — a CoKindle Labs initiative. Made by a parent, for a small circle of friends.
      We only ever email you about AraBuzz itself.</p>
  </div></body></html>`;
}

/* ------------------------------------------------------------------- misc */
export function send(res, status, obj) {
  res.status(status).json(obj);
}
