/* ==========================================================================
   AraBuzz — ui.js
   Screens, routing and the child-facing experience.
   ========================================================================== */
(function (w) {
  'use strict';

  const { $, el, esc, toast, modal, confirmBox, promptBox, confetti } = window.U;

  let current = 'home';

  /* ------------------------------------------------------------- routing  */
  function go(name, opts) {
    /* A newer AraBuzz arrived while something was mid-flight. The moment the
       person navigates ANYWHERE quiet, the update is taken — so a version
       refreshed on one screen can never sit stale on the next. Only the three
       mid-question screens, and onboarding, are allowed to hold it off. */
    const holdUpdate = name === 'quiz' || name === 'puzzle' || name === 'result'
      || document.body.classList.contains('onboarding');
    if (!holdUpdate && window.ARABUZZ_UPDATE && window.arabuzzTakeUpdate) {
      if (window.arabuzzTakeUpdate()) return;
    }
    const scr = $('#scr-' + name);
    if (!scr) return;
    /* Empty the screen being left, not just hide it. Screens keep their HTML
       in the document, and two screens both containing an id like #quit or
       #ptab means document.querySelector finds the STALE one — which is how
       Word Rush's Stop button ended up wired to a dead quiz screen. Every
       screen repaints in full on entry, so nothing of value is lost. */
    window.U.$$('.screen').forEach(s => {
      if (s !== scr && s.classList.contains('active')) s.innerHTML = '';
      s.classList.remove('active');
    });
    scr.classList.add('active');
    current = name;
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    const painters = {
      setup: paintSetup, home: paintHome, play: paintPlay, learn: paintLearn,
      garden: paintGarden, me: paintMe, howto: paintHowTo, journey: paintJourney,
      who: paintWho, scores: paintScores,
      parent: () => window.Parent.paint(opts),
      admin:  () => window.Admin.paint(opts),
      landing: paintLanding
    };
    if (painters[name]) painters[name](opts);
    if (window.Scene) Scene.update();
    renderHud(); renderNav();
  }

  /* ------------------------------------------------------------- chrome   */
  const LOGO_SVG = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><defs>
<linearGradient id="lbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#357C93"/><stop offset="100%" stop-color="#1B4860"/></linearGradient>
<linearGradient id="lhd" x1=".15" y1="0" x2=".9" y2="1"><stop offset="0%" stop-color="#F8D189"/><stop offset="52%" stop-color="#E8A33D"/><stop offset="100%" stop-color="#CB831F"/></linearGradient>
<linearGradient id="lbk" x1=".1" y1="0" x2=".85" y2="1"><stop offset="0%" stop-color="#F2A184"/><stop offset="55%" stop-color="#E07A5F"/><stop offset="100%" stop-color="#B75439"/></linearGradient>
<linearGradient id="lcr" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#5A8474"/><stop offset="100%" stop-color="#9AC9B1"/></linearGradient></defs>
<rect x="2" y="2" width="116" height="116" rx="31" fill="url(#lbg)"/>
<g stroke="#F8D189" stroke-width="3.1" stroke-linecap="round" fill="none" opacity=".9"><path d="M99 24 q6.5 6 0 12"/><path d="M107.5 18 q11.5 12 0 24"/></g>
<g fill="url(#lcr)"><path d="M38 38 C31 24 20 19 13 23 C19 32 27 38 35 42 Z"/><path d="M46 30 C43 15 35 7 27 7 C29 18 35 27 42 34 Z"/><path d="M56 26 C58 12 55 4 48 2 C45 11 47 20 51 29 Z"/></g>
<path d="M52 71 C 74 69 85 77 82 87 C 79 95 65 96 58 89 C 63 84 59 77 52 71 Z" fill="#8E3B26"/>
<path d="M50 47 C 76 40 96 51 94 65 C 93 78 86 88 76 92 C 83 79 75 73 50 73 Z" fill="url(#lbk)" stroke="#A8523A" stroke-width="1.3" stroke-linejoin="round"/>
<path d="M64 48 C 82 49 91 56 90 65" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".38"/>
<ellipse cx="44" cy="64" rx="27" ry="28" fill="url(#lhd)"/>
<ellipse cx="70" cy="53" rx="2.5" ry="1.9" fill="#8E3F2C" opacity=".45"/>
<ellipse cx="31" cy="79" rx="8.5" ry="6.5" fill="#E07A5F" opacity=".28"/>
<ellipse cx="53" cy="57" rx="11" ry="11.5" fill="#FDFBF7"/>
<g stroke="#CBB9A4" stroke-width="1" stroke-linecap="round" opacity=".7"><path d="M46.5 51.5 h11.5"/><path d="M45 56.5 h13.5"/><path d="M46 61.5 h12.5"/></g>
<circle cx="55.5" cy="56.5" r="5.4" fill="#22333B"/><circle cx="57.5" cy="54.3" r="1.9" fill="#FDFBF7"/>
<path d="M26 101 L33 83 L40 101 M29.2 95 h7.6" stroke="#FDFBF7" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".92"/></svg>`;

  function renderHud() {
    const hud = $('#hud');
    const db = Store.db;
    if (!db.profile) { hud.innerHTML = ''; return; }
    const st = Game.levelProgress(db.game.points);
    const inQuiz = current === 'quiz';
    hud.innerHTML = inQuiz ? '' : `
      <button class="pill who-chip" id="whoBtn" title="Switch player, or add a brother or sister"
          style="--who:${esc((db.profile && db.profile.colour) || '#E8A33D')}">
          ${esc((db.profile && db.profile.emoji) || '🦜')} ${esc(db.profile ? db.profile.name : '')}
          ${Icon.icon('swap', { size: 14 })}</button>
      <span class="pill honey" title="Buzz Points">${Icon.icon('star', { size: 15 })} ${db.game.points}</span>
      <span class="pill sky" title="Level">Lv ${st.level}</span>
      <span class="pill coral" title="Day streak">${Icon.icon('flame', { size: 15 })} ${db.game.streakDays}</span>
      <button class="btn-quiet btn-s" id="parentBtn" title="For parents — PIN needed" style="gap:6px">
        ${Icon.icon('lock', { size: 16 })} Grown-ups</button>`;
    const pb = $('#parentBtn');
    if (pb) pb.onclick = openParentGate;
    const wb = $('#whoBtn');
    // Switching from inside the grown-ups area means switching GROWN-UPS
    // context: pick the kid, prove the PIN again, land in THAT kid's
    // grown-ups pages — never dropped onto the kids' screens.
    if (wb) wb.onclick = () => go('who', { from: current === 'parent' ? 'parent' : null });
  }

  function renderNav() {
    const nav = $('#nav');
    const HIDE_NAV = ['quiz', 'setup', 'parent', 'admin', 'landing', 'puzzle', 'result', 'who'];
    if (!Store.db.profile || HIDE_NAV.includes(current)) {
      nav.style.display = 'none'; return;
    }
    nav.style.display = 'flex';
    const items = [
      ['home', 'home', 'Home'], ['learn', 'book', 'Learn'], ['scores', 'medal', 'Scores'],
      ['me', 'macaw', 'Ara'], ['howto', 'help', 'Help']
    ];
    nav.innerHTML = items.map(([k, i, t]) =>
      `<button data-go="${k}" class="${current === k ? 'on' : ''}">${Icon.icon(i, { size: 21 })}${t}</button>`).join('');
    window.U.$$('#nav button').forEach(b => b.onclick = () => go(b.dataset.go));
  }

  /* ====================================================================== */
  /*  SETUP — profile + baseline check                                      */
  /* ====================================================================== */
  let setupState = { step: 0, name: '', rows: [], i: 0, mode: 'new', emoji: null, colour: null };

  function paintSetup() {
    const s = $('#scr-setup');
    if (setupState.step === 0) {
      s.innerHTML = `
        <div class="card glow" style="max-width:560px;margin:20px auto;text-align:center">
          <div class="ara-stage ara-bob" style="margin-bottom:6px">${Ara.svg({ level: 1, width: 170, mood: 'happy' })}</div>
          <h1>Hello! I'm Ara.</h1>
          <p class="muted">I'm a macaw, and macaws are very good at words. I'm going to
             help you get brilliant at spelling — and every time you practise, I grow.</p>
          <div class="field" style="text-align:left;margin-top:22px">
            <label>What should I call you?</label>
            <input type="text" id="nm" placeholder="Type your name" maxlength="18">
          </div>
          <div class="field" style="text-align:left">
            <label>Pick your badge</label>
            <div class="row wrap" style="gap:8px" id="avaPick">
              ${Store.AVATARS.map((e, i) => `<button class="ava ${i === 0 ? 'on' : ''}" data-ava="${i}"
                 style="--ava:${Store.COLOURS[i]}">${e}</button>`).join('')}
            </div>
          </div>
          <div class="field" style="text-align:left">
            <label>Ara will talk about you — which words should she use?</label>
            <div class="row wrap" style="gap:8px" id="pnPick">
              ${window.U.PRONOUNS.map((p, i) => `<button class="btn-quiet pn ${i === 2 ? 'on' : ''}"
                 data-pn="${p.key}">${esc(p.label)}</button>`).join('')}
            </div>
          </div>
          <button class="btn-primary btn-xl btn-block" id="go1">Let's go →</button>
          ${((window.Cloud && Cloud.whoAmI() && Cloud.whoAmI().parent) || (Store.db.children || []).length)
            ? `<button class="btn-quiet btn-block" id="setupBack" style="margin-top:10px">← Back</button>` : ''}
          <p class="hint" style="margin-top:14px">Grown-up setting things up? You can add words after this.</p>
        </div>`;
      const sb = $('#setupBack');
      if (sb) sb.onclick = () => {
        const me = window.Cloud && Cloud.whoAmI();
        if (me && me.parent) return go('landing');
        if ((Store.db.children || []).length) return go('who');
        go('home');
      };
      const nm = $('#nm'); setTimeout(() => nm.focus(), 200);
      let ava = 0;
      let pronoun = setupState.pronoun || 'they';
      window.U.$$('#avaPick .ava').forEach(b => b.onclick = () => {
        ava = +b.dataset.ava;
        window.U.$$('#avaPick .ava').forEach(x => x.classList.toggle('on', x === b));
      });
      window.U.$$('#pnPick .pn').forEach(b => {
        b.classList.toggle('on', b.dataset.pn === pronoun);
        b.onclick = () => {
          pronoun = b.dataset.pn;
          window.U.$$('#pnPick .pn').forEach(x => x.classList.toggle('on', x === b));
        };
      });
      const start = () => {
        const v = nm.value.trim();
        if (!v) { toast('Type your name first!'); nm.focus(); return; }
        setupState.name = v;
        setupState.emoji = Store.AVATARS[ava];
        setupState.colour = Store.COLOURS[ava];
        setupState.pronoun = pronoun;
        setupState.step = 1; paintSetup();
      };
      $('#go1').onclick = start;
      nm.onkeydown = e => { if (e.key === 'Enter') start(); };
      return;
    }

    if (setupState.step === 1) {
      s.innerHTML = `
        <div class="card glow" style="max-width:600px;margin:20px auto;text-align:center">
          <div class="ara-stage">${Ara.svg({ level: 1, width: 130, mood: 'think' })}</div>
          <h1>Nice to meet you, ${esc(setupState.name)}!</h1>
          <p class="muted">Before we start, I'd like to see how you spell right now —
             <b>20 questions, in four little parts</b>. It is <b>not a test</b> and nobody
             is marking you. Some are meant to be hard. Getting them wrong actually helps
             me: it tells me exactly what to practise with you.</p>
          <div class="row center wrap" style="gap:8px;margin:18px 0">
            <span class="pill sage">${Icon.icon('clock',{size:15})} About 5 minutes</span>
            <span class="pill honey">${Icon.icon('ear',{size:15})} You can hear each word</span>
            <span class="pill plum">${Icon.icon('lock',{size:15})} Just for us</span>
          </div>
          <button class="btn-go btn-xl btn-block" id="go2">I'm ready</button>
          <button class="btn-quiet btn-block" id="setupBack1" style="margin-top:10px">← Back</button>
        </div>`;
      setTimeout(() => { const b = $('#go2'); if (b) b.focus(); }, 80);     // Enter presses it
      $('#setupBack1').onclick = () => {
        if (setupState.mode === 'retake' && Store.db.profile) return go('home');
        setupState.step = 0; paintSetup();
      };
      $('#go2').onclick = () => {
        setupState.step = 2; setupState.i = 0; setupState.rows = [];
        // A fresh mix every sitting — same parts, same difficulty, different
        // words and a different order, so siblings never sit the same check.
        setupState.qs = window.U.buildBaseline ? window.U.buildBaseline() : window.U.BASELINE;
        paintSetup();
      };
      return;
    }

    // step 2 — the baseline itself
    const B = setupState.qs || window.U.BASELINE;
    const i = setupState.i;
    if (i >= B.length) { finishSetup(window.U.scoreBaseline(setupState.rows)); return; }
    const item = B[i];

    /* A new kind of question gets announced before it appears. Twenty questions
       of one thing is a slog; four short chapters with a breath between them
       stays a game. */
    if (setupState.announced !== item.kind) {
      const K = window.U.BASELINE_KINDS[item.kind] || { title: 'Next part', blurb: '' };
      s.innerHTML = `
        <div class="card glow" style="max-width:560px;margin:20px auto;text-align:center">
          <div class="ara-stage ara-bob">${Ara.svg({ level: 1, width: 130, mood: 'happy' })}</div>
          <p class="tiny faint" style="letter-spacing:.12em;text-transform:uppercase;margin:0 0 6px">
            Question ${i + 1} of ${B.length}</p>
          <h1>${K.title}</h1>
          <p class="muted">${K.blurb}</p>
          <button class="btn-go btn-xl btn-block" id="kindGo" style="margin-top:14px">Ready →</button>
        </div>`;
      $('#kindGo').onclick = () => { setupState.announced = item.kind; paintSetup(); };
      setTimeout(() => { const b = $('#kindGo'); if (b) b.focus(); }, 80);   // Enter presses it
      return;
    }

    const KIND = {
      listen:  { tag: 'Listen and spell',   ask: 'Listen, then type the word.' },
      spell:   { tag: 'Spell it',           ask: 'Type the word that means this.' },
      spot:    { tag: 'Spot the spelling',  ask: 'Which one is spelled correctly?' },
      meaning: { tag: 'What does it mean?', ask: 'Pick what this word means.' }
    }[item.kind];

    const record = (given, ok) => {
      setupState.rows.push({
        word: item.word, given, ok, probe: item.probe, level: item.level, kind: item.kind
      });
      setupState.i++;
      paintSetup();
    };

    let bodyHTML = '';
    if (item.kind === 'listen') {
      bodyHTML = `
        <div class="center-text" style="padding:8px 0 4px">
          <button class="btn-primary btn-xl" id="hear">${Icon.icon('speaker',{size:20})} Hear the word</button>
          <div class="row center" style="gap:8px;margin-top:10px">
            <button class="btn-ghost btn-s" id="slow">${Icon.icon('clock',{size:16})} Slower</button>
            ${window.U.speedBtn()}
          </div>
        </div>
        <p class="center-text muted small" style="margin:14px 0 4px">${esc(item.meaning)}</p>
        <input type="text" class="spell-input" id="ans" placeholder="type the word">`;
    } else if (item.kind === 'spell') {
      bodyHTML = `
        <p class="center-text" style="font-size:1.15rem;line-height:1.6;margin:10px 0 4px">${esc(item.meaning)}</p>
        <input type="text" class="spell-input" id="ans" placeholder="type the word">`;
    } else if (item.kind === 'spot') {
      const opts = Engine.shuffle([item.word].concat(item.options));
      bodyHTML = `
        <p class="center-text muted" style="margin:10px 0 14px">${esc(item.meaning)}</p>
        <div class="opts" id="opts">${opts.map((o, k) =>
          `<button class="opt spelling-opt" data-v="${esc(o)}"><span class="key">${'ABCD'[k]}</span><span>${esc(o)}</span></button>`).join('')}</div>`;
    } else {
      const opts = Engine.shuffle([item.meaning].concat(item.options));
      bodyHTML = `
        <div class="center-text"><div class="big-word">${esc(item.word)}</div></div>
        <div class="opts" id="opts" style="margin-top:16px">${opts.map((o, k) =>
          `<button class="opt" data-v="${esc(o)}"><span class="key">${'ABCD'[k]}</span><span>${esc(o)}</span></button>`).join('')}</div>`;
    }

    const typed = item.kind === 'listen' || item.kind === 'spell';

    s.innerHTML = `
      <div class="card glow" style="max-width:620px;margin:14px auto">
        <div class="row between" style="margin-bottom:6px">
          <span class="kicker">${esc(KIND.tag)}</span>
          <span class="kicker">${i + 1} of ${B.length}</span>
        </div>
        <div class="qbar">${B.map((_, k) =>
          `<span class="${k < i ? 'done' : k === i ? 'now' : ''}"></span>`).join('')}</div>
        <p class="center-text small faint" style="margin:4px 0 10px">${esc(KIND.ask)}</p>
        ${bodyHTML}
        ${typed ? `<div class="row center" style="margin-top:16px">
          <button class="btn-primary btn-xl" id="next">Next →</button></div>` : ''}
        <p class="hint center-text">Not sure? Have a go anyway — a guess tells me more than a blank.</p>
      </div>`;

    if (typed) {
      const ans = window.U.noAutoCorrect($('#ans'));
      setTimeout(() => ans.focus(), 150);
      if (item.kind === 'listen') {
        const hear = () => window.U.speak(item.word);
        $('#hear').onclick = hear;
        $('#slow').onclick = () => window.U.speak(item.word, { rate: 0.55 });
        setTimeout(hear, 350);
      }
      const submit = () => {
        const given = ans.value.trim();
        record(given, Phonics.analyse(item.word, given).ok);
      };
      $('#next').onclick = submit;
      ans.onkeydown = e => { if (e.key === 'Enter') submit(); };
    } else {
      const right = item.kind === 'spot' ? item.word : item.meaning;
      window.U.$$('#opts .opt').forEach(b => b.onclick = () => {
        const v = b.dataset.v;
        window.U.$$('#opts .opt').forEach(x => {
          x.classList.add('locked');
          if (x.dataset.v === right) x.classList.add('correct');
          else if (x === b) x.classList.add('wrong');
        });
        setTimeout(() => record(v, v === right), 620);
      });
    }
  }

  /** Wipe the on-screen state and run the welcome again for a new child. */
  function startFresh() {
    setupState = { step: 0, mode: 'new', name: '', rows: [], i: 0, emoji: null, colour: null };
    learnState = { weekId: null, i: 0, flipped: false };
    playPick = { weekIds: [], mode: 'spellbuzz', count: 10 };
    go('setup');
  }

  function retakeBaseline() {
    setupState = { step: 1, mode: 'retake',
      name: (Store.db.profile && Store.db.profile.name) || 'Speller', rows: [], i: 0 };
    go('setup');
  }

  /** Add another child from the parent area, or from the picker. */
  function addChildFlow() {
    setupState = { step: 0, mode: 'new', name: '', rows: [], i: 0, emoji: null, colour: null };
    go('setup');
  }

  async function finishSetup(baseline) {
    if (setupState.mode === 'new') {
      // Through Sync, so she exists in the account as well as on this device —
      // and carries the same id in both, on every device she ever uses.
      await window.Sync.createChild({
        name: setupState.name, emoji: setupState.emoji,
        colour: setupState.colour, pronoun: setupState.pronoun || 'they'
      });
      Store.db.profile.baseline = baseline || null;
      Store.db.game.lastPlayDay = '';
      if (baseline) {
        window.Sync.saveChild(Store.db.activeChildId, { baseline });
        /* The onboarding report — written NOW, from these twenty answers.
           That is the agreement with the parent: the first check IS the
           assessment, and their starting-point note is waiting behind the
           PIN by the time the child has finished celebrating. It runs in
           the background; the child never waits on it or sees it. */
        if (window.Parent && Parent.generateOnboardingReport) {
          Parent.generateOnboardingReport(baseline).catch(e =>
            console.warn('onboarding report deferred', e));
        }
      }
    } else {
      const existing = Store.db.profile || {};
      Store.db.profile = Object.assign({ createdAt: Date.now() }, existing, {
        name: setupState.name || existing.name || 'Speller',
        baseline: baseline || existing.baseline || null
      });
    }
    Store.save(true);
    syncVault();

    if (!baseline) { go('home'); return; }

    const s = $('#scr-setup');
    const phon = Math.round(baseline.phoneticShare * 100);
    const prod = baseline.produceScore == null ? null : Math.round(baseline.produceScore * 100);
    const recog = baseline.recogniseScore == null ? null : Math.round(baseline.recogniseScore * 100);

    /* Every branch below is earned by the numbers, never assumed. A child who
       got everything right must hear that — not a canned line about the words
       they "missed". */
    const acc = baseline.total ? baseline.correct / baseline.total : 0;
    const missed = baseline.total - baseline.correct;
    const insight =
      acc === 1
        ? `Every single one right — all ${baseline.total} of them. That's genuinely rare. The
           school sheets will bring words that stretch even you, and that's where the fun starts.`
      : acc >= 0.9
        ? `${missed === 1 ? 'Only one slipped past you' : 'Only ' + missed + ' slipped past you'} —
           that's a very strong start. We'll aim the practice at exactly ${missed === 1 ? 'that kind of word' : 'those kinds of words'},
           and the rest stays out of your way.`
      : baseline.gap === 'recognises-but-cannot-produce'
        ? `Here's the interesting bit: when I showed you spellings, you picked the right one
           <b>${recog}%</b> of the time — but when you had to write it yourself, <b>${prod}%</b>.
           That means you already <i>know</i> what these words look like. Getting them out of your
           head and onto the page is the part we'll practise.`
      : (missed > 0 && phon >= 50)
        ? `Most of the ones you missed, you spelled <b>the way they sound</b> — so your ears are
           excellent. We just need to teach your eyes to remember the shape of the word too.
           That's exactly what I'm for.`
        : `You've got a good feel for how words are built. We'll work on the tricky letters that
           like to hide inside them.`;

    s.innerHTML = `
      <div class="card glow" style="max-width:620px;margin:20px auto;text-align:center">
        <div class="ara-stage ara-cheer">${Ara.svg({ level: 1, width: 160, mood: 'celebrate' })}</div>
        <h1>All done, ${esc(Store.db.profile.name)}!</h1>
        <p class="muted">You got <b>${baseline.correct} out of ${baseline.total}</b>. That's a really useful start.</p>
        <div class="row center wrap" style="gap:8px;margin:14px 0">
          ${prod != null ? `<span class="pill honey">${Icon.icon('pencil',{size:15})} Writing it yourself: ${prod}%</span>` : ''}
          ${recog != null ? `<span class="pill sky">${Icon.icon('search',{size:15})} Spotting the right one: ${recog}%</span>` : ''}
        </div>
        <div class="card flat" style="background:var(--honey-soft);border:none;text-align:left;margin:18px 0">
          <p style="margin:0"><b>Here's what I noticed:</b></p>
          <p style="margin:8px 0 0">${insight}</p>
        </div>
        <button class="btn-primary btn-xl btn-block" id="done">Take me to AraBuzz →</button>
      </div>`;
    $('#done').onclick = () => { go('journey', { first: true }); confetti(70); };
    setTimeout(() => { const b = $('#done'); if (b) b.focus(); }, 120);      // Enter presses it
  }

  /* ======================================================================
     WHO'S PLAYING — the child picker
     ====================================================================== */
  function paintWho(opts) {
    const s = $('#scr-who');
    const from = (opts && opts.from) || null;
    const kids = Store.childList();
    s.innerHTML = `
      <div class="center-text" style="padding:14px 0 4px">
        <h1 style="margin-bottom:4px">${from === 'parent' ? 'Whose pages?' : "Who's playing?"}</h1>
        <p class="muted">${from === 'parent'
          ? 'Pick a kid — your PIN opens their grown-ups pages.'
          : 'Everyone has their own points, streak, tree and reports. The word lists are shared.'}</p>
      </div>
      <div class="who-grid">
        ${kids.map(k => `
          <button class="who-card ${k.active ? 'on' : ''}" data-kid="${k.id}" style="--who:${k.colour}">
            <span class="who-ava">${k.emoji}</span>
            <span class="who-name">${esc(k.name)}</span>
            <span class="who-meta">Level ${Game.levelFor(k.points)} · ${k.points} pts${k.streak ? ` · ${k.streak} day streak` : ''}</span>
            ${k.active ? '<span class="who-tag">playing now</span>' : ''}
          </button>`).join('')}
        <button class="who-card add" id="addKid">
          <span class="who-ava">＋</span>
          <span class="who-name">Add someone</span>
          <span class="who-meta">A brother, sister or friend</span>
        </button>
      </div>
      <div class="center-text" style="margin-top:22px">
        <button class="btn-ghost" id="whoBack">← Back</button>
      </div>`;

    window.U.$$('#scr-who [data-kid]').forEach(b => b.onclick = () => {
      const id = b.dataset.kid;
      if (id !== Store.db.activeChildId) {
        Store.switchChild(id);
        syncVault(true);
      }
      if (from === 'parent') { openParentGate(); return; }   // PIN, then that kid's grown-ups
      toast(`Hello again, ${Store.db.profile.name}!`, 'good');
      go('home');
    });
    $('#addKid').onclick = addChildFlow;
    $('#whoBack').onclick = () => go(from === 'parent' ? 'parent' : 'home');
  }

  /* ====================================================================== */
  /*  HOME                                                                  */
  /* ====================================================================== */
  /** The newest set whose words this child has never even LOOKED at.
   *  "Met" is a firstSeen stamp on the progress row — practice also sets it,
   *  so a child who dove straight into a quiz is not nagged afterwards. */
  function unmetWeek() {
    const db = Store.db;
    for (const wk of (db.weeks || [])) {
      const ids = wk.wordIds || [];
      if (!ids.length) continue;
      const unmet = ids.filter(id => {
        const pr = db.progress[id];
        return !pr || (!pr.seen && !pr.firstSeen);
      });
      if (unmet.length >= Math.max(3, Math.ceil(ids.length * 0.6))) return wk;
      return null;   // only ever the newest set — older ones are history
    }
    return null;
  }

  function startMeet(weekId) {
    learnState = { weekId, i: 0, flipped: false, meet: true };
    go('learn');
  }

  function paintHome() {
    const db = Store.db, s = $('#scr-home');
    /* No child on this device: the home screen has nobody to greet. The admin
       belongs in the console, a signed-in parent on the landing, and only a
       truly blank offline device falls through to the welcome. This is what
       froze "Back to the app" for the admin — a blank screen mid-crash. */
    if (!db.profile) {
      const me = window.Cloud && Cloud.whoAmI();
      if (me && me.isAdmin) return go('admin');
      if (me && me.parent) return go('landing');
      return go('setup');
    }
    const name = db.profile.name;
    const lv = Game.levelProgress(db.game.points);
    const weeks = db.weeks;
    const latest = weeks[0];
    const allWords = Store.allWords();
    const due = Engine.dueCount(allWords);
    const tricky = Engine.trickyWords(50).length;
    const playedToday = Game.todayCount();
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Hello' : 'Good evening';

    if (!allWords.length) {
      s.innerHTML = `
        <div class="card glow center-text" style="max-width:600px;margin:10px auto">
          <div class="ara-stage ara-bob">${Ara.svg({ level: lv.level, width: 160, mood: 'think' })}</div>
          <h1>${greet}, ${esc(name)}!</h1>
          <p class="muted">I don't have any words yet. A grown-up needs to add this week's
             Spell Buzz sheet first — then we can play.</p>
          <button class="btn-primary btn-xl" id="toParent">${Icon.icon('lock',{size:19})} Grown-up, tap here</button>
        </div>
        ${howItWorksCard()}`;
      $('#toParent').onclick = openParentGate;
      return;
    }

    const meetWk = unmetWeek();

    s.innerHTML = `
      <div id="heroSlot" style="cursor:pointer">${Scene.hero()}</div>

      ${meetWk ? `
      <div class="card glow" style="margin-bottom:16px;border-color:var(--gold)">
        <div class="row wrap between" style="gap:12px">
          <div class="grow" style="min-width:200px">
            <h3 style="margin:0">New words have arrived!</h3>
            <p class="muted small" style="margin:4px 0 0">
              ${esc(meetWk.topic || meetWk.title)} — ${window.U.plural((meetWk.wordIds || []).length, 'word')}.
              Come and meet them first. No questions, no marks — just a hello.</p>
          </div>
          <button class="btn-primary" id="meetBtn">${Icon.icon('sparkle', { size: 17 })} Meet the words</button>
        </div>
      </div>` : ''}

      <div class="card glow" style="margin-bottom:16px">
        <div class="row wrap" style="gap:20px">
          <div class="ara-stage ara-bob" style="flex:none">${Ara.svg({ level: lv.level, width: 132, mood: playedToday ? 'happy' : 'idle' })}</div>
          <div class="grow" style="min-width:220px">
            <h1 style="margin-bottom:2px">${greet}, ${esc(name)}!</h1>
            <div class="speech up" style="margin:10px 0 14px">${esc(
              playedToday ? 'Back again? I like your style.' : Ara.say('welcome'))}</div>
            <div class="row between small muted" style="margin-bottom:5px">
              <span>Level ${lv.level} · ${Ara.stageFor(lv.level).name}</span>
              <span>${lv.into} / ${lv.need}</span>
            </div>
            <div class="bar"><i style="width:${Math.round(lv.pct * 100)}%"></i></div>
          </div>
        </div>
      </div>

      <div class="row wrap" style="gap:10px;margin-bottom:16px">
        <span class="pill honey">${Icon.icon('star', { size: 15 })} ${db.game.points} Buzz Points</span>
        <span class="pill coral">${Icon.icon('flame', { size: 15 })} ${window.U.plural(db.game.streakDays, 'day')} in a row</span>
        <span class="pill sage">${Icon.icon('sprout', { size: 15 })} ${Game.grownCount()} words grown</span>
        ${due ? `<span class="pill sky">${Icon.icon('target', { size: 15 })} ${due} ready</span>` : ''}
      </div>

      ${(() => {
        const got = Game.BADGES.filter(x => Game.has(x.id));
        const nextB = Game.BADGES.filter(x => !Game.has(x.id))[0];
        return `<div class="badge-shelf" style="margin-bottom:18px">
          ${got.slice(-4).map(x => `<span class="badge-chip">${Icon.icon(x.ic, { size: 15 })} ${esc(x.name)}</span>`).join('')}
          ${nextB ? `<span class="badge-chip locked">${Icon.icon('lock', { size: 14 })} next: ${esc(nextB.name)}</span>` : ''}
          <button class="btn-quiet btn-s" id="scoresLink">${Icon.icon('medal', { size: 16 })} My scores</button>
        </div>`;
      })()}

      <h2>Pick a game</h2>
      <div class="grid grid-auto" id="modes"></div>

      ${latest ? `
      <h2 style="margin-top:28px">This week</h2>
      <div class="card">
        <div class="row between wrap">
          <div>
            <div class="kicker">${esc(latest.topic || 'Spell Buzz')}</div>
            <h3 class="row" style="margin:2px 0 4px;gap:9px"><span class="setno">${Store.weekTag(latest)}</span>${esc(latest.title)}</h3>
            <p class="small muted" style="margin:0">${latest.wordIds.length} words${
              latest.assessedOn ? ` · test on ${esc(new Date(latest.assessedOn).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}` : ''}</p>
          </div>
          <div class="row">
            <button class="btn-ghost btn-s" id="studyBtn">${Icon.icon('book',{size:16})} Study them</button>
            <button class="btn-go btn-s" id="weekQuiz">Practise →</button>
          </div>
        </div>
        <div class="row wrap" style="gap:6px;margin-top:14px">
          ${Store.weekWords(latest.id).slice(0, 24).map(wd => {
            const p = Game.plantFor(wd.id);
            return `<span class="pill ${p.grown ? 'sage' : ''}">${esc(wd.word)}</span>`;
          }).join('')}
        </div>
      </div>` : ''}

      ${tricky >= 3 ? `
      <div class="card" style="margin-top:16px;border-color:var(--coral)">
        <div class="row between wrap">
          <div><h3 style="margin:0">Your tricky words</h3>
          <p class="small muted" style="margin:4px 0 0">${tricky} words are still catching you out. Ten minutes here is worth an hour anywhere else.</p></div>
          <button class="btn-primary btn-s" id="trickyBtn">Practise these</button>
        </div>
      </div>` : ''}
      `;

    // Six games, not nine. Beat the Buzzer was just Word Meanings with a clock,
    // and Championship Buzz was Mixed Buzz with a serious face — both are now
    // options inside the game they belonged to. Mixed Buzz sits last on purpose:
    // it is everything combined, including a small crossword, so it reads as the
    // real thing to work up to.
    const modes = [
      { k: 'quest', ic: 'trophy', t: 'Spell Quest', d: 'Ara gives you a clue, you type the spelling — the whole list, one at a time, until you beat it. Talk to her back; this one is better with the internet on. 📶', ribbon: 'NEW' },
      { k: 'spellbuzz', ic: 'pencil', t: 'Spell Buzz', d: 'Read the clue, spell the word. Just like the test at school.', ribbon: 'START HERE' },
      { k: 'rush', ic: 'keys', t: 'Word Rush', d: 'Typing game. Copy it, watch it vanish, then type it from memory.' },
      { k: 'listen', ic: 'ear', t: 'Listen & Spell', d: 'I say the word out loud. You spell it.' },
      { k: 'meanings', ic: 'speech', t: 'Word Meanings', d: 'Match words to what they mean. Add a timer if you want a race.' },
      { k: 'puzzles', ic: 'puzzle', t: 'Puzzles', d: 'Crossword or word search — you choose.' },
      { k: 'mixed', ic: 'dice', t: 'Mixed Buzz', d: 'Everything at once, with a mini crossword thrown in. The real test.', ribbon: 'BOSS' }
    ];
    /* The order is HERS. A kid who lives in Word Rush should not have to
       scroll past five tiles to reach it, so the tiles can be dragged into
       whatever order she likes and the app remembers. Unknown or new games
       (like a freshly shipped one) join at the front so they get noticed. */
    const saved = (db.game.tileOrder || []).filter(k => modes.some(m => m.k === k));
    const ordered = modes.slice().sort((a, b) => {
      const ia = saved.indexOf(a.k), ib = saved.indexOf(b.k);
      if (ia < 0 && ib < 0) return 0;
      if (ia < 0) return -1;
      if (ib < 0) return 1;
      return ia - ib;
    });
    $('#modes').innerHTML = ordered.map(m => `
      <div class="tile" data-mode="${m.k}" style="touch-action:none">
        ${m.ribbon ? `<span class="ribbon">${m.ribbon}</span>` : ''}
        <span class="tile-ic">${Icon.icon(m.ic, { size: 30, stroke: 1.5 })}</span>
        <h3>${m.t}</h3><p>${m.d}</p>
      </div>`).join('');
    makeTilesDraggable($('#modes'), order => {
      Store.db.game.tileOrder = order;
      Store.save(true);
    }, key => go('play', { mode: key }));

    if ($('#heroSlot')) $('#heroSlot').onclick = () => go('journey');
    if ($('#meetBtn') && meetWk) $('#meetBtn').onclick = () => startMeet(meetWk.id);
    if ($('#scoresLink')) $('#scoresLink').onclick = () => go('scores');
    if ($('#weekQuiz')) $('#weekQuiz').onclick = () => go('play', { mode: 'spellbuzz', weekIds: [latest.id] });
    if ($('#studyBtn')) $('#studyBtn').onclick = () => go('learn', { weekId: latest.id });
    if ($('#trickyBtn')) $('#trickyBtn').onclick = () => Quiz.start({ preset: 'mixed', pool: Engine.trickyWords(40), label: 'Tricky Words', count: 10 });
  }

  /* ======================================================================
     DRAG THE TILES INTO YOUR OWN ORDER
     Pointer events, not HTML5 drag-and-drop, because this has to work with a
     finger on an iPad as well as a mouse. A short hold (or a deliberate
     drag) picks a tile up; a quick tap still just opens the game.
     ====================================================================== */
  function makeTilesDraggable(box, onOrder, onTap) {
    if (!box) return;
    let held = null, from = 0, startX = 0, startY = 0, moved = false, holdTimer = null;

    const tiles = () => Array.from(box.querySelectorAll('.tile'));
    const finish = (commit) => {
      clearTimeout(holdTimer);
      if (held) {
        held.classList.remove('dragging');
        held.style.transform = '';
        box.classList.remove('rearranging');
        if (commit) onOrder(tiles().map(t => t.dataset.mode));
      }
      held = null; moved = false;
    };

    box.addEventListener('pointerdown', e => {
      const t = e.target.closest('.tile');
      if (!t || e.button > 0) return;
      startX = e.clientX; startY = e.clientY; moved = false;
      from = tiles().indexOf(t);
      holdTimer = setTimeout(() => {          // held long enough — pick it up
        held = t;
        t.classList.add('dragging');
        box.classList.add('rearranging');
        try { t.setPointerCapture(e.pointerId); } catch (err) {}
        window.U.beep('tick');
      }, 220);
    });

    box.addEventListener('pointermove', e => {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!held) {
        // a real scroll or a decisive sideways drag cancels the hold
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(holdTimer);
        return;
      }
      e.preventDefault();
      moved = true;
      held.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;

      // whichever tile the finger is over swaps places with the held one
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const target = over && over.closest ? over.closest('.tile') : null;
      if (target && target !== held && box.contains(target)) {
        const list = tiles();
        const ai = list.indexOf(held), bi = list.indexOf(target);
        if (ai > -1 && bi > -1) {
          box.insertBefore(held, ai < bi ? target.nextSibling : target);
          startX = e.clientX; startY = e.clientY;
          held.style.transform = 'scale(1.04)';
        }
      }
    });

    const up = e => {
      const wasHeld = held, didMove = moved;
      const t = e.target && e.target.closest ? e.target.closest('.tile') : null;
      finish(wasHeld && didMove);
      if (!wasHeld && t && Math.abs(e.clientX - startX) < 10 && Math.abs(e.clientY - startY) < 10) {
        onTap(t.dataset.mode);        // an ordinary tap: play the game
      }
    };
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', () => finish(false));
  }

  function howItWorksCard() {
    return `<div class="card" style="max-width:600px;margin:16px auto">
      <h3>How AraBuzz works</h3>
      <ol class="muted" style="padding-left:20px;line-height:1.9;margin:0">
        <li>A grown-up uploads the weekly Spell Buzz sheet.</li>
        <li>You practise the words as games — as often as you like.</li>
        <li>Ara grows, you collect stars, and your garden fills up.</li>
      </ol></div>`;
  }

  /* ====================================================================== */
  /*  PLAY — choose what to practise                                        */
  /* ====================================================================== */
  let playPick = { weekIds: [], mode: 'spellbuzz', count: 10, puzzle: 'crossword', timed: false, bigTest: false };

  function paintPlay(opts) {
    const db = Store.db, s = $('#scr-play');
    const o = opts || {};
    playPick.mode = o.mode || playPick.mode || 'spellbuzz';
    if (o.weekIds) playPick.weekIds = o.weekIds.slice();
    const myWeeks = Store.weeksFor();
    if (!playPick.weekIds.length && myWeeks.length) playPick.weekIds = [myWeeks[0].id];

    const isPuzzle = ['crossword', 'wordsearch', 'rush', 'puzzles', 'quest'].includes(playPick.mode);
    const titles = {
      quest: 'Spell Quest', spellbuzz: 'Spell Buzz', listen: 'Listen & Spell', meanings: 'Word Meanings',
      mixed: 'Mixed Buzz', buzzer: 'Speed Round', crossword: 'Crossword',
      wordsearch: 'Word Search', championship: 'The Big Test', rush: 'Word Rush',
      puzzles: 'Puzzles'
    };

    s.innerHTML = `
      <button class="btn-quiet" id="back">← Back</button>
      <h1>${titles[playPick.mode] || 'Practise'}</h1>

      <div class="card" style="margin-bottom:16px">
        <h3>Which words?</h3>
        <p class="small muted">Tick as many weeks as you want.</p>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr));margin-top:12px" id="weekPick"></div>
        <div class="row wrap" style="margin-top:14px;gap:8px">
          <button class="btn-ghost btn-s" id="pickAll">All weeks</button>
          <button class="btn-ghost btn-s" id="pickLatest">Just this week</button>
          <button class="btn-ghost btn-s" id="pickTricky">${Icon.icon('target',{size:16})} My tricky words</button>
        </div>
      </div>

      ${playPick.mode === 'puzzles' ? `
      <div class="card" style="margin-bottom:16px">
        <h3>Which puzzle?</h3>
        <div class="grid grid-2" style="margin-top:12px">
          <div class="tile" data-puz="crossword" style="${playPick.puzzle !== 'wordsearch' ? 'border-color:var(--honey);background:var(--honey-soft)' : ''}">
            <span class="tile-ic">${Icon.icon('puzzle',{size:28,stroke:1.5})}</span><h3>Crossword</h3><p>Read the clues, fill in the boxes.</p></div>
          <div class="tile" data-puz="wordsearch" style="${playPick.puzzle === 'wordsearch' ? 'border-color:var(--honey);background:var(--honey-soft)' : ''}">
            <span class="tile-ic">${Icon.icon('search',{size:28,stroke:1.5})}</span><h3>Word Search</h3><p>Hunt the hidden words.</p></div>
        </div>
      </div>` : ''}

      ${isPuzzle ? '' : `
      <div class="card" style="margin-bottom:16px">
        <h3>How many questions?</h3>
        <div class="row wrap" style="gap:8px;margin-top:10px" id="counts">
          ${[5, 10, 15, 20].map(n => `<button class="btn-ghost ${playPick.count === n ? 'btn-primary' : ''}" data-n="${n}">${n}</button>`).join('')}
        </div>
        ${playPick.mode === 'meanings' ? `
        <label class="row" style="gap:10px;cursor:pointer;margin-top:14px">
          <input type="checkbox" id="optTimer" ${playPick.timed ? 'checked' : ''} style="width:auto">
          <span>${Icon.icon('bolt',{size:16})} Race the clock — 90 seconds, as many as you can</span></label>` : ''}
        ${playPick.mode === 'mixed' ? `
        <label class="row" style="gap:10px;cursor:pointer;margin-top:14px">
          <input type="checkbox" id="optTest" ${playPick.bigTest ? 'checked' : ''} style="width:auto">
          <span>${Icon.icon('trophy',{size:16})} Make it a proper test — no hints, no second tries, scorecard at the end</span></label>
        <p class="hint">Good for the night before the real Spell Buzz.</p>` : ''}
      </div>`}

      <div class="card center-text" id="startBox"></div>`;

    $('#back').onclick = () => go('home');

    const paintWeeks = () => {
      /* Six tiles is a choice; twenty is wallpaper. The six most recent
         sheets — plus anything already ticked — get tiles; everything older
         waits inside one quiet dropdown until it is asked for. */
      const RECENT = 6;
      const mine = Store.weeksFor();
      const shown = mine.filter((wk, i) => i < RECENT || playPick.weekIds.includes(wk.id));
      const older = mine.filter((wk, i) => i >= RECENT && !playPick.weekIds.includes(wk.id));
      $('#weekPick').innerHTML = (shown.map(wk => {
        const on = playPick.weekIds.includes(wk.id);
        const words = Store.weekWords(wk.id);
        const grown = words.filter(x => Game.plantFor(x.id).grown).length;
        return `<div class="tile" data-wk="${wk.id}" style="${on ? 'border-color:var(--honey);background:var(--honey-soft)' : ''}">
          <div class="row between"><b><span class="setno">${Store.weekTag(wk)}</span>${esc(wk.topic || wk.title)}</b>
            <span style="color:${on ? 'var(--jade)' : 'var(--ink-faint)'}">${Icon.icon(on ? 'check' : 'plus', { size: 17 })}</span></div>
          <p>${words.length} words · ${grown} grown${wk.assessedOn ? ' · ' + window.U.fmtDay(wk.assessedOn) : ''}</p>
        </div>`;
      }).join('') || '<p class="muted">No weeks added yet.</p>')
      + (older.length ? `
        <div class="tile" style="display:flex;align-items:center">
          <select id="olderWeeks" style="width:100%">
            <option value="">Older sheets (${older.length})…</option>
            ${older.map(wk => `<option value="${wk.id}">${Store.weekTag(wk)} · ${esc(wk.topic || wk.title)}${wk.assessedOn ? ' · ' + window.U.fmtDay(wk.assessedOn) : ''}</option>`).join('')}
          </select>
        </div>` : '');
      window.U.$$('#weekPick .tile[data-wk]').forEach(t => t.onclick = () => {
        const id = t.dataset.wk;
        const at = playPick.weekIds.indexOf(id);
        if (at >= 0) playPick.weekIds.splice(at, 1); else playPick.weekIds.push(id);
        paintWeeks(); paintStart();
      });
      const ow = $('#olderWeeks');
      if (ow) ow.onchange = () => {
        if (!ow.value) return;
        playPick.weekIds.push(ow.value);   // ticked — it now appears as a tile
        paintWeeks(); paintStart();
      };
    };

    const paintStart = () => {
      const pool = poolNow();
      const box = $('#startBox');
      if (!pool.length) {
        box.innerHTML = `<p class="muted">Pick at least one week to practise.</p>`;
        return;
      }
      const due = Engine.dueCount(pool);
      box.innerHTML = `
        <p class="muted" style="margin-bottom:12px">${pool.length} words ready${due ? ` · ${due} that Ara thinks you need most` : ''}</p>
        <button class="btn-go btn-xl btn-block" id="start">Start →</button>`;
      $('#start').onclick = launch;
    };

    function poolNow() {
      if (playPick.weekIds === 'tricky') return Engine.trickyWords(40);
      return Store.wordsFor(playPick.weekIds);
    }

    function launch() {
      const pool = poolNow();
      if (playPick.mode === 'puzzles') {
        if (playPick.puzzle === 'wordsearch') Quiz.startWordSearch(pool);
        else Quiz.startCrossword(pool);
        return;
      }
      if (playPick.mode === 'crossword') { Quiz.startCrossword(pool); return; }
      if (playPick.mode === 'wordsearch') { Quiz.startWordSearch(pool); return; }
      if (playPick.mode === 'rush') { Quiz.startRush(pool, { count: 6 }); return; }
      if (playPick.mode === 'quest') {
        Quiz.startQuest(pool, { weekIds: playPick.weekIds === 'tricky' ? [] : playPick.weekIds });
        return;
      }
      const preset = (playPick.mode === 'meanings' && playPick.timed) ? 'buzzer'
                   : (playPick.mode === 'mixed' && playPick.bigTest) ? 'championship'
                   : playPick.mode;
      Quiz.start({ preset, pool, count: playPick.count, weekIds: playPick.weekIds,
                   miniCrossword: playPick.mode === 'mixed' });
    }

    paintWeeks(); paintStart();
    $('#pickAll').onclick = () => { playPick.weekIds = Store.weeksFor().map(x => x.id); paintWeeks(); paintStart(); };
    $('#pickLatest').onclick = () => { const m = Store.weeksFor(); playPick.weekIds = m.length ? [m[0].id] : []; paintWeeks(); paintStart(); };
    $('#pickTricky').onclick = () => {
      const t = Engine.trickyWords(40);
      if (t.length < 3) { toast('Not enough tricky words yet — keep playing!'); return; }
      Quiz.start({ preset: playPick.mode === 'meanings' ? 'meanings' : 'mixed', pool: t, count: playPick.count, label: 'Tricky Words' });
    };
    if ($('#counts')) window.U.$$('#counts button').forEach(b => b.onclick = () => {
      playPick.count = +b.dataset.n; paintPlay({ mode: playPick.mode });
    });
    window.U.$$('[data-puz]').forEach(t => t.onclick = () => {
      playPick.puzzle = t.dataset.puz; paintPlay({ mode: playPick.mode });
    });
    if ($('#optTimer')) $('#optTimer').onchange = e => { playPick.timed = e.target.checked; };
    if ($('#optTest')) $('#optTest').onchange = e => { playPick.bigTest = e.target.checked; };
  }

  /* ====================================================================== */
  /*  LEARN — study cards before being tested                               */
  /* ====================================================================== */
  let learnState = { weekId: null, i: 0, flipped: false };

  function paintLearn(opts) {
    const db = Store.db, s = $('#scr-learn');
    if (opts && opts.weekId) { learnState.weekId = opts.weekId; learnState.i = 0; }
    if (!learnState.weekId && Store.weeksFor().length) learnState.weekId = Store.weeksFor()[0].id;

    const words = learnState.weekId ? Store.weekWords(learnState.weekId) : [];
    if (!words.length) {
      s.innerHTML = `<h1>Study</h1><div class="card center-text muted">No words yet. Ask a grown-up to add this week's sheet.</div>`;
      return;
    }
    if (learnState.i >= words.length) learnState.i = 0;
    const wd = words[learnState.i];
    const plant = Game.plantFor(wd.id);
    const meet = !!learnState.meet;
    const last = learnState.i === words.length - 1;

    /* Meeting a word leaves a fingerprint — firstSeen — without touching any
       score. That is what tells the home screen the introductions are done,
       on this device and (through sync) on every other. */
    if (meet) {
      const pr = Store.ensureProgress(wd.id);
      if (!pr.firstSeen) {
        pr.firstSeen = Date.now();
        if (window.Sync) Sync.noteProgress(wd.id);
      }
    }

    s.innerHTML = `
      <div class="row between wrap" style="align-items:flex-end">
        <div>
        <button class="btn-quiet btn-s" id="learnExit" style="margin-bottom:8px">← Home</button>
        <h1 style="margin-bottom:0">${meet ? 'Meet the words' : 'Study'}</h1>
        <p class="muted small">${meet
          ? 'This week\u2019s new words, saying hello. Look, listen, say each one out loud — nothing to get right or wrong.'
          : 'Look, listen, say it out loud. No marks here.'}</p></div>
        <select id="wkSel" style="width:auto;min-width:190px">
          ${Store.weeksFor().map(x => `<option value="${x.id}" ${x.id === learnState.weekId ? 'selected' : ''}>${Store.weekTag(x)} · ${esc(x.topic || x.title)}</option>`).join('')}
        </select>
      </div>

      <div class="qbar" style="margin-top:14px">${words.map((_, k) =>
        `<span class="${k < learnState.i ? 'done' : k === learnState.i ? 'now' : ''}"></span>`).join('')}</div>

      <div class="card glow" style="text-align:center;padding:30px 22px">
        <div class="row center" style="gap:8px;margin-bottom:10px">
          <span class="pill sage">${plant.svg({ size: 15 })} ${plant.grown ? 'Grown' : 'Growing'}</span>
          <span class="pill">${learnState.i + 1} / ${words.length}</span>
        </div>
        <div class="big-word" id="theWord">${esc(wd.word)}</div>
        ${wd.syllables ? `<p class="muted" style="margin:6px 0 0;letter-spacing:.06em">${esc(wd.syllables)}</p>` : ''}
        ${wd.pronunciation ? `<p class="faint small" style="margin:2px 0 0">say it like: ${esc(wd.pronunciation)}</p>` : ''}

        <div class="row center wrap" style="gap:8px;margin:16px 0">
          <button class="btn-ghost btn-s" id="hear">${Icon.icon('speaker',{size:16})} Hear it</button>
          <button class="btn-ghost btn-s" id="spellOut">${Icon.icon('spell',{size:16})} Spell it to me</button>
          ${window.U.speedBtn()}
        </div>

        <div class="card flat" style="background:var(--honey-soft);border:none;text-align:left">
          <p style="margin:0"><b>Means:</b> ${esc(wd.kidMeaning || wd.meaning)}
            ${window.U.sayMeaningBtn(wd.meaning || wd.kidMeaning, wd.kidMeaning)}</p>
          ${wd.trickyBit ? `<p style="margin:10px 0 0"><b>Watch out:</b> ${esc(wd.trickyBit)}</p>` : ''}
          ${wd.memoryTrick ? `<p style="margin:10px 0 0"><b>Trick to remember:</b> ${esc(wd.memoryTrick)}</p>` : ''}
          ${wd.sentences && wd.sentences[0] ? `<p style="margin:10px 0 0" class="muted"><i>${esc(wd.sentences[0].replace(/_{3,}/, wd.word))}</i></p>` : ''}
          ${wd.funFact ? `<p style="margin:10px 0 0" class="small ichip">${Icon.icon('sparkle',{size:15})}<span>${esc(wd.funFact)}</span></p>` : ''}
        </div>

        <div class="row center" style="margin-top:18px;gap:10px">
          <button class="btn-ghost" id="prev">‹ Previous word</button>
          <button class="btn-primary" id="next">${meet && last ? 'That\u2019s everyone! ✓' : 'Next word ›'}</button>
        </div>
      </div>

      <div class="card center-text" style="margin-top:14px">
        <p class="muted small" style="margin-bottom:10px">Feeling ready?</p>
        <button class="btn-go" id="testMe">Test me on these →</button>
      </div>`;

    $('#learnExit').onclick = () => { learnState.meet = false; go('home'); };
    $('#wkSel').onchange = e => { learnState.weekId = e.target.value; learnState.i = 0; paintLearn(); };
    $('#hear').onclick = () => window.U.speak(wd.word);
    $('#spellOut').onclick = () => window.U.spellOut(wd.word);
    $('#prev').onclick = () => { learnState.i = (learnState.i - 1 + words.length) % words.length; paintLearn(); };
    $('#next').onclick = () => {
      if (meet && last) {
        // every word met — a small celebration, then home, where the callout
        // will have been replaced by the practice card
        Store.save(true);
        learnState.meet = false;
        confetti(50);
        toast('You\u2019ve met all the new words. See you at practice!', 'good', 3000);
        go('home');
        return;
      }
      learnState.i = (learnState.i + 1) % words.length; paintLearn();
    };
    $('#testMe').onclick = () => Quiz.start({ preset: 'spellbuzz', pool: words, count: Math.min(10, words.length), weekIds: [learnState.weekId] });
    setTimeout(() => window.U.speak(wd.word), 250);
  }

  /* ====================================================================== */
  /*  GARDEN                                                                */
  /* ====================================================================== */
  function paintGarden() {
    const s = $('#scr-garden');
    const rows = Game.garden();
    const grown = rows.filter(r => r.plant.grown).length;
    if (!rows.length) {
      s.innerHTML = `<h1>Your garden</h1>
        <div class="card center-text muted">Nothing planted yet. Practise some words and
        they'll start coming up here.</div>`;
      return;
    }
    const pct = grown / rows.length;
    const stage = Garden.stageKeyFor(pct);
    const L = Garden.LIGHT[stage];
    const plants = rows.map(r => ({ id: r.word.id, label: r.word.word, box: r.plant.box }));
    const shown = plants.length > 27
      ? plants.slice().sort((x, y) => y.box - x.box).slice(0, 27) : plants;

    s.innerHTML = `
      <div class="row between wrap" style="align-items:flex-end;gap:10px">
        <div><h1 style="margin-bottom:2px">Your garden</h1>
          <p class="muted small" style="margin:0">Every word is a plant. The better you know it,
             the more it grows.</p></div>
        <span class="pill">${esc(L.name)}</span>
      </div>

      <div class="plot" id="plot">${Garden.scene({
        plants: shown, pct, stage, seed: 5150, interactive: true,
        aria: `${grown} of ${rows.length} words grown.`
      })}</div>
      <p class="hint" style="margin:-4px 0 16px">${shown.length < plants.length
        ? `Showing your ${shown.length} furthest-along plants out of ${plants.length}. `
        : ''}Tap any plant to see its word.</p>

      <div class="card flat" style="margin:0 0 16px">
        <div class="row between small" style="margin-bottom:7px">
          <b>${grown} of ${rows.length} fully grown</b>
          <span class="muted">${Math.round(pct * 100)}%</span>
        </div>
        <div class="bar sage"><i style="width:${Math.round(pct * 100)}%"></i></div>
      </div>

      <h3>Every word</h3>
      <div class="garden" id="gard">
        ${rows.map(r => `
          <div class="plant ${r.plant.grown ? 'mastered' : ''} ${(r.prog.wrong || 0) >= 2 && !r.plant.grown ? 'tricky' : ''}" data-id="${r.word.id}">
            <span class="stage">${Garden.sprig({ id: r.word.id, box: r.plant.box, size: 42, stage })}</span>
            <div class="nm">${esc(r.word.word)}</div>
            <div class="lvl"><i style="width:${Math.round(r.plant.pct * 100)}%"></i></div>
          </div>`).join('')}
      </div>

      <div class="card" style="margin-top:18px">
        <h3>What the plants mean</h3>
        <div class="legend">
          ${Garden.STAGE_NAME.map((x, i) => `<span class="leg">
            <i>${Garden.sprig({ species: 'tomato', box: i, size: 46, stage })}</i>
            <b>${esc(x)}</b></span>`).join('')}
        </div>
      </div>`;

    window.U.$$('#gard .plant').forEach(p => p.onclick = () => showWordCard(p.dataset.id));
    window.U.$$('#plot .gplant').forEach(g => {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => showWordCard(g.dataset.id));
    });
  }

  function showWordCard(id) {
    const wd = Store.db.words[id]; if (!wd) return;
    const pr = Store.db.progress[id] || {};
    const plant = Game.plantFor(id);
    const att = Store.attemptsFor(id);
    const misses = att.filter(a => !a.ok && a.given).slice(-5);
    const m = modal(`
      <div class="center-text">
        <div class="row center">${Garden.sprig({ id, box: plant.box, size: 78 })}</div>
        <h2 style="margin:4px 0">${esc(wd.word)}</h2>
        ${wd.syllables ? `<p class="faint" style="margin:0">${esc(wd.syllables)}</p>` : ''}
      </div>
      <p style="margin-top:14px"><b>Means:</b> ${esc(wd.kidMeaning || wd.meaning)}</p>
      ${wd.trickyBit ? `<p><b>Tricky bit:</b> ${esc(wd.trickyBit)}</p>` : ''}
      ${wd.memoryTrick ? `<p><b>Remember:</b> ${esc(wd.memoryTrick)}</p>` : ''}
      <div class="row wrap" style="gap:8px;margin:14px 0">
        <span class="pill sage">${Icon.icon('check',{size:15})} ${pr.right || 0} right</span>
        <span class="pill coral">${Icon.icon('pencil',{size:15})} ${pr.wrong || 0} tries</span>
        <span class="pill">Grown ${Math.round(plant.pct * 100)}%</span>
      </div>
      ${misses.length ? `<p class="small muted">You've written it as:
        ${misses.map(x => `<span class="pill coral">${esc(x.given)}</span>`).join(' ')}</p>` : ''}
      <div class="row center wrap" style="margin-top:16px;gap:8px">
        <button class="btn-ghost" id="hearW">${Icon.icon('speaker',{size:17})} Hear it</button>
        <button class="btn-ghost" id="spellW">${Icon.icon('spell',{size:17})} Spell it</button>
        <button class="btn-primary" id="practiseW">Practise this word</button>
      </div>
      <p class="tiny faint center-text" style="margin:12px 0 0">Esc or tap outside to close</p>`);
    m.box.querySelector('#hearW').onclick = () => window.U.speak(wd.word);
    m.box.querySelector('#spellW').onclick = () => window.U.spellOut(wd.word);
    m.box.querySelector('#practiseW').onclick = () => {
      m.close('practise');
      const pool = Store.allWords();
      const near = Engine.shuffle(pool.filter(x => x.id !== id)).slice(0, 5);
      Quiz.start({ preset: 'mixed', pool: [wd].concat(near), count: 6, label: wd.word });
    };
  }

  /* ====================================================================== */
  /*  ME — Ara, level, badges, stats                                        */
  /* ====================================================================== */
  function paintMe() {
    const db = Store.db, s = $('#scr-me');
    const st = Game.stats();
    const lp = Game.levelProgress(db.game.points);
    const stage = Ara.stageFor(lp.level);
    const next = Ara.nextStage(lp.level);
    const items = Ara.itemsFor(lp.level);
    const nextItem = Ara.ITEMS.find(i => i.at > lp.level);

    s.innerHTML = `
      <div class="card glow center-text">
        <div class="ara-stage ara-bob">${Ara.svg({ level: lp.level, width: 210, mood: 'happy' })}</div>
        <h1 style="margin:8px 0 2px">Ara the ${esc(stage.name)}</h1>
        <p class="muted">${esc(stage.blurb)}</p>
        <div style="max-width:360px;margin:14px auto 0">
          <div class="row between small muted"><span>Level ${lp.level}</span><span>${lp.into}/${lp.need} to level ${lp.level + 1}</span></div>
          <div class="bar"><i style="width:${Math.round(lp.pct * 100)}%"></i></div>
        </div>
        ${next ? `<p class="small faint" style="margin-top:10px">At level ${next.at} she becomes <b>${esc(next.name)}</b> — ${esc(next.blurb)}</p>` : ''}
      </div>

      <div class="grid grid-3" style="margin-top:16px">
        ${[['star', st.points, 'Buzz Points'], ['flame', st.streak, 'Day streak'],
           ['medal', st.bestStreak, 'Best streak'], ['dice', st.sessions, 'Games played'],
           ['pencil', st.answered, 'Words answered'], ['target', window.U.pct(st.accuracy), 'Got right']]
          .map(([i, v, t]) => `<div class="card center-text pad-s">
            <div style="color:var(--gold)">${Icon.icon(i, { size: 24 })}</div>
            <div style="font-family:var(--font-head);font-size:1.55rem;font-weight:600;margin-top:4px">${v}</div>
            <div class="tiny faint">${t}</div></div>`).join('')}
      </div>

      <div class="card" style="margin-top:16px">
        <div class="row between wrap" style="gap:10px">
          <div class="grow" style="min-width:200px">
            <h3 style="margin:0">Your journey</h3>
            <p class="small muted" style="margin:6px 0 0">Everything you can grow and collect, in pictures.</p>
          </div>
          <button class="btn-ghost btn-s" id="meGarden">${Icon.icon('leaf',{size:16})} My garden</button>
          <button class="btn-primary btn-s" id="meJourney">Show me</button>
        </div>
      </div>

      <h2 style="margin-top:26px">Ara's things ${items.length ? `(${items.length})` : ''}</h2>
      <div class="card">
        ${items.length ? `<div class="row wrap" style="gap:8px">${items.map(i => `<span class="pill honey">${Icon.icon('sparkle',{size:14})} ${esc(i.name)}</span>`).join('')}</div>`
          : `<p class="muted" style="margin:0">Nothing yet — Ara earns things as you level up.</p>`}
        ${nextItem ? `<p class="small faint" style="margin:12px 0 0">Next: <b>${esc(nextItem.name)}</b> at level ${nextItem.at}.</p>` : ''}
      </div>

      <h2 style="margin-top:26px">Badges (${st.badges} of ${st.badgeTotal})</h2>
      <div class="badges">
        ${Game.BADGES.map(b => `
          <div class="badge ${Game.has(b.id) ? 'on' : ''}">
            <span class="ic">${b.ic}</span>
            <div class="nm">${esc(b.name)}</div>
            <div class="ds">${esc(b.ds)}</div>
          </div>`).join('')}
      </div>`;
    if ($('#meJourney')) $('#meJourney').onclick = () => go('journey');
    if ($('#meGarden')) $('#meGarden').onclick = () => go('garden');
  }

  /* ======================================================================
     MY SCORES — her own history, without a wall of numbers
     ====================================================================== */
  function paintScores() {
    const s = $('#scr-scores');
    const db = Store.db;
    const rows = db.sessions.slice(0, 60);
    const LBL = { spellbuzz: 'Spell Buzz', mixed: 'Mixed Buzz', listen: 'Listen & Spell',
      meanings: 'Word Meanings', buzzer: 'Speed round', rush: 'Word Rush',
      crossword: 'Crossword', wordsearch: 'Word Search', championship: 'The Big Test' };

    if (!rows.length) {
      s.innerHTML = `<button class="btn-quiet" id="sBack">← Back</button>
        <h1>My scores</h1>
        <div class="card center-text muted">You haven't finished a game yet. Play one and it'll show up here!</div>`;
      $('#sBack').onclick = () => go('home');
      return;
    }

    const best = rows.reduce((m, r) => (r.total && r.correct / r.total > (m.total ? m.correct / m.total : 0)) ? r : m, rows[0]);
    const totalStars = rows.reduce((n, r) => n + (r.stars || 0), 0);
    const last14 = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      const n = db.sessions.filter(x => new Date(x.ts).toISOString().slice(0, 10) === day).length;
      last14.push({ day, n });
    }
    const maxDay = Math.max(1, ...last14.map(d => d.n));

    s.innerHTML = `
      <button class="btn-quiet" id="sBack">← Back</button>
      <h1 style="margin-bottom:2px">My scores</h1>
      <p class="muted" style="margin-top:0">Everything you've played. Your best bits are at the top.</p>

      <div class="grid grid-3" style="margin-bottom:16px">
        ${[['dice', rows.length, 'games played'],
           ['star', totalStars, 'stars collected'],
           ['trophy', best.total ? Math.round(best.correct / best.total * 100) + '%' : '—', 'best score ever']]
          .map(([i, v, t]) => `<div class="card pad-s center-text">
            <div style="color:var(--gold)">${Icon.icon(i, { size: 24 })}</div>
            <div style="font-family:var(--font-head);font-size:1.65rem;font-weight:600;margin-top:4px">${v}</div>
            <div class="tiny faint">${t}</div></div>`).join('')}
      </div>

      <div class="card" style="margin-bottom:16px">
        <h3>Your last two weeks</h3>
        <div class="row" style="gap:5px;align-items:flex-end;height:66px;margin-top:10px">
          ${last14.map(d => `<div title="${d.n} game(s)" style="flex:1;border-radius:5px 5px 0 0;
            background:${d.n ? 'var(--honey)' : 'var(--paper-2)'};
            height:${d.n ? Math.max(16, d.n / maxDay * 100) : 8}%"></div>`).join('')}
        </div>
        <p class="tiny faint" style="margin:8px 0 0">${last14.filter(d => d.n).length} days out of 14 — keep the flame going!</p>
      </div>

      <div class="card">
        <h3>Every game</h3>
        <div style="margin-top:8px">
          ${rows.map(r => {
            const pct = r.total ? Math.round(r.correct / r.total * 100) : 0;
            return `<div class="score-row">
              <div class="score-when">
                <b>${esc(window.U.fmtDay(r.ts))}</b>
                <span class="tiny faint">${new Date(r.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
              <div class="grow">
                <div class="row between wrap" style="gap:6px">
                  <span>${esc(LBL[r.preset] || LBL[r.kind] || 'Practice')}</span>
                  <span class="tiny faint">${r.correct}/${r.total}</span>
                </div>
                <div class="bar thin ${pct >= 80 ? 'sage' : ''}" style="margin-top:5px"><i style="width:${pct}%"></i></div>
              </div>
              <div class="score-stars">${Icon.stars(r.stars || 0, 3, { size: 16 })}</div>
              <div class="score-pts">+${r.points || 0}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="center-text" style="margin:20px 0">
        <button class="btn-go btn-xl" id="sPlay">Play another →</button>
      </div>`;
    $('#sBack').onclick = () => go('home');
    $('#sPlay').onclick = () => go('home');
  }

  /* ======================================================================
     YOUR JOURNEY — mostly pictures. Shown once after the starting check,
     and reachable any time from Help, from Ara's page and from Home.
     ====================================================================== */
  function paintJourney(opts) {
    const first = opts && opts.first;
    const s = $('#scr-journey');
    const db = Store.db;
    const lv = Game.levelFor(db.game.points);
    const grown = Game.grownCount();
    const total = Store.allWords().length;

    const stageStrip = [1, 5, 12, 19, 30].map(l => {
      const st = Ara.stageFor(l);
      const have = lv >= l;
      return `<div class="jstep ${have ? 'have' : ''}">
        <div class="jart">${Ara.svg({ level: l, width: 88, plain: true })}</div>
        <div class="jname">${esc(st.name)}</div>
        <div class="jsub">${have ? 'unlocked' : 'Level ' + l}</div>
      </div>`;
    }).join('');

    const plantStripDefs = [
      ['Brand new', 'You have just met this word.'],
      ['Sprouting', 'You got it right once.'],
      ['Growing', 'It is starting to stick.'],
      ['Getting there', 'Nearly yours.'],
      ['Almost!', 'One more good go.'],
      ['Grown!', 'You know this word.'],
      ['Rock solid', 'You will not forget this one.']
    ];
    // light up as far as her best-known word has actually reached
    const bestBox = Object.keys(db.progress).reduce((m, id) => Math.max(m, db.progress[id].box || 0), 0);
    const plantStripHTML = plantStripDefs.map(([t, d], i) => `<div class="jstep ${i <= bestBox ? 'have' : ''}">
      <div class="jart">${Garden.sprig({ species: 'tomato', box: i, size: 44 })}</div>
      <div class="jname">${t}</div><div class="jsub">${d}</div></div>`).join('');

    const nextBadges = Game.BADGES.filter(b => !Game.has(b.id)).slice(0, 6);
    const gotBadges = Game.BADGES.filter(b => Game.has(b.id));

    s.innerHTML = `
      ${first ? '' : `<button class="btn-quiet" id="jBack">← Back</button>`}
      <div class="row wrap" style="gap:18px;align-items:center;margin-bottom:6px">
        <div class="ara-stage ara-bob" style="flex:none">${Ara.svg({ level: lv, width: 118, mood: 'happy' })}</div>
        <div class="grow">
          <h1 style="margin-bottom:4px">${first ? 'Here\'s what\'s ahead' : 'Your journey'}</h1>
          <p class="muted" style="margin:0">Three things grow when you practise: <b>me</b>, <b>your tree</b>,
             and your <b>badge shelf</b>. That's the whole game.</p>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>1 · I grow up</h2>
        <p class="muted small">Every point you earn levels me up. I go from a scruffy chick to a
           full blue-and-gold macaw — and I pick up a scarf, a cap, glasses, a medal and a crown on the way.</p>
        <div class="jstrip">${stageStrip}</div>
        <div class="bar" style="margin-top:14px"><i style="width:${Math.round(Game.levelProgress(db.game.points).pct * 100)}%"></i></div>
        <p class="tiny faint center-text" style="margin-top:6px">You are Level ${lv} — ${esc(Ara.stageFor(lv).name)}</p>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>2 · Your tree fills up</h2>
        <p class="muted small">Every word you practise is a plant in your garden. It grows a step each time
           you get it right <b>without any help</b> — and when they are all grown, so is your tree.</p>
        <div class="jtree">
          <div style="flex:none">${Garden.treeSVG({ pct: grown / Math.max(total, 12), width: 200 })}</div>
          <div class="grow">
            <div class="jstrip small-steps">${plantStripHTML}</div>
          </div>
        </div>
        <p class="tiny faint center-text" style="margin-top:10px">
          ${total ? `${grown} of ${total} words grown so far` : 'Your first words are on their way!'}</p>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>3 · Your badge shelf</h2>
        <p class="muted small">${gotBadges.length
          ? `You have <b>${gotBadges.length}</b> already. Here is what to go for next.`
          : `There are ${Game.BADGES.length} to collect. Here are the easiest ones to start with.`}</p>
        ${gotBadges.length ? `<div class="badges" style="margin-bottom:14px">
          ${gotBadges.slice(0, 6).map(b => `<div class="badge on">
            <span class="ic">${b.ic}</span><div class="nm">${esc(b.name)}</div></div>`).join('')}
        </div>` : ''}
        <div class="badges">
          ${nextBadges.map(b => `<div class="badge">
            <span class="ic">${b.ic}</span><div class="nm">${esc(b.name)}</div>
            <div class="ds">${esc(b.ds)}</div></div>`).join('')}
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>4 · Keep the flame alive</h2>
        <div class="row wrap center" style="gap:10px;margin-top:8px">
          ${[1, 3, 7, 14, 30].map(d => `<div class="jflame ${db.game.streakDays >= d ? 'have' : ''}">
            <div>${Icon.icon('flame', { size: 26 })}</div>
            <div class="tiny">${d} day${d > 1 ? 's' : ''}</div></div>`).join('')}
        </div>
        <p class="muted small center-text" style="margin-top:12px">Practise on any day and the flame grows.
           Miss one and I'll save you — <b>once</b>. A little every day beats an hour on Sunday.</p>
      </div>

      <div class="center-text" style="margin:22px 0">
        <button class="btn-primary btn-xl" id="jGo">${first ? 'Let\'s start! →' : 'Back to playing →'}</button>
        ${first ? '' : '<p class="tiny faint" style="margin-top:10px">You can always find this again under Help.</p>'}
      </div>`;

    if ($('#jBack')) $('#jBack').onclick = () => go('howto');
    $('#jGo').onclick = () => { go('home'); if (first) confetti(80); };
  }

  /* ====================================================================== */
  /*  HOW TO PLAY — written for a 9-year-old                                */
  /* ====================================================================== */
  function paintHowTo() {
    const s = $('#scr-howto');
    s.innerHTML = `
      <div class="row wrap" style="gap:18px;align-items:center">
        <div class="ara-stage" style="flex:none">${Ara.svg({ level: 8, width: 120, mood: 'happy' })}</div>
        <div class="grow"><h1 style="margin-bottom:4px">How AraBuzz works</h1>
        <p class="muted" style="margin:0">Everything you need to know. It's not complicated, I promise.</p></div>
      </div>

      <div class="tile" id="jLink" style="margin-top:18px;border-color:var(--honey);background:var(--honey-soft)">
        <div class="row between wrap" style="gap:12px">
          <div class="grow" style="min-width:220px">
            <span class="tile-ic">${Icon.icon('sparkle',{size:28,stroke:1.5})}</span>
            <h3 style="margin:0">Your journey</h3>
            <p>See how I grow, how your tree fills up and which badges to go for next — in pictures.</p>
          </div>
          <div style="flex:none;align-self:center">${Garden.treeSVG({ pct: Game.grownCount() / Math.max(Store.allWords().length, 12), width: 104 })}</div>
        </div>
      </div>

      <div class="card" style="margin-top:18px">
        <h2>The games</h2>
        <p class="muted">There are lots of ways to practise the same words. That's on purpose —
           your brain remembers something much better if it meets it in different ways.</p>
        <div class="grid grid-2" style="margin-top:14px">
          ${[
            ['pencil', 'Spell Buzz', 'I give you a clue. You type the word. This is the one that\'s most like your real test at school.'],
            ['keys', 'Word Rush', 'A typing game. First you copy the word, then it fades away, then you type it from memory. Three levels and the word is yours forever.'],
            ['ear', 'Listen &amp; Spell', 'I say the word out loud. You spell it. Great for words you keep forgetting.'],
            ['speech', 'What Does It Mean?', 'I show you a word. You pick what it means from four choices.'],
            ['spell', 'Missing Letters', 'Some letters vanish. You put them back. I hide the ones you usually get wrong — sorry!'],
            ['swap', 'Jumbled Up', 'All the letters are muddled. Drag them into the right order.'],
            ['search', 'Spot the Spelling', 'Four spellings, only one is right. Trust your eyes.'],
            ['puzzle', 'Crossword', 'Read the clues, fill the boxes. Just like at school.'],
            ['bolt', 'Speed Round', 'Quick! How many can you get before time runs out?'],
            ['trophy', 'The Big Test', 'A proper practice test. Try this the night before the real one.']
          ].map(([i, t, d]) => `<div class="card flat pad-s">
            <b class="ichip">${Icon.icon(i, { size: 18 })}<span>${t}</span></b>
            <p class="small muted" style="margin:7px 0 0">${d}</p></div>`).join('')}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>⌨️ About Word Rush</h2>
        <p class="muted">This one is my favourite. A word floats in on a bubble and you type it —
           and every letter lights up green as you get it right, like a proper typing test.</p>
        <div class="grid grid-3" style="margin-top:12px">
          ${[['1️⃣', 'Copy it', 'The word is right there. Just type what you see.'],
             ['2️⃣', 'Quick peek', 'You get two seconds, then it vanishes. Type the rest from your head.'],
             ['3️⃣', 'From memory', 'No word at all. Just what it means, and my voice.']]
            .map(([i, t, d]) => `<div class="card flat pad-s" style="background:var(--paper-2);border:none">
              <b>${i} ${t}</b><p class="small muted" style="margin:6px 0 0">${d}</p></div>`).join('')}
        </div>
        <p class="muted" style="margin-top:14px">Clear all three and that word is yours — the bubble pops
           and it turns green in your list. Get one wrong and you just drop back one level, never to the start.
           <b>Nothing chases you and nothing runs out of time</b>, so you can take as long as you like.</p>
        <p class="muted">Writing a word out twenty times in a book doesn't work, because after the third
           line your hand is copying and your brain has wandered off. Taking the word <i>away</i> is what
           makes it stick.</p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Buzz Points</h2>
        <p class="muted">You get points for every word you get right.</p>
        <ul class="muted">
          <li><b>10 points</b> — right on your very first try</li>
          <li><b>6 points</b> — right on your second try</li>
          <li><b>Extra points</b> — for every answer in a row you get right</li>
        </ul>
        <p class="muted"><b>You never lose points.</b> Getting something wrong just means we practise it again — it never takes anything away from you.</p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Ara grows</h2>
        <p class="muted">Points make you level up, and levelling up makes me grow. I start as a
           scruffy little chick and end up a full blue-and-gold macaw. Along the way I get
           a scarf, a cap, glasses, a medal and — eventually — a crown.
           <b>You're the one growing me.</b> No practice, no feathers.</p>
        <div class="row wrap center" style="gap:14px;margin-top:10px">
          ${[1, 8, 19, 30].map(l => `<div class="center-text">
            ${Ara.svg({ level: l, width: 92, plain: true })}
            <div class="tiny faint">Level ${l}</div></div>`).join('')}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>The streak</h2>
        <p class="muted">Practise on any day and your streak goes up by one. Miss a day and it
           starts again — but I'll save you <b>once</b> with a streak freeze, because
           everybody has a busy day sometimes. You earn another freeze every 7 days.</p>
        <p class="muted"><b>Practising every day beats one big session a week.</b> That's not me being
           bossy, that's just how remembering works.</p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Your Word Garden</h2>
        <p class="muted">Every word you practise becomes a plant. It grows a bit each time you
           get it right — and only when you get it right <i>without</i> help.</p>
        <div class="row wrap" style="gap:10px;margin-top:8px">
          ${['Brand new', 'Sprouting', 'Growing', 'Getting there', 'Nearly', 'Grown', 'Rock solid']
            .map((t, i) => `<span class="pill">${Icon.plant(i, { size: 16 })} ${t}</span>`).join('')}
        </div>
        <p class="muted" style="margin-top:12px">If you get a word wrong, its plant shrinks a little — but it never dies.
           I'll bring that word back sooner so we can fix it together.</p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Why the same words keep coming back</h2>
        <p class="muted">I'm sneaky. I keep a list of which words you find hard, and I bring
           those back more often than the easy ones. I also hide <i>the letters you
           usually get wrong</i> in Missing Letters.</p>
        <p class="muted">And I never give you exactly the same quiz twice — different words,
           different clues, different order, every single time. So there's no point
           learning the quiz. You have to actually learn the words. Sorry!</p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>One last thing</h2>
        <p class="muted">Getting a word wrong isn't failing. It's how I find out what to teach you.
           The words you get wrong are the most useful words in the whole app.
           So have a go, even when you're not sure — <b>a guess tells me more than a blank.</b></p>
      </div>

      <div class="center-text" style="margin:22px 0">
        <button class="btn-primary btn-xl" id="letsGo">Got it — let's play →</button>
      </div>`;
    $('#letsGo').onclick = () => go('home');
    if ($('#jLink')) $('#jLink').onclick = () => go('journey');
  }

  /* ====================================================================== */
  /*  PARENT GATE                                                           */
  /* ====================================================================== */
  async function openParentGate() {
    /* Signed-in families set their PIN during onboarding and it lives in the
       database, checked by Postgres — that is the one that counts. The local
       settings PIN is only for the original offline, single-device mode.
       (Before this check existed, a new parent's grown-ups area was not
       actually locked on the child's device. It is now.) */
    if (window.Cloud && Cloud.available() && Cloud.signedIn() && Cloud.pinIsSet()) {
      const m = modal(`
        <h2>Grown-ups only</h2>
        <p class="muted">Enter your PIN.</p>
        <input type="password" id="pin" data-autofocus inputmode="numeric" maxlength="6" placeholder="••••••"
               style="text-align:center;font-size:1.6rem;letter-spacing:.4em">
        <div class="row center" style="margin-top:14px">
          <button class="btn-primary btn-block" data-primary id="ok">Unlock</button></div>
        <p class="tiny faint center-text" style="margin:12px 0 0">Esc or tap outside to go back</p>`);
      const inp = m.box.querySelector('#pin');
      const tryPin = async () => {
        const btn = m.box.querySelector('#ok');
        btn.disabled = true; btn.textContent = 'Checking…';
        let ok = false;
        try { ok = await Cloud.checkPin(inp.value.trim()); } catch (e) {}
        if (ok) { m.close('ok'); go('parent'); return; }
        btn.disabled = false; btn.textContent = 'Unlock';
        inp.value = ''; inp.classList.add('shake');
        setTimeout(() => inp.classList.remove('shake'), 500);
        toast('Not quite', 'bad');
      };
      m.box.querySelector('#ok').onclick = tryPin;
      inp.onkeydown = e => { if (e.key === 'Enter') tryPin(); };
      return;
    }

    const pin = Store.db.settings.pin;
    if (!pin) {
      const m = modal(`
        <h2>Grown-ups</h2>
        <p class="muted">Set a PIN — 4 to 6 digits — so this area stays yours. You'll need it to upload
           word lists and see the reports.</p>
        <div class="field"><label>Choose a PIN</label>
          <input type="password" id="p1" inputmode="numeric" placeholder="••••••" maxlength="6"></div>
        <div class="field"><label>Type it again</label>
          <input type="password" id="p2" inputmode="numeric" placeholder="••••••" maxlength="6"></div>
        <div class="row center"><button class="btn-primary btn-block" data-primary id="setPin">Set PIN</button></div>
        <p class="hint">Forgotten it later? It can be cleared from the backup file, so keep that safe.
           Esc or tap outside to cancel.</p>`);
      m.box.querySelector('#setPin').onclick = () => {
        const a = m.box.querySelector('#p1').value.trim();
        const b = m.box.querySelector('#p2').value.trim();
        if (!/^[0-9]{4,6}$/.test(a)) return toast('4 to 6 digits, numbers only');
        if (a !== b) return toast('The two PINs don\'t match');
        Store.db.settings.pin = a; Store.save(true);
        m.close(); go('parent');
      };
      return;
    }
    const m = modal(`
      <h2>Grown-ups only</h2>
      <p class="muted">Enter your PIN.</p>
      <input type="password" id="pin" data-autofocus inputmode="numeric" maxlength="6" placeholder="••••••"
             style="text-align:center;font-size:1.6rem;letter-spacing:.4em">
      <div class="row center" style="margin-top:14px">
        <button class="btn-primary btn-block" data-primary id="ok">Unlock</button></div>
      <p class="tiny faint center-text" style="margin:12px 0 0">Esc or tap outside to go back</p>`);
    const inp = m.box.querySelector('#pin');
    const tryPin = () => {
      if (inp.value.trim() === Store.db.settings.pin) { m.close('ok'); go('parent'); }
      else { inp.value = ''; inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 500); toast('Not quite', 'bad'); }
    };
    m.box.querySelector('#ok').onclick = tryPin;
  }

  /* ====================================================================== */
  /*  VAULT                                                                 */
  /* ====================================================================== */
  function syncVault(now) {
    if (window.Vault && Vault.supported) Vault.sync(Store.db, { now: !!now });
  }
  function checkpointVault() {
    if (window.Vault && Vault.supported) Vault.checkpoint(Store.db);
  }

  /* ======================================================================
     THE LANDING — a signed-in grown-up, on a device with no child on it.
     This screen exists because of a real bug: the admin finished setting his
     password and was dropped straight into Ara asking "What should I call
     you?" — the app assumed every device belongs to a child. It doesn't.
     A parent checking the weekly note on their own phone is the everyday
     case, and this is their front door.
     ====================================================================== */
  function paintLanding() {
    const s = $('#scr-landing');
    const me = (window.Cloud && Cloud.whoAmI()) || {};

    // The admin never lands here — the console is their whole app.
    if (me.isAdmin) { go('admin'); return; }

    const kids = Store.childList().filter(k => k.name);
    const accountKids = (me.children || []);

    /* The account has kids the device hasn't adopted yet — fetch them rather
       than showing an empty launcher or, worse, offering to create them again. */
    if (!kids.length && accountKids.length && window.Sync && !paintLanding._pulling) {
      paintLanding._pulling = true;
      showBootWait();
      Sync.pull({ deep: true })
        .catch(e => console.warn(e))
        .finally(() => {
          paintLanding._pulling = false;
          hideBootWait();
          if (current === 'landing') paintLanding();
        });
      return;
    }

    if (kids.length) {
      /* The launcher. Open the app, see your name, tap it, play — the same
         one-tap ritual as the TV. Grown-ups have their own door underneath. */
      s.innerHTML = `
        <div class="center-text" style="padding:22px 0 4px">
          <div class="ara-stage ara-bob">${Ara.svg({ level: 3, width: 116, mood: 'happy' })}</div>
          <h1 style="margin-bottom:4px">Who\u2019s playing today?</h1>
          <p class="muted">Tap your name to start.</p>
        </div>
        <div class="who-grid">
          ${kids.map(k => `
            <button class="who-card ${k.active ? 'on' : ''}" data-kid="${k.id}" style="--who:${k.colour}">
              <span class="who-ava">${k.emoji}</span>
              <span class="who-name">${esc(k.name)}</span>
              <span class="who-meta">Level ${Game.levelFor(k.points)} \u00b7 ${k.points} pts${k.streak ? ` \u00b7 ${k.streak} day streak` : ''}</span>
            </button>`).join('')}
          <button class="who-card add" id="ldAdd">
            <span class="who-ava">\uFF0B</span>
            <span class="who-name">Add someone</span>
            <span class="who-meta">A brother or sister</span>
          </button>
        </div>
        <div class="center-text" style="margin:30px auto 0;max-width:440px;border-top:1px solid var(--line);padding-top:20px">
          <button class="btn-quiet" id="ldParent">${Icon.icon('lock',{size:16})} Grown-ups \u2014 enter your PIN</button>
          <p class="tiny faint" style="margin-top:8px">Progress, notes and settings live behind the PIN.</p>
        </div>`;

      window.U.$$('#scr-landing [data-kid]').forEach(b => b.onclick = () => {
        const id = b.dataset.kid;
        if (id !== Store.db.activeChildId) { Store.switchChild(id); syncVault(true); }
        if (Store.db.profile) toast(`Hello, ${Store.db.profile.name}!`, 'good');
        go('home');
      });
      $('#ldParent').onclick = openParentGate;
      $('#ldAdd').onclick = addChildFlow;
      return;
    }

    // No kids yet — the family is brand new on every device.
    const who = (me.parent && me.parent.full_name) || 'there';
    s.innerHTML = `
      <div class="card glow" style="max-width:560px;margin:26px auto;text-align:center">
        <div class="ara-stage ara-bob">${Ara.svg({ level: 1, width: 140, mood: 'happy' })}</div>
        <h1>Hello, ${esc(who)}</h1>
        <p class="muted">You\u2019re signed in. No kid is set up yet.</p>
        <div class="col" style="gap:10px;margin-top:18px;align-items:stretch">
          <button class="btn-primary btn-xl" id="ldKid">Set up my kid on this device</button>
          <button class="btn-quiet" id="ldParent">${Icon.icon('lock',{size:16})} Open the grown-ups\u2019 area</button>
        </div>
        <p class="hint" style="margin-top:14px">The grown-ups\u2019 area asks for your PIN \u2014 the weekly notes live behind it.</p>
      </div>`;
    $('#ldParent').onclick = openParentGate;
    $('#ldKid').onclick = () => startFresh();
  }

  /* ====================================================================== */
  /*  BOOT                                                                  */
  /* ====================================================================== */
  let booted = false;

  /* A quiet holding screen for the one moment the app genuinely has nothing
     to show: a device that has just been signed in on and does not yet know
     whose it is. */
  function showBootWait() {
    let el = document.getElementById('bootWait');
    if (el) return;
    el = window.U.el('div', { id: 'bootWait', class: 'boot-wait' },
      `<img src="assets/cokindle-labs.png" alt="CoKindle Labs" style="height:52px;margin:0 auto 4px;display:block;opacity:.85">
       <div class="tiny faint center-text" style="margin-bottom:18px">AraBuzz — a CoKindle Labs initiative</div>
       <span class="loader" style="margin:0 auto"></span>
       <p class="muted center-text">Fetching your details…</p>`);
    document.body.classList.add('bootwait');   // hides the splash #madeBy underneath
    document.body.appendChild(el);
  }
  function hideBootWait() {
    document.body.classList.remove('bootwait');
    const el = document.getElementById('bootWait');
    if (el) el.remove();
  }

  /** Sync calls this when something arrived that changes what is on screen —
   *  a new word list, or the children on the account. Never interrupt her
   *  mid-question; a list she is not looking at can wait until she is. */
  const REPAINTABLE = ['home', 'play', 'learn', 'garden', 'me', 'scores', 'who'];
  function refreshAfterSync() {
    try {
      // Never redraw the screen she is answering a question on.
      if (current === 'quiz' || current === 'puzzle' || current === 'result') return;
      if (current === 'setup' && Store.db.profile && setupState.step === 0) { go('home'); return; }
      if (current === 'landing') { paintLanding(); return; }
      renderHud();
      if (window.Scene) Scene.update(true);
      if (REPAINTABLE.includes(current)) go(current);
    } catch (e) { console.warn('refresh after sync', e); }
  }

  /** Where does a signed-in person land? A child's device goes home; the
   *  admin's own machine goes to the console; a parent's phone goes to the
   *  landing, where the grown-ups' area is one tap away. NOBODY is dropped
   *  into "What should I call you?" unless they chose to set up a child. */
  function arrive() {
    const me = window.Cloud && Cloud.whoAmI();
    if (me && me.isAdmin) {
      // The admin is an admin, not a family — the console is the whole app.
      if (window.Onboard && Onboard.onAdminPath && Onboard.onAdminPath()) {
        history.replaceState({}, '', '/');
      }
      go('admin');
      return;
    }
    // A signed-in family always opens on the launcher: every kid a tile,
    // one tap to play, the grown-ups' door underneath.
    if (me && me.parent) { go('landing'); return; }
    if (Store.db.profile) { go('home'); return; }   // offline device: straight in
    go('setup');   // local-only: the original single-device flow
  }

  /** Called by Onboard once the grown-up has joined, agreed and set a PIN. */
  async function afterOnboard() {
    try {
      document.body.classList.remove('onboarding');
      if (window.Sync) await Sync.start();
      if (window.Scene) Scene.update(true);
      renderHud();
      arrive();
    } catch (e) { console.error('afterOnboard', e); }
  }

  async function boot() {
    if (booted) return; booted = true;

    /* ?update — throw away the offline copy and fetch the app again.
       This is the one thing to tell a parent whose app looks out of date. It
       touches NOTHING a child owns: her profile, words, progress, answers,
       points and PIN all live in localStorage, which this does not go near.
       Unlike ?reset, it is safe to give to anybody over the phone. */
    if (/[?&]update\b/.test(location.search)) {
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
      } catch (e) { console.warn('update', e); }
      location.replace(location.pathname);
      return;
    }

    // Open the app with ?reset on the end of the address to wipe it and start
    // completely fresh — no PIN needed. Handy while testing a new version.
    if (/[?&]reset\b/.test(location.search)) {
      const yes = confirm(
        'Erase EVERYTHING in AraBuzz on this device and start from scratch?\n\n' +
        'Profile, word lists, scores, history, reports, PIN and the links to your ' +
        'saved folders will all be cleared.\n\n' +
        'Files already written into your folders on disk are NOT deleted.');
      if (yes) {
        try { Store.wipe(); } catch (e) {}
        try { if (window.Vault && Vault.supported) await Vault.wipeHandles(); } catch (e) {}
        location.replace(location.pathname);
        return;
      }
      history.replaceState({}, '', location.pathname);
    }

    Store.load();

    /* A one-time setup link. On the published copy of AraBuzz there is no key
       built in — the key travels in the link you open once on each device, is
       saved to that device, and is wiped out of the address bar immediately so
       it is never left sitting in history or a bookmark:
           https://…/#k=sk-ant-…
       Nothing is sent anywhere; this only writes to this device's settings. */
    const kmatch = /[#&?]k=([A-Za-z0-9_\-]{20,})/.exec(location.hash + location.search);
    if (kmatch) {
      Store.db.settings.apiKey = kmatch[1];
      Store.save(true);
      history.replaceState({}, '', location.pathname);
      setTimeout(() => window.U && U.toast('This device is set up and ready.', 'good'), 700);
    }

    $('#brandLogo').innerHTML = LOGO_SVG;
    $('#brandBtn').onclick = () => go('home');   // home routes each role to the right place

    // Night is the default: the garden is lit, and everything around it steps
    // back so the picture is the brightest thing on the screen.
    if (Store.db.settings.theme !== 'light') document.documentElement.setAttribute('data-theme', 'dark');

    /* Signing in, joining, agreeing and setting a PIN all happen before the app
       itself appears. Onboard takes over the screen while any of that is
       outstanding and calls back here when the family is ready. */
    if (window.Cloud && Cloud.available()) {
      try {
        await Cloud.start();
        if (window.Onboard && Onboard.needed()) { await Onboard.route(); return; }

        /* Signed in and set up. Bring the account down onto this device and
           start pushing whatever this device has been holding.

           On a device that already knows her, none of that is waited for: the
           app opens instantly and the network catches up behind it. On a brand
           new device there is nothing to show until her details arrive, so we
           do wait — a moment here saves a "who are you?" screen that would ask
           her to invent herself a second time. */
        if (window.Sync) {
          if (Store.db.profile) Sync.start();
          else { showBootWait(); await Sync.start(); hideBootWait(); }
        }
        if (!Store.db.profile) { arrive(); return; }
      } catch (e) {
        console.warn('cloud unavailable, carrying on locally', e);
      }
    }


    if (window.Vault && Vault.supported) {
      try {
        const st = await Vault.restore();
        // A saved folder handle needs its permission re-granted by a click after
        // every reload — so nudge once, gently, rather than failing silently.
        if (st.hasPrimary) setTimeout(maybeNudgeFolder, 1200);
      } catch (e) { console.warn('vault restore', e); }
    }

    if (window.Scene) Scene.update(true);
    window.addEventListener('beforeunload', () => { Store.save(true); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { Store.save(true); syncVault(true); }
    });

    // wake up speech so the first "hear it" isn't silent on iOS
    document.addEventListener('touchstart', primeSpeech, { once: true });
    document.addEventListener('click', primeSpeech, { once: true });

    arrive();
  }

  let primed = false;
  function primeSpeech() {
    if (primed || !('speechSynthesis' in window)) return;
    primed = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0; speechSynthesis.speak(u);
      window.U.loadVoices();
    } catch (e) {}
  }

  let nudged = false;
  async function maybeNudgeFolder() {
    if (nudged) return; nudged = true;
    const bar = window.U.el('div', {
      class: 'card',
      style: 'position:fixed;left:50%;transform:translateX(-50%);bottom:90px;z-index:80;max-width:520px;width:calc(100% - 32px);padding:14px 18px'
    }, `<div class="row between wrap" style="gap:10px">
          <div class="small"><b>Reconnect your AraBuzz folder?</b><br>
          <span class="faint">Browsers ask again each time you open the app.</span></div>
          <div class="row"><button class="btn-quiet btn-s" id="nudgeNo">Later</button>
          <button class="btn-primary btn-s" id="nudgeYes">Reconnect</button></div>
        </div>`);
    document.body.appendChild(bar);
    bar.querySelector('#nudgeNo').onclick = () => bar.remove();
    bar.querySelector('#nudgeYes').onclick = async () => {
      const ok = await Vault.reconnect();
      bar.remove();
      toast(ok ? 'Folder reconnected — saving there again.' : 'Could not reconnect.', ok ? 'good' : 'bad');
      if (ok) syncVault(true);
    };
    setTimeout(() => bar.remove(), 20000);
  }

  w.UI = { go, boot, afterOnboard, refreshAfterSync, renderHud, renderNav, syncVault, checkpointVault, openParentGate,
           showWordCard, retakeBaseline, startFresh, addChildFlow, LOGO_SVG,
           get current() { return current; } };

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})(window);
