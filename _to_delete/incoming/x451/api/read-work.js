/* ==========================================================================
   api/read-work.js — reading a marked page of a child's own schoolwork.

   Prem photographed Aradhana's Charlotte's Web workbook: her writing in
   pencil, her teacher's corrections in green pen above it. On one page:
   spayder → spider, dayd → died, haul → how, moching → watching, smol →
   small, asced → asked, Mer is → where is. Not one of those words has ever
   appeared on a Spell Buzz sheet, and every one of them is a phonetic
   speller spelling exactly what she hears.

   That is the most valuable spelling data in this project and it was sitting
   in a folder. This reads it.

   TWO RULES, AND THEY MATTER MORE THAN THE FEATURE
   1. Nothing found here is ever practised until a parent has looked at it and
      said yes. Handwriting is hard to read, a teacher's cursive harder, and
      the one unforgivable bug in a spelling app is teaching a child a word
      that is wrong. This endpoint therefore RETURNS findings; it does not
      save them anywhere.
   2. The photograph is never stored. It is read, findings come back, and it
      is gone — nothing is written to disk, to storage, or to the database.
      A picture of a child's schoolwork is not ours to keep.
   ========================================================================== */

import { whoIs, serviceCount, rpcAsUser, serviceGet, send } from './_lib.js';

const MODEL = 'claude-sonnet-5';          // handwriting deserves the better eyes
const MAX_TOKENS = 4000;
const PAGES_PER_FAMILY_PER_DAY = 40;
const MAX_BYTES = 5_500_000;              // ~4 MB of image once base64-decoded

const FINDINGS_TOOL = {
  name: 'findings',
  description: 'Everything the teacher marked on this page.',
  input_schema: {
    type: 'object',
    properties: {
      readable: { type: 'boolean', description: 'False if the photo is too blurry, too dark or too far away to read confidently.' },
      note: { type: 'string', description: 'If not readable, one short sentence telling the parent what would help — closer, straighter, more light.' },
      pageTitle: { type: 'string', description: 'What this worksheet is, in a few words, from its heading. E.g. "Charlotte\'s Web — Story Summary".' },
      marked: { type: 'boolean', description: 'True if a teacher has written corrections on this page — usually in a different colour or a grown-up hand. False if it is the child\'s work alone, unmarked.' },
      spellings: {
        type: 'array',
        description: 'Every word the child spelled wrongly that the teacher corrected. One entry per word.',
        items: {
          type: 'object',
          properties: {
            written: { type: 'string', description: 'Exactly what the child wrote, letter for letter.' },
            correct: { type: 'string', description: 'The correct spelling, as the teacher wrote it.' },
            confident: { type: 'boolean', description: 'False if you are unsure you read either word correctly.' },
            sameSound: { type: 'boolean', description: 'True if what she wrote would sound roughly right if read aloud (spayder for spider), false if it is a different word entirely (with for that).' }
          },
          required: ['written', 'correct', 'confident', 'sameSound']
        }
      },
      spotted: {
        type: 'array',
        description: 'ONLY for an unmarked page: words YOU believe are misspelled, that no teacher has corrected. Leave empty on a marked page. Be strict — see the rules.',
        items: {
          type: 'object',
          properties: {
            written: { type: 'string', description: 'Exactly what the child wrote, letter for letter.' },
            correct: { type: 'string', description: 'The standard spelling of the word she was reaching for.' },
            confident: { type: 'boolean', description: 'False unless you are certain both that you read her writing correctly and that it is genuinely misspelled.' },
            sameSound: { type: 'boolean', description: 'True if what she wrote would sound roughly right read aloud.' }
          },
          required: ['written', 'correct', 'confident', 'sameSound']
        }
      },
      other: {
        type: 'array',
        description: 'Corrections that are NOT spelling — a missing capital, a wrong word choice, a tense, a missing full stop. For the parent to read, not to drill.',
        items: {
          type: 'object',
          properties: {
            wrote: { type: 'string' },
            shouldBe: { type: 'string' },
            kind: { type: 'string', description: 'capital | punctuation | grammar | word choice' }
          },
          required: ['wrote', 'shouldBe', 'kind']
        }
      }
    },
    required: ['readable', 'marked', 'spellings', 'spotted', 'other']
  }
};

const SYSTEM = `You are reading a photograph of one page of a child's marked schoolwork, to find the words she spelled wrongly.

WHAT IS ON THE PAGE
The child's own writing, usually in pencil. Her teacher's corrections, usually in a different colour, written above or beside the mistake. The printed worksheet itself.

WHAT TO RETURN
Every place the teacher corrected a SPELLING: what the child actually wrote, letter for letter, and the correct spelling. Read her writing as carefully as you can — the whole point is her exact letters, so "spayder" must come back as "spayder" and not tidied into "spider".

RULES THAT MATTER
- Only report a correction that is actually on the page. Never guess at a word the teacher did not mark, and never invent a correction because a word looks odd to you. An empty list is a perfectly good answer.
- If you cannot read either the child's word or the teacher's correction with confidence, still report the pair but set confident to false. A parent will check it. Do not silently drop it and do not silently clean it up.
- Ignore the printed text of the worksheet. Only the handwriting matters.
- A capital letter, a full stop, a wrong word or a tense is NOT a spelling — those go in "other".
- If the photograph is too blurry, dark, angled or distant to read, set readable to false and say in one short sentence what would help. Do not squint and guess.
- Some pages will have no corrections at all. That is fine and common.

IS THE PAGE MARKED?
Decide first, and say so in "marked". A marked page has a teacher's corrections on it, usually in a different colour or an adult hand. An unmarked page is the child's work on its own.

IF THE PAGE IS UNMARKED
Nobody has checked this work, so YOU are being asked to. Put anything you find in "spotted", never in "spellings" — those two lists mean different things to the parent reading them, and one carries a teacher's authority while the other carries only your opinion.

Hold yourself to a much higher bar here, because a wrong flag teaches a child to doubt a word she had right:
- Flag a word ONLY if you can read her handwriting confidently AND you are certain the word is genuinely misspelled. If either is in doubt, leave it out entirely.
- Never flag a name, a place, a made-up story word, or anything that might be either.
- Never flag a word that is correct in British OR American spelling. Both are right.
- Never flag a word because a letter is oddly formed, back-to-front, or joined strangely. That is handwriting, not spelling.
- Never flag grammar, tense, capitals or punctuation as a spelling. Those go in "other".
- If you are not sure she meant the word you have in mind, leave it out. A short honest list beats a long confident one.
- Returning nothing is a perfectly good answer for an unmarked page too.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const who = await whoIs(req);
  if (!who || !who.parent) return send(res, 401, { error: 'Please sign in again.' });

  const b = req.body || {};
  const media = String(b.mediaType || 'image/jpeg');
  const data = String(b.image || '');
  const childId = String(b.childId || '');

  if (!data) return send(res, 400, { error: 'No picture came through.' });
  if (data.length > MAX_BYTES) {
    return send(res, 413, { error: 'That picture is very large — try again and it will be shrunk first.' });
  }
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(media)) {
    return send(res, 400, { error: 'That kind of picture cannot be read. A photo or a screenshot works.' });
  }

  /* The child must be one of this family's own. A parent reads their own
     children's work and nobody else's. */
  const kids = await serviceGet(
    `children?id=eq.${childId}&family_id=eq.${who.parent.family_id}&select=id,name`);
  if (!kids || !kids[0]) return send(res, 404, { error: 'No such child on this account.' });

  const since = new Date(Date.now() - 864e5).toISOString();
  const used = await serviceCount(
    `api_usage?family_id=eq.${who.parent.family_id}&kind=eq.read-work&ts=gte.${encodeURIComponent(since)}&select=id`);
  if (used >= PAGES_PER_FAMILY_PER_DAY) {
    return send(res, 429, { error: 'That is a lot of pages for one day — the rest can wait until tomorrow.' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data } },
            { type: 'text', text: 'Read this page. If a teacher has marked it, report every spelling they corrected. If nobody has marked it, tell me which words are misspelled — and only the ones you are certain about.' }
          ]
        }],
        tools: [FINDINGS_TOOL],
        tool_choice: { type: 'tool', name: 'findings' }
      })
    });

    if (!r.ok) {
      const t = await r.text();
      console.warn('[read-work]', r.status, t.slice(0, 200));
      return send(res, 502, { error: 'The page could not be read just now. Try again in a moment.' });
    }
    const json = await r.json();
    const block = (json.content || []).find(x => x.type === 'tool_use');
    if (!block) return send(res, 502, { error: 'Nothing came back from reading the page.' });

    const usage = json.usage || {};
    try {
      await rpcAsUser(who.token, 'record_usage', {
        p_kind: 'read-work', p_model: MODEL,
        p_in_tok: usage.input_tokens || 0, p_out_tok: usage.output_tokens || 0,
        p_cost: ((usage.input_tokens || 0) / 1e6) * 3 + ((usage.output_tokens || 0) / 1e6) * 15,
        p_scope: 'individual', p_child_id: childId, p_deck_id: null, p_detail: null
      });
    } catch (e) { console.warn('[read-work] usage not recorded', e.message); }

    const out = block.input || {};
    /* Tidy, not trusting: drop anything with an empty half, and never let a
       "correction" through that is identical to what she wrote. */
    const clean = (arr) => (Array.isArray(arr) ? arr : [])
      .map(x => ({
        written: String(x.written || '').trim(),
        correct: String(x.correct || '').trim(),
        confident: x.confident !== false,
        sameSound: !!x.sameSound
      }))
      .filter(x => x.written && x.correct &&
                   x.written.toLowerCase() !== x.correct.toLowerCase() &&
                   x.correct.length <= 40);

    const marked = out.marked !== false;
    /* The two lists must never blur into each other. A teacher's correction
       is a fact; the model's opinion is an opinion, and the parent reading
       the screen is entitled to know which is which. So an unmarked page
       returns nothing under "spellings", whatever the model put there. */
    return send(res, 200, {
      readable: out.readable !== false,
      marked,
      note: String(out.note || '').slice(0, 200),
      pageTitle: String(out.pageTitle || '').slice(0, 80),
      spellings: marked ? clean(out.spellings) : [],
      spotted: clean(out.spotted).slice(0, 30),
      other: (Array.isArray(out.other) ? out.other : []).slice(0, 20)
    });
  } catch (e) {
    console.warn('[read-work]', e.message);
    return send(res, 502, { error: 'The page could not be read just now. Try again in a moment.' });
  }
}
