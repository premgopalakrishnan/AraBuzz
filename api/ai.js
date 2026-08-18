/* ==========================================================================
   AraBuzz — api/ai.js
   The one door to the AI. Every model call the app makes comes through here,
   so the Anthropic key lives on this server and on no child's iPad.

   Who may ask for what:

     admin only          read-deck · enrich · top-up · topic-list
                         (the expensive jobs — reading a sheet and building a
                         week's material — happen once, done by Prem)

     any signed-in       coach-report · onboarding-report · memory-tricks · test
     parent              (small, per-child jobs; rate-limited so a bug in a
                         loop cannot quietly spend money all night)

   Every call is written to api_usage through record_usage(), as the person
   who made it, so the admin console's Usage tab is simply true.
   ========================================================================== */

import {
  whoIs, askClaude, rpcAsUser, serviceCount, serviceGet,
  emailOf, sendEmail, emailShell, APP_URL, ALLOWED_MODELS, send
} from './_lib.js';

const escHtml = t => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* The starting-point note deserves the same knock on the door as the weekly
   one: a short email saying it is ready, sent the moment it is written. The
   note itself never travels by email — it stays behind the PIN. */
async function emailOnboardingReady(who, childId) {
  let kidName = 'your kid';
  try {
    if (childId && who.parent && who.parent.family_id) {
      // constrained to the caller's own family — a childId from anywhere
      // else simply finds nothing, and the email says "your kid"
      const rows = await serviceGet(
        `children?id=eq.${childId}&family_id=eq.${who.parent.family_id}&select=name`);
      if (rows && rows[0] && rows[0].name) kidName = rows[0].name;
    }
  } catch (e) { /* the name is a nicety, not a requirement */ }

  const email = await emailOf(who.user.id);
  if (!email) return;
  const parentName = (who.parent && who.parent.full_name) || '';
  await sendEmail(email, `${kidName}'s starting-point note is ready`, emailShell(`
    <p style="margin:0 0 14px">Hi ${escHtml(parentName)},</p>
    <p style="margin:0 0 14px">${escHtml(kidName)} finished the first check, and the
       starting-point note is ready — a short read on where ${escHtml(kidName)} is
       starting from and what the practice will aim at first.</p>
    <p style="margin:0 0 20px;text-align:center">
      <a href="${APP_URL}" style="display:inline-block;background:#B8862F;color:#fff;
         text-decoration:none;padding:12px 28px;border-radius:999px">Open AraBuzz</a></p>
    <p style="margin:0 0 14px;font-size:13px;color:#4C5D5A">Tap <b>Grown-ups</b>, enter
       your PIN, and open <b>Coach Report</b>. The note never travels by email — it stays
       behind your PIN.</p>
    <p style="margin:0;font-size:13px;color:#4C5D5A">From here, a fresh note is published
       every <b>Wednesday morning</b> — as long as ${escHtml(kidName)} has done a couple
       of practice rounds in AraBuzz by then.</p>`));
}

const ADMIN_JOBS  = new Set(['read-deck', 'enrich', 'topic-list']);
const PARENT_JOBS = new Set(['coach-report', 'onboarding-report', 'memory-tricks', 'top-up', 'test']);

const MAX_TOKENS_CEILING = 24000;
const FAMILY_CALLS_PER_DAY = 40;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const who = await whoIs(req);
  if (!who) return send(res, 401, { error: 'Please sign in again.' });

  const b = req.body || {};
  const job = String(b.job || '');
  const model = String(b.model || '');
  const maxTokens = Math.min(Math.max(1, +b.maxTokens || 8000), MAX_TOKENS_CEILING);

  if (!ADMIN_JOBS.has(job) && !PARENT_JOBS.has(job)) {
    return send(res, 400, { error: `Unknown job "${job}"` });
  }
  if (ADMIN_JOBS.has(job) && !who.isAdmin) {
    return send(res, 403, { error: 'Only the admin can run this.' });
  }
  if (!ALLOWED_MODELS.has(model)) {
    return send(res, 400, { error: `Unknown model "${model}"` });
  }
  if (!b.tool || !b.tool.name || !b.content) {
    return send(res, 400, { error: 'Malformed request.' });
  }

  /* A family can only spend so much in a day. The admin is exempt — building
     a week's material is legitimately many calls in a row. */
  if (!who.isAdmin) {
    const since = new Date(Date.now() - 864e5).toISOString();
    const used = await serviceCount(
      `api_usage?family_id=eq.${who.parent.family_id}&ts=gte.${encodeURIComponent(since)}&select=id`);
    if (used >= FAMILY_CALLS_PER_DAY) {
      return send(res, 429, {
        error: 'That is plenty for one day — AraBuzz has a daily limit per family. It resets tomorrow.'
      });
    }
  }

  try {
    const { result, usage } = await askClaude({
      model, maxTokens,
      system: b.system || '',
      content: b.content,
      tool: b.tool
    });

    /* Recorded as the caller, so the ledger says who really spent it. */
    try {
      await rpcAsUser(who.token, 'record_usage', {
        p_kind: job,
        p_model: model,
        p_in_tok: usage.inTok,
        p_out_tok: usage.outTok,
        p_cost: usage.est,
        p_scope: ADMIN_JOBS.has(job) ? 'shared' : 'individual',
        p_child_id: b.childId || null,
        p_deck_id: b.deckId || null,
        p_detail: null
      });
    } catch (e) {
      console.warn('usage not recorded', e.message);
    }

    /* The first check's note just got written — tell the parent, the same
       way the Wednesday note does. Never fatal: the note itself is already
       on its way into the app regardless. */
    if (job === 'onboarding-report') {
      try { await emailOnboardingReady(who, b.childId || null); }
      catch (e) { console.warn('onboarding email not sent', e.message); }
    }

    return send(res, 200, { out: result, usage });
  } catch (e) {
    const status = e.status === 429 ? 429 : 502;
    return send(res, status, { error: e.message || 'The AI call failed.' });
  }
}
