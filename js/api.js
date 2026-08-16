/* ==========================================================================
   AraBuzz — api.js
   Talks to the Anthropic API straight from the browser.

   Call discipline (this is what keeps it cheap):
     • upload a deck        -> 1 call to READ it   (+1 to ENRICH after you approve)
     • enrichment is cached against the WORD, forever, across all weeks
     • variety top-ups are BATCHED — one call refreshes many words at once
     • mistake coaching is BATCHED at the end of a quiz, once per word ever
     • parent report        -> 1 call, on demand
   Nothing here ever blocks the child: every function has a local fallback.
   ========================================================================== */
(function (w) {
  'use strict';

  const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const VERSION = '2023-06-01';

  /** Normally we call Anthropic straight from the browser. `apiBase` lets a
   *  household point AraBuzz at their own small proxy instead, so the key never
   *  sits on the device — useful later if this is shared beyond the family. */
  function endpoint() {
    const base = (Store.db.settings.apiBase || '').trim();
    if (!base) return DEFAULT_ENDPOINT;
    return base.replace(/\/+$/, '') + '/v1/messages';
  }

  // Rough $/million tokens, only used for the parent-facing cost estimate.
  const RATES = {
    'claude-opus-5':   { in: 5,    out: 25 },
    'claude-sonnet-5': { in: 3,    out: 15 },
    'claude-fable-5':  { in: 1,    out: 5 },
    'claude-opus-4-8': { in: 5,    out: 25 },
    'claude-sonnet-4-6': { in: 3,  out: 15 },
    'claude-haiku-4-5-20251001': { in: 1, out: 5 },
    _default:          { in: 3,    out: 15 }
  };

  function cfg() { return Store.db.settings; }

  /** The key in Settings wins; otherwise the built-in one from config.js. */
  function key() {
    const own = (cfg().apiKey || '').trim();
    return own || ((window.CONFIG && CONFIG.DEFAULT_API_KEY) || '').trim();
  }
  function hasKey() { return !!key(); }
  function usingOwnKey() { return !!(cfg().apiKey || '').trim(); }

  /** Which model runs this job. A per-job override beats the policy. */
  function modelFor(kind) {
    const s = cfg();
    if (s.modelOverrides && s.modelOverrides[kind]) return s.modelOverrides[kind];
    const pol = (window.CONFIG && CONFIG.POLICIES[s.modelPolicy || CONFIG.DEFAULT_POLICY]);
    if (pol && pol.models[kind]) return pol.models[kind];
    return s.model || 'claude-sonnet-5';
  }

  function estCost(model, i, o) {
    const r = RATES[model] || RATES._default;
    return (i / 1e6) * r.in + (o / 1e6) * r.out;
  }

  /* ------------------------------------------------------------ core call */
  async function call(kind, { system, content, tool, maxTokens = 8000, model }) {
    if (!hasKey()) throw new Error('NO_KEY');
    const useModel = model || modelFor(kind);

    const body = {
      model: useModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name }
    };

    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key(),
        'anthropic-version': VERSION,
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let msg = res.status + '';
      try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) {}
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }

    const json = await res.json();
    const use = json.usage || {};
    Store.logUsage({
      kind, model: useModel,
      inTok: use.input_tokens || 0,
      outTok: use.output_tokens || 0,
      est: estCost(useModel, use.input_tokens || 0, use.output_tokens || 0)
    });

    const block = (json.content || []).find(b => b.type === 'tool_use');
    if (!block) throw new Error('Model returned no structured result');
    if (json.stop_reason === 'max_tokens') {
      throw new Error('The answer was cut short — try a smaller batch.');
    }
    return block.input;
  }

  /** Very occasionally a model hands back an array field as a JSON string.
   *  Rather than crash a whole upload over it, straighten it out. */
  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch (e) {}
    }
    if (v && typeof v === 'object') return Object.values(v).filter(x => x && typeof x === 'object');
    return [];
  }

  /* ======================================================================
     1. READ A DECK  — deliberately format-agnostic.
     The three sample sheets from school were all laid out differently
     (different titles, some with an intro blurb, some without, dates written
     two different ways). So we never pattern-match: we hand the whole thing
     to Claude and ask it to find the word/meaning pairs wherever they sit.
     ====================================================================== */
  const READ_TOOL = {
    name: 'record_spelling_list',
    description: 'Record the weekly spelling list found in the document.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short human title, e.g. "Spell Buzz — Circulatory System"' },
        topic: { type: 'string', description: 'The subject/theme the words belong to, e.g. "The Circulatory System". Empty string if unclear.' },
        sentOn: { type: 'string', description: 'Date the list was sent, as ISO YYYY-MM-DD. Empty string if absent. Note dates in these documents are day/month/year.' },
        assessedOn: { type: 'string', description: 'Date of the test, ISO YYYY-MM-DD. Empty string if absent.' },
        words: {
          type: 'array',
          description: 'Every word or term in the list, in the order given.',
          items: {
            type: 'object',
            properties: {
              word: { type: 'string', description: 'The term exactly as spelled in the document, keeping hyphens and spaces (e.g. "Well-being", "Red Blood Cells").' },
              meaning: { type: 'string', description: 'The meaning exactly as given in the document, tidied of line-break artefacts.' }
            },
            required: ['word', 'meaning']
          }
        },
        notes: { type: 'string', description: 'Anything odd you noticed, e.g. "two words had no meaning given". Empty string if all clean.' }
      },
      required: ['title', 'topic', 'sentOn', 'assessedOn', 'words', 'notes']
    }
  };

  const READ_SYSTEM =
`You extract weekly spelling lists from school documents.

These are made by hand by a teacher, so the layout changes week to week: sometimes
there is an explanatory paragraph first, sometimes not; the heading may be
"SpellBuzz" or "Spell Buzz"; dates may be labelled "Sent on", "To be assessed on"
or "Assessed on"; the list may be a table, or plain lines, or slides.

Ignore all boilerplate about the programme itself. Find only the actual
word/meaning pairs. Terms are often more than one word ("Nervous System",
"Voluntary Action", "Red Blood Cells") — keep them whole and keep the original
spelling and capitalisation. Dates are day/month/year. Convert to YYYY-MM-DD,
assuming 20xx for two-digit years.`;

  async function readDeck({ text, pdfBase64, imageBase64, imageType }) {
    const content = [];
    if (pdfBase64) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
      content.push({ type: 'text', text: 'Extract the weekly spelling list from this document.' });
    } else if (imageBase64) {
      content.push({ type: 'image', source: { type: 'base64', media_type: imageType || 'image/png', data: imageBase64 } });
      content.push({ type: 'text', text: 'Extract the weekly spelling list from this picture of the sheet.' });
    } else {
      content.push({ type: 'text', text: 'Extract the weekly spelling list from this document text:\n\n<document>\n' + text + '\n</document>' });
    }
    return call('read-deck', { system: READ_SYSTEM, content, tool: READ_TOOL, maxTokens: 8000 });
  }

  /* ======================================================================
     2. ENRICH WORDS — the one big call per week.
     Deliberately generous: 4 clues, 4 sentences, 6 misspellings and 4 wrong
     meanings per word, so the local engine can build hundreds of distinct
     questions afterwards with no further API use.
     ====================================================================== */
  const ENRICH_TOOL = {
    name: 'record_word_packs',
    description: 'Record the teaching pack for each word.',
    input_schema: {
      type: 'object',
      properties: {
        packs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              word: { type: 'string', description: 'The word, echoed back exactly.' },
              kidMeaning: { type: 'string', description: 'The meaning rewritten for a 9-year-old in one short sentence, max 18 words. Never contains the word itself or any part of it.' },
              syllables: { type: 'string', description: 'Word split by hyphens at syllable breaks, e.g. "cer-e-bel-lum".' },
              pronunciation: { type: 'string', description: 'Simple respelling with the stressed part in capitals, e.g. "seh-ruh-BEL-um".' },
              partOfSpeech: { type: 'string', description: 'noun, verb, adjective, or phrase.' },
              clues: {
                type: 'array', minItems: 4, maxItems: 4,
                description: 'Four DIFFERENT riddle-style clues a child can solve to reach the word. Each under 20 words, each taking a different angle (what it does / where it is / what happens without it / an everyday example). CRITICAL: never include the word, any part of it, or an obvious root of it.',
                items: { type: 'string' }
              },
              sentences: {
                type: 'array', minItems: 4, maxItems: 4,
                description: 'Four different everyday sentences using the word, with the word itself replaced by exactly "______" (six underscores). Child-friendly, 8-16 words.',
                items: { type: 'string' }
              },
              crosswordClue: { type: 'string', description: 'A very short crossword-style clue, under 9 words. Must not contain the word.' },
              trickyBit: { type: 'string', description: 'The single spot children misspell most, in plain words a child understands, e.g. "two l\'s in the middle" or "it starts with a silent p".' },
              misspellings: {
                type: 'array', minItems: 6, maxItems: 6,
                description: 'Six realistic WRONG spellings a 9-year-old would produce. At least three must be phonetic (spelled the way it sounds, e.g. "nervus" for "nervous"). Others: dropped double letter, swapped vowel pair, missing silent letter.',
                items: { type: 'string' }
              },
              wrongMeanings: {
                type: 'array', minItems: 4, maxItems: 4,
                description: 'Four plausible but WRONG definitions, same style and length as a real one. They should be tempting, not silly — ideally about related things in the same topic.',
                items: { type: 'string' }
              },
              funFact: { type: 'string', description: 'One surprising kid-friendly fact about this thing, under 22 words.' }
            },
            required: ['word', 'kidMeaning', 'syllables', 'pronunciation', 'partOfSpeech', 'clues',
                       'sentences', 'crosswordClue', 'trickyBit', 'misspellings', 'wrongMeanings', 'funFact']
          }
        }
      },
      required: ['packs']
    }
  };

  const ENRICH_SYSTEM =
`You are an experienced primary-school literacy specialist building practice
material for a 9-year-old in an IB PYP school. She learned to read through
Montessori phonics, so she spells words the way they sound and needs to build
the visual/orthographic memory of each word.

Write everything in British English spelling conventions, matching the school.
Keep language warm, concrete and simple — no words harder than the target word
itself in the clues. Clues must be solvable, never vague.`;

  /** Each word's pack is around 400 output tokens, so a long list is split into
   *  batches. One request for forty words is slow and risks running into the
   *  output ceiling half-way through a word; three smaller ones are quicker,
   *  cost the same, and let the parent watch it progress. */
  const ENRICH_BATCH = 12;

  async function enrich(words, topic, onProgress) {
    const batches = [];
    for (let i = 0; i < words.length; i += ENRICH_BATCH) batches.push(words.slice(i, i + ENRICH_BATCH));

    const out = [];
    for (let i = 0; i < batches.length; i++) {
      if (onProgress) onProgress(out.length, words.length, i + 1, batches.length);
      const list = batches[i].map(x => `- ${x.word} :: ${x.meaning}`).join('\n');
      const send = () => call('enrich', {
        system: ENRICH_SYSTEM,
        content: [{ type: 'text', text: `Topic: ${topic || 'general'}\n\nBuild a teaching pack for every word below.\n\n${list}` }],
        tool: ENRICH_TOOL,
        maxTokens: Math.min(24000, 900 * batches[i].length + 2000)
      });

      let packs = [];
      try { packs = asArray((await send()).packs); }
      catch (e) { console.warn('enrich batch failed, retrying', e); }

      if (!packs.length) {
        // one retry — a failed batch means those words get no clues at all
        try { packs = asArray((await send()).packs); }
        catch (e) { console.warn('enrich retry failed', e); }
      }
      packs.forEach(p => { if (p && p.word) out.push(p); });
    }
    if (onProgress) onProgress(out.length, words.length, batches.length, batches.length);
    return out;
  }

  /* ======================================================================
     3. TOP-UP — batched refill when a word's variety runs low.
     ====================================================================== */
  const TOPUP_TOOL = {
    name: 'record_more_variations',
    description: 'Record additional fresh variations for the listed words.',
    input_schema: {
      type: 'object',
      properties: {
        packs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              word: { type: 'string' },
              clues: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' },
                description: 'Three brand-new clues, different in angle from the ones already used. Never contain the word.' },
              sentences: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' },
                description: 'Three brand-new sentences with the word replaced by "______".' },
              misspellings: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' },
                description: 'Three further realistic wrong spellings not already listed.' }
            },
            required: ['word', 'clues', 'sentences', 'misspellings']
          }
        }
      },
      required: ['packs']
    }
  };

  async function topUp(items) {
    // items: [{word, meaning, existingClues:[], existingMisspellings:[]}]
    const list = items.map(x =>
      `- ${x.word} :: ${x.meaning}\n    already used clues: ${(x.existingClues || []).join(' | ') || 'none'}\n    already used misspellings: ${(x.existingMisspellings || []).join(', ') || 'none'}`
    ).join('\n');
    const content = [{
      type: 'text',
      text: `These words have run out of fresh practice material. Produce NEW variations that do not repeat what is already listed.\n\n${list}`
    }];
    const out = await call('top-up', {
      system: ENRICH_SYSTEM, content, tool: TOPUP_TOOL,
      maxTokens: Math.min(16000, 700 * items.length + 1500)
    });
    return asArray(out.packs);
  }

  /* ======================================================================
     4. COACH THE MISSES — batched at quiz end, cached against the word forever.
     ====================================================================== */
  const TRICK_TOOL = {
    name: 'record_memory_tricks',
    description: 'Record a memory trick for each word the child got wrong.',
    input_schema: {
      type: 'object',
      properties: {
        tricks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              word: { type: 'string' },
              memoryTrick: { type: 'string', description: 'A vivid, silly, memorable trick for spelling this word — a mnemonic, a picture, a hidden little word inside it. Under 25 words. Address the child directly as "you". PLAIN TEXT ONLY — no asterisks, no markdown, no bold markers of any kind. Use CAPITALS if you need to stress part of a word.' },
              whyTricky: { type: 'string', description: 'One short sentence naming exactly what she got wrong, in kind, plain language.' }
            },
            required: ['word', 'memoryTrick', 'whyTricky']
          }
        }
      },
      required: ['tricks']
    }
  };

  async function memoryTricks(items) {
    // items: [{word, meaning, herSpellings:[]}]
    const list = items.map(x => `- ${x.word} (she wrote: ${(x.herSpellings || []).join(', ') || 'blank'})`).join('\n');
    const content = [{
      type: 'text',
      text: `A 9-year-old just misspelled these. Give each a memory trick that fixes the exact part she got wrong.\n\n${list}`
    }];
    const out = await call('memory-tricks', {
      system: ENRICH_SYSTEM, content, tool: TRICK_TOOL,
      maxTokens: Math.min(8000, 400 * items.length + 1200)
    });
    // Belt and braces: strip any stray markdown so it never renders literally.
    return asArray(out.tricks).map(t => ({
      word: t.word,
      memoryTrick: demarkdown(t.memoryTrick),
      whyTricky: demarkdown(t.whyTricky)
    }));
  }

  function demarkdown(s) {
    return String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*_`]/g, '').trim();
  }

  /* ======================================================================
     5. PARENT COACH REPORT — 1 call, on demand.
     ====================================================================== */
  const REPORT_TOOL = {
    name: 'record_coach_report',
    description: 'Record the parent report.',
    input_schema: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'One warm sentence a parent reads first, naming the single most important thing this fortnight. Under 28 words.' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How much data this is based on. low if under 40 attempts.' },
        whereSheIs: { type: 'string', description: 'Two or three short paragraphs in plain English on where she stands. Quote her actual spellings in double quotes as evidence. No jargon. Address the parent as "you" and the child by name.' },
        strengths: {
          type: 'array', minItems: 2, maxItems: 4, items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short phrase.' },
              detail: { type: 'string', description: 'What the data shows, with a specific example or number. 1-2 sentences.' }
            }, required: ['title', 'detail']
          }
        },
        patterns: {
          type: 'array', minItems: 1, maxItems: 5,
          description: 'The recurring spelling error patterns, most important first.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Plain-English name for the pattern, e.g. "Writing words the way they sound".' },
              whatsHappening: { type: 'string', description: 'Explain it to a non-teacher in 1-2 sentences.' },
              evidence: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' },
                description: 'Real examples in the form: wrote "nervus" for "nervous".' },
              whyItHappens: { type: 'string', description: 'The likely cause, in one sentence. Be specific about phonics-first backgrounds where relevant.' },
              howBad: { type: 'string', enum: ['watch', 'work-on', 'urgent'] }
            },
            required: ['name', 'whatsHappening', 'evidence', 'whyItHappens', 'howBad']
          }
        },
        thisWeek: {
          type: 'array', minItems: 3, maxItems: 3,
          description: 'Exactly three concrete things the parent should do this week. Practical, 5 minutes each, doable at a kitchen table.',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Imperative, specific. Name the actual words to use.' },
              why: { type: 'string', description: 'One sentence on what it fixes.' },
              minutes: { type: 'integer' }
            },
            required: ['action', 'why', 'minutes']
          }
        },
        wordsToDrill: { type: 'array', minItems: 3, maxItems: 12, items: { type: 'string' },
          description: 'The exact words needing attention before the next school test, hardest first.' },
        motivation: { type: 'string', description: 'Two sentences on her engagement — streaks, session counts, whether she is choosing to come back — and one specific suggestion to keep it up.' },
        sinceLastReport: { type: 'string', description: 'If previousReport is present in the data: two or three sentences on exactly what has changed since it, quoting the numbers, and — importantly — whether the advice given last time appears to have worked. Name any pattern that has shrunk or grown. If there is no previous report, write exactly: "This is the first report, so there is nothing to compare against yet. From the next one on, this section will tell you what has changed."' },
        sayToHer: { type: 'string', description: 'One or two sentences the parent can say to the child, word for word, that praises effort and names one real improvement. Warm, not gushing.' }
      },
      required: ['headline', 'confidence', 'whereSheIs', 'strengths', 'patterns', 'thisWeek', 'wordsToDrill', 'motivation', 'sinceLastReport', 'sayToHer']
    }
  };

  const REPORT_SYSTEM =
`You are a warm, experienced primary literacy coach writing a private report to a
parent about their own child. You have their real practice data in front of you.

Rules:
• Write the way a good teacher talks at a parents' evening — plain, specific, kind.
  No education jargon. If you must use a term, explain it in the same breath.
• EVIDENCE IS EVERYTHING. Never make a claim without quoting a real spelling she
  produced or a real number from the data. Vague encouragement is useless to a parent.
• Be honest about weaknesses, but always pair a problem with what to do about it.
• This child came from a Montessori phonics-first background, so writing words the
  way they sound is the expected failure mode — look for it specifically, and if the
  data shows it, explain clearly why it happens and that it is normal and fixable.
• Never suggest the child is behind, deficient, or should be worried. Frame
  everything as "here is the next thing to build".
• Use the child's name naturally throughout.
• If a previousReport is included, treat this as the next instalment of an ongoing
  record, not a standalone document: say plainly what has moved, and be honest
  about whether last time's advice worked. Parents lose trust in a report that
  claims progress every time.`;

  async function coachReport(payload) {
    const content = [{ type: 'text', text: JSON.stringify(payload, null, 2) }];
    return call('coach-report', {
      system: REPORT_SYSTEM, content, tool: REPORT_TOOL, maxTokens: 12000
    });
  }

  /* ======================================================================
     6. CUSTOM TOPIC PACK — parent invents a list from a topic.
     ====================================================================== */
  const TOPIC_TOOL = {
    name: 'record_topic_list',
    description: 'Record a generated word list for a topic.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        topic: { type: 'string' },
        words: {
          type: 'array',
          items: {
            type: 'object',
            properties: { word: { type: 'string' }, meaning: { type: 'string', description: 'Child-friendly definition, one sentence.' } },
            required: ['word', 'meaning']
          }
        }
      },
      required: ['title', 'topic', 'words']
    }
  };

  async function topicList(topic, difficulty, count) {
    const content = [{
      type: 'text',
      text: `Build a spelling list of ${count} words on the topic "${topic}" for a 9-year-old.
Difficulty: ${difficulty} (easy = words she likely half-knows; medium = school-level for her year; hard = a genuine stretch, longer and less common).
Use British English. Mix single words and short terms. Avoid words that are trivially easy to spell at this difficulty.`
    }];
    return call('topic-list', { system: ENRICH_SYSTEM, content, tool: TOPIC_TOOL, maxTokens: 6000 });
  }

  /* ------------------------------------------------------------ test call */
  async function test() {
    const t0 = Date.now();
    await call('test', {
      system: 'Reply using the tool.',
      content: [{ type: 'text', text: 'Say hello to AraBuzz.' }],
      tool: {
        name: 'ok', description: 'Confirm.',
        input_schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
      },
      maxTokens: 300
    });
    return Date.now() - t0;
  }

  w.API = { hasKey, usingOwnKey, key, modelFor, readDeck, enrich, topUp,
            memoryTricks, coachReport, topicList, test, estCost, RATES };
})(window);
