/* ==========================================================================
   AraBuzz — api/_report.js
   Writing a coach note. One implementation, three callers.

   The Wednesday cron writes notes. A parent asking for one out of turn ends
   up here too, once an admin has approved it. Both should produce the same
   kind of note, so both come through this file.

   WHAT CHANGED, AND WHY
   Prem read the first two notes and said the honest thing: "it is not that
   detailed". He was right. The old payload showed the model one period of
   data and, at most, the headline of the previous note. A note written from
   that can only ever describe a moment. A parent does not want a moment —
   they want to know whether the last fortnight moved anything, which of the
   things they were asked to work on actually got fixed, and what the marked
   worksheets say that the app's own games do not.

   So the note is now written from:

     history        every previous note's numbers, so the model can say
                    "up from 31%" instead of "she is at 49%".
     sinceLast      each word the last note asked them to drill, with its
                    accuracy then and now — the direct answer to "did the
                    advice work?".
     movement       words that climbed a practice box since the last note,
                    and words that slipped back.
     patternTrend   each kind of mistake counted in this period AND in the
                    period before it, so "still doing it" and "stopped doing
                    it" are facts rather than impressions.
     byMode         accuracy per game, which is how you tell a spelling
                    problem from a typing-under-time-pressure problem.
     daily          answers per day, for the practice-habit chart.
     ownWork        words lifted off photographs of her real schoolwork, kept
                    separate from the school's lists — the outside evidence.
     baseline       where they started, so the whole arc is in one place.
   ========================================================================== */

import { serviceGet, serviceCount, serviceWrite, rpcAsServer, askClaude } from './_lib.js';

export const MODEL = 'claude-sonnet-5';

/* The Wednesday bar. A child who did not practise does not get a note. */
export const MIN_SESSIONS = 2;
export const MIN_ANSWERS = 25;
export const MIN_DAYS_BETWEEN = 2;

const day = ts => String(ts).slice(0, 10);

/* ------------------------------------------------------------ gathering -- */

/**
 * Everything a note is written from. `windowDays` only matters when the child
 * has never had a note before.
 */
export async function gather(kid, opts) {
  const o = opts || {};

  /* Every note this child has ever had, newest first. The first is the
     "previous note"; all of them together are the trend. */
  const past = await serviceGet(
    `reports?child_id=eq.${kid.id}&order=ts.desc&limit=8` +
    `&select=id,ts,range_from,range_to,payload`);

  const prevRow = past[0] || null;
  const prev = prevRow ? prevRow.payload : null;
  const lastTs = prevRow ? prevRow.ts : null;

  const sinceIso = lastTs || new Date(Date.now() - (o.windowDays || 14) * 864e5).toISOString();
  const since = encodeURIComponent(sinceIso);

  /* The period BEFORE this one, of the same length, so every pattern can be
     reported as a change rather than a level. */
  const spanMs = Math.max(864e5, Date.now() - Date.parse(sinceIso));
  const beforeIso = new Date(Date.parse(sinceIso) - spanMs).toISOString();
  const before = encodeURIComponent(beforeIso);

  const [sessions, answers, rightCount] = await Promise.all([
    serviceCount(`sessions?child_id=eq.${kid.id}&ts=gte.${since}&select=id`),
    serviceCount(`attempts?child_id=eq.${kid.id}&ts=gte.${since}&select=id`),
    serviceCount(`attempts?child_id=eq.${kid.id}&ts=gte.${since}&ok=is.true&select=id`)
  ]);

  const [attempts, priorAttempts, progress, sessRows] = await Promise.all([
    serviceGet(`attempts?child_id=eq.${kid.id}&ts=gte.${since}` +
               `&select=ts,mode,given,ok,ms,errors,word_id&order=ts.desc&limit=400`),
    serviceGet(`attempts?child_id=eq.${kid.id}&ts=gte.${before}&ts=lt.${since}` +
               `&select=ts,mode,given,ok,errors,word_id&order=ts.desc&limit=400`),
    serviceGet(`progress?child_id=eq.${kid.id}` +
               `&select=word_id,box,seen,right_count,wrong_count,misspellings,first_seen,last_seen`),
    serviceGet(`sessions?child_id=eq.${kid.id}&ts=gte.${since}` +
               `&select=ts,kind,label,total,correct&order=ts.desc&limit=60`)
  ]);

  /* Word names, and which list each word came from — the school's, or a
     photograph of this child's own marked work. A note that cannot tell
     those apart cannot say anything useful about either. */
  const wordIds = [...new Set(
    progress.map(p => p.word_id).concat(attempts.map(a => a.word_id)).filter(Boolean))];
  const words = {}, ownWordIds = new Set();
  for (let i = 0; i < wordIds.length; i += 60) {
    const part = wordIds.slice(i, i + 60);
    const rows = await serviceGet(
      `words?id=in.(${part.join(',')})&select=id,word,deck_id,decks(id,title,child_id,source_name)`);
    rows.forEach(r => {
      words[r.id] = r.word;
      if (r.decks && r.decks.child_id) ownWordIds.add(r.id);
    });
  }

  return { kid, past, prev, prevRow, lastTs, sinceIso, beforeIso,
           sessions, answers, rightCount, attempts, priorAttempts,
           progress, sessRows, words, ownWordIds };
}

/* ------------------------------------------------------------- payload --- */

export function buildPayload(g) {
  const { kid, attempts, priorAttempts, progress, sessRows, words, ownWordIds, prev, past } = g;
  const rate = list => list.length ? +(list.filter(a => a.ok).length / list.length).toFixed(2) : null;

  /* ---- mistakes, this period and the one before it ---- */
  const tally = list => {
    const counts = {}; let soundsRight = 0, typedWrong = 0;
    list.forEach(a => {
      const e = a.errors || {};
      if (!a.ok && a.given) {
        typedWrong++;
        if (e.soundsRight) soundsRight++;
        (e.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
      }
    });
    return { counts, soundsRight, typedWrong };
  };
  const now = tally(attempts), then = tally(priorAttempts);

  const patternTrend = [...new Set(Object.keys(now.counts).concat(Object.keys(then.counts)))]
    .map(tag => ({
      tag,
      now: now.counts[tag] || 0,
      before: then.counts[tag] || 0,
      /* Rates, not raw counts — she may simply have played more this time. */
      nowRate: now.typedWrong ? +((now.counts[tag] || 0) / now.typedWrong).toFixed(2) : null,
      beforeRate: then.typedWrong ? +((then.counts[tag] || 0) / then.typedWrong).toFixed(2) : null
    }))
    .sort((a, b) => b.now - a.now)
    .slice(0, 10);

  /* ---- word by word ---- */
  const wordRows = progress
    .filter(p => p.seen > 0)
    .map(p => ({
      word: words[p.word_id] || '',
      tries: p.seen, right: p.right_count,
      accuracy: +(p.right_count / p.seen).toFixed(2),
      box: p.box || 0,
      fromOwnWork: ownWordIds.has(p.word_id) || undefined,
      spellings: (p.misspellings || []).slice(-5)
    }))
    .filter(r => r.word)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 60);

  const byWordName = {};
  wordRows.forEach(r => { byWordName[r.word.toLowerCase()] = r; });

  /* ---- did the last note's advice work? ----
     The single most useful thing a second note can contain, and the thing
     the old payload had no way of answering. */
  const prevWords = (prev && prev.result && prev.result.wordsToDrill) || [];
  const prevByWord = {};
  ((prev && prev.words) || []).forEach(x => { if (x && x.word) prevByWord[x.word.toLowerCase()] = x; });

  const sinceLast = prevWords.map(w => {
    const key = String(w).toLowerCase();
    const nowRow = byWordName[key];
    const wasRow = prevByWord[key];
    if (!nowRow) return { word: w, verdict: 'not practised since' };
    const wasAcc = wasRow ? wasRow.accuracy : null;
    const d = wasAcc == null ? null : +(nowRow.accuracy - wasAcc).toFixed(2);
    return {
      word: w,
      accuracyBefore: wasAcc,
      accuracyNow: nowRow.accuracy,
      change: d,
      box: nowRow.box,
      verdict: nowRow.box >= 4 || nowRow.accuracy >= 0.9 ? 'looks fixed'
             : d != null && d >= 0.15 ? 'clearly better'
             : d != null && d <= -0.15 ? 'gone backwards'
             : nowRow.accuracy < 0.5 ? 'still hard'
             : 'about the same',
      recentSpellings: nowRow.spellings
    };
  });

  /* ---- boxes moved ---- */
  const prevBoxes = {};
  ((prev && prev.words) || []).forEach(x => { if (x && x.word) prevBoxes[x.word.toLowerCase()] = x.box; });
  const movement = wordRows
    .map(r => ({ word: r.word, box: r.box, wasBox: prevBoxes[r.word.toLowerCase()] }))
    .filter(r => r.wasBox != null && r.wasBox !== r.box)
    .map(r => ({ ...r, direction: r.box > r.wasBox ? 'up' : 'down' }));

  /* ---- which games ---- */
  const modes = {};
  attempts.forEach(a => {
    const m = a.mode || 'other';
    modes[m] = modes[m] || { mode: m, n: 0, right: 0 };
    modes[m].n++; if (a.ok) modes[m].right++;
  });
  const byMode = Object.values(modes)
    .filter(m => m.n >= 3)
    .map(m => ({ mode: m.mode, answers: m.n, accuracy: +(m.right / m.n).toFixed(2) }))
    .sort((a, b) => b.answers - a.answers);

  /* ---- practice habit, day by day ---- */
  const dayMap = {};
  attempts.forEach(a => {
    const d = day(a.ts);
    dayMap[d] = dayMap[d] || { day: d, answers: 0, right: 0 };
    dayMap[d].answers++; if (a.ok) dayMap[d].right++;
  });
  const daily = Object.values(dayMap).sort((a, b) => a.day < b.day ? -1 : 1);

  /* ---- her own marked schoolwork ----
     Words that came off a photograph of real work the teacher has seen, as
     opposed to the school's published list. Where the two disagree is the
     most interesting sentence in any note. */
  const ownWork = wordRows.filter(r => r.fromOwnWork)
    .map(r => ({ word: r.word, tries: r.tries, accuracy: r.accuracy, spellings: r.spellings }));

  /* ---- the arc across every note so far ---- */
  const history = (past || []).slice().reverse().map(r => ({
    on: day(r.ts),
    headline: (r.payload && r.payload.result && r.payload.result.headline) || '',
    metrics: (r.payload && r.payload.metrics) || null,
    askedToDrill: (r.payload && r.payload.result && r.payload.result.wordsToDrill) || []
  })).filter(h => h.metrics);

  const activeDays = daily.length;

  const overall = {
    answers: attempts.length,
    accuracy: rate(attempts),
    sessions: sessRows.length,
    activeDays,
    wordsMastered: progress.filter(p => (p.box || 0) >= 5).length,
    wordsMet: progress.filter(p => p.seen > 0).length,
    soundsRightShare: now.typedWrong ? +(now.soundsRight / now.typedWrong).toFixed(2) : null
  };

  const priorOverall = priorAttempts.length ? {
    answers: priorAttempts.length,
    accuracy: rate(priorAttempts),
    soundsRightShare: then.typedWrong ? +(then.soundsRight / then.typedWrong).toFixed(2) : null
  } : null;

  return {
    name: kid.name,
    pronoun: kid.pronoun || 'they',
    child: { name: kid.name, pronoun: kid.pronoun || 'they', ageYears: 9, curriculum: 'IB PYP' },
    period: { from: g.sinceIso.slice(0, 10), to: new Date().toISOString().slice(0, 10) },
    baseline: kid.baseline || null,
    overall,
    previousPeriod: priorOverall,
    history,
    sinceLast,
    movement,
    patternTrend,
    byMode,
    daily,
    ownWork,
    errorPatterns: patternTrend.slice(0, 8).map(p => ({ tag: p.tag, count: p.now })),
    words: wordRows,
    previousReport: prev && prev.result ? {
      on: g.lastTs ? day(g.lastTs) : null,
      headline: prev.result.headline || '',
      wordsToDrill: prev.result.wordsToDrill || [],
      thisWeek: (prev.result.thisWeek || []).map(x => x && x.action).filter(Boolean),
      metrics: prev.metrics || null
    } : null
  };
}

/* -------------------------------------------------------------- prompts -- */

function pronounLine(name, key) {
  if (key === 'she') return `Refer to ${name} as "she/her". Never use any other pronoun about ${name}.`;
  if (key === 'he') return `Refer to ${name} as "he/him". Never use any other pronoun about ${name}.`;
  return `Refer to ${name} as "they/them" (singular they — "they spell", "they are"). Never use "he" or "she" about ${name}.`;
}

export function reportSystem(kid, opts) {
  const name = kid.name;
  const o = opts || {};
  return `You are a warm, experienced primary literacy coach writing a private report to a
parent about their own child. You have their real practice data in front of you.

The child is called ${name}. ${pronounLine(name, kid.pronoun)}
Getting this wrong is worse than saying nothing — a parent notices immediately.
${o.onRequest ? `
This note was ASKED FOR by the parent, out of the normal Wednesday rhythm. Write it as
a full note, not a summary. Do not mention that it was requested, approved, or that it
is out of turn.` : ''}

WHAT MAKES THIS NOTE WORTH READING

A parent already knows their child is finding spelling hard. What they cannot see, and
what only you can tell them, is MOVEMENT. Every claim in this note should be a
comparison, not a level:

• "up from 31% a fortnight ago" beats "she is at 49%".
• "you were asked to drill lifestyle last time; it has gone from 0/5 to 4/6" beats
  "lifestyle is still tricky".
• "the missing-double-letter mistake has gone from a third of her errors to a tenth"
  beats "she sometimes misses double letters".

You are given \`history\` (the numbers behind every previous note), \`previousPeriod\`
(the same length of time immediately before this one), \`sinceLast\` (what happened to
each word the last note asked them to practise), \`movement\` (words that climbed or
slipped a practice box) and \`patternTrend\` (each kind of mistake counted now AND
before). USE THEM. A note that ignores them is the note we are replacing.

If this is the first note, say so plainly and describe the starting point instead —
do not invent a trend.

RULES

• Write the way a good teacher talks at a parents' evening — plain, specific, kind.
• EVIDENCE IS EVERYTHING. Never make a claim without quoting a real spelling ${name}
  produced or a real number from the data. Quote the child's actual spellings.
• Be honest about what has NOT moved. A note that finds progress every single time is
  worthless, and parents can tell. If something went backwards, say so, kindly, with
  the number.
• Pair every problem with something concrete to do about it.
• Writing words the way they sound is a common failure mode at this age. If the data
  shows it, explain why it happens and that it is normal and fixable. If it does not
  show it, do not claim it.
• \`ownWork\` holds words lifted from photographs of ${name}'s real, marked schoolwork
  — not the school's published list. If there is anything there, it is the most
  valuable evidence in the whole payload, because it is what the teacher actually saw.
  Say what it shows and whether it agrees with the practice data. If they disagree,
  that disagreement is the most useful sentence you can write.
• \`byMode\` is accuracy per game. A child who is fine in Spell Buzz and poor in Word
  Rush has a speed problem, not a spelling problem. Say which it is.
• Never use "weak", "poor", "behind" or "struggling" — say "not yet", "still growing",
  "still tricky".
• Never mention money, cost, tokens, subscriptions or anything being paid for.
• Do not describe problems with the data itself. Write about the child.`;
}

export const REPORT_TOOL = {
  name: 'record_coach_report',
  description: 'Record the parent report.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One warm sentence a parent reads first, naming the single most important CHANGE since the last note. Under 28 words.' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      whereTheyAre: { type: 'string', description: 'Three or four short paragraphs on where the child stands, quoting their actual spellings in double quotes and real numbers as evidence. Address the parent as "you" and the child by name, with the pronouns given.' },

      trend: {
        type: 'object',
        description: 'The honest direction of travel since the last note. If there is no previous note, set direction to "first" and say so in evidence.',
        properties: {
          direction: { type: 'string', enum: ['up', 'flat', 'down', 'mixed', 'first'] },
          evidence: { type: 'string', description: 'One or two sentences quoting the specific numbers that justify the direction.' }
        },
        required: ['direction', 'evidence']
      },

      fixed: {
        type: 'array', minItems: 0, maxItems: 5,
        description: 'Things that genuinely got better since the last note — a word, a mistake pattern, a habit. Empty is a valid and honest answer.',
        items: { type: 'object', properties: {
          thing: { type: 'string' },
          evidence: { type: 'string', description: 'The numbers or spellings that show it.' } },
          required: ['thing', 'evidence'] }
      },

      stillHard: {
        type: 'array', minItems: 0, maxItems: 5,
        description: 'Things that have not moved, or have gone backwards, since the last note.',
        items: { type: 'object', properties: {
          thing: { type: 'string' },
          evidence: { type: 'string' },
          whatToTry: { type: 'string', description: 'Something different from what was suggested last time.' } },
          required: ['thing', 'evidence', 'whatToTry'] }
      },

      fromSchoolwork: { type: 'string', description: 'What the photographed, marked schoolwork shows, and whether it agrees with what the app sees. Empty string if there is no own-work data.' },

      howTheyPractise: { type: 'string', description: 'One short paragraph on the shape of their practice — which games, how often, whether it is spread out or crammed, and what that suggests. Use byMode and daily.' },

      strengths: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', properties: {
        title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] } },
      patterns: { type: 'array', minItems: 0, maxItems: 4, items: { type: 'object', properties: {
        pattern: { type: 'string' }, meaning: { type: 'string' }, example: { type: 'string' },
        movement: { type: 'string', description: 'Whether this pattern is more or less common than in the period before, with the numbers.' } },
        required: ['pattern', 'meaning'] } },
      thisWeek: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', properties: {
        action: { type: 'string' }, why: { type: 'string' }, minutes: { type: 'integer' } },
        required: ['action', 'why', 'minutes'] } },
      wordsToDrill: { type: 'array', minItems: 3, maxItems: 12, items: { type: 'string' } },
      motivation: { type: 'string' },
      sinceLastReport: { type: 'string' },
      sayToThem: { type: 'string', description: 'One or two sentences the parent can say to the child, word for word.' }
    },
    required: ['headline', 'confidence', 'whereTheyAre', 'trend', 'fixed', 'stillHard',
               'fromSchoolwork', 'howTheyPractise', 'strengths', 'patterns',
               'thisWeek', 'wordsToDrill', 'motivation', 'sinceLastReport', 'sayToThem']
  }
};

/* ---------------------------------------------------------------- write -- */

/**
 * Write one note and file it. Returns { id, usage, payload }.
 * `opts.detail` is what shows in the usage log; `opts.onRequest` marks a note
 * a parent asked for.
 */
export async function writeNote(g, opts) {
  const o = opts || {};
  const payload = buildPayload(g);
  const kid = g.kid;

  const { result, usage } = await askClaude({
    model: MODEL, maxTokens: 14000,
    system: reportSystem(kid, o),
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    tool: REPORT_TOOL
  });

  const rows = await serviceWrite('reports', {
    child_id: kid.id,
    payload: {
      kind: o.onRequest ? 'on-request' : 'weekly',
      onRequest: !!o.onRequest,
      /* Carried with the note so the app writes headings about the right
         child. Four of the nine children are boys; a note that says "how she
         practises" about a boy is the kind of mistake a parent notices
         immediately and never quite forgets. */
      pronoun: kid.pronoun || 'they',
      result,
      metrics: payload.overall,
      period: payload.period,
      /* Everything the note was written from, kept beside it. The app draws
         its charts from these — and a parent who wants to check a claim can
         see the working rather than taking the prose on faith. */
      history: payload.history,
      sinceLast: payload.sinceLast,
      patternTrend: payload.patternTrend,
      byMode: payload.byMode,
      daily: payload.daily,
      movement: payload.movement,
      ownWork: payload.ownWork,
      previousPeriod: payload.previousPeriod,
      words: payload.words,
      evidence: {
        from: g.sinceIso,
        to: new Date().toISOString(),
        totals: { sessions: g.sessions, answers: g.answers,
                  right: g.rightCount, wrong: g.answers - g.rightCount },
        sessions: g.sessRows.slice(0, 40).map(x => ({
          ts: x.ts, label: x.label || x.kind || 'Practice',
          total: x.total || 0, correct: x.correct || 0
        }))
      }
    },
    model: MODEL,
    range_from: g.sinceIso.slice(0, 10),
    range_to: new Date().toISOString().slice(0, 10)
  });

  const id = rows && rows[0] ? rows[0].id : null;

  try {
    await rpcAsServer('record_usage', {
      p_kind: 'coach-report', p_model: MODEL,
      p_in_tok: usage.inTok, p_out_tok: usage.outTok, p_cost: usage.est,
      p_scope: 'individual', p_child_id: kid.id, p_deck_id: null,
      p_detail: o.detail || 'weekly cron'
    });
  } catch (e) { console.warn('usage not recorded', e.message); }

  return { id, usage, payload, result };
}
