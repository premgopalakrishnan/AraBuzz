/* ==========================================================================
   AraBuzz — phonics.js
   Works out WHAT KIND of spelling mistake was made, letter by letter.
   This runs entirely on the device — no API — and it is what powers both the
   adaptive practice and the evidence in the parent's Coach Report.
   ========================================================================== */
(function (w) {
  'use strict';

  const VOWELS = 'aeiouy';   // y counts — children swap i/y constantly
  const clean = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const looseTrim = s => String(s || '').trim().replace(/\s+/g, ' ');

  /* ------------------------------------------------- 1. sequence alignment */
  /** Returns [{op:'=' | 'sub' | 'del' | 'ins', a, b, i, j}] where a = correct
   *  letter, b = what she wrote. 'del' = she left a letter out.
   *  'ins' = she added a letter that shouldn't be there. */
  function align(correct, given) {
    const A = clean(correct), B = clean(given);
    const n = A.length, m = B.length;
    const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) d[i][0] = i;
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const c = A[i - 1] === B[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      }
    }
    const ops = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && A[i - 1] === B[j - 1] && d[i][j] === d[i - 1][j - 1]) {
        ops.unshift({ op: '=', a: A[i - 1], b: B[j - 1], i: i - 1, j: j - 1 }); i--; j--;
      } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
        ops.unshift({ op: 'sub', a: A[i - 1], b: B[j - 1], i: i - 1, j: j - 1 }); i--; j--;
      } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
        ops.unshift({ op: 'del', a: A[i - 1], b: '', i: i - 1, j }); i--;
      } else {
        ops.unshift({ op: 'ins', a: '', b: B[j - 1], i, j: j - 1 }); j--;
      }
    }
    return ops;
  }

  function distance(a, b) {
    return align(a, b).filter(o => o.op !== '=').length;
  }

  /* -------------------------------------------------- 2. phonetic sameness */
  /** Compact Metaphone-ish coder, then reduced to its CONSONANT SKELETON.
   *  English spells vowels a dozen ways, so the consonant skeleton is what
   *  actually answers: "if you sounded out what she wrote, would you get the
   *  real word?" — the single most important question for a phonics-first
   *  speller. */
  function sound(str) {
    let s = clean(str);
    if (!s) return '';
    s = s
      .replace(/y/g, 'i')                       // do this first: y behaves as a vowel here
      .replace(/^kn|^gn|^pn|^wr|^ps/, n => n[1])
      .replace(/^x/, 's')
      .replace(/^wh/, 'w')
      .replace(/rh/g, 'r')
      .replace(/mb$/, 'm')
      .replace(/ough/g, 'of')
      .replace(/augh/g, 'af')
      .replace(/ph/g, 'f')
      .replace(/tion|ssion|sion|cion|cian|tian/g, 'Xn')
      .replace(/ture/g, 'Xr')
      .replace(/[cs]h/g, 'X')
      .replace(/c([eiy])/g, 's$1')
      .replace(/c/g, 'k')
      .replace(/q(u)?/g, 'kw')
      .replace(/x/g, 'ks')
      .replace(/gh/g, '')
      .replace(/dge/g, 'j')
      .replace(/g([eiy])/g, 'j$1')
      .replace(/z/g, 's')
      .replace(/w(?![aeiou])/g, '')
      .replace(/h(?![aeiou])/g, '')
      .replace(/(.)\1+/g, '$1');                // collapse doubles — silent in speech
    return s;
  }

  /** The consonant frame, vowels stripped out entirely. */
  function skeleton(str) {
    return sound(str).replace(/[aeiou]/g, '');
  }

  /** True when what she wrote would sound like the target if read aloud. */
  function soundsSame(correct, given) {
    const a = sound(correct), b = sound(given);
    if (!a || !b) return false;
    if (a === b) return true;

    const sa = skeleton(correct), sb = skeleton(given);
    if (!sa || sa !== sb) return false;          // consonants must match exactly

    // Consonants align. Vowels may differ, but the vowel GROUPS must sit in the
    // same places and be roughly the same size — otherwise it's a transposition
    // or a dropped syllable, not a phonetic spelling.
    const va = a.match(/[aeiou]+/g) || [];
    const vb = b.match(/[aeiou]+/g) || [];
    if (va.length !== vb.length) return false;
    return true;
  }

  /* --------------------------------------------------- 3. helper detectors */
  const SILENT_PATTERNS = [
    { re: /^kn/, letter: 'k', label: 'silent k' },
    { re: /^wr/, letter: 'w', label: 'silent w' },
    { re: /^ps/, letter: 'p', label: 'silent p' },
    { re: /^gn/, letter: 'g', label: 'silent g' },
    { re: /mb$/, letter: 'b', label: 'silent b' },
    { re: /gh/,  letter: 'g', label: 'silent gh' },
    { re: /^h/,  letter: 'h', label: 'silent h' },
    { re: /rh/,  letter: 'h', label: 'silent h' },
    { re: /st[le]/, letter: 't', label: 'silent t' }
  ];

  const ENDINGS = ['tion', 'sion', 'cian', 'ssion', 'ance', 'ence', 'able', 'ible',
                   'ant', 'ent', 'ary', 'ery', 'ory', 'ous', 'ious', 'eous', 'ate', 'ite', 'ial', 'ual'];

  function doubles(word) {
    const out = [];
    const s = clean(word);
    for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1]) out.push({ letter: s[i], at: i });
    return out;
  }

  function endingOf(word) {
    const s = clean(word);
    let best = '';
    ENDINGS.forEach(e => { if (s.endsWith(e) && e.length > best.length) best = e; });
    return best;
  }

  /* --------------------------------------------------- 4. classify a slip  */
  const LABELS = {
    correct:    'Correct',
    capital:    'Capital letters only',
    spacing:    'Spaces or hyphens',
    phonetic:   'Spelled it the way it sounds',
    doubling:   'Double letters',
    silent:     'Silent letters',
    vowelteam:  'Vowel pairs',
    vowelswap:  'Wrong vowel',
    ending:     'Word endings',
    transpose:  'Letters swapped round',
    omission:   'Letter left out',
    insertion:  'Extra letter added',
    severe:     'Word not known yet'
  };

  const ADVICE = {
    phonetic:  'She is hearing the word correctly and writing what she hears. The next step is building a picture of the word in her memory — seeing it, not sounding it.',
    vowelswap: 'The right sound, the wrong vowel letter. Common when a word is learned by ear rather than by sight.',
    doubling:  'English doubles a letter to keep the vowel before it short. This is a rule she can be taught rather than memorised word by word.',
    silent:    'Silent letters cannot be heard, so phonics alone will never produce them. These have to be seen and noticed.',
    vowelteam: 'Two vowels together often make one sound, and English offers several spellings for the same sound. This is the slowest one to fix and needs exposure.',
    ending:    'Word endings follow patterns. Learning the handful of common endings fixes dozens of words at once.',
    transpose: 'She knows the letters; they arrived in the wrong order. Usually speed, not knowledge.',
    omission:  'Letters dropping out usually means she is writing faster than she is picturing the word.',
    insertion: 'An extra letter creeping in often comes from over-applying a rule she has just learned.',
    spacing:   'The letters are right — only the spaces or hyphen are off. Worth a quick mention, not a worry.',
    capital:   'Spelling is right; only the capital letter differs. Not a spelling problem.',
    severe:    'This word has not been learned yet, rather than being misremembered. It needs first-time teaching, not correction.'
  };

  /** The core classifier. Returns {ok, tags[], primary, soundsRight, ops, note} */
  function analyse(correct, given) {
    const rawC = looseTrim(correct), rawG = looseTrim(given);
    const C = clean(correct), G = clean(given);
    const res = { ok: false, tags: [], primary: null, soundsRight: false, ops: [], note: '' };

    if (!G) { res.tags = ['severe']; res.primary = 'severe'; res.note = 'left blank'; res.ops = align(C, ''); return res; }

    if (rawC === rawG) { res.ok = true; res.primary = 'correct'; res.ops = align(C, G); return res; }

    // letters identical, only case/space/hyphen differ
    if (C === G) {
      res.ok = true; // we accept it as correct, but note the slip
      res.ops = align(C, G);
      if (rawC.toLowerCase().replace(/\s|-/g, '') === rawG.toLowerCase().replace(/\s|-/g, '') &&
          rawC.replace(/\s|-/g, '').toLowerCase() !== rawG.replace(/\s|-/g, '').toLowerCase()) { /* n/a */ }
      const cSpace = rawC.replace(/[a-z]/gi, ''), gSpace = rawG.replace(/[a-z]/gi, '');
      if (cSpace !== gSpace) { res.tags.push('spacing'); res.primary = 'spacing'; res.note = 'spacing/hyphen'; }
      else { res.tags.push('capital'); res.primary = 'capital'; res.note = 'capitals'; }
      return res;
    }

    const ops = align(C, G);
    res.ops = ops;
    const errs = ops.filter(o => o.op !== '=');
    const dist = errs.length;

    // Does it sound right? Tracked separately from the tags, because this is
    // the headline finding for a phonics-first speller and it can be true
    // alongside any of the specific patterns below.
    res.soundsRight = soundsSame(C, G);

    // Too far off to be a "slip"
    if (dist > Math.max(3, Math.ceil(C.length * 0.45)) && !res.soundsRight) {
      res.tags.push('severe'); res.primary = 'severe';
      res.note = `${dist} letters out`;
      return res;
    }

    const tags = [];

    // -- transposition (adjacent swap) — check first, it's the most specific
    let transposed = false;
    for (let i = 0; i < C.length - 1; i++) {
      if (C[i] !== C[i + 1] && G[i] === C[i + 1] && G[i + 1] === C[i] &&
          C.slice(0, i) === G.slice(0, i) && C.slice(i + 2) === G.slice(i + 2)) {
        tags.push('transpose'); transposed = true;
        res.note = `swapped "${C[i]}${C[i + 1]}" round`;
        break;
      }
    }

    // -- doubling
    const dC = doubles(C), dG = doubles(G);
    if (dC.length > dG.length) { tags.push('doubling'); res.note = res.note || `missed the double "${dC[0].letter}"`; }
    else if (dG.length > dC.length) { tags.push('doubling'); res.note = res.note || `doubled a letter that isn't doubled`; }
    else if (dC.length && dC.some((x, i) => !dG[i] || dG[i].letter !== x.letter)) tags.push('doubling');

    // -- silent letters (including the silent e on the end)
    SILENT_PATTERNS.forEach(p => {
      if (p.re.test(C) && !p.re.test(G)) {
        const cCount = (C.match(new RegExp(p.letter, 'g')) || []).length;
        const gCount = (G.match(new RegExp(p.letter, 'g')) || []).length;
        if (gCount < cCount) { tags.push('silent'); res.note = res.note || p.label; }
      }
    });
    if (/[^aeiou]e$/.test(C) && !/e$/.test(G) && C.slice(0, -1) === G) {
      tags.push('silent'); res.note = res.note || 'left off the e on the end';
    }

    // -- endings
    const eC = endingOf(C), eG = endingOf(G);
    if (eC && eC !== eG) {
      const tailStart = C.length - eC.length;
      if (errs.some(o => o.i >= tailStart - 1)) {
        tags.push('ending');
        res.note = res.note || `the "-${eC}" ending`;
      }
    }

    // -- vowel team: only when the correct word genuinely has a vowel pair
    //    at or beside the place she slipped
    const vowelErrAt = errs.filter(o =>
      (o.op === 'sub' && VOWELS.includes(o.a) && VOWELS.includes(o.b)) ||
      (o.op === 'del' && VOWELS.includes(o.a)) ||
      (o.op === 'ins' && VOWELS.includes(o.b))
    );
    if (vowelErrAt.length && !transposed) {
      const nearPair = vowelErrAt.some(o => {
        const i = Math.max(0, (o.i || 0) - 1);
        return /[aeiou]{2}/.test(C.slice(i, i + 3));
      });
      tags.push(nearPair ? 'vowelteam' : 'vowelswap');
    }

    // -- plain omission / insertion (only if nothing more specific explains it)
    if (!tags.length) {
      if (res.soundsRight) tags.push('phonetic');
      else if (errs.some(o => o.op === 'del')) tags.push('omission');
      else if (errs.some(o => o.op === 'ins')) tags.push('insertion');
    }

    res.tags = Array.from(new Set(tags));
    if (!res.tags.length) res.tags = ['omission'];

    // Primary tag — the most SPECIFIC, most actionable one wins. "Sounds right"
    // is deliberately not in this list; it is reported on its own.
    const PRIORITY = ['silent', 'doubling', 'ending', 'transpose', 'vowelteam',
                      'vowelswap', 'phonetic', 'insertion', 'omission', 'severe'];
    res.primary = PRIORITY.find(t => res.tags.includes(t)) || res.tags[0];
    return res;
  }

  /* --------------------------------------------- 5. render the diff nicely */
  /** Shows what she typed, with wrong letters struck through and the letters
   *  she missed shown in green. Never just "wrong". */
  function diffHTML(correct, given) {
    const ops = align(correct, given);
    let out = '';
    ops.forEach(o => {
      if (o.op === '=') out += `<span class="ok">${o.b}</span>`;
      else if (o.op === 'sub') out += `<span class="bad">${o.b}</span><span class="miss">${o.a}</span>`;
      else if (o.op === 'ins') out += `<span class="bad">${o.b}</span>`;
      else if (o.op === 'del') out += `<span class="miss">${o.a}</span>`;
    });
    return out;
  }

  /** Highlights the letters within the CORRECT word that she got wrong —
   *  used on the "here's the word" reveal. */
  function highlightCorrect(correct, given) {
    const ops = align(correct, given);
    const bad = new Set();
    ops.forEach(o => { if (o.op === 'sub' || o.op === 'del') bad.add(o.i); });
    const C = String(correct);
    let ci = 0, out = '';
    for (let k = 0; k < C.length; k++) {
      const ch = C[k];
      if (/[a-z]/i.test(ch)) {
        out += bad.has(ci) ? `<span class="miss">${ch}</span>` : `<span class="ok">${ch}</span>`;
        ci++;
      } else out += `<span class="ok">${ch}</span>`;
    }
    return out;
  }

  /** Which letter positions in the correct word does she historically miss?
   *  Used to aim the "missing letters" game at her real weak spots. */
  function weakPositions(correct, pastGivens) {
    const counts = {};
    (pastGivens || []).forEach(g => {
      align(correct, g).forEach(o => {
        if (o.op === 'sub' || o.op === 'del') counts[o.i] = (counts[o.i] || 0) + 1;
      });
    });
    return counts;
  }

  /* ------------------------------------------------ 6. aggregate patterns  */
  function summarise(rows) {
    // rows: [{correct, given, ok, ts, wordId}]
    const tally = {};
    const examples = {};
    let wrong = 0, soundedRight = 0;
    const soundExamples = [];

    rows.forEach(r => {
      if (r.ok) return;
      wrong++;
      const a = analyse(r.correct, r.given);
      if (a.soundsRight) {
        soundedRight++;
        if (soundExamples.length < 8 && !soundExamples.some(e => e.correct === r.correct)) {
          soundExamples.push({ correct: r.correct, given: r.given, ts: r.ts });
        }
      }
      a.tags.forEach(t => {
        if (t === 'correct') return;
        tally[t] = (tally[t] || 0) + 1;
        examples[t] = examples[t] || [];
        if (examples[t].length < 6 && !examples[t].some(e => e.correct === r.correct)) {
          examples[t].push({ correct: r.correct, given: r.given, ts: r.ts });
        }
      });
    });

    const list = Object.keys(tally).map(t => ({
      tag: t,
      label: LABELS[t] || t,
      advice: ADVICE[t] || '',
      count: tally[t],
      share: wrong ? tally[t] / wrong : 0,
      examples: examples[t] || []
    })).sort((a, b) => b.count - a.count);

    return {
      totalWrong: wrong,
      patterns: list,
      phonetic: {
        count: soundedRight,
        share: wrong ? soundedRight / wrong : 0,
        examples: soundExamples,
        label: LABELS.phonetic,
        advice: ADVICE.phonetic
      }
    };
  }

  w.Phonics = {
    align, distance, sound, skeleton, soundsSame, analyse, diffHTML, highlightCorrect,
    weakPositions, summarise, doubles, endingOf, LABELS, ADVICE, clean
  };
})(window);
