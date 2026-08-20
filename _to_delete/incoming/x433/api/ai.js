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
  whoIs, askClaude, rpcAsUser, serviceCount, ALLOWED_MODELS, send
} from './_lib.js';

/* NOTE ON THE STARTING-POINT EMAIL — moved out of this file deliberately.

   It used to be sent right here, the moment the model returned the note. That
   is the wrong moment: the note has not been filed anywhere yet. If the device
   then failed to save it — a bad connection, or the crash we hit on a
   malformed result — the parent got an email about a note that did not exist
   and never would. That is exactly what happened to Aradhana's first note.

   The email now belongs to /api/note-ready, which the app calls only AFTER
   the note is safely in the `reports` table, and which checks the row is
   really there before sending anything. */

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

    return send(res, 200, { out: result, usage });
  } catch (e) {
    const status = e.status === 429 ? 429 : 502;
    return send(res, status, { error: e.message || 'The AI call failed.' });
  }
}
