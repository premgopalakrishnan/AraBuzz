/* ==========================================================================
   AraBuzz — util.js
   Small shared helpers: DOM, toasts, modals, confetti, sound, speech,
   and the baseline spelling check used when a profile is created.
   ========================================================================== */
(function (w) {
  'use strict';

  /* ------------------------------------------------------------------ DOM */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'style') n.style.cssText = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    if (html != null) n.innerHTML = html;
    return n;
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /* --------------------------------------------------------------- toasts */
  function toast(msg, kind, ms) {
    let box = $('#toast');
    if (!box) { box = el('div', { id: 'toast' }); document.body.appendChild(box); }
    const t = el('div', { class: 'toast ' + (kind || '') }, esc(msg));
    box.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .35s, transform .35s';
      t.style.opacity = '0'; t.style.transform = 'translateY(10px)';
      setTimeout(() => t.remove(), 400);
    }, ms || 2400);
  }

  /* ==========================================================================
     MODALS
     Every popup in AraBuzz behaves the same way, and none of them can trap you:
       Esc            closes (and cancels)
       click outside  closes (and cancels)
       ✕ button       closes (and cancels)
       Enter          fires the primary action, unless you are in a textarea
     Only the very first PIN setup opts out of dismissal, because leaving it
     half-done would lock the parent area with an unknown PIN.
     ========================================================================== */
  const modalStack = [];

  function modal(html, opts) {
    const o = opts || {};
    const lastFocus = document.activeElement;

    const bg = el('div', { class: 'modal-bg' });
    const box = el('div', { class: 'modal' });
    if (!o.noClose) {
      box.appendChild(el('button', {
        class: 'modal-x', 'aria-label': 'Close', title: 'Close (Esc)'
      }, '✕'));
    }
    const inner = el('div', { class: 'modal-body' }, html);
    box.appendChild(inner);
    bg.appendChild(box);
    document.body.appendChild(bg);
    document.body.style.overflow = 'hidden';

    let closed = false;
    function close(reason) {
      if (closed) return;
      closed = true;
      const at = modalStack.indexOf(entry);
      if (at >= 0) modalStack.splice(at, 1);
      if (!modalStack.length) document.body.style.overflow = '';
      bg.remove();
      if (o.onClose) { try { o.onClose(reason || 'dismiss'); } catch (e) {} }
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }

    const entry = { bg, box, close, dismissible: !o.noDismiss };
    modalStack.push(entry);

    const x = box.querySelector('.modal-x');
    if (x) x.onclick = () => close('close');

    if (!o.noDismiss) {
      bg.addEventListener('mousedown', e => { if (e.target === bg) bg.__downOutside = true; });
      bg.addEventListener('click', e => {
        // only close if the press STARTED outside — stops a drag from inside
        // the card ending on the backdrop and closing it by accident
        if (e.target === bg && bg.__downOutside) close('backdrop');
        bg.__downOutside = false;
      });
    }

    // focus the first sensible control
    setTimeout(() => {
      const target = box.querySelector('[data-autofocus]') ||
                     box.querySelector('input:not([type=hidden]), textarea, select') ||
                     box.querySelector('[data-primary]') || x;
      if (target && target.focus) target.focus();
    }, 60);

    return entry;
  }

  /* One global key handler for the whole modal stack. */
  document.addEventListener('keydown', e => {
    if (!modalStack.length) return;
    const top = modalStack[modalStack.length - 1];

    if (e.key === 'Escape') {
      if (top.dismissible) { e.preventDefault(); e.stopPropagation(); top.close('escape'); }
      return;
    }
    if (e.key === 'Enter') {
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
      const primary = top.box.querySelector('[data-primary]:not([disabled])');
      if (primary) { e.preventDefault(); primary.click(); }
    }
  }, true);

  function closeAllModals() {
    while (modalStack.length) modalStack[modalStack.length - 1].close('force');
  }

  function confirmBox(title, body, okLabel) {
    return new Promise(res => {
      let done = false;
      const finish = v => { if (done) return; done = true; res(v); };
      const m = modal(`
        <h2>${esc(title)}</h2>
        <p class="muted">${body}</p>
        <div class="row center wrap" style="margin-top:18px">
          <button class="btn-ghost" data-no>Cancel</button>
          <button class="btn-primary" data-primary data-yes>${esc(okLabel || 'Yes')}</button>
        </div>
        <p class="tiny faint center-text" style="margin:12px 0 0">Esc to cancel · Enter to confirm</p>`,
        { onClose: () => finish(false) });
      m.box.querySelector('[data-no]').onclick = () => { finish(false); m.close('cancel'); };
      m.box.querySelector('[data-yes]').onclick = () => { finish(true); m.close('ok'); };
    });
  }

  function promptBox(title, body, placeholder, type) {
    return new Promise(res => {
      let done = false;
      const finish = v => { if (done) return; done = true; res(v); };
      const m = modal(`
        <h2>${esc(title)}</h2>
        <p class="muted">${body || ''}</p>
        <input type="${type || 'text'}" id="pmt" data-autofocus
               placeholder="${esc(placeholder || '')}" autocomplete="off">
        <div class="row center wrap" style="margin-top:18px">
          <button class="btn-ghost" data-no>Cancel</button>
          <button class="btn-primary" data-primary data-yes>OK</button>
        </div>
        <p class="tiny faint center-text" style="margin:12px 0 0">Esc to cancel · Enter to confirm</p>`,
        { onClose: () => finish(null) });
      const inp = m.box.querySelector('#pmt');
      m.box.querySelector('[data-no]').onclick = () => { finish(null); m.close('cancel'); };
      m.box.querySelector('[data-yes]').onclick = () => { const v = inp.value; finish(v); m.close('ok'); };
    });
  }

  /* ------------------------------------------------------------- confetti */
  function confetti(n) {
    let cv = $('#confetti');
    if (!cv) { cv = el('canvas', { id: 'confetti' }); document.body.appendChild(cv); }
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    ctx.scale(dpr, dpr);
    const cols = ['#E8A33D', '#6B9080', '#E07A5F', '#9B8AA6', '#5B8FA8', '#F3C171'];
    const bits = Array.from({ length: n || 90 }, () => ({
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.5,
      r: 4 + Math.random() * 7,
      vy: 2 + Math.random() * 3.6,
      vx: -1.4 + Math.random() * 2.8,
      rot: Math.random() * 6.3,
      vr: -0.14 + Math.random() * 0.28,
      c: cols[Math.floor(Math.random() * cols.length)]
    }));
    let frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      bits.forEach(b => {
        b.x += b.vx; b.y += b.vy; b.rot += b.vr; b.vy += 0.035;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.r / 2, -b.r / 2, b.r, b.r * 0.62);
        ctx.restore();
      });
      frames++;
      if (frames < 190) requestAnimationFrame(tick);
      else { ctx.clearRect(0, 0, innerWidth, innerHeight); cv.remove(); }
    })();
  }

  function floatPoints(text, x, y) {
    const n = el('div', { class: 'float-points' }, esc(text));
    n.style.left = (x - 20) + 'px'; n.style.top = y + 'px';
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 1200);
  }

  /* ---------------------------------------------------------------- sound */
  let ac = null;
  function beep(kind) {
    if (!Store.db.settings.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const notes = {
        good:  [[660, 0], [880, .09]],
        great: [[660, 0], [880, .08], [1174, .16]],
        bad:   [[300, 0], [220, .11]],
        tick:  [[880, 0]],
        level: [[523, 0], [659, .09], [784, .18], [1046, .27]]
      }[kind] || [[660, 0]];
      notes.forEach(([f, t]) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ac.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.3);
        o.connect(g); g.connect(ac.destination);
        o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.32);
      });
    } catch (e) {}
  }

  /* --------------------------------------------------------------- speech */
  let voices = [];
  function loadVoices() {
    try { voices = speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    return voices;
  }
  if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  function bestVoice() {
    if (!voices.length) loadVoices();
    const want = Store.db.settings.voiceURI;
    if (want) { const v = voices.find(x => x.voiceURI === want); if (v) return v; }
    const prefs = [/en-GB/i, /en-IN/i, /en-AU/i, /en-US/i, /^en/i];
    for (const p of prefs) {
      const v = voices.find(x => p.test(x.lang) && /female|samantha|karen|serena|kate|fiona|moira|google uk/i.test(x.name))
             || voices.find(x => p.test(x.lang));
      if (v) return v;
    }
    return voices[0] || null;
  }

  function speak(text, opts) {
    const o = opts || {};
    if (!('speechSynthesis' in window)) { toast('This device cannot read words aloud.'); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      const v = bestVoice(); if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = o.rate || Store.db.settings.speakRate || 0.85;
      u.pitch = o.pitch || 1.05;
      u.volume = 1;
      if (o.onend) u.onend = o.onend;
      speechSynthesis.speak(u);
    } catch (e) { console.warn('speak', e); }
  }

  /** Say the word, then optionally spell it out slowly, then say it again. */
  function speakWordThen(word, meaning) {
    speak(word, {
      onend: () => { if (meaning) setTimeout(() => speak(meaning, { rate: 0.92 }), 260); }
    });
  }

  function spellOut(word) {
    const letters = String(word).toUpperCase().replace(/[^A-Z ]/g, '').split('');
    let i = 0;
    (function next() {
      if (i >= letters.length) { setTimeout(() => speak(word), 320); return; }
      const ch = letters[i++];
      if (ch === ' ') { setTimeout(next, 320); return; }
      speak(ch, { rate: 0.62, onend: () => setTimeout(next, 120) });
    })();
  }

  /* ---------------------------------------------------------------- misc  */
  const fmtDate = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const pct = n => Math.round((n || 0) * 100) + '%';
  const plural = (n, s, p) => n + ' ' + (n === 1 ? s : (p || s + 's'));

  function daysBetween(a, b) {
    return Math.floor((new Date(b) - new Date(a)) / 864e5);
  }

  /* ============================================================== PRONOUNS
     AraBuzz was built for one nine-year-old girl and said "she" everywhere.
     Most of the class are not her, and four of the nine children are boys.

     Every sentence the app writes about a child now comes through here. The
     default is "they", because a default of "she" is a mistake made about a
     real child, on their own screen, in front of them — and "they" is never
     wrong, only occasionally less natural.

     Use it like this:
         P.they()        →  she | he | they
         P.them()        →  her | him | them
         P.their()       →  her | his | their
         P.theirs()      →  hers | his | theirs
         P.themself()    →  herself | himself | themselves
         P.is('is')      →  is | is | are         (verb agreement for "they")
         P.has()         →  has | has | have
         P.does()        →  does | does | do
         P.Cap.they()    →  She | He | They
     ============================================================== */
  const PRONOUNS = [
    { key: 'she',  label: 'she / her' },
    { key: 'he',   label: 'he / him' },
    { key: 'they', label: 'they / them' }
  ];

  const PRON_TABLE = {
    she:  { they: 'she',  them: 'her',  their: 'her',   theirs: 'hers',  themself: 'herself',    plural: false },
    he:   { they: 'he',   them: 'him',  their: 'his',   theirs: 'his',   themself: 'himself',    plural: false },
    they: { they: 'they', them: 'them', their: 'their', theirs: 'theirs', themself: 'themselves', plural: true  }
  };

  /* Only the verbs the app actually writes. Anything not listed is returned
     unchanged, which is right for regular verbs after "they" (they spell,
     they practise) and harmless everywhere else. */
  const PLURAL_VERBS = {
    is: 'are', was: 'were', has: 'have', does: 'do', "isn't": "aren't",
    "hasn't": "haven't", "doesn't": "don't", "wasn't": "weren't", "'s": "'re"
  };

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /** `who` may be a pronoun key, a child profile, or nothing at all. */
  function pronouns(who) {
    const key = typeof who === 'string'
      ? who
      : (who && who.pronoun) || (w.Store && Store.db.profile && Store.db.profile.pronoun) || 'they';
    const t = PRON_TABLE[key] || PRON_TABLE.they;

    const verb = v => (t.plural ? (PLURAL_VERBS[v] || v) : v);
    const api = {
      key: PRON_TABLE[key] ? key : 'they',
      plural: t.plural,
      they: () => t.they, them: () => t.them, their: () => t.their,
      theirs: () => t.theirs, themself: () => t.themself,
      verb,
      is: () => verb('is'), was: () => verb('was'), has: () => verb('has'),
      does: () => verb('does'),
      /** "Aradhana spells" vs "they spell" — the -s a plural subject drops. */
      s: (stem) => (t.plural ? stem : stem + 's'),
      Cap: {
        they: () => cap(t.they), them: () => cap(t.them), their: () => cap(t.their),
        theirs: () => cap(t.theirs), themself: () => cap(t.themself)
      }
    };
    return api;
  }

  /** For the AI prompts: one line that tells the model how to write about
   *  this child, so a report never has to be corrected afterwards. */
  function pronounNote(name, who) {
    const p = pronouns(who);
    const n = name || 'the child';
    return p.plural
      ? `Refer to ${n} as "they/them" (singular they — "they spell", "they are"). ` +
        `Never use "he" or "she" about ${n}.`
      : `Refer to ${n} as "${p.they()}/${p.them()}". Never use any other pronoun about ${n}.`;
  }

  /** Stops iOS/desktop autocorrect from silently fixing her spelling. */
  function noAutoCorrect(input) {
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('data-gramm', 'false');
    return input;
  }

  /* ============================================================== BASELINE
     A 12-word check taken once, when the profile is created. Words are
     graded from easy to hard and each one probes a different English
     spelling pattern, so the very first Coach Report already has something
     real to say.
     ============================================================== */
  /* Twelve items, four different kinds of question — the same length as before,
     but now it measures two separate abilities rather than one:

       PRODUCE   she has to write the word herself   (listen / meaning → spell)
       RECOGNISE she only has to pick it out         (spot the spelling / meanings)

     That split is the whole point. A phonics-first speller very often recognises
     the correct spelling instantly but cannot produce it from memory — and that is
     a completely different problem from not knowing the word at all. Comparing the
     two scores tells us which one we are dealing with on day one. */
  /* Twenty items now, still four kinds. The extra eight exist to give every
     probe two or three chances to show itself — one miss on a doubling word is
     noise, three misses is a pattern, and the onboarding report is written
     the moment this finishes, so the patterns must be catchable from these
     twenty answers alone. */
  const BASELINE = [
    // ---- listen and spell (produce, hardest)
    { kind: 'listen', word: 'because', meaning: 'The word you use to give a reason.',
      probe: 'vowelteam', level: 1 },
    { kind: 'listen', word: 'people', meaning: 'More than one person.',
      probe: 'vowelswap', level: 1 },
    { kind: 'listen', word: 'different', meaning: 'Not the same as something else.',
      probe: 'doubling', level: 2 },
    { kind: 'listen', word: 'tomorrow', meaning: 'The day after today.',
      probe: 'doubling', level: 3 },
    { kind: 'listen', word: 'knowledge', meaning: 'All the things a person knows.',
      probe: 'silent', level: 3 },
    { kind: 'listen', word: 'occasion', meaning: 'A special event, like a birthday.',
      probe: 'doubling', level: 4 },

    // ---- meaning shown, spell it (produce, no sound to lean on)
    { kind: 'spell', word: 'friend', meaning: 'Someone you like and spend time with.',
      probe: 'vowelteam', level: 1 },
    { kind: 'spell', word: 'beautiful', meaning: 'Very lovely to look at.',
      probe: 'vowelteam', level: 2 },
    { kind: 'spell', word: 'separate', meaning: 'To move things apart from each other.',
      probe: 'vowelswap', level: 3 },
    { kind: 'spell', word: 'disappear', meaning: 'To go out of sight completely.',
      probe: 'doubling', level: 4 },

    // ---- spot the correct spelling (recognise)
    { kind: 'spot', word: 'island', meaning: 'Land with water all the way around it.',
      probe: 'silent', level: 2, options: ['iland', 'islend', 'ilande'] },
    { kind: 'spot', word: 'weird', meaning: 'Strange, in a surprising way.',
      probe: 'vowelswap', level: 3, options: ['wierd', 'weerd', 'wird'] },
    { kind: 'spot', word: 'necessary', meaning: 'Something you really need to have.',
      probe: 'doubling', level: 3, options: ['neccessary', 'necesary', 'nesessary'] },
    { kind: 'spot', word: 'rhythm', meaning: 'A repeating beat in music.',
      probe: 'silent', level: 4, options: ['rythm', 'rhythem', 'rithm'] },
    { kind: 'spot', word: 'tongue', meaning: 'The part of your mouth you taste with.',
      probe: 'silent', level: 4, options: ['tounge', 'tung', 'tonge'] },

    // ---- what does it mean (vocabulary — Spell Buzz tests this too)
    { kind: 'meaning', word: 'curious', meaning: 'Wanting very much to find out about something.',
      probe: 'vocab', level: 2, options: ['Feeling very cold.', 'Angry with a friend.', 'Extremely tidy.'] },
    { kind: 'meaning', word: 'ancient', meaning: 'Very, very old — from a long time ago.',
      probe: 'vocab', level: 2, options: ['Angry about something small.', 'Made completely of metal.', 'Happening every single day.'] },
    { kind: 'meaning', word: 'fragile', meaning: 'Easily broken, so you must be gentle.',
      probe: 'vocab', level: 3, options: ['Smells very strong.', 'Moves extremely fast.', 'Costs a lot of money.'] },
    { kind: 'meaning', word: 'generous', meaning: 'Happy to share and to give to others.',
      probe: 'vocab', level: 3, options: ['Very easily frightened.', 'Always arriving late.', 'Good at remembering.'] },
    { kind: 'meaning', word: 'reluctant', meaning: 'Not really wanting to do something.',
      probe: 'vocab', level: 4, options: ['Feeling very proud.', 'Completely worn out.', 'Full of clever ideas.'] }
  ];

  /* The card shown when the check changes gear. Twenty questions of one thing
     is a slog; four short chapters with a breath between them is a game. */
  const BASELINE_KINDS = {
    listen:  { title: 'First: listening ears',
               blurb: 'Ara says a word out loud. Type how you think it’s spelled. Guessing is allowed — guessing is useful!' },
    spell:   { title: 'Now something different',
               blurb: 'No sound this time. You’ll read what a word means, then spell the word it’s describing.' },
    spot:    { title: 'Now: detective eyes',
               blurb: 'Nothing to type! Just look carefully and pick the one that’s spelled right.' },
    meaning: { title: 'Last part: word meanings',
               blurb: 'Pick what each word means. Four to go — you’re nearly done!' }
  };

  const PRODUCE_KINDS = ['listen', 'spell'];

  /** Turns baseline answers into a starting picture. */
  function scoreBaseline(rows) {
    // rows: [{word, given, ok, probe, level, kind}]
    const P = window.Phonics;
    const right = rows.filter(r => r.ok).length;

    const produce = rows.filter(r => PRODUCE_KINDS.includes(r.kind));
    const recognise = rows.filter(r => !PRODUCE_KINDS.includes(r.kind));
    const rate = list => list.length ? list.filter(r => r.ok).length / list.length : null;
    const produceScore = rate(produce), recogniseScore = rate(recognise);

    const byLevel = {};
    rows.forEach(r => {
      byLevel[r.level] = byLevel[r.level] || { n: 0, ok: 0 };
      byLevel[r.level].n++; if (r.ok) byLevel[r.level].ok++;
    });
    let level = 1;
    [1, 2, 3, 4].forEach(L => { if (byLevel[L] && byLevel[L].ok / byLevel[L].n >= 0.6) level = L; });

    // Only the words she actually WROTE can be analysed as spellings.
    const summary = P.summarise(produce.map(r =>
      ({ correct: r.word, given: r.given, ok: r.ok, ts: Date.now() })));

    // The headline insight: can she see it but not write it?
    let gap = 'even';
    if (produceScore != null && recogniseScore != null) {
      if (recogniseScore - produceScore >= 0.3) gap = 'recognises-but-cannot-produce';
      else if (produceScore - recogniseScore >= 0.3) gap = 'writes-better-than-she-reads';
    }

    return {
      takenAt: Date.now(),
      correct: right,
      total: rows.length,
      level,
      levelName: ['', 'Getting started', 'Building up', 'Doing well', 'Strong speller'][level] || 'Getting started',
      produceScore, recogniseScore, gap,
      vocabScore: rate(rows.filter(r => r.kind === 'meaning')),
      phoneticShare: summary.phonetic.share,
      topPatterns: summary.patterns.slice(0, 3).map(p => ({ tag: p.tag, label: p.label, count: p.count })),
      rows: rows.map(r => ({ word: r.word, given: r.given, ok: r.ok, probe: r.probe, kind: r.kind }))
    };
  }

  w.U = {
    $, $$, el, esc, toast, modal, closeAllModals, confirmBox, promptBox, confetti, floatPoints,
    beep, speak, speakWordThen, spellOut, loadVoices, bestVoice,
    fmtDate, fmtDay, pct, plural, daysBetween, noAutoCorrect,
    PRONOUNS, pronouns, pronounNote,
    BASELINE, BASELINE_KINDS, scoreBaseline
  };
})(window);
