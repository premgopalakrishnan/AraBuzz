/* ==========================================================================
   AraBuzz — engine.js
   Chooses WHICH words to practise, in WHICH form, with WHICH wording.

   Two promises this file has to keep:
     1. A retake is never the same quiz twice. Words, question types, clue
        wording, option order and gap positions all rotate.
     2. Practice bends towards what she actually gets wrong — the words, and
        the kinds of letters inside them.
   ========================================================================== */
(function (w) {
  'use strict';

  const P = () => window.Phonics;
  const S = () => window.Store;

  /* ------------------------------------------------------------- Leitner  */
  // Days until a word comes back, by box. Box 0 = brand new.
  const INTERVALS = [0, 1, 2, 4, 8, 16, 30];
  const MAX_BOX = 6;

  function isDue(prog) {
    return !prog.due || prog.due <= Date.now();
  }

  function grade(wordId, ok, firstTry) {
    const pr = S().ensureProgress(wordId);
    pr.seen++;
    pr.lastSeen = Date.now();
    if (!pr.firstSeen) pr.firstSeen = Date.now();
    if (ok) {
      pr.right++;
      pr.streak = (pr.streak || 0) + 1;
      if (firstTry) pr.box = Math.min(MAX_BOX, (pr.box || 0) + 1);
    } else {
      pr.wrong++;
      pr.streak = 0;
      pr.box = Math.max(0, Math.floor((pr.box || 0) / 2));   // slip back, don't reset to zero
    }
    pr.due = Date.now() + INTERVALS[Math.min(pr.box, INTERVALS.length - 1)] * 864e5;
    if (window.Sync) Sync.noteProgress(wordId);
    return pr;
  }

  function mastery(wordId) {
    const pr = S().db.progress[wordId];
    if (!pr) return 0;
    return Math.min(1, (pr.box || 0) / 5);
  }

  function accuracy(wordId) {
    const pr = S().db.progress[wordId];
    if (!pr || !pr.seen) return null;
    return pr.right / pr.seen;
  }

  /* -------------------------------------------------------- word choosing */
  /** Ranks the pool so the words she needs most come up most. */
  function pickWords(pool, n, opts) {
    const o = Object.assign({ mode: 'smart', confidenceShare: 0.2 }, opts);
    if (!pool.length) return [];
    if (o.mode === 'random') return shuffle(pool).slice(0, n);

    const now = Date.now();
    const scored = pool.map(wd => {
      const pr = S().db.progress[wd.id] || {};
      const acc = pr.seen ? pr.right / pr.seen : null;
      let score = Math.random() * 18;                       // keeps it fresh

      if (!pr.seen) score += 85;                            // never met it
      if (isDue(pr) && pr.seen) score += 70;                // spaced-repetition due
      if (acc !== null) score += (1 - acc) * 70;            // struggles with it
      score += (5 - Math.min(5, pr.box || 0)) * 9;          // not yet locked in
      if (pr.streak === 0 && pr.seen) score += 22;          // last go was wrong

      // don't hammer the same word twice in ten minutes
      if (pr.lastSeen && now - pr.lastSeen < 6e5) score -= 60;

      return { wd, score, mastered: (pr.box || 0) >= 5 };
    });

    scored.sort((a, b) => b.score - a.score);

    // Reserve a slice for words she already knows — confidence matters as much
    // as challenge, and an all-hard quiz makes a child quit.
    const want = Math.min(n, pool.length);
    const conf = Math.min(
      Math.floor(want * o.confidenceShare),
      scored.filter(s => s.mastered).length
    );
    const hard = scored.filter(s => !s.mastered).slice(0, want - conf).map(s => s.wd);
    const easy = shuffle(scored.filter(s => s.mastered)).slice(0, conf).map(s => s.wd);
    const out = shuffle(hard.concat(easy));

    // top up if the pool was thin
    if (out.length < want) {
      shuffle(pool).forEach(wd => {
        if (out.length < want && !out.some(x => x.id === wd.id)) out.push(wd);
      });
    }
    return out.slice(0, want);
  }

  function shuffle(a) {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  }
  const pick = a => a[Math.floor(Math.random() * a.length)];

  /* ------------------------------------------------------- variety cycling */
  /** Rotates through a word's stored clues/sentences so she never gets the
   *  same wording twice in a row. Flags the word for a top-up when the pool
   *  has been fully used. */
  function nextVariant(wordId, kind, list) {
    if (!list || !list.length) return { text: null, exhausted: true };
    const pr = S().ensureProgress(wordId);
    pr.variantUse = pr.variantUse || {};
    const used = pr.variantUse[kind] || 0;
    const idx = used % list.length;
    pr.variantUse[kind] = used + 1;
    return { text: list[idx], exhausted: used + 1 >= list.length * 2, index: idx };
  }

  /** Words whose material is running thin — batched into one top-up call. */
  function needTopUp(pool, limit) {
    const out = [];
    pool.forEach(wd => {
      const pr = S().db.progress[wd.id];
      if (!pr || !pr.variantUse) return;
      const clueUse = pr.variantUse.clue || 0;
      const sentUse = pr.variantUse.sentence || 0;
      const clueN = (wd.clues || []).length || 1;
      const sentN = (wd.sentences || []).length || 1;
      if (clueUse >= clueN * 2 || sentUse >= sentN * 2) out.push(wd);
    });
    return out.slice(0, limit || 12);
  }

  /* ---------------------------------------------------------- mode choice */
  const ALL_MODES = ['spell', 'listen', 'sentence', 'meaning', 'reverse', 'missing', 'jumble', 'spot'];

  // Roughly easiest to hardest, for a child.
  const DIFFICULTY = { reverse: 1, meaning: 1, jumble: 2, missing: 2, spot: 3, sentence: 4, spell: 4, listen: 5 };

  function chooseMode(wd, allowed, prog) {
    let opts = allowed.slice();

    // multi-word terms don't jumble sensibly
    const isPhrase = /[\s-]/.test(wd.word);
    if (isPhrase) opts = opts.filter(m => m !== 'jumble');

    // needs material we may not have
    if (!(wd.sentences || []).length) opts = opts.filter(m => m !== 'sentence');
    if (!(wd.misspellings || []).length) opts = opts.filter(m => m !== 'spot');
    if (!(wd.wrongMeanings || []).length) opts = opts.filter(m => m !== 'meaning');
    if (!S().db.settings.allowSpotSpelling) opts = opts.filter(m => m !== 'spot');

    const box = (prog && prog.box) || 0;
    const seen = (prog && prog.seen) || 0;

    // First meeting: never show wrong spellings, and lean towards the gentler
    // forms — but not exclusively, or a "Spell Buzz" round on a brand-new list
    // would contain no actual spelling. Recognition first, recall soon after.
    if (seen === 0) {
      opts = opts.filter(m => m !== 'spot');
      const gentle = opts.filter(m => ['reverse', 'jumble', 'missing', 'meaning'].includes(m));
      if (gentle.length && Math.random() < 0.6) opts = gentle;
    } else if (box >= 3) {
      // she knows it — push towards writing it from memory
      const stretch = opts.filter(m => DIFFICULTY[m] >= 3);
      if (stretch.length) opts = stretch;
    } else if (box <= 1) {
      const easier = opts.filter(m => DIFFICULTY[m] <= 3);
      if (easier.length) opts = easier;
    }

    // never repeat the last two forms for this word
    const recent = (prog && prog.lastModes) || [];
    const fresh = opts.filter(m => !recent.slice(-2).includes(m));
    if (fresh.length) opts = fresh;

    return opts.length ? pick(opts) : 'spell';
  }

  function noteMode(wordId, mode) {
    const pr = S().ensureProgress(wordId);
    pr.lastModes = (pr.lastModes || []).concat(mode).slice(-6);
  }

  /* ------------------------------------------------------- gap selection  */
  /** Which letters to hide in "Missing Letters" — aimed at the letters SHE
   *  gets wrong, plus the structurally tricky ones. */
  function chooseGaps(wd, count) {
    const word = wd.word;
    const letters = [];
    for (let i = 0; i < word.length; i++) if (/[a-z]/i.test(word[i])) letters.push(i);

    const weights = {};
    letters.forEach(i => { weights[i] = 1; });

    // structural difficulty
    const clean = P().clean(word);
    const map = [];                                   // clean index -> raw index
    for (let i = 0; i < word.length; i++) if (/[a-z]/i.test(word[i])) map.push(i);

    P().doubles(word).forEach(d => {
      const raw = map[d.at]; if (raw != null) weights[raw] = (weights[raw] || 1) + 4;
      const raw2 = map[d.at - 1]; if (raw2 != null) weights[raw2] = (weights[raw2] || 1) + 2;
    });
    for (let i = 1; i < clean.length; i++) {
      if ('aeiou'.includes(clean[i]) && 'aeiou'.includes(clean[i - 1])) {
        [map[i], map[i - 1]].forEach(r => { if (r != null) weights[r] = (weights[r] || 1) + 3; });
      }
    }
    const ending = P().endingOf(word);
    if (ending) {
      for (let i = clean.length - ending.length; i < clean.length; i++) {
        const r = map[i]; if (r != null) weights[r] = (weights[r] || 1) + 2;
      }
    }

    // her own history
    const past = S().attemptsFor(wd.id).filter(a => !a.ok && a.given).map(a => a.given);
    if (past.length) {
      const wp = P().weakPositions(word, past);
      Object.keys(wp).forEach(ci => {
        const r = map[+ci]; if (r != null) weights[r] = (weights[r] || 1) + wp[ci] * 5;
      });
    }

    // never blank the first letter — too discouraging
    if (map.length) weights[map[0]] = 0.05;

    const n = Math.max(1, Math.min(count || 2, Math.floor(letters.length / 2)));
    const chosen = [];
    const bag = letters.slice();
    for (let k = 0; k < n && bag.length; k++) {
      const total = bag.reduce((s, i) => s + (weights[i] || 1), 0);
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < bag.length; idx++) { r -= (weights[bag[idx]] || 1); if (r <= 0) break; }
      const gp = bag[Math.min(idx, bag.length - 1)];
      chosen.push(gp);
      // avoid adjacent gaps — too hard
      for (let d = -1; d <= 1; d++) {
        const at = bag.indexOf(gp + d);
        if (at >= 0) bag.splice(at, 1);
      }
    }
    return chosen.sort((a, b) => a - b);
  }

  /* --------------------------------------------------------- build a Q    */
  let qseq = 0;

  function buildQuestion(wd, allowed, poolForDistractors) {
    const prog = S().ensureProgress(wd.id);
    const mode = chooseMode(wd, allowed, prog);
    const q = {
      id: 'q' + (++qseq) + '_' + Math.random().toString(36).slice(2, 6),
      wordId: wd.id, word: wd.word, mode,
      answer: wd.word, kind: 'type', prompt: '', sub: '', options: null, meta: {}
    };

    const meaning = wd.kidMeaning || wd.meaning || '';
    const clue = nextVariant(wd.id, 'clue', wd.clues);

    switch (mode) {
      case 'spell': {
        q.kind = 'type';
        // Alternate between the riddle clue and the plain meaning.
        const useClue = clue.text && Math.random() < 0.6;
        q.prompt = useClue ? clue.text : meaning;
        q.sub = useClue ? 'Which word is it? Spell it.' : 'Spell the word that means this.';
        q.meta.hintSyllables = wd.syllables || '';
        break;
      }
      case 'listen': {
        q.kind = 'type';
        q.prompt = '';
        q.sub = 'Listen, then spell it.';
        q.meta.speak = wd.word;
        q.meta.meaning = meaning;
        break;
      }
      case 'sentence': {
        const s = nextVariant(wd.id, 'sentence', wd.sentences);
        q.kind = 'type';
        q.prompt = s.text || meaning;
        q.sub = 'Fill in the missing word.';
        break;
      }
      case 'meaning': {
        q.kind = 'choice';
        q.prompt = wd.word;
        q.sub = 'What does this mean?';
        q.answer = meaning;
        q.options = shuffle(buildMeaningOptions(wd, meaning, poolForDistractors));
        break;
      }
      case 'reverse': {
        q.kind = 'choice';
        q.prompt = clue.text || meaning;
        q.sub = 'Which word is this?';
        q.answer = wd.word;
        const others = shuffle(poolForDistractors.filter(x => x.id !== wd.id)).slice(0, 3).map(x => x.word);
        q.options = shuffle([wd.word].concat(others));
        break;
      }
      case 'missing': {
        q.kind = 'gaps';
        const box = prog.box || 0;
        const gaps = chooseGaps(wd, box >= 3 ? 3 : 2);
        q.meta.gaps = gaps;
        q.prompt = meaning;
        q.sub = 'Fill in the missing letters.';
        break;
      }
      case 'jumble': {
        q.kind = 'jumble';
        const letters = wd.word.split('');
        let mixed = shuffle(letters);
        // make sure it isn't accidentally already correct
        if (mixed.join('') === wd.word && letters.length > 2) mixed = shuffle(letters);
        q.meta.tiles = mixed;
        q.prompt = meaning;
        q.sub = 'Put the letters in the right order.';
        break;
      }
      case 'spot': {
        q.kind = 'choice';
        q.prompt = meaning;
        q.sub = 'Which spelling is correct?';
        q.answer = wd.word;
        q.meta.spelling = true;
        const wrong = buildSpellingOptions(wd);
        q.options = shuffle([wd.word].concat(wrong));
        break;
      }
    }
    noteMode(wd.id, mode);
    return q;
  }

  function buildMeaningOptions(wd, correct, pool) {
    const bag = S().uniq((wd.wrongMeanings || []).slice());
    // mix in real meanings of other words from the same week — genuinely tempting
    shuffle(pool.filter(x => x.id !== wd.id)).slice(0, 4).forEach(x => {
      const m = x.kidMeaning || x.meaning;
      if (m && m !== correct) bag.push(m);
    });
    return [correct].concat(shuffle(bag).slice(0, 3));
  }

  function buildSpellingOptions(wd) {
    const bag = S().uniq((wd.misspellings || []).slice());
    // her own past misspellings are the most instructive distractors, but only
    // once the word is partly known — never on first contact
    const pr = S().db.progress[wd.id] || {};
    if ((pr.box || 0) >= 2) {
      (pr.misspellings || []).forEach(m => { if (m && m.toLowerCase() !== wd.word.toLowerCase()) bag.unshift(m); });
    }
    return S().uniq(bag).filter(x => x.toLowerCase() !== wd.word.toLowerCase()).slice(0, 3);
  }

  /* ----------------------------------------------------- build a full set */
  const PRESETS = {
    spellbuzz:  { label: 'Spell Buzz',   modes: ['spell', 'listen', 'sentence', 'missing', 'jumble', 'spot'] },
    meanings:   { label: 'Word Meanings', modes: ['meaning', 'reverse'] },
    mixed:      { label: 'Mixed Buzz',   modes: ALL_MODES },
    buzzer:     { label: 'Beat the Buzzer', modes: ['spot', 'reverse', 'meaning'] },
    listen:     { label: 'Listen & Spell', modes: ['listen'] },
    championship: { label: 'Championship Buzz', modes: ['spell', 'listen', 'sentence', 'meaning'] }
  };

  function buildQuiz(pool, opts) {
    const o = Object.assign({ preset: 'spellbuzz', count: 10, selection: 'smart' }, opts);
    const preset = PRESETS[o.preset] || PRESETS.spellbuzz;
    const words = pickWords(pool, o.count, {
      mode: o.selection,
      confidenceShare: o.preset === 'championship' ? 0 : 0.2
    });
    const qs = words.map(wd => buildQuestion(wd, preset.modes, pool));

    // Don't open with the hardest thing in the set — start with a win.
    if (qs.length > 2) {
      const easiestAt = qs.reduce((best, q, i) =>
        (DIFFICULTY[q.mode] < DIFFICULTY[qs[best].mode] ? i : best), 0);
      if (easiestAt !== 0) { const t = qs[0]; qs[0] = qs[easiestAt]; qs[easiestAt] = t; }
    }
    return { preset: o.preset, label: preset.label, questions: qs };
  }

  /* --------------------------------------------------------------- check  */
  function check(q, given) {
    const target = q.kind === 'choice' ? q.answer : q.word;
    if (q.kind === 'choice') {
      return { ok: String(given).trim() === String(q.answer).trim(), analysis: null };
    }
    const a = P().analyse(target, given);
    return { ok: a.ok, analysis: a };
  }

  /** Records the answer, updates the Leitner box, and remembers her exact
   *  misspelling so it can be used against her later — as a distractor and
   *  as evidence in the parent report. */
  function record(q, given, ok, firstTry, ms, sessionId) {
    const wd = S().db.words[q.wordId];
    const wk = S().weekOfWord(q.wordId);
    const analysis = q.kind === 'choice' ? null : P().analyse(q.word, given);

    S().logAttempt({
      sessionId, wordId: q.wordId, mode: q.mode,
      given: String(given || ''), ok: !!ok, firstTry: !!firstTry, ms: ms || 0,
      weekId: wk ? wk.id : null,
      correct: q.word,
      tags: analysis ? analysis.tags : [],
      soundsRight: analysis ? !!analysis.soundsRight : false,
      primary: analysis ? analysis.primary : (ok ? 'correct' : 'choice')
    });

    if (!ok && q.kind !== 'choice' && given) {
      const pr = S().ensureProgress(q.wordId);
      pr.misspellings = S().uniq((pr.misspellings || []).concat(String(given))).slice(-8);
    }
    grade(q.wordId, ok, firstTry);
    return analysis;
  }

  /* --------------------------------------------------------- session stats */
  function stars(pct) { return pct >= 0.95 ? 3 : pct >= 0.8 ? 2 : pct >= 0.55 ? 1 : 0; }

  function dueCount(pool) {
    return pool.filter(wd => {
      const pr = S().db.progress[wd.id];
      return !pr || !pr.seen || isDue(pr);
    }).length;
  }

  function trickyWords(limit) {
    return S().allWords()
      .map(wd => {
        const pr = S().db.progress[wd.id] || {};
        const acc = pr.seen ? pr.right / pr.seen : 1;
        return { wd, pr, acc, wrong: pr.wrong || 0 };
      })
      .filter(x => x.wrong >= 1 && x.acc < 0.8)
      .sort((a, b) => (a.acc - b.acc) || (b.wrong - a.wrong))
      .slice(0, limit || 20)
      .map(x => x.wd);
  }

  w.Engine = {
    INTERVALS, MAX_BOX, ALL_MODES, PRESETS, DIFFICULTY,
    isDue, grade, mastery, accuracy, pickWords, shuffle, pick,
    nextVariant, needTopUp, chooseMode, chooseGaps,
    buildQuestion, buildQuiz, check, record, stars, dueCount, trickyWords
  };
})(window);
