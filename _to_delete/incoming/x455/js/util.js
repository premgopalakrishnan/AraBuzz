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
  if ('speechSynthesis' in window) loadVoices();   // the watcher below rebinds this

  /* Devices ship several grades of the same voice and hand the plainest one
     over first. The plain grade is the robotic one — the "Enhanced",
     "Premium", "Natural" and "Neural" builds are recorded from a person and
     sound like one. Prefer them everywhere, on every platform, before
     falling back to accent. */
  const NICE = /\b(enhanced|premium|natural|neural|siri)\b/i;

  /* The joke voices. Apple ships a drawer of them — singing, robotic, alien —
     and not one is any use for reading a spelling to a nine-year-old. They
     are hidden rather than sorted to the bottom, because a list you have to
     scroll past rubbish to read is a list nobody reads. */
  const NOVELTY = /\b(bells?|bubbles?|organ|cellos?|zarvox|trinoids|boing|jester|wobble|whisper|bahh|deranged|hysterical|bad news|good news|pipe organ|superstar|albert|princess|junior|ralph|fred|kathy|bruce|agnes|victoria|alice singing|sing)\b/i;

  function voiceGrade(v) {
    const n = (v && v.name) || '';
    if (/premium|neural|natural/i.test(n)) return 3;
    if (/enhanced|siri/i.test(n)) return 2;
    if (NOVELTY.test(n)) return -2;
    if (/compact|eloquence/i.test(n)) return -1;
    return 0;
  }
  function isNovelty(v) { return NOVELTY.test((v && v.name) || ''); }
  function englishVoices() {
    if (!voices.length) loadVoices();
    return voices.filter(v => /^en/i.test(v.lang || ''));
  }
  function bestVoice() {
    if (!voices.length) loadVoices();
    const want = Store.db.settings.voiceURI;
    if (want) { const v = voices.find(x => x.voiceURI === want); if (v) return v; }
    const prefs = [/en-GB/i, /en-IN/i, /en-AU/i, /en-US/i, /^en/i];
    /* Grade first, accent second: a Premium American reads a spelling far
       better than a robotic British one. */
    const ranked = englishVoices().slice().sort((a, b) => {
      const g = voiceGrade(b) - voiceGrade(a);
      if (g) return g;
      const rank = v => { for (let i = 0; i < prefs.length; i++) if (prefs[i].test(v.lang)) return i; return 9; };
      return rank(a) - rank(b);
    });
    if (ranked.length) return ranked[0];
    for (const p of prefs) { const v = voices.find(x => p.test(x.lang)); if (v) return v; }
    return voices[0] || null;
  }

  /** Every English voice this device is willing to hand to AraBuzz, best
   *  first — which is not the same list the device shows in its own
   *  settings, and that difference is worth being able to see. */
  /** Every English voice this device is willing to hand to AraBuzz, best
   *  first — which is not the same list the device shows in its own
   *  settings, and that difference is worth being able to see.
   *  Pass `{ all: true }` to include the joke voices as well. */
  /* A device lists the SAME voice three times: "Karen", "Karen (Enhanced)"
     and "Karen (Premium)" are one person recorded three ways, and only the
     last is worth listening to. Showing all three invites a parent to pick
     the worst one by accident, so variants are folded together and the best
     grade wins — with the plain ones still reachable on request. */
  function baseName(n) {
    return String(n || '').replace(/\s*\((enhanced|premium|natural|neural|compact)\)\s*/ig, '').trim();
  }
  function variantOf(n) {
    const m = String(n || '').match(/\((enhanced|premium|natural|neural)\)/i);
    return m ? m[1].replace(/^./, c => c.toUpperCase()) : '';
  }

  /* Which devices are fenced off from their own good voices. Only Apple's,
     and only on the web — worth knowing, because it changes what we can
     honestly promise a parent. */
  function appleTouch() {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) ||
           (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  function voiceList(opts) {
    const o = opts || {};
    const rows = englishVoices()
      .filter(v => o.all || !isNovelty(v))
      .map(v => ({ uri: v.voiceURI, name: v.name, base: baseName(v.name), variant: variantOf(v.name),
                   lang: v.lang, grade: voiceGrade(v), nice: NICE.test(v.name), novelty: isNovelty(v) }));

    if (!o.everyVariant) {
      const byBase = new Map();
      rows.forEach(r => {
        const key = (r.base + '|' + (r.lang || '')).toLowerCase();
        const had = byBase.get(key);
        if (!had || r.grade > had.grade) byBase.set(key, r);
        if (had && r.grade <= had.grade) had.alsoPlain = true;
      });
      return Array.from(byBase.values())
        .sort((a, b) => b.grade - a.grade || a.base.localeCompare(b.base));
    }
    return rows.sort((a, b) => b.grade - a.grade || a.name.localeCompare(b.name));
  }

  /** How many entries are being folded away as lesser copies of a voice
   *  already on the list. */
  function variantCount() {
    return Math.max(0, voiceList({ everyVariant: true }).length - voiceList().length);
  }
  function noveltyCount() { return englishVoices().filter(isNovelty).length; }

  /* A device fills its voice list when it is ready, not when it is asked —
     often a second or two after the page has drawn. Anything showing that
     list can subscribe and redraw itself instead of making a parent press a
     button and hope. */
  const voiceWatchers = [];
  function onVoices(fn) { voiceWatchers.push(fn); }
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = () => {
      loadVoices();
      voiceWatchers.forEach(fn => { try { fn(voices.length); } catch (e) {} });
    };
  }

  /* One long flat utterance is most of what makes a synthetic voice sound
     like a machine — a person breathes between sentences. So anything longer
     than a phrase is spoken sentence by sentence, with a small gap, and the
     pitch drifts a hair between them. Same voice, far less robot. */
  function sentencesOf(text) {
    return String(text).replace(/\s+/g, ' ').trim()
      .split(/(?<=[.!?])\s+|(?<=[:;—])\s+/)
      .map(x => x.trim()).filter(Boolean);
  }

  /* AraBuzz speaks with the voice that belongs to the device, and with
     nothing else. No speech service, no account anywhere, no sentence sent
     off to be turned into sound — what a child says and hears in this app
     stays on the device that heard it. That is a deliberate choice and it
     costs something: on an iPad the built-in voice is the plainest of the
     three Apple ships, because Apple does not share the good ones with a web
     app. We would rather sound a little flat than quietly send a
     nine-year-old's spelling attempts to a third company to be read back. */
  /* ----------------------------------------------------- speaking, or not
     There are two kinds of speaking in this app and they are not the same
     thing. One is a child ASKING to hear a word — a tap on a speaker, the
     whole point of Listen & Spell — and that must always work. The other is
     the app deciding to read something out because it thinks that helps.

     Aradhana does not want the second kind. She is a strong reader; being
     read to while she is thinking is an interruption, not help. So the
     automatic kind can be switched off and the asked-for kind cannot, which
     means turning the voice off costs her nothing she wanted.

     Use speakAuto() for anything the app decided to say. Use speak() only
     where a person asked. */
  function autoVoiceOn() {
    const s = (window.Store && Store.db && Store.db.settings) || {};
    return s.autoVoice !== false;
  }
  function speakAuto(text, opts) {
    if (!autoVoiceOn()) return;
    speak(text, opts);
  }
  function setAutoVoice(on) {
    if (!window.Store || !Store.db) return;
    Store.db.settings.autoVoice = !!on;
    Store.save(true);
    if (!on && 'speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) {} }
  }

  function speak(text, opts) {
    const o = opts || {};
    const full = String(text || '').trim();
    if (!full) return;
    deviceSpeak(full, o);
  }

  function deviceSpeak(full, opts) {
    const o = opts || {};
    if (!('speechSynthesis' in window)) { toast('This device cannot read words aloud.'); return; }
    try {
      speechSynthesis.cancel();
      const v = bestVoice();
      const rate = o.rate || Store.db.settings.speakRate || 0.85;
      const parts = o.whole ? [full] : sentencesOf(full);

      const utter = (str, i) => {
        const u = new SpeechSynthesisUtterance(str);
        if (v) { u.voice = v; u.lang = v.lang; }
        u.rate = rate;
        u.pitch = (o.pitch || 1.05) + (i % 2 ? -0.03 : 0.03);   // a breath of variation
        u.volume = 1;
        return u;
      };

      /* Queue every sentence NOW rather than chaining each one off the end of
         the last. Safari's `onend` is unreliable — chaining means one missed
         event and she is left with half a sentence and silence. The browser's
         own queue plays them in order, and it puts a natural breath between
         utterances for free. */
      parts.forEach((str, i) => {
        const u = utter(str, i);
        if (o.onend && i === parts.length - 1) u.onend = o.onend;
        speechSynthesis.speak(u);
      });
    } catch (e) { console.warn('speak', e); }
  }

  /* ---- reading speed, choosable right where the speaking happens -------
     One small button that cycles Slow → Normal → Quick. It writes the choice
     into settings, so every "Hear it" in the app follows it from then on.
     The button is bound by delegation — paint the HTML anywhere with
     U.speedBtn() and it just works, no wiring per screen. */
  const SPEEDS = [
    { rate: 0.6,  label: 'Slow' },
    { rate: 0.85, label: 'Normal' },
    { rate: 1.15, label: 'Quick' }
  ];
  function speedIdx() {
    const r = (window.Store && Store.db && Store.db.settings.speakRate) || 0.85;
    let best = 1, gap = 9;
    SPEEDS.forEach((s, i) => { const g = Math.abs(s.rate - r); if (g < gap) { gap = g; best = i; } });
    return best;
  }
  function speedBtn() {
    return `<button type="button" class="btn-quiet btn-s" data-rate-toggle
      title="How fast words are read out">${esc('Voice: ' + SPEEDS[speedIdx()].label)}</button>`;
  }
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('[data-rate-toggle]');
    if (!b) return;
    const next = SPEEDS[(speedIdx() + 1) % SPEEDS.length];
    if (window.Store && Store.db) { Store.db.settings.speakRate = next.rate; Store.save(true); }
    $$('[data-rate-toggle]').forEach(x => { x.textContent = 'Voice: ' + next.label; });
    speak('The tallest giraffe');           // hear the new speed straight away
  }, true);

  /* ---- a speaker that reads any text, bound by delegation --------------
     Paint <button data-say-text="…"> anywhere. Used beside definitions, so a
     child who cannot read the meaning yet can still hear it — always the
     school's own words, never invented ones. */
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('[data-say-text]');
    if (!b) return;
    const extra = b.getAttribute('data-say-extra');
    speak(b.getAttribute('data-say-text'), {
      rate: 0.9,
      onend: extra ? () => setTimeout(() => speak('In simple words. ' + extra, { rate: 0.9 }), 300) : null
    });
  }, true);

  /** A small speaker button that reads a definition aloud. If the practice
   *  pack carries a kid-simple version of the same meaning, that follows —
   *  both come from the sheet's enrichment, neither is made up on the spot. */
  function sayMeaningBtn(meaning, kidMeaning) {
    if (!meaning) return '';
    const extra = (kidMeaning && kidMeaning !== meaning) ? kidMeaning : '';
    return `<button type="button" class="btn-quiet btn-icon" data-say-text="${esc(meaning)}"
      ${extra ? `data-say-extra="${esc(extra)}"` : ''}
      title="Read the meaning out loud" aria-label="Read the meaning out loud">${
      window.Icon ? Icon.icon('speaker', { size: 16 }) : '🔊'}</button>`;
  }

  /** Say the word, then optionally spell it out slowly, then say it again. */
  function speakWordThen(word, meaning) {
    speak(word, {
      onend: () => { if (meaning) setTimeout(() => speak(meaning, { rate: 0.92 }), 260); }
    });
  }

  /* ------------------------------------------------------ spelling it out
     Aradhana pressed "spell the word" and heard "capital N, capital E,
     capital C…". The word was being put into capitals before being spoken,
     and a lone capital letter is exactly what a speech engine describes
     rather than reads — it cannot know we meant the letter and not the
     shape of it.

     Lowercasing is not the fix either: a lone "a" is read as the word "a",
     and "i" as "I". So each letter is handed over as its NAME, spelled the
     way it sounds, which every engine reads correctly and which is also what
     a person actually says when spelling something aloud. */
  const LETTER_SOUNDS = {
    a: 'ay',  b: 'bee', c: 'see',  d: 'dee', e: 'ee',  f: 'eff',
    g: 'jee', h: 'aitch', i: 'eye', j: 'jay', k: 'kay', l: 'ell',
    m: 'em',  n: 'en',  o: 'oh',   p: 'pee', q: 'cue', r: 'ar',
    s: 'ess', t: 'tee', u: 'you',  v: 'vee', w: 'double-you',
    x: 'ex',  y: 'why', z: 'zed'
  };

  function spellOut(word) {
    /* A space or a hyphen is a beat, not a letter — "well-being" is spelled
       as two words with a pause, the way anyone would say it. */
    const chars = String(word).toLowerCase().replace(/[^a-z \-]/g, '').split('');
    let i = 0;
    (function next() {
      if (i >= chars.length) { setTimeout(() => speak(word), 320); return; }
      const ch = chars[i++];
      if (ch === ' ' || ch === '-') { setTimeout(next, 320); return; }
      const say = LETTER_SOUNDS[ch] || ch;
      speak(say, { rate: 0.62, onend: () => setTimeout(next, 120) });
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
  /* A second word for every slot — same kind, same probe, same level, so the
     scoring is identical whichever one a child gets. Two kids sitting the
     check side by side should not be able to copy, and a re-take should not
     feel like the same test handed back. */
  const BASELINE_ALT = [
    { kind: 'listen', word: 'again', meaning: 'One more time.',
      probe: 'vowelteam', level: 1 },
    { kind: 'listen', word: 'animal', meaning: 'A living creature, like a dog or a bird.',
      probe: 'vowelswap', level: 1 },
    { kind: 'listen', word: 'suddenly', meaning: 'Quickly, without any warning.',
      probe: 'doubling', level: 2 },
    { kind: 'listen', word: 'beginning', meaning: 'The first part of something.',
      probe: 'doubling', level: 3 },
    { kind: 'listen', word: 'answer', meaning: 'What you say back when someone asks a question.',
      probe: 'silent', level: 3 },
    { kind: 'listen', word: 'embarrass', meaning: 'To make someone feel silly in front of others.',
      probe: 'doubling', level: 4 },

    { kind: 'spell', word: 'school', meaning: 'The place you go to learn.',
      probe: 'vowelteam', level: 1 },
    { kind: 'spell', word: 'favourite', meaning: 'The one you like the most.',
      probe: 'vowelteam', level: 2 },
    { kind: 'spell', word: 'definite', meaning: 'Completely certain, with no doubt.',
      probe: 'vowelswap', level: 3 },
    { kind: 'spell', word: 'disappoint', meaning: 'To make someone sad because a hope did not come true.',
      probe: 'doubling', level: 4 },

    { kind: 'spot', word: 'castle', meaning: 'A large old building with strong walls and towers.',
      probe: 'silent', level: 2, options: ['casle', 'cassle', 'castel'] },
    { kind: 'spot', word: 'believe', meaning: 'To feel sure that something is true.',
      probe: 'vowelswap', level: 3, options: ['beleive', 'belive', 'beleave'] },
    { kind: 'spot', word: 'address', meaning: 'The name of the place where someone lives.',
      probe: 'doubling', level: 3, options: ['adress', 'addres', 'adres'] },
    { kind: 'spot', word: 'doubt', meaning: 'The feeling of not being sure.',
      probe: 'silent', level: 4, options: ['dout', 'dowt', 'doubbt'] },
    { kind: 'spot', word: 'stomach', meaning: 'The part of your body where food goes.',
      probe: 'silent', level: 4, options: ['stomack', 'stummach', 'stomache'] },

    { kind: 'meaning', word: 'enormous', meaning: 'Extremely big.',
      probe: 'vocab', level: 2, options: ['Very quiet and shy.', 'Bright and colourful.', 'Quick to fall asleep.'] },
    { kind: 'meaning', word: 'furious', meaning: 'Extremely angry.',
      probe: 'vocab', level: 2, options: ['Very hungry.', 'Full of happiness.', 'Moving in circles.'] },
    { kind: 'meaning', word: 'transparent', meaning: 'So clear you can see straight through it.',
      probe: 'vocab', level: 3, options: ['Very heavy to lift.', 'Making a loud noise.', 'Folded many times.'] },
    { kind: 'meaning', word: 'exhausted', meaning: 'Completely worn out and needing rest.',
      probe: 'vocab', level: 3, options: ['Very excited.', 'Lost and confused.', 'Extremely wealthy.'] },
    { kind: 'meaning', word: 'genuine', meaning: 'Real and true — not fake.',
      probe: 'vocab', level: 4, options: ['Very expensive.', 'Extremely rare.', 'Found in the sea.'] }
  ];

  /** One fresh 20-question check: every slot flips a coin between its two
   *  words, then the questions inside each part are shuffled — so no two
   *  children (and no two sittings) see the same check in the same order,
   *  while the parts, probes and difficulty stay identical for scoring. */
  function buildBaseline() {
    const order = ['listen', 'spell', 'spot', 'meaning'];
    const out = [];
    order.forEach(kind => {
      const a = BASELINE.filter(x => x.kind === kind);
      const b = BASELINE_ALT.filter(x => x.kind === kind);
      const picked = a.map((slot, i) => (Math.random() < 0.5 && b[i]) ? b[i] : slot);
      for (let i = picked.length - 1; i > 0; i--) {          // shuffle inside the part
        const j = Math.floor(Math.random() * (i + 1));
        [picked[i], picked[j]] = [picked[j], picked[i]];
      }
      out.push(...picked);
    });
    return out;
  }

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
    beep, speak, speakAuto, autoVoiceOn, setAutoVoice, speakWordThen, spellOut,
    loadVoices, bestVoice, voiceList, voiceGrade,
    noveltyCount, variantCount, onVoices, appleTouch,
    speedBtn, sayMeaningBtn,
    fmtDate, fmtDay, pct, plural, daysBetween, noAutoCorrect,
    PRONOUNS, pronouns, pronounNote,
    BASELINE, BASELINE_KINDS, buildBaseline, scoreBaseline
  };
})(window);
