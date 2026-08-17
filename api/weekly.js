/* ==========================================================================
   AraBuzz — api/weekly.js
   The weekly note, kept honestly weekly.

   Vercel wakes this once a day. For each child it asks one question: has
   enough genuinely happened since their last note to be worth a parent's
   attention? The bar is the agreed one — at least TWO sessions and TWENTY-FIVE
   answers since the last note, and the last note at least six days old. A
   child who didn't play this week simply doesn't get a note, which is far
   better than a note with nothing in it.

   When the bar is met, the note is written HERE, on the server, from the
   synced data — and the parent gets one short email saying it is ready. The
   note itself never travels by email; it stays behind the PIN in the app.
   ========================================================================== */

import {
  serviceGet, serviceCount, serviceWrite, rpcAsServer, emailOf,
  askClaude, sendEmail, emailShell, APP_URL, send
} from './_lib.js';

const MIN_SESSIONS = 2;
const MIN_ANSWERS = 25;
const MIN_DAYS_BETWEEN = 6;
const MODEL = 'claude-sonnet-5';

export default async function handler(req, res) {
  /* Only Vercel's own scheduler (which carries CRON_SECRET) may run this —
     it spends real money. */
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
  /* ---- has enough happened? ---- */
  const last = await serviceGet(
    `reports?child_id=eq.${kid.id}&order=ts.desc&limit=1&select=ts,payload`);
  const lastTs = last[0] ? last[0].ts : null;
  const prev = last[0] ? last[0].payload : null;

  if (lastTs && (Date.now() - Date.parse(lastTs)) < MIN_DAYS_BETWEEN * 864e5) {
    return 'a note went recently';
  }

  const sinceIso = lastTs || new Date(Date.now() - 14 * 864e5).toISOString();
  const since = encodeURIComponent(sinceIso);

  const sessions = await serviceCount(
    `sessions?child_id=eq.${kid.id}&ts=gte.${since}&select=id`);
  if (sessions < MIN_SESSIONS) return `only ${sessions} session(s)`;

  const answers = await serviceCount(
    `attempts?child_id=eq.${kid.id}&ts=gte.${since}&select=id`);
  if (answers < MIN_ANSWERS) return `only ${answers} answer(s)`;

  /* ---- gather what the note is built from ---- */
  const [attempts, progress, sessRows] = await Promise.all([
    serviceGet(`attempts?child_id=eq.${kid.id}&ts=gte.${since}` +
               `&select=ts,mode,given,ok,ms,errors,word_id&order=ts.desc&limit=400`),
    serviceGet(`progress?child_id=eq.${kid.id}` +
               `&select=word_id,box,seen,right_count,wrong_count,misspellings`),
    serviceGet(`sessions?child_id=eq.${kid.id}&ts=gte.${since}` +
               `&select=ts,kind,label,total,correct&order=ts.desc&limit=60`)
  ]);

  const wordIds = [...new Set(progress.map(p => p.word_id).filter(Boolean))];
  const words = {};
  for (let i = 0; i < wordIds.length; i += 80) {
    const part = wordIds.slice(i, i + 80);
    const rows = await serviceGet(`words?id=in.(${part.join(',')})&select=id,word`);
    rows.forEach(r => { words[r.id] = r.word; });
  }

  const payload = buildPayload(kid, attempts, progress, sessRows, words, prev, sinceIso);

  /* ---- write it ---- */
  const { result, usage } = await askClaude({
    model: MODEL, maxTokens: 12000,
    system: reportSystem(kid),
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    tool: REPORT_TOOL
  });

  await serviceWrite('reports', {
    child_id: kid.id,
    payload: { kind: 'weekly', result, metrics: payload.overall, period: payload.period },
    model: MODEL,
    range_from: sinceIso.slice(0, 10),
    range_to: new Date().toISOString().slice(0, 10)
  });

  try {
    await rpcAsServer('record_usage', {
      p_kind: 'coach-report', p_model: MODEL,
      p_in_tok: usage.inTok, p_out_tok: usage.outTok, p_cost: usage.est,
      p_scope: 'individual', p_child_id: kid.id, p_deck_id: null,
      p_detail: 'weekly cron'
    });
  } catch (e) { console.warn('usage not recorded', e.message); }

  /* ---- one short email; the note itself stays in the app ---- */
  const parents = await serviceGet(
    `parents?family_id=eq.${kid.family_id}&active=is.true&select=id,full_name`);
  for (const p of parents) {
    const email = await emailOf(p.id);
    if (!email) continue;
    await sendEmail(email, `${kid.name}'s note is ready`, emailShell(`
      <p style="margin:0 0 14px">Hi ${esc(p.full_name || '')},</p>
      <p style="margin:0 0 14px">${esc(kid.name)}'s weekly note is ready — a few minutes'
         read on what went well this week and the one or two things worth helping with.</p>
      <p style="margin:0 0 20px;text-align:center">
        <a href="${APP_URL}" style="display:inline-block;background:#B8862F;color:#fff;
           text-decoration:none;padding:12px 28px;border-radius:999px">Open AraBuzz</a></p>
      <p style="margin:0;font-size:13px;color:#4C5D5A">Tap the padlock, enter your PIN,
         and open <b>Coach Report</b>. The note never travels by email — it stays behind
         your PIN.</p>`));
  }
  return true;
}

/* ------------------------------------------------------------ the payload */
function buildPayload(kid, attempts, progress, sessions, words, prev, sinceIso) {
  const rate = list => list.length ? +(list.filter(a => a.ok).length / list.length).toFixed(2) : null;

  const patternCounts = {};
  let soundsRight = 0, typedWrong = 0;
  attempts.forEach(a => {
    const e = a.errors || {};
    if (!a.ok && a.given) {
      typedWrong++;
      if (e.soundsRight) soundsRight++;
      (e.tags || []).forEach(t => { patternCounts[t] = (patternCounts[t] || 0) + 1; });
    }
  });

  const wordRows = progress
    .filter(p => p.seen > 0)
    .map(p => ({
      word: words[p.word_id] || '',
      tries: p.seen, right: p.right_count,
      accuracy: +(p.right_count / p.seen).toFixed(2),
      box: p.box || 0,
      spellings: (p.misspellings || []).slice(-5)
    }))
    .filter(r => r.word)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 60);

  const activeDays = new Set(attempts.map(a => String(a.ts).slice(0, 10))).size;

  return {
    name: kid.name,
    pronoun: kid.pronoun || 'they',
    child: { name: kid.name, pronoun: kid.pronoun || 'they', ageYears: 9, curriculum: 'IB PYP' },
    period: { from: sinceIso.slice(0, 10), to: new Date().toISOString().slice(0, 10) },
    baseline: kid.baseline || null,
    overall: {
      answers: attempts.length,
      accuracy: rate(attempts),
      sessions: sessions.length,
      activeDays,
      wordsMastered: progress.filter(p => (p.box || 0) >= 5).length,
      wordsMet: progress.filter(p => p.seen > 0).length,
      soundsRightShare: typedWrong ? +(soundsRight / typedWrong).toFixed(2) : null
    },
    errorPatterns: Object.entries(patternCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([tag, count]) => ({ tag, count })),
    words: wordRows,
    previousReport: prev && prev.result ? {
      headline: prev.result.headline || '',
      wordsToDrill: prev.result.wordsToDrill || [],
      metrics: prev.metrics || null
    } : null
  };
}

/* ------------------------------------------------- the prompt, server copy */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function pronounLine(name, key) {
  if (key === 'she') return `Refer to ${name} as "she/her". Never use any other pronoun about ${name}.`;
  if (key === 'he') return `Refer to ${name} as "he/him". Never use any other pronoun about ${name}.`;
  return `Refer to ${name} as "they/them" (singular they — "they spell", "they are"). Never use "he" or "she" about ${name}.`;
}

function reportSystem(kid) {
  const name = kid.name;
  return `You are a warm, experienced primary literacy coach writing a private report to a
parent about their own child. You have their real practice data in front of you.

The child is called ${name}. ${pronounLine(name, kid.pronoun)}
Getting this wrong is worse than saying nothing — a parent notices immediately.

Rules:
• Write the way a good teacher talks at a parents' evening — plain, specific, kind.
• EVIDENCE IS EVERYTHING. Never make a claim without quoting a real spelling ${name}
  produced or a real number from the data.
• Be honest about weaknesses, but always pair a problem with what to do about it.
• Writing words the way they sound is a common failure mode at this age. If the data
  shows it, explain why it happens and that it is normal and fixable. If it does not
  show it, do not claim it.
• Never use "weak", "poor", "behind" or "struggling" — say "not yet", "still growing",
  "still tricky".
• If previousReport is present, say plainly what has moved since it and whether last
  time's advice appears to have worked. Parents lose trust in a report that claims
  progress every time.`;
}

const REPORT_TOOL = {
  name: 'record_coach_report',
  description: 'Record the parent report.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One warm sentence a parent reads first, naming the single most important thing this week. Under 28 words.' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      whereTheyAre: { type: 'string', description: 'Two or three short paragraphs on where the child stands, quoting their actual spellings in double quotes as evidence. Address the parent as "you" and the child by name, with the pronouns given.' },
      strengths: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', properties: {
        title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] } },
      patterns: { type: 'array', minItems: 0, maxItems: 4, items: { type: 'object', properties: {
        pattern: { type: 'string' }, meaning: { type: 'string' }, example: { type: 'string' } },
        required: ['pattern', 'meaning'] } },
      thisWeek: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', properties: {
        action: { type: 'string' }, why: { type: 'string' }, minutes: { type: 'integer' } },
        required: ['action', 'why', 'minutes'] } },
      wordsToDrill: { type: 'array', minItems: 3, maxItems: 12, items: { type: 'string' } },
      motivation: { type: 'string' },
      sinceLastReport: { type: 'string' },
      sayToThem: { type: 'string', description: 'One or two sentences the parent can say to the child, word for word.' }
    },
    required: ['headline', 'confidence', 'whereTheyAre', 'strengths', 'patterns',
               'thisWeek', 'wordsToDrill', 'motivation', 'sinceLastReport', 'sayToThem']
  }
};
