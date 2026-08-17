/* ==========================================================================
   AraBuzz — parent.js
   The grown-ups' area: uploads, word management, analytics, the Coach Report,
   folder storage and settings.
   ========================================================================== */
(function (w) {
  'use strict';

  const { $, el, esc, toast, modal, confirmBox, promptBox } = window.U;

  /** Modes where she typed or built the letters herself. */
  const TYPED_MODES = ['spell', 'listen', 'sentence', 'missing', 'jumble', 'crossword', 'rush'];

  let tab = null;   // decided on first paint
  let draft = null;   // a deck being reviewed before it is published

  /** Where the upload flow is being shown right now. Adding words lives in the
   *  admin console, but the code for it lives here — so every repaint during
   *  an upload has to know which screen it is painting into. */
  let host = 'parent';   // 'parent' | 'admin'

  /** Sheets come only from Prem now — a parent's grown-up area has no way to
   *  add words. That is deliberate: one person uploads for everybody, once,
   *  which is also what keeps the AI cost tiny. */
  function isAdmin() {
    const me = window.Cloud && Cloud.whoAmI();
    return !!(me && me.isAdmin);
  }

  /** Repaint whatever currently hosts the upload flow. Called after every
   *  step of reading, reviewing and publishing a sheet. */
  function repaintHere(opts) {
    if (host === 'admin' && window.Admin && window.UI && UI.current === 'admin') {
      const at = $('#atab');
      if (at) {
        at.innerHTML = '<div id="ptab"></div>';
        return draft ? paintDraft() : tabUpload();
      }
    }
    paint(opts);
  }

  function paint(opts) {
    host = 'parent';
    if (opts && opts.tab) tab = opts.tab;
    const admin = isAdmin();
    // Words are added in the admin console now; progress and reports need a
    // child, which the admin account deliberately does not have.
    if (!admin && (tab === 'upload' || tab === 'words')) tab = 'about';
    if (admin && (tab === 'progress' || tab === 'report')) tab = 'about';
    if (tab === 'storage' || tab === 'upload') tab = admin ? 'words' : 'settings';
    // First visit — or nothing set up yet — opens on the explainer.
    if (!tab) tab = admin ? 'words'
      : ((Store.db.weeks.length && Store.db.attempts.length) ? 'progress' : 'about');
    const kidName = Store.db.profile ? Store.db.profile.name : null;
    const scr = $('#scr-parent');
    scr.innerHTML = `
      <div class="row between wrap" style="gap:10px">
        <div>
          <h1 style="margin-bottom:2px">Grown-ups</h1>
          <p class="muted small" style="margin:0">${kidName
            ? esc(kidName) + `'s AraBuzz · synced safely to your family account`
            : (admin ? 'Admin account · the families live in the admin console'
                     : 'Synced safely to your family account')}</p>
        </div>
        <div class="row" style="gap:8px">
          <span id="syncPill"></span>
          ${admin
            ? `<button class="btn-quiet btn-s" id="goAdmin">${Icon.icon('keys', { size: 15 })} Admin console</button>`
            : ''}
          <button class="btn-ghost btn-s" id="exitParent">← Back to ${esc(kidName || 'the app')}</button>
        </div>
      </div>

      <div class="tabs" id="ptabs" style="margin-top:16px">
        ${(admin
          ? [['about', 'sparkle', 'Start here'], ['words', 'book', 'Word lists'],
             ['settings', 'gear', 'Settings']]
          : [['about', 'sparkle', 'Start here'],
             ['progress', 'chart', 'Progress'], ['report', 'doc', 'Coach Report'],
             ['settings', 'gear', 'Settings']])
          .map(([k, i, t]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">
             ${Icon.icon(i, { size: 16 })} ${t}</button>`).join('')}
      </div>
      <div id="ptab"></div>`;

    $('#exitParent').onclick = () => UI.go('home');
    const adminBtn = $('#goAdmin');
    if (adminBtn) adminBtn.onclick = () => UI.go('admin');
    window.U.$$('#ptabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; paint(); });
    paintSyncPill();

    ({ about: tabAbout, upload: tabUpload, words: tabWords, progress: tabProgress,
       report: tabReport, settings: tabSettings }[tab] || tabAbout)();
  }

  /* ------------------------------------------------------------ sync pill
     The honest answer to "is everything saved?", always visible up here.
     Green: everything is in the family account. Amber: answers are still on
     this device, waiting for the internet — closing the browser now would
     lose them. It re-checks itself while the screen is open. */
  let syncPillTimer = null;
  function paintSyncPill() {
    const el = $('#syncPill');
    if (!el) { clearInterval(syncPillTimer); syncPillTimer = null; return; }
    const st = (window.Sync && Sync.status) ? Sync.status() : null;
    if (!st || !st.live) { el.innerHTML = ''; }
    else if (st.pending > 0) {
      el.innerHTML = `<span class="pill honey" title="Still on this device — don't close the browser until this clears">
        ${window.U.plural(st.pending, 'change')} waiting to sync</span>`;
    } else {
      el.innerHTML = `<span class="pill sage" title="Everything is saved in your family account"> All synced</span>`;
    }
    if (!syncPillTimer) syncPillTimer = setInterval(() => {
      if (!$('#syncPill')) { clearInterval(syncPillTimer); syncPillTimer = null; return; }
      paintSyncPill();
    }, 8000);
  }

  /** The admin console calls this to show the upload flow inside its own
   *  "Add words" tab. The grown-ups screen keeps a stale #ptab in its DOM,
   *  which would shadow the admin's one — so it is emptied first. */
  function openUpload() {
    host = 'admin';
    const sp = $('#scr-parent'); if (sp) sp.innerHTML = '';
    const at = $('#atab');
    if (!at) return;
    at.innerHTML = '<div id="ptab"></div>';
    if (draft) paintDraft(); else tabUpload();
  }

  /* ======================================================================
     0. START HERE — what this is, in plain English, for a parent who has
     never seen it before.
     ====================================================================== */
  function tabAbout() {
    const box = $('#ptab');
    const db = Store.db;
    const name = db.profile ? db.profile.name : 'your kid';
    const words = Store.allWords().length;
    const admin = isAdmin();

    box.innerHTML = `
      <div class="card glow">
        <div class="row wrap" style="gap:20px;align-items:center">
          <div style="flex:none">${Ara.svg({ level: 12, width: 120, mood: 'happy' })}</div>
          <div class="grow" style="min-width:250px">
            <h2 style="margin-bottom:6px">What AraBuzz is</h2>
            <p class="muted" style="margin:0">It turns the weekly spelling sheet from school into
               games ${esc(name)} will actually choose to play — and it watches, quietly, exactly which
               letters trip them up. Then it tells you what to do about it in plain English.</p>
            <p class="muted" style="margin:10px 0 0"><b>Around twenty minutes a day is the sweet spot.</b>
               Not an hour on Sunday. That is not us being strict — it is simply how memory works.</p>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>Your week, in three steps</h3>
        <div class="grid grid-3" style="margin-top:14px">
          ${(admin
            ? [['', 'When the sheet arrives', 'You drop the PDF into the admin console — that is the whole job. Takes under a minute, and every family gets it at once.'],
               ['', 'All week', 'The kids play. Ten different games, and never the same quiz twice, so nobody can learn the quiz instead of the words.'],
               ['', 'Before the test', 'Each family reads their own Coach Report — it names the exact words to drill.']]
            : [['', 'When the sheet arrives', `The week's words appear here by themselves — there is nothing for you to upload or set up.`],
               ['', 'All week', `${esc(name)} plays. Ten different games, and never the same quiz twice, so they cannot learn the quiz instead of the words.`],
               ['', 'Before the test', 'You read the Coach Report. It names the exact words to drill and three things to do at the kitchen table.']])
            .map(([i, t, d]) => `<div class="card flat pad-s" style="background:var(--paper-2);border:none">
              <div style="font-size:2rem">${i}</div>
              <b>${t}</b><p class="small muted" style="margin:6px 0 0">${d}</p></div>`).join('')}
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>Why it works — the four things that actually matter</h3>
        <p class="muted small">There is a lot of noise in educational apps. These are the only four
           ideas AraBuzz is built on, and each one is doing real work.</p>
        <div class="grid grid-2" style="margin-top:14px">
          ${[
            ['', 'Words come back on purpose',
             'A word they get wrong keeps coming back — more often than the ones they already know — until it finally sticks. Words they have mastered stop taking up their time. This one mechanism does more than everything else combined.'],
            ['', 'They have to produce it, not recognise it',
             'Ticking the right spelling from four options is easy. Writing it from an empty box is what actually builds the memory. Most of the games make them produce the word.'],
            ['', 'No red pen, ever',
             'A wrong answer is never just "wrong". They see their spelling next to the correct one, letter by letter, with the missing letters in green — and they get another go while the word is still fresh.'],
            ['', 'It aims at their mistakes, not generic ones',
             'AraBuzz remembers the exact letters your kid drops in each word, and hides those letters when it tests them. Their own past misspellings become the wrong options they have to reject.']
          ].map(([i, t, d]) => `<div class="card flat pad-s" style="background:var(--paper-2);border:none">
            <b>${i} ${t}</b><p class="small muted" style="margin:6px 0 0">${d}</p></div>`).join('')}
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>What ${esc(name)} gets out of it</h3>
        <div class="row wrap" style="gap:20px;align-items:center;margin-top:8px">
          <div style="flex:none">${Garden.treeSVG({ pct: Game.grownCount() / Math.max(words, 12), width: 128 })}</div>
          <div class="grow" style="min-width:240px">
            <ul class="muted" style="margin:0;padding-left:20px;line-height:1.8">
              <li>A macaw called Ara who <b>grows because they practised</b> — eight stages, from scruffy chick to full blue-and-gold.</li>
              <li>A <b>tree</b> that fills out as words go in for good.</li>
              <li>Points, a daily streak, ${Game.BADGES.length} badges, and their own garden of words.</li>
              <li><b>Points are never taken away.</b> Getting something wrong costs nothing — it just means the word comes back sooner.</li>
            </ul>
          </div>
        </div>
        <p class="hint">There is a picture guide to all of this on their side of the app, under Help.</p>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>What you get out of it</h3>
        <ul class="muted" style="padding-left:20px;line-height:1.8">
          <li><b>A straight answer to "how are they doing?"</b> — not a score, but which kinds of mistakes they make and whether those are shrinking.</li>
          <li><b>The single most useful number</b>: what share of their misspellings would sound correct if you read them aloud. For a child taught by phonics first, that number says the ear is fine and it is the visual memory that needs building — and you can watch it fall over the term.</li>
          <li><b>Three specific things to do this week</b>, five minutes each, naming the actual words.</li>
          <li><b>Something to say to your kid</b>, word for word, that praises real effort rather than being vague.</li>
          <li>Every note is kept and dated, so you can see the shape of a whole term.</li>
        </ul>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>Common questions</h3>
        ${[
          ['Do they need the internet?',
           'Not all the time. The device needs to connect once to download the latest words and questions — after that, everything runs on the device itself: quizzes, crosswords, word searches, the typing game, all of it, on a plane or in the car with the wifi off. Anything played offline is saved on the device and syncs to your family account the next time it connects. One honest caution: until that sync happens, the new answers exist only on that device — if the browser data is cleared before it reconnects, they are lost. The sync tracker at the top of this screen tells you whether anything is still waiting.'],
          ['Where does the data go?',
           'It stays on the device and in your own private family account — which is what lets progress follow your kid onto any device they sign in on. It is never sold, never shared, and never used to train anything. You can download a copy or delete everything, any time, from Settings.'],
          ['Will they just memorise the quiz?',
           'They cannot. Every quiz re-picks the words, changes the question type, rotates the wording and moves the gaps. Three quizzes in a row from the same word list share almost no questions.'],
          ['Is the AI marking my kid?',
           'No. The AI writes the practice material and writes your note. Every judgement about whether an answer is right, which word comes next and how hard to make it is made on the device by fixed rules you can see working under Progress.'],
          ['My kid is upset about spelling. Will this make it worse?',
           'It is built the other way round. No timers except in one optional game, no red, no lost points, no leaderboards, and a wrong answer always gets a second try and an explanation. The words they get wrong are described to them as the most useful words in the app — because they are.'],
          ['Can more than one of my kids use it?',
           'Yes, and you can do it yourself. On the kids\' side of the app, tap the name at the top and choose "Add someone" — the new kid picks their own name and does their own starting check. Every kid gets their own profile, their own questions and their own badges, all built from the same sheets everyone shares.']
        ].map(([q, a]) => `<details style="border-bottom:1px solid var(--line);padding:11px 0">
          <summary style="cursor:pointer;font-weight:600;font-family:var(--font-head)">${esc(q)}</summary>
          <p class="muted small" style="margin:8px 0 0">${esc(a)}</p></details>`).join('')}
      </div>

      <div class="card" style="margin-top:14px;text-align:center">
        <img src="assets/cokindle-labs.png" alt="CoKindle Labs" style="height:56px">
        <p class="small muted" style="margin:10px 0 0"><b>AraBuzz</b> · a CoKindle Labs initiative</p>
        <p class="tiny faint" style="margin:4px 0 0">A practice tool, not a clinical or diagnostic assessment.</p>
      </div>`;

    window.U.$$('[data-goto]').forEach(b => b.onclick = () => { tab = b.dataset.goto; paint(); });
  }

  /* ====================================================================== */
  /*  1. ADD WORDS                                                          */
  /* ====================================================================== */
  function tabUpload() {
    const box = $('#ptab');
    if (draft) return paintDraft();

    box.innerHTML = `
      <div class="card">
        <h2>Add this week's Spell Buzz sheet</h2>
        <p class="muted">Drop in the PDF the school sends. The layout changes from week to
           week — different headings, sometimes an intro paragraph, sometimes not — so
           AraBuzz reads it with AI rather than looking for a fixed format. You'll get to
           check and correct everything before it goes out to the kids.</p>

        <div id="drop" class="card flat" style="border:2px dashed var(--line);text-align:center;padding:34px 20px;margin-top:16px;cursor:pointer">
          <div style="color:var(--gold)">${Icon.icon('upload', { size: 34, stroke: 1.4 })}</div>
          <p style="margin:8px 0 4px"><b>Tap to choose files</b> or drag them here</p>
          <p class="small faint" style="margin:0">PDF, Word-exported PDF, or a photo of the sheet</p>
          <p class="small faint" style="margin:6px 0 0">You can pick several at once — catch up on a
             few weeks in one go, and choose whether they stay separate.</p>
          <input type="file" id="file" accept=".pdf,image/*,.txt" multiple style="display:none">
        </div>

        <div class="row center" style="margin-top:14px;gap:10px">
          <button class="btn-ghost btn-s" id="pasteBtn">Type or paste words instead</button>
          <button class="btn-ghost btn-s" id="topicBtn">Make a list from a topic</button>
        </div>
        <div id="upStatus"></div>
      </div>

      ${!API.hasKey() ? `<div class="card" style="margin-top:14px;border-color:var(--coral)">
        <h3>No API key yet</h3>
        <p class="muted small">Reading PDFs and building practice material needs an Anthropic API key.
           Add one under <b>Settings</b>. You can still type word lists in by hand without it.</p>
      </div>` : ''}

      <div class="card" style="margin-top:14px">
        <h3>What happens to a sheet you upload</h3>
        <ol class="muted small" style="padding-left:20px;line-height:1.8">
          <li>The words and meanings are read out of the document — <b>1 API call</b>.</li>
          <li>You check them and fix anything that came out wrong. No call.</li>
          <li>Each word gets a practice pack built: four clues, four sentences, six likely
              misspellings, a crossword clue, a memory hook — <b>1 API call for the whole week</b>.</li>
          <li>After that, every quiz, crossword and word search is generated on this device
              for free, however many times the kids play.</li>
        </ol>
      </div>`;

    const fi = $('#file'), drop = $('#drop');
    drop.onclick = () => fi.click();
    fi.onchange = () => { if (fi.files.length) handleFiles(Array.from(fi.files)); };
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.style.borderColor = 'var(--honey)'; drop.style.background = 'var(--honey-soft)';
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.style.borderColor = 'var(--line)'; drop.style.background = '';
    }));
    drop.addEventListener('drop', e => {
      if (e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files));
    });

    $('#pasteBtn').onclick = pasteWords;
    $('#topicBtn').onclick = topicList;
  }

  const status = html => { const b = $('#upStatus'); if (b) b.innerHTML = html; };
  const busy = msg => status(`<div class="loading-box"><span class="loader"></span><p class="muted small" style="margin:0">${esc(msg)}</p></div>`);

  /** Reads one document into a draft "doc". One API call each. */
  async function readOne(file) {
    let payload = null;
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      const text = await pdfText(file);
      if (text && text.replace(/\s/g, '').length > 220) payload = { text };
      else payload = { pdfBase64: await toBase64(file) };   // scanned or image-only
    } else if (/^image\//.test(file.type)) {
      payload = { imageBase64: await toBase64(file), imageType: file.type };
    } else {
      payload = { text: await file.text() };
    }
    const out = await API.readDeck(payload);
    if (!out.words || !out.words.length) throw new Error('No words found in ' + file.name);
    return {
      title: out.title || file.name.replace(/\.[^.]+$/, ''),
      topic: out.topic || '',
      sentOn: out.sentOn || '',
      assessedOn: out.assessedOn || '',
      notes: out.notes || '',
      words: out.words,
      file
    };
  }

  async function handleFiles(files) {
    if (!API.hasKey()) { toast('Add an API key in Settings first.', 'bad'); return; }
    const list = Array.from(files).slice(0, 12);
    const docs = [], failed = [];

    for (let i = 0; i < list.length; i++) {
      busy(list.length > 1
        ? `Reading ${i + 1} of ${list.length} — ${esc(list[i].name)}…`
        : 'Reading the document…');
      try { docs.push(await readOne(list[i])); }
      catch (e) { console.error(e); failed.push({ name: list[i].name, why: e.message || String(e) }); }
    }

    if (!docs.length) {
      status(`<div class="feedback bad"><b>That didn't work.</b>
        ${failed.map(f => `<p class="small" style="margin:6px 0 0">${esc(f.name)} — ${esc(f.why)}</p>`).join('')}
        <p class="small muted" style="margin:6px 0 0">You can always type the words in by hand instead.</p></div>`);
      return;
    }
    status(failed.length ? `<div class="feedback bad"><b>${failed.length} file(s) could not be read.</b>
      ${failed.map(f => `<p class="small" style="margin:4px 0 0">${esc(f.name)}</p>`).join('')}</div>` : '');

    if (docs.length === 1) { draft = { docs, mode: 'separate', tab: 0 }; repaintHere(); return; }
    askSeparateOrTogether(docs, failed);
  }

  /** More than one sheet — the parent decides how they should be treated. */
  function askSeparateOrTogether(docs, failed) {
    const total = docs.reduce((n, d) => n + d.words.length, 0);
    const m = modal(`
      <h2>${docs.length} sheets read</h2>
      <p class="muted">Found <b>${total} words</b> altogether. How should the kids get them?</p>
      <div class="grid" style="gap:12px;margin-top:16px">
        <div class="tile" data-choice="separate">
          <span class="emoji"></span>
          <h3>Keep them separate</h3>
          <p>${docs.length} separate weeks. The kids can practise one week at a time, or tick several
             together. Best for catching up on past sheets — the Coach Report can then show
             progress topic by topic.</p>
        </div>
        <div class="tile" data-choice="combined">
          <span class="emoji"></span>
          <h3>Put them together</h3>
          <p>One list of ${total} words. Good for revision before a big test, when the topic
             boundaries don't matter any more.</p>
        </div>
      </div>
      <div class="row wrap" style="gap:6px;margin-top:14px">
        ${docs.map(d => `<span class="pill tiny">${esc(d.topic || d.title)} · ${d.words.length}</span>`).join('')}
      </div>
      <p class="tiny faint center-text" style="margin:14px 0 0">Esc or tap outside to cancel</p>`);

    m.box.querySelectorAll('[data-choice]').forEach(t => t.onclick = () => {
      const mode = t.dataset.choice;
      if (mode === 'combined') {
        const seen = new Set(), words = [];
        docs.forEach(d => d.words.forEach(x => {
          const k = Store.wordKey(x.word);
          if (k && !seen.has(k)) { seen.add(k); words.push(x); }
        }));
        const dated = docs.map(d => d.assessedOn).filter(Boolean).sort();
        draft = {
          mode: 'combined', tab: 0,
          docs: [{
            title: docs.map(d => d.topic || d.title).join(' + ').slice(0, 70),
            topic: docs.map(d => d.topic).filter(Boolean).join(', '),
            sentOn: '', assessedOn: dated[dated.length - 1] || '',
            notes: `Merged from ${docs.length} sheets.`,
            words, file: docs[0].file, sourceFiles: docs.map(d => d.file)
          }]
        };
      } else {
        draft = { mode: 'separate', tab: 0, docs };
      }
      m.close('chosen');
      repaintHere();
    });
  }

  function toBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  async function pdfText(file) {
    if (!window.pdfjsLib) return '';
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      let out = '';
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        let lastY = null, line = '';
        tc.items.forEach(it => {
          const y = it.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 3) { out += line.trim() + '\n'; line = ''; }
          line += it.str + ' ';
          lastY = y;
        });
        out += line.trim() + '\n\n';
      }
      return out;
    } catch (e) { console.warn('pdf text', e); return ''; }
  }

  /* ---------------------------------------------------------- draft review */
  /** The set number this draft sheet will be given once it's published. */
  function nextTag(i) {
    const n = (Store.db.weekSeq || 0) + i + 1;
    return n < 10 ? '0' + n : String(n);
  }

  function paintDraft() {
    const box = $('#ptab');
    const multi = draft.docs.length > 1;
    const d = draft.docs[draft.tab] || draft.docs[0];
    const totalWords = draft.docs.reduce((n, x) => n + x.words.length, 0);

    box.innerHTML = `
      <div class="card">
        <div class="row between wrap" style="gap:10px">
          <h2 style="margin:0">Check before you publish</h2>
          <div class="row wrap" style="gap:6px">
            <span class="pill sky">${totalWords} words</span>
            ${multi ? `<span class="pill honey">${draft.docs.length} separate weeks</span>` : ''}
            ${draft.mode === 'combined' ? `<span class="pill plum">merged into one list</span>` : ''}
          </div>
        </div>
        <p class="muted small" style="margin-top:8px">Fix any typos here — the school's sheets sometimes
           come out with odd line breaks. Delete anything that isn't a real word.</p>

        ${multi ? `<div class="tabs" id="docTabs" style="margin-top:14px">
          ${draft.docs.map((x, i) => `<button data-doc="${i}" class="${i === draft.tab ? 'on' : ''}">
            <span class="setno">${nextTag(i)}</span>${esc(x.topic || x.title || ('Sheet ' + (i + 1)))}
            <span class="faint">(${x.words.length})</span></button>`).join('')}
        </div>` : ''}

        ${d.notes ? `<p class="small" style="background:var(--honey-soft);padding:10px 14px;border-radius:12px">${esc(d.notes)}</p>` : ''}

        <div class="grid grid-2" style="margin:16px 0">
          <div class="field"><label>Title</label><input id="dTitle" value="${esc(d.title)}"></div>
          <div class="field"><label>Topic</label><input id="dTopic" value="${esc(d.topic)}"></div>
          <div class="field"><label>Sent on</label><input type="date" id="dSent" value="${esc(d.sentOn)}"></div>
          <div class="field"><label>Test on</label><input type="date" id="dTest" value="${esc(d.assessedOn)}"></div>
        </div>

        <table class="data">
          <thead><tr><th style="width:32%">Word</th><th>Meaning</th><th style="width:44px"></th></tr></thead>
          <tbody id="dRows"></tbody>
        </table>
        <div class="row wrap" style="gap:8px;margin-top:12px">
          <button class="btn-ghost btn-s" id="addRow">+ Add a word</button>
          ${multi ? `<button class="btn-quiet btn-s" id="dropDoc">Remove this sheet</button>` : ''}
        </div>

        <div class="row between wrap" style="margin-top:22px;gap:10px">
          <button class="btn-quiet" id="cancelDraft">Cancel</button>
          <button class="btn-primary btn-xl" id="publish">Build practice material →</button>
        </div>
        <p class="hint">${multi
          ? `All ${draft.docs.length} sheets are built in a <b>single</b> API call, not one each.`
          : `This is the one API call that does the heavy lifting for the whole week.`}</p>
        <div id="pubStatus"></div>
      </div>`;

    const rows = () => {
      $('#dRows').innerHTML = d.words.map((x, i) => `
        <tr>
          <td><input data-w="${i}" value="${esc(x.word)}" style="font-weight:600"></td>
          <td><input data-m="${i}" value="${esc(x.meaning)}"></td>
          <td><button class="btn-quiet btn-s" data-del="${i}" title="Remove"></button></td>
        </tr>`).join('');
      window.U.$$('#dRows [data-w]').forEach(inp => inp.oninput = () => d.words[+inp.dataset.w].word = inp.value);
      window.U.$$('#dRows [data-m]').forEach(inp => inp.oninput = () => d.words[+inp.dataset.m].meaning = inp.value);
      window.U.$$('#dRows [data-del]').forEach(b => b.onclick = () => { d.words.splice(+b.dataset.del, 1); rows(); });
    };
    rows();

    const stash = () => {
      d.title = $('#dTitle').value; d.topic = $('#dTopic').value;
      d.sentOn = $('#dSent').value; d.assessedOn = $('#dTest').value;
    };

    window.U.$$('#docTabs button').forEach(b => b.onclick = () => {
      stash(); draft.tab = +b.dataset.doc; paintDraft();
    });
    $('#addRow').onclick = () => { d.words.push({ word: '', meaning: '' }); rows(); };
    if ($('#dropDoc')) $('#dropDoc').onclick = async () => {
      const yes = await confirmBox('Remove this sheet?', 'It will not be added. The others are unaffected.', 'Remove');
      if (!yes) return;
      draft.docs.splice(draft.tab, 1);
      draft.tab = 0;
      if (!draft.docs.length) { draft = null; repaintHere(); } else paintDraft();
    };
    $('#cancelDraft').onclick = async () => {
      const yes = await confirmBox('Discard these words?', 'Nothing will be saved.', 'Discard');
      if (yes) { draft = null; repaintHere(); }
    };
    $('#publish').onclick = () => { stash(); publishDraft(); };
  }

  async function publishDraft() {
    const docs = draft.docs
      .map(d => Object.assign({}, d, { words: d.words.filter(x => x.word.trim()) }))
      .filter(d => d.words.length);
    if (!docs.length) { toast('No words to publish.'); return; }

    const all = [];
    const seen = new Set();
    docs.forEach(d => d.words.forEach(x => {
      const k = Store.wordKey(x.word);
      if (k && !seen.has(k)) { seen.add(k); all.push(x); }
    }));

    const st = $('#pubStatus');
    const showProgress = (done, total, batch, batches) => {
      st.innerHTML = `<div class="loading-box"><span class="loader"></span>
        <p class="muted small" style="margin:0">
          Building clues, sentences, likely misspellings and memory hooks…<br>
          <b>${done} of ${total} words</b> ${batches > 1 ? `· batch ${batch} of ${batches}` : ''}<br>
          <span class="faint">This only happens once. Everything after this is generated on your own device.</span>
        </p>
        <div class="bar" style="max-width:300px;width:100%"><i style="width:${Math.round(done / total * 100)}%"></i></div>
      </div>`;
    };
    showProgress(0, all.length, 1, Math.ceil(all.length / 12));

    let packs = [];
    if (API.hasKey()) {
      try {
        packs = await API.enrich(all, docs.map(d => d.topic).filter(Boolean).join(', '), showProgress);
      } catch (e) {
        console.error(e);
        st.innerHTML = `<div class="feedback bad"><b>Couldn't build the practice material.</b>
          <p class="small" style="margin:6px 0 0">${esc(e.message || e)}</p>
          <p class="small muted">The words will still be saved — the kids can practise with the school's meanings,
          and you can retry the extras later from Word lists.</p></div>`;
      }
    }

    const findPack = wordText => packs.find(p => Store.wordKey(p.word) === Store.wordKey(wordText)) || {};

    let added = 0;
    for (const d of docs) {
      const merged = d.words.map(x => Object.assign({}, findPack(x.word), { word: x.word, meaning: x.meaning }));
      const wk = Store.addWeek({
        title: d.title, topic: d.topic, sentOn: d.sentOn, assessedOn: d.assessedOn
      }, merged);
      added += wk.wordIds.length;

      // keep the original documents next to the data
      const files = d.sourceFiles || (d.file ? [d.file] : []);
      if (window.Vault && Vault.supported) {
        for (const f of files) {
          try { await Vault.saveDeck(f, (d.topic || d.title).replace(/\s+/g, '_') + '_' + f.name); } catch (e) {}
        }
      }
    }

    Store.save(true);
    UI.checkpointVault();
    draft = null;
    if (host === 'admin' && window.Admin && window.UI && UI.current === 'admin') {
      // Straight to Sheets, where the new week sits ready to publish to the
      // database so every family's devices can pick it up.
      Admin.paint({ tab: 'sheets' });
    } else {
      tab = 'words';
      paint();
    }
    toast(docs.length > 1
      ? `${docs.length} weeks added — ${added} words ready to practise!`
      : `${added} words are ready to practise!`, 'good', 3400);
  }

  /* ------------------------------------------------------- manual entry   */
  function pasteWords() {
    const m = modal(`
      <h2>Type or paste the words</h2>
      <p class="muted small">One per line, as <b>word = meaning</b> (or separate them with a comma, a colon or a dash).</p>
      <textarea id="ta" rows="12" placeholder="Nervous System = The body's control system
Neuron = A special nerve cell that carries messages
Reflex = A quick automatic response"></textarea>
      <div class="grid grid-2" style="margin-top:12px">
        <div class="field"><label>Topic</label><input id="mTopic" placeholder="e.g. The Nervous System"></div>
        <div class="field"><label>Test on</label><input type="date" id="mTest"></div>
      </div>
      <div class="row center"><button class="btn-primary btn-block" data-primary id="ok">Continue →</button></div>
      <p class="tiny faint center-text" style="margin:12px 0 0">Esc or tap outside to cancel</p>`);
    m.box.querySelector('#ok').onclick = () => {
      const lines = m.box.querySelector('#ta').value.split('\n').map(x => x.trim()).filter(Boolean);
      const words = lines.map(l => {
        const mt = l.match(/^(.+?)\s*(?:=|:|\s[–—-]\s|\t)\s*(.+)$/);
        return mt ? { word: mt[1].trim(), meaning: mt[2].trim() } : { word: l, meaning: '' };
      }).filter(x => x.word);
      if (!words.length) return toast('Nothing to add.');
      const topic = m.box.querySelector('#mTopic').value.trim();
      draft = { mode: 'separate', tab: 0, docs: [{ title: topic || 'Spell Buzz', topic, sentOn: '',
        assessedOn: m.box.querySelector('#mTest').value, notes: '', words, file: null }] };
      m.close('ok'); repaintHere();
    };
  }

  function topicList() {
    if (!API.hasKey()) return toast('Add an API key in Settings first.', 'bad');
    const m = modal(`
      <h2>Make a list from a topic</h2>
      <p class="muted small">Useful between school sheets — holidays, a book the kids are reading, or a
         topic they find hard.</p>
      <div class="field"><label>Topic</label><input id="tTopic" placeholder="e.g. Volcanoes, Ancient Egypt, Space"></div>
      <div class="grid grid-2">
        <div class="field"><label>How hard?</label>
          <select id="tDiff"><option value="easy">Easy</option><option value="medium" selected>Just right</option><option value="hard">A stretch</option></select></div>
        <div class="field"><label>How many words?</label>
          <select id="tN"><option>8</option><option selected>12</option><option>16</option><option>20</option></select></div>
      </div>
      <div class="row center"><button class="btn-primary btn-block" data-primary id="ok">Generate →</button></div>
      <div id="tStat"></div>`);
    m.box.querySelector('#ok').onclick = async () => {
      const t = m.box.querySelector('#tTopic').value.trim();
      if (!t) return toast('Type a topic first.');
      const stat = m.box.querySelector('#tStat');
      stat.innerHTML = `<div class="loading-box"><span class="loader"></span><p class="small muted" style="margin:0">Thinking of good words…</p></div>`;
      try {
        const out = await API.topicList(t, m.box.querySelector('#tDiff').value, +m.box.querySelector('#tN').value);
        draft = { mode: 'separate', tab: 0, docs: [{ title: out.title || t, topic: out.topic || t,
          sentOn: '', assessedOn: '', notes: '', words: out.words || [], file: null }] };
        m.close('ok'); repaintHere();
      } catch (e) {
        stat.innerHTML = `<div class="feedback bad"><b>Didn't work.</b><p class="small">${esc(e.message || e)}</p></div>`;
      }
    };
  }

  /* ====================================================================== */
  /*  2. WORD LISTS                                                         */
  /* ====================================================================== */
  function tabWords() {
    const box = $('#ptab');
    const weeks = Store.db.weeks;
    if (!weeks.length) {
      box.innerHTML = `<div class="card center-text muted">No word lists yet. Add one under <b>Add words</b>.</div>`;
      return;
    }
    box.innerHTML = weeks.map(wk => {
      const words = Store.weekWords(wk.id);
      const acc = weekAccuracy(wk.id);
      return `
      <div class="card" style="margin-bottom:14px">
        <div class="row between wrap" style="gap:10px">
          <div>
            <div class="kicker">${esc(wk.topic || '')}</div>
            <h3 class="row" style="margin:2px 0;gap:9px">
              <span class="setno">${Store.weekTag(wk)}</span>${esc(wk.title)}</h3>
            <p class="small muted" style="margin:0">
              ${words.length} words${wk.assessedOn ? ' · test ' + esc(window.U.fmtDate(new Date(wk.assessedOn).getTime())) : ''}
              ${acc.n ? ` · ${Math.round(acc.pct * 100)}% right over ${acc.n} tries` : ' · not practised yet'}
            </p>
          </div>
          <div class="row">
            ${words.some(x => !x.clues || !x.clues.length) ? `<button class="btn-ghost btn-s" data-enrich="${wk.id}">Build material</button>` : ''}
            <button class="btn-ghost btn-s" data-del="${wk.id}">Delete</button>
          </div>
        </div>
        <table class="data" style="margin-top:12px">
          <thead><tr><th>Word</th><th>Meaning</th><th style="width:120px">How she's doing</th></tr></thead>
          <tbody>${words.map(wd => {
            const pr = Store.db.progress[wd.id] || {};
            const a = pr.seen ? pr.right / pr.seen : null;
            const plant = Game.plantFor(wd.id);
            return `<tr>
              <td><b>${esc(wd.word)}</b>${!wd.clues || !wd.clues.length ? ' <span class="pill tiny coral">no material</span>' : ''}</td>
              <td class="small muted">${esc(wd.kidMeaning || wd.meaning || '')}</td>
              <td class="small">${plant.svg({ size: 16 })} ${a === null ? '<span class="faint">—</span>'
                : `${Math.round(a * 100)}% <span class="faint">(${pr.seen})</span>`}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
    }).join('');

    window.U.$$('[data-del]').forEach(b => b.onclick = async () => {
      const wk = Store.db.weeks.find(x => x.id === b.dataset.del);
      const yes = await confirmBox('Delete this list?',
        `"${esc(wk.title)}" will be removed. The scores for those words stay in the history.`, 'Delete');
      if (yes) { Store.deleteWeek(b.dataset.del); UI.checkpointVault(); paint(); }
    });
    window.U.$$('[data-enrich]').forEach(b => b.onclick = () => enrichWeek(b.dataset.enrich, b));
  }

  async function enrichWeek(weekId, btn) {
    if (!API.hasKey()) return toast('Add an API key in Settings first.', 'bad');
    const wk = Store.db.weeks.find(x => x.id === weekId);
    const words = Store.weekWords(weekId).filter(x => !x.clues || !x.clues.length);
    if (!words.length) return;
    btn.innerHTML = '<span class="loader"></span>'; btn.disabled = true;
    try {
      const packs = await API.enrich(words.map(x => ({ word: x.word, meaning: x.meaning })), wk.topic);
      packs.forEach(p => {
        const wd = words.find(x => Store.wordKey(x.word) === Store.wordKey(p.word));
        if (!wd) return;
        Object.assign(wd, p, { word: wd.word, meaning: wd.meaning, id: wd.id });
      });
      Store.save(true); UI.checkpointVault();
      toast('Practice material ready.', 'good');
      paint();
    } catch (e) {
      toast('Failed: ' + (e.message || e), 'bad');
      btn.innerHTML = 'Build material'; btn.disabled = false;
    }
  }

  function weekAccuracy(weekId) {
    const rows = Store.db.attempts.filter(a => a.weekId === weekId);
    return { n: rows.length, pct: rows.length ? rows.filter(a => a.ok).length / rows.length : 0 };
  }

  /* ====================================================================== */
  /*  3. PROGRESS                                                           */
  /* ====================================================================== */
  function tabProgress() {
    const box = $('#ptab');
    const db = Store.db;
    const att = db.attempts;
    if (!att.length) {
      // No history yet — but the parent can still see exactly how AraBuzz is
      // going to teach, which is the question they actually have on day one.
      box.innerHTML = `<div class="card center-text muted">
          The numbers appear as soon as they have played a few rounds.
        </div>${adaptCard()}`;
      const rb0 = $('#rebuildPreview');
      if (rb0) rb0.onclick = () => { paint(); toast('Re-picked.'); };
      return;
    }

    const st = Game.stats();
    const last30 = Store.recentAttempts(30);
    // Only answers she actually SPELLED tell us anything about spelling — a
    // wrong multiple-choice meaning is not a misspelling.
    const typed30 = last30.filter(a => TYPED_MODES.includes(a.mode) && a.given);
    const summary = Phonics.summarise(typed30.map(a => ({ correct: a.correct, given: a.given, ok: a.ok, ts: a.ts })));
    const byMode = modeBreakdown(last30);
    const trend = weeklyTrend(att);
    const worst = worstWords(14);
    const daily = dailyActivity(28);

    box.innerHTML = `
      <div class="grid grid-3">
        ${[['Words answered', st.answered], ['Got right', window.U.pct(st.accuracy)],
           ['Words fully grown', `${st.grown} / ${st.words}`], ['Games played', st.sessions],
           ['Current streak', window.U.plural(st.streak, 'day')], ['Best streak', window.U.plural(st.bestStreak, 'day')]]
          .map(([t, v]) => `<div class="card pad-s center-text">
            <div style="font-family:var(--font-head);font-size:1.8rem;font-weight:800">${v}</div>
            <div class="tiny faint">${t}</div></div>`).join('')}
      </div>

      <div class="card" style="margin-top:16px">
        <h3>The headline</h3>
        ${summary.phonetic.count ? `
          <div class="row" style="gap:16px;align-items:center;flex-wrap:wrap">
            <div style="font-family:var(--font-head);font-size:3rem;font-weight:800;color:var(--honey-deep);line-height:1">
              ${Math.round(summary.phonetic.share * 100)}%</div>
            <div class="grow" style="min-width:220px">
              <p style="margin:0"><b>of their misspellings sound exactly right when read aloud.</b></p>
              <p class="small muted" style="margin:4px 0 0">Their ear is working. It's the visual memory of
                 the word that needs building — which is what a Montessori phonics start predicts.</p>
            </div>
          </div>
          <div class="row wrap" style="gap:6px;margin-top:12px">
            ${summary.phonetic.examples.slice(0, 6).map(e =>
              `<span class="pill coral tiny">"${esc(e.given)}" → ${esc(e.correct)}</span>`).join('')}
          </div>` : `<p class="muted small" style="margin:0">Not enough misspellings yet to spot a pattern.</p>`}
      </div>

      <div class="card" style="margin-top:16px">
        <h3>What kind of mistakes (last 30 days)</h3>
        ${summary.patterns.length ? summary.patterns.slice(0, 7).map(p => `
          <div style="margin-bottom:14px">
            <div class="row between small"><b>${esc(p.label)}</b><span class="faint">${p.count} of ${summary.totalWrong}</span></div>
            <div class="bar thin"><i style="width:${Math.round(p.share * 100)}%"></i></div>
            <p class="tiny faint" style="margin:5px 0 0">${p.examples.slice(0, 3).map(e => `wrote "${esc(e.given)}" for ${esc(e.correct)}`).join(' · ')}</p>
          </div>`).join('') : `<p class="muted small">No mistakes recorded in this period.</p>`}
      </div>

      <div class="grid grid-2" style="margin-top:16px">
        <div class="card">
          <h3>How they do in each game</h3>
          ${byMode.map(m => `
            <div style="margin-bottom:12px">
              <div class="row between small"><span>${esc(m.label)}</span><span class="faint">${Math.round(m.pct * 100)}% · ${m.n}</span></div>
              <div class="bar thin ${m.pct >= 0.75 ? 'sage' : ''}"><i style="width:${Math.round(m.pct * 100)}%"></i></div>
            </div>`).join('') || '<p class="muted small">—</p>'}
        </div>
        <div class="card">
          <h3>Week by week</h3>
          ${trend.length > 1 ? trend.map(t => `
            <div style="margin-bottom:12px">
              <div class="row between small"><span>${esc(t.label)}</span><span class="faint">${Math.round(t.pct * 100)}% · ${t.n} answers</span></div>
              <div class="bar thin sage"><i style="width:${Math.round(t.pct * 100)}%"></i></div>
            </div>`).join('') : '<p class="muted small">Needs a couple of weeks of practice to show a trend.</p>'}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3>Last 4 weeks</h3>
        <div class="row" style="gap:3px;align-items:flex-end;height:70px;margin-top:10px">
          ${daily.map(d => `<div title="${esc(d.day)}: ${d.n} answers" style="flex:1;background:${d.n ? 'var(--honey)' : 'var(--paper-2)'};height:${d.n ? Math.max(10, Math.min(100, d.n * 7)) : 6}%;border-radius:4px 4px 0 0"></div>`).join('')}
        </div>
        <p class="tiny faint" style="margin:8px 0 0">${daily.filter(d => d.n).length} active days out of 28</p>
      </div>

      <div class="card" style="margin-top:16px">
        <h3>Words that keep catching them out</h3>
        <table class="data">
          <thead><tr><th>Word</th><th style="width:80px">Right</th><th>They have written</th></tr></thead>
          <tbody>${worst.map(x => `
            <tr>
              <td><b>${esc(x.word.word)}</b><div class="tiny faint">${esc(x.word.trickyBit || '')}</div></td>
              <td class="small">${Math.round(x.acc * 100)}%<div class="tiny faint">${x.pr.seen} tries</div></td>
              <td class="small">${(x.pr.misspellings || []).slice(-4).map(m => `<span class="pill coral tiny">${esc(m)}</span>`).join(' ') || '<span class="faint">—</span>'}</td>
            </tr>`).join('') || '<tr><td colspan="3" class="muted small">Nothing troubling them — nice.</td></tr>'}
          </tbody>
        </table>
      </div>

      ${adaptCard()}

      ${db.profile.baseline ? baselineCard(db.profile.baseline) : ''}`;

    const rb = $('#rebuildPreview');
    if (rb) rb.onclick = () => { paint(); toast('Re-picked — notice it is a different set.'); };
  }

  /* --------------------------------------------------------------------------
     "Is her progress actually used?" — the honest, checkable answer.
     The API is a content factory that runs once per word. The teaching decisions
     are made fresh on this device for every single question, from her record.
     This panel shows the real next-quiz ranking, with the real reasons.
     -------------------------------------------------------------------------- */
  function adaptCard() {
    const pool = Store.allWords();
    if (!pool.length) return '';

    const now = Date.now();
    const ranked = pool.map(wd => {
      const pr = Store.db.progress[wd.id] || {};
      const acc = pr.seen ? pr.right / pr.seen : null;
      const why = [];
      let score = 0;
      if (!pr.seen) { score += 85; why.push('never seen'); }
      if (pr.seen && (!pr.due || pr.due <= now)) { score += 70; why.push('due for review'); }
      if (acc !== null && acc < 0.8) { score += (1 - acc) * 70; why.push(`only ${Math.round(acc * 100)}% right`); }
      score += (5 - Math.min(5, pr.box || 0)) * 9;
      if (pr.streak === 0 && pr.seen) { score += 22; why.push('missed last time'); }
      if (pr.lastSeen && now - pr.lastSeen < 6e5) { score -= 60; why.push('just practised'); }
      return { wd, pr, score, why, box: pr.box || 0 };
    }).sort((a, b) => b.score - a.score);

    const top = ranked.slice(0, 6);
    const rested = ranked.filter(r => r.box >= 5).slice(0, 4);

    const nextMode = r => {
      const box = r.box, seen = r.pr.seen || 0;
      if (seen === 0) return 'a gentle one — pick the word, or fill the gaps';
      if (box >= 3) return 'write it from memory';
      return 'jumbled letters or missing letters';
    };

    return `
      <div class="card" style="margin-top:16px">
        <h3>How the next quiz is being chosen <span class="pill tiny sky">live</span></h3>
        <p class="muted small">The AI writes each word's raw material <b>once</b> — four different clues,
           four sentences, six likely misspellings, a crossword clue. After that it is not involved.
           Every quiz is <b>assembled on this device, fresh, from their record</b>: which words come up,
           which kind of question each becomes, which wording is used, and which letters get hidden.
           That is why a retake is never the same, and why it gets harder as they improve.</p>

        <div class="grid grid-2" style="margin-top:14px">
          <div>
            <div class="kicker">Most likely next</div>
            <table class="data" style="margin-top:6px"><tbody>
              ${top.map(r => `<tr>
                <td><b>${esc(r.wd.word)}</b>
                  <div class="tiny faint">${esc(r.why.join(' · ') || 'keeping it in rotation')}</div></td>
                <td class="small" style="width:44%">${esc(nextMode(r))}</td>
              </tr>`).join('')}
            </tbody></table>
            <button class="btn-quiet btn-s" id="rebuildPreview" style="margin-top:6px">↻ Re-pick</button>
          </div>
          <div>
            <div class="kicker">Resting — they know these</div>
            ${rested.length
              ? `<div class="row wrap" style="gap:6px;margin-top:8px">
                   ${rested.map(r => `<span class="pill sage tiny">${esc(r.wd.word)}</span>`).join('')}</div>
                 <p class="tiny faint" style="margin-top:8px">These come back on a widening schedule —
                    2 days, then 4, then 8, then 16 — rather than every session.</p>`
              : `<p class="small muted" style="margin-top:8px">Nothing fully locked in yet. Words move here
                   once they have got them right several times in a row.</p>`}

            <div class="kicker" style="margin-top:16px">Aimed at their own mistakes</div>
            <p class="tiny faint" style="margin-top:6px">In Missing Letters, the letters AraBuzz hides are
               weighted towards the ones they personally drop on that exact word — not random gaps.
               In Spot the Spelling, their own past misspellings are used as the wrong options,
               but only once they half-know the word.</p>
            ${gapExample()}
          </div>
        </div>
      </div>`;
  }

  /** A worked example, using a real word she has actually got wrong. */
  function gapExample() {
    const cand = Store.allWords()
      .map(wd => ({ wd, pr: Store.db.progress[wd.id] || {} }))
      .filter(x => (x.pr.misspellings || []).length)
      .sort((a, b) => (b.pr.wrong || 0) - (a.pr.wrong || 0))[0];
    if (!cand) return '';
    const word = cand.wd.word;
    const weak = Phonics.weakPositions(word, cand.pr.misspellings);
    const clean = Phonics.clean(word);
    const map = [];
    for (let i = 0; i < word.length; i++) if (/[a-z]/i.test(word[i])) map.push(i);
    const hot = Object.keys(weak).sort((a, b) => weak[b] - weak[a]).slice(0, 2).map(i => map[+i]);
    return `<div class="card flat pad-s" style="background:var(--paper-2);border:none;margin-top:10px">
      <div class="tiny faint">For example — they have written <b>${esc(word)}</b> as
        ${(cand.pr.misspellings || []).slice(-2).map(m => `"${esc(m)}"`).join(', ')}, so AraBuzz now hides:</div>
      <div style="font-size:1.4rem;letter-spacing:.14em;margin-top:8px;font-weight:600">
        ${word.split('').map((ch, i) => hot.includes(i)
          ? `<span style="color:var(--coral-deep);background:var(--coral-soft);border-radius:4px;padding:0 3px">_</span>`
          : esc(ch)).join('')}
      </div></div>`;
  }

  function baselineCard(b) {
    return `<div class="card" style="margin-top:16px">
      <h3>Their starting point</h3>
      <p class="small muted">Taken ${esc(window.U.fmtDate(b.takenAt))} — ${b.correct} of ${b.total} correct,
         and ${Math.round(b.phoneticShare * 100)}% of the misses sounded right.</p>
      <div class="row wrap" style="gap:6px">
        ${b.rows.map(r => `<span class="pill ${r.ok ? 'sage' : 'coral'} tiny">${esc(r.word)}${r.ok ? '' : ' → "' + esc(r.given || 'blank') + '"'}</span>`).join('')}
      </div>
      <p class="tiny faint" style="margin-top:10px">Compare this with the table above to see how far she's moved.</p>
    </div>`;
  }

  function modeBreakdown(rows) {
    const L = { spell: ' Spell it', listen: ' Listen & spell', sentence: 'Fill the gap',
      meaning: ' Meanings', reverse: ' Which word', missing: ' Missing letters',
      jumble: ' Jumbled', spot: ' Spot the spelling', crossword: ' Crossword',
      wordsearch: ' Word search', rush: '⌨ Word Rush (from memory)' };
    const by = {};
    rows.forEach(a => { by[a.mode] = by[a.mode] || { n: 0, ok: 0 }; by[a.mode].n++; if (a.ok) by[a.mode].ok++; });
    return Object.keys(by).filter(k => by[k].n >= 3)
      .map(k => ({ mode: k, label: L[k] || k, n: by[k].n, pct: by[k].ok / by[k].n }))
      .sort((a, b) => a.pct - b.pct);
  }

  function weeklyTrend(att) {
    const by = {};
    att.forEach(a => {
      const d = new Date(a.ts);
      const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const k = monday.toISOString().slice(0, 10);
      by[k] = by[k] || { n: 0, ok: 0 };
      by[k].n++; if (a.ok) by[k].ok++;
    });
    return Object.keys(by).sort().slice(-8).map(k => ({
      label: 'w/c ' + window.U.fmtDay(new Date(k).getTime()),
      n: by[k].n, pct: by[k].ok / by[k].n
    }));
  }

  function dailyActivity(days) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      const n = Store.db.attempts.filter(a => new Date(a.ts).toISOString().slice(0, 10) === d).length;
      out.push({ day: d, n });
    }
    return out;
  }

  function worstWords(limit) {
    return Store.allWords()
      .map(wd => { const pr = Store.db.progress[wd.id] || {}; return { word: wd, pr, acc: pr.seen ? pr.right / pr.seen : 1 }; })
      .filter(x => x.pr.seen >= 2 && x.acc < 0.85)
      .sort((a, b) => a.acc - b.acc)
      .slice(0, limit);
  }

  /* ====================================================================== */
  /*  4. COACH REPORT                                                       */
  /* ====================================================================== */
  /** Notes written elsewhere — the weekly cron, or another device — live in
   *  the account. Fold them into the local archive so this tab shows one
   *  truthful list wherever the parent happens to open it. */
  async function mergeCloudReports() {
    if (!window.Cloud || !Cloud.signedIn() || !window.Sync) return false;
    const childId = Store.db.activeChildId;
    if (!Sync.isDbId(childId)) return false;
    try {
      const { data, error } = await Cloud.from('reports')
        .select('id, ts, payload, html, range_from, range_to')
        .eq('child_id', childId).order('ts', { ascending: false }).limit(40);
      if (error || !data) return false;
      let added = 0;
      data.forEach(row => {
        if ((Store.db.reports || []).some(r => r.cloudId === row.id)) return;
        const pay = row.payload || {};
        const res = pay.result || null;
        const html = row.html || (res ? renderCloudNote(res, pay, row) : null);
        if (!html) return;
        Store.db.reports.push({
          id: Store.uid('r'), cloudId: row.id,
          ts: Date.parse(row.ts) || Date.now(),
          html,
          range: pay.kind === 'onboarding' ? 'Starting point'
               : (row.range_from ? row.range_from + ' → ' + row.range_to : 'Weekly note'),
          kind: pay.kind || 'weekly',
          headline: res ? res.headline : '',
          metrics: pay.metrics || null
        });
        added++;
      });
      if (added) Store.save(true);
      return added > 0;
    } catch (e) { return false; }
  }

  /** A weekly note arriving as structured data, rendered here. */
  function renderCloudNote(r, pay, row) {
    const name = Store.db.profile ? Store.db.profile.name : '';
    const inner = `
      <div class="card report">
        <div class="kicker">AraBuzz · Weekly note · ${esc(window.U.fmtDate(Date.parse(row.ts)))}</div>
        <h1>${esc(name)}'s week</h1>
        <blockquote><b>${esc(r.headline || '')}</b></blockquote>
        ${String(r.whereTheyAre || '').split(/\n{2,}|\n/).filter(Boolean).map(t => `<p>${esc(t)}</p>`).join('')}
        <h2>Going well</h2>
        <ul>${(r.strengths || []).map(x => `<li><b>${esc(x.title)}</b> — ${esc(x.detail)}</li>`).join('')}</ul>
        ${(r.patterns || []).length ? `<h2>Patterns worth knowing</h2>
        <ul>${r.patterns.map(x => `<li><b>${esc(x.pattern)}</b> — ${esc(x.meaning)}${x.example ? ` <span class="muted small">(${esc(x.example)})</span>` : ''}</li>`).join('')}</ul>` : ''}
        <h2>This week, if you have ten minutes</h2>
        <ol>${(r.thisWeek || []).map(x => `<li><b>${esc(x.action)}</b> — ${esc(x.why)} <span class="pill tiny">${x.minutes} min</span></li>`).join('')}</ol>
        ${(r.wordsToDrill || []).length ? `<h2>Words to practise before the next test</h2>
        <p>${r.wordsToDrill.map(wd => `<span class="pill honey">${esc(wd)}</span>`).join(' ')}</p>` : ''}
        <h2>Since the last note</h2><p>${esc(r.sinceLastReport || '')}</p>
        <p>${esc(r.motivation || '')}</p>
        ${r.sayToThem ? `<blockquote>Something worth saying:<br><b>“${esc(r.sayToThem)}”</b></blockquote>` : ''}
      </div>`;
    return wrapReportHTML(inner);
  }

  function tabReport() {
    const box = $('#ptab');
    // quietly pull anything new from the account, then repaint once
    mergeCloudReports().then(changed => { if (changed && tab === 'report') tabReport(); });
    const saved = (Store.db.reports || []).slice().sort((a, b) => b.ts - a.ts);
    const att = Store.db.attempts;
    const name = Store.db.profile ? Store.db.profile.name : 'your child';

    /* The starting-point note is promised the moment the first check ends —
       but it is written over the network, and a dropped connection at that
       exact minute used to lose it silently, forever. If a baseline exists
       and its note doesn't, offer to write it now from the same answers. */
    const bl = Store.db.profile && Store.db.profile.baseline;
    const missingOnboard = !!bl && !saved.some(r => r.kind === 'onboarding');

    box.innerHTML = `
      ${missingOnboard ? `<div class="card" style="border-color:var(--honey)">
        <h3 style="margin-top:0">The starting-point note isn't written yet</h3>
        <p class="muted small">${esc(name)} finished the first check, but the note about it
           never got written — most likely the connection dropped at that moment. The answers
           are all still here.</p>
        <button class="btn-primary btn-s" id="fixOnboard">Write it now</button>
        <div id="fixOnboardStat"></div>
      </div>` : ''}
      <div class="card"${missingOnboard ? ' style="margin-top:14px"' : ''}>
        <h2>Coach Report</h2>
        <p class="muted">A written report on how ${esc(name)} is really doing — what they're good at,
           the exact patterns behind their mistakes with their own spellings quoted as evidence, and
           three specific things to do this week. Plain English, not teacher-speak.</p>
        <p class="muted small"><b>Reports are never overwritten.</b> Each one is filed by date and kept,
           so you can open any of them again and watch the shape of their progress change from one to the next.</p>
        <div class="row wrap" style="gap:10px;margin-top:14px">
          <select id="rRange" style="width:auto">
            <option value="14">Last 2 weeks</option>
            <option value="30" selected>Last month</option>
            <option value="90">Last 3 months</option>
            <option value="3650">Everything</option>
          </select>
          <button class="btn-primary" id="genBtn" ${att.length < 12 ? 'disabled' : ''}>
            ${saved.length ? 'Write a new report →' : 'Write the report →'}</button>
        </div>
        ${att.length < 12
          ? `<p class="hint">They need a bit more practice first — about ${12 - att.length} more answers.</p>`
          : `<p class="hint">One API call, about 30 seconds.${saved.length
              ? ` The new report will compare itself against ${esc(window.U.fmtDate(saved[0].ts))}.` : ''}</p>`}
        <div id="rStatus"></div>
      </div>

      ${saved.length >= 2 ? `<div class="card" style="margin-top:14px">
        <h3>Progress across your reports</h3>
        <p class="small muted">Every report you have ever generated, in order.</p>
        <div style="margin-top:12px">${reportTrendChart(saved)}</div>
      </div>` : ''}

      ${saved.length ? `<div class="card" style="margin-top:14px">
        <h3>Report archive <span class="pill tiny">${saved.length}</span></h3>
        <div id="archive" style="margin-top:10px">
          ${saved.map((r, i) => archiveRow(r, saved[i + 1])).join('')}
        </div>
      </div>` : ''}

      <div id="reportOut"></div>`;

    if ($('#fixOnboard')) $('#fixOnboard').onclick = async () => {
      const btn = $('#fixOnboard'); btn.disabled = true; btn.textContent = 'Writing…';
      try {
        await generateOnboardingReport(bl);
        toast('The starting-point note is ready.', 'good');
        tabReport();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Write it now';
        const st = $('#fixOnboardStat');
        if (st) st.innerHTML = `<p class="small" style="color:var(--coral-deep);margin:8px 0 0">${esc(e.message || e)}</p>`;
      }
    };
    $('#genBtn').onclick = generateReport;
    window.U.$$('[data-open]').forEach(b => b.onclick = () => {
      const r = Store.db.reports.find(x => x.id === b.dataset.open);
      if (!r) return;
      $('#reportOut').innerHTML = r.html;
      wireReport();
      $('#reportOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    window.U.$$('[data-rdel]').forEach(b => b.onclick = async () => {
      const yes = await confirmBox('Delete this report?',
        'The report text goes, but none of the practice history is touched — you can always write a new report covering the same dates.', 'Delete');
      if (!yes) return;
      Store.db.reports = Store.db.reports.filter(x => x.id !== b.dataset.rdel);
      Store.save(true); UI.checkpointVault(); paint();
    });
  }

  /** One row in the archive: date-tagged, with what changed since the one before. */
  function archiveRow(r, prev) {
    const m = r.metrics || {};
    const pm = (prev && prev.metrics) || null;
    const d = (a, b) => (a == null || b == null) ? null : Math.round((a - b) * 100);
    const dAcc = d(m.accuracy, pm && pm.accuracy);
    const dPhon = d(m.phoneticShare, pm && pm.phoneticShare);
    const dMast = (m.wordsMastered != null && pm && pm.wordsMastered != null)
      ? m.wordsMastered - pm.wordsMastered : null;

    const chip = (val, label, goodUp) => {
      if (val == null) return '';
      const good = goodUp ? val > 0 : val < 0;
      const cls = val === 0 ? '' : good ? 'sage' : 'coral';
      const arrow = val > 0 ? '▲' : val < 0 ? '▼' : '–';
      return `<span class="pill ${cls} tiny">${arrow} ${Math.abs(val)}${label}</span>`;
    };

    return `<div style="padding:12px 0;border-bottom:1px solid var(--line)">
      <div class="row between wrap" style="gap:10px">
        <div class="grow" style="min-width:230px">
          <div class="row wrap" style="gap:8px;align-items:baseline">
            <b>${esc(window.U.fmtDate(r.ts))}</b>
            <span class="pill tiny">${esc(r.range)}</span>
            ${m.answers ? `<span class="faint tiny">${m.answers} answers</span>` : ''}
          </div>
          ${r.headline ? `<p class="small muted" style="margin:6px 0 0">${esc(r.headline)}</p>` : ''}
          <div class="row wrap" style="gap:6px;margin-top:7px">
            ${m.accuracy != null ? `<span class="pill tiny">${Math.round(m.accuracy * 100)}% right</span>` : ''}
            ${m.wordsMastered != null ? `<span class="pill tiny">${m.wordsMastered} words locked in</span>` : ''}
            ${pm ? `<span class="faint tiny" style="align-self:center">vs previous:</span>
                    ${chip(dAcc, ' pts accuracy', true)}
                    ${chip(dPhon, ' pts sound-alike errors', false)}
                    ${chip(dMast, ' words', true)}` : '<span class="faint tiny">first report</span>'}
          </div>
        </div>
        <div class="row" style="align-self:flex-start">
          <button class="btn-ghost btn-s" data-open="${r.id}">Open</button>
          <button class="btn-quiet btn-s" data-rdel="${r.id}" title="Delete this report"></button>
        </div>
      </div>
    </div>`;
  }

  /** Accuracy at each report, oldest first — the long view. */
  function reportTrendChart(savedDesc) {
    const rows = savedDesc.slice().reverse().filter(r => r.metrics && r.metrics.accuracy != null);
    if (rows.length < 2) return '';
    return Charts.line(
      rows.map(r => ({ label: window.U.fmtDay(r.ts), v: Math.round(r.metrics.accuracy * 100), n: r.metrics.answers })),
      { title: 'Accuracy at each report', suffix: '%', max: 100, min: 0,
        sub: 'One point per report you have generated.' }
    );
  }

  function buildReportPayload(days) {
    const db = Store.db;
    const cut = Date.now() - days * 864e5;
    const att = db.attempts.filter(a => a.ts >= cut);
    const typed = att.filter(a => TYPED_MODES.includes(a.mode) && a.given);
    const summary = Phonics.summarise(typed.map(a => ({ correct: a.correct, given: a.given, ok: a.ok, ts: a.ts })));

    const wordRows = Store.allWords().map(wd => {
      const pr = db.progress[wd.id] || {};
      if (!pr.seen) return null;
      return {
        word: wd.word,
        topic: (Store.weekOfWord(wd.id) || {}).topic || '',
        tries: pr.seen, right: pr.right, accuracy: +(pr.right / pr.seen).toFixed(2),
        box: pr.box || 0,
        spellings: (pr.misspellings || []).slice(-5)
      };
    }).filter(Boolean).sort((a, b) => a.accuracy - b.accuracy);

    const sessions = db.sessions.filter(s => s.ts >= cut);
    const activeDays = new Set(att.map(a => new Date(a.ts).toISOString().slice(0, 10))).size;

    // did she improve? compare the first and last thirds of the period
    const sorted = att.slice().sort((a, b) => a.ts - b.ts);
    const third = Math.floor(sorted.length / 3);
    const early = sorted.slice(0, third), late = sorted.slice(-third);
    const rate = r => r.length ? +(r.filter(x => x.ok).length / r.length).toFixed(2) : null;

    return {
      // name and pronoun sit at the top level as well as inside `child`,
      // because the system prompt reads them before it sees anything else.
      name: db.profile.name,
      pronoun: (db.profile.pronoun || 'they'),
      child: {
        name: db.profile.name,
        pronoun: (db.profile.pronoun || 'they'),
        ageYears: 9,
        curriculum: 'IB PYP'
      },
      periodDays: days,
      baseline: db.profile.baseline ? {
        takenAt: new Date(db.profile.baseline.takenAt).toISOString().slice(0, 10),
        score: `${db.profile.baseline.correct}/${db.profile.baseline.total}`,
        phoneticShareOfErrors: +db.profile.baseline.phoneticShare.toFixed(2),
        words: db.profile.baseline.rows
      } : null,
      overall: {
        answers: att.length,
        accuracy: rate(att),
        typedAnswers: typed.length,
        wordsSeen: wordRows.length,
        wordsMastered: wordRows.filter(x => x.box >= 5).length,
        accuracyEarlyInPeriod: rate(early),
        accuracyLateInPeriod: rate(late)
      },
      engagement: {
        sessions: sessions.length,
        activeDays, periodDays: days,
        currentStreak: db.game.streakDays,
        bestStreak: db.game.bestStreak,
        level: Game.levelFor(db.game.points),
        badgesEarned: db.game.badges.length,
        averageSessionMinutes: sessions.length
          ? +(sessions.reduce((s, x) => s + (x.ms || 0), 0) / sessions.length / 60000).toFixed(1) : 0,
        gamesChosen: countBy(sessions.map(s => s.preset))
      },
      spellingPatterns: {
        totalMisspellings: summary.totalWrong,
        soundsRightShare: +summary.phonetic.share.toFixed(2),
        soundsRightExamples: summary.phonetic.examples.map(e => ({ wrote: e.given, correct: e.correct })),
        patterns: summary.patterns.map(p => ({
          pattern: p.label, count: p.count, share: +p.share.toFixed(2),
          examples: p.examples.map(e => ({ wrote: e.given, correct: e.correct }))
        }))
      },
      byGameType: modeBreakdown(att).map(m => ({ game: m.label, answers: m.n, accuracy: +m.pct.toFixed(2) })),
      byTopic: countAccuracyByWeek(att),
      wordsStruggling: wordRows.filter(x => x.accuracy < 0.8).slice(0, 20),
      wordsSolid: wordRows.filter(x => x.accuracy >= 0.9 && x.tries >= 3).slice(0, 12).map(x => x.word),
      upcomingTest: (db.weeks[0] && db.weeks[0].assessedOn) ? { date: db.weeks[0].assessedOn, topic: db.weeks[0].topic } : null
    };
  }

  function countBy(arr) {
    const o = {}; arr.forEach(x => { if (x) o[x] = (o[x] || 0) + 1; }); return o;
  }

  function countAccuracyByWeek(att) {
    const by = {};
    att.forEach(a => {
      const wk = Store.db.weeks.find(x => x.id === a.weekId);
      const k = wk ? (wk.topic || wk.title) : 'Other';
      by[k] = by[k] || { n: 0, ok: 0 };
      by[k].n++; if (a.ok) by[k].ok++;
    });
    return Object.keys(by).map(k => ({ topic: k, answers: by[k].n, accuracy: +(by[k].ok / by[k].n).toFixed(2) }));
  }

  /* --------------------------------------------------- metrics + series  */

  /** A compact numeric snapshot filed with each report, so any two reports can
   *  be compared later without re-deriving anything from the raw history. */
  function snapshotMetrics(days) {
    const cut = Date.now() - days * 864e5;
    const att = Store.db.attempts.filter(a => a.ts >= cut);
    const typed = att.filter(a => TYPED_MODES.includes(a.mode) && a.given);
    const sum = Phonics.summarise(typed.map(a => ({ correct: a.correct, given: a.given, ok: a.ok, ts: a.ts })));
    const activeDays = new Set(att.map(a => new Date(a.ts).toISOString().slice(0, 10))).size;
    return {
      ts: Date.now(),
      rangeDays: days,
      answers: att.length,
      accuracy: att.length ? att.filter(a => a.ok).length / att.length : null,
      typedAnswers: typed.length,
      wordsSeen: Object.keys(Store.db.progress).filter(id => Store.db.progress[id].seen).length,
      wordsMastered: Game.grownCount(),
      phoneticShare: sum.phonetic.share,
      totalMisspellings: sum.totalWrong,
      patterns: sum.patterns.slice(0, 8).map(p => ({ tag: p.tag, label: p.label, count: p.count, share: p.share })),
      activeDays,
      sessions: Store.db.sessions.filter(s => s.ts >= cut).length,
      streak: Store.db.game.streakDays,
      bestStreak: Store.db.game.bestStreak,
      level: Game.levelFor(Store.db.game.points),
      points: Store.db.game.points
    };
  }

  /** Accuracy and sound-alike share, bucketed by calendar week. */
  function weeklySeries(days) {
    const cut = Date.now() - days * 864e5;
    const att = Store.db.attempts.filter(a => a.ts >= cut);
    const by = {};
    att.forEach(a => {
      const d = new Date(a.ts);
      const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const k = mon.toISOString().slice(0, 10);
      by[k] = by[k] || { n: 0, ok: 0, typed: [] };
      by[k].n++; if (a.ok) by[k].ok++;
      if (TYPED_MODES.includes(a.mode) && a.given) by[k].typed.push(a);
    });
    return Object.keys(by).sort().map(k => {
      const b = by[k];
      const sum = Phonics.summarise(b.typed.map(a => ({ correct: a.correct, given: a.given, ok: a.ok, ts: a.ts })));
      return {
        key: k,
        label: window.U.fmtDay(new Date(k).getTime()),
        n: b.n,
        accuracy: b.n ? b.ok / b.n : 0,
        phoneticShare: sum.phonetic.share,
        misspellings: sum.totalWrong
      };
    });
  }

  /** Words locked in, week by week — reconstructed from when each word was
   *  last got right, so it works even for history recorded before today. */
  function masterySeries(weeks) {
    const out = [];
    weeks.forEach(wk => {
      const end = new Date(wk.key).getTime() + 7 * 864e5;
      let n = 0;
      Object.keys(Store.db.progress).forEach(id => {
        const rows = Store.db.attempts.filter(a => a.wordId === id && a.ts < end);
        if (rows.length < 3) return;
        const tail = rows.slice(-3);
        if (tail.every(a => a.ok)) n++;
      });
      out.push({ label: wk.label, v: n });
    });
    return out;
  }

  /** Error patterns for this window and the equally-long window before it. */
  function patternComparison(days) {
    const now = Date.now();
    const cur = windowPatterns(now - days * 864e5, now);
    const prev = windowPatterns(now - days * 2 * 864e5, now - days * 864e5);
    const keys = Array.from(new Set(cur.map(p => p.tag).concat(prev.map(p => p.tag)))).slice(0, 6);
    const pctOf = (list, tag) => {
      const hit = list.find(p => p.tag === tag);
      return hit ? Math.round(hit.share * 100) : 0;
    };
    return {
      hasPrev: prev.length > 0,
      rows: keys.map(t => ({
        label: (cur.find(p => p.tag === t) || prev.find(p => p.tag === t)).label,
        a: pctOf(cur, t),
        b: prev.length ? pctOf(prev, t) : null
      })).sort((x, y) => y.a - x.a)
    };
  }

  function windowPatterns(from, to) {
    const rows = Store.db.attempts
      .filter(a => a.ts >= from && a.ts < to && TYPED_MODES.includes(a.mode) && a.given)
      .map(a => ({ correct: a.correct, given: a.given, ok: a.ok, ts: a.ts }));
    if (!rows.length) return [];
    return Phonics.summarise(rows).patterns;
  }

  /* ======================================================================
     THE ONBOARDING REPORT
     Called by the setup flow the moment the twenty-question check finishes.
     Runs quietly in the background; the child never sees it. By the time the
     parent next opens the grown-ups' area, their starting-point note is
     sitting at the top of the Coach Report archive.
     ====================================================================== */
  async function generateOnboardingReport(baseline) {
    if (!API.hasKey() || !baseline) return null;
    const db = Store.db;
    const p = db.profile || {};

    const payload = {
      kind: 'onboarding',
      name: p.name || 'the child',
      pronoun: p.pronoun || 'they',
      check: {
        description: 'A 20-question first check: 6 listen-and-spell, 4 read-the-meaning-and-spell, 5 spot-the-correct-spelling, 5 word meanings. Each question probes a specific English spelling pattern.',
        score: `${baseline.correct}/${baseline.total}`,
        produceScore: baseline.produceScore,
        recogniseScore: baseline.recogniseScore,
        vocabScore: baseline.vocabScore,
        gap: baseline.gap,
        phoneticShareOfErrors: baseline.phoneticShare,
        topPatterns: baseline.topPatterns,
        answers: baseline.rows
      }
    };

    const r = await API.onboardingReport(payload);
    const html = renderOnboardReport(r, p.name || '');
    const rec = {
      id: Store.uid('r'), ts: Date.now(), html,
      range: 'Starting point', kind: 'onboarding',
      headline: r.headline,
      metrics: { answers: baseline.total, accuracy: baseline.correct / baseline.total,
                 phoneticShare: baseline.phoneticShare, wordsMastered: 0 }
    };
    db.reports.push(rec);
    Store.save(true);

    // …and into the account, so it is on whichever device the parent opens.
    try {
      if (window.Sync && Sync.isDbId(db.activeChildId) && window.Cloud && Cloud.signedIn()) {
        await Cloud.from('reports').insert({
          child_id: db.activeChildId,
          payload: { kind: 'onboarding', result: r, metrics: rec.metrics },
          html
        });
      }
    } catch (e) { console.warn('onboarding report not synced', e); }
    return rec;
  }

  function renderOnboardReport(r, name) {
    const inner = `
      <div class="card report">
        <div class="kicker">AraBuzz · Starting point · ${esc(window.U.fmtDate(Date.now()))}</div>
        <h1>Where ${esc(name)} is starting from</h1>
        <blockquote><b>${esc(r.headline || '')}</b></blockquote>
        ${String(r.startingPoint || '').split(/\n{2,}|\n/).filter(Boolean)
          .map(t => `<p>${esc(t)}</p>`).join('')}
        <h2>What ${esc(name)} already brings</h2>
        <ul>${(r.strengths || []).map(x =>
          `<li><b>${esc(x.title)}</b> — ${esc(x.detail)}</li>`).join('')}</ul>
        <h2>What practice will focus on first</h2>
        <ul>${(r.focus || []).map(x =>
          `<li><b>${esc(x.pattern)}</b> — ${esc(x.why)}${x.example
            ? ` <span class="muted small">(${esc(x.example)})</span>` : ''}</li>`).join('')}</ul>
        <h2>The first fortnight</h2>
        <p>${esc(r.firstFortnight || '')}</p>
        ${r.sayToThem ? `<blockquote>Something worth saying tonight:<br><b>“${esc(r.sayToThem)}”</b></blockquote>` : ''}
        <p class="small muted">Written from the twenty answers of the first check — a strong
           starting sketch that daily practice now sharpens. The weekly notes take it from here.</p>
      </div>`;
    return wrapReportHTML(inner);
  }

  async function generateReport() {
    if (!API.hasKey()) return toast('Add an API key in Settings first.', 'bad');
    const days = +$('#rRange').value;
    const st = $('#rStatus');
    const previous = (Store.db.reports || []).slice().sort((a, b) => b.ts - a.ts)[0] || null;

    st.innerHTML = `<div class="loading-box"><span class="loader"></span>
      <p class="muted small" style="margin:0">Reading every answer, spotting the patterns, writing it up…</p></div>`;
    try {
      const payload = buildReportPayload(days);
      if (previous && previous.metrics) {
        payload.previousReport = {
          writtenOn: new Date(previous.ts).toISOString().slice(0, 10),
          accuracy: previous.metrics.accuracy,
          wordsMastered: previous.metrics.wordsMastered,
          soundsRightShare: previous.metrics.phoneticShare,
          topPatterns: (previous.metrics.patterns || []).slice(0, 4).map(p => p.label),
          headline: previous.headline || ''
        };
      }
      const r = await API.coachReport(payload);
      const metrics = snapshotMetrics(days);
      const html = renderReport(r, payload, days, { metrics, previous });
      const rec = {
        id: Store.uid('r'), ts: Date.now(), html, range: rangeLabel(days),
        headline: r.headline, metrics
      };
      Store.db.reports.push(rec);
      if (Store.db.reports.length > 40) Store.db.reports.shift();
      Store.save(true);
      if (window.Vault && Vault.supported) Vault.saveReport(wrapReportHTML(html), `coach-report-${new Date().toISOString().slice(0, 10)}`);
      UI.checkpointVault();
      st.innerHTML = '';
      $('#reportOut').innerHTML = html;
      wireReport(html);
      window.scrollTo({ top: 340, behavior: 'smooth' });
    } catch (e) {
      console.error(e);
      st.innerHTML = `<div class="feedback bad"><b>Couldn't write the report.</b><p class="small" style="margin:6px 0 0">${esc(e.message || e)}</p></div>`;
    }
  }

  const rangeLabel = d => d <= 14 ? 'Last 2 weeks' : d <= 30 ? 'Last month' : d <= 90 ? 'Last 3 months' : 'All time';

  const SEV = { watch: ['', 'Keep an eye on it', 'plum'], 'work-on': ['', 'Worth working on', 'honey'], urgent: ['', 'Needs attention', 'coral'] };

  function renderReport(r, payload, days, extra) {
    const name = Store.db.profile.name;
    const o = payload.overall, e = payload.engagement;
    const ex = extra || {};
    const m = ex.metrics || snapshotMetrics(days);
    const prev = ex.previous && ex.previous.metrics ? ex.previous.metrics : null;
    const moved = (o.accuracyLateInPeriod != null && o.accuracyEarlyInPeriod != null)
      ? Math.round((o.accuracyLateInPeriod - o.accuracyEarlyInPeriod) * 100) : null;

    const weeks = weeklySeries(days);
    const cmp = patternComparison(days);
    const pct = v => v == null ? null : Math.round(v * 100);

    const tiles = Charts.tiles([
      { value: pct(m.accuracy) + '%', label: 'Answers correct',
        delta: prev ? (m.accuracy - prev.accuracy) : null,
        deltaText: prev ? Math.abs(pct(m.accuracy) - pct(prev.accuracy)) + ' pts' : '',
        sub: prev ? '' : 'first report' },
      { value: m.wordsMastered, label: 'Words locked in',
        delta: prev ? (m.wordsMastered - prev.wordsMastered) : null,
        deltaText: prev ? Math.abs(m.wordsMastered - prev.wordsMastered) + ' words' : '' },
      { value: pct(m.phoneticShare) + '%', label: 'Errors that sound right',
        higherIsBetter: false,
        delta: prev ? (m.phoneticShare - prev.phoneticShare) : null,
        deltaText: prev ? Math.abs(pct(m.phoneticShare) - pct(prev.phoneticShare)) + ' pts' : '' },
      { value: m.activeDays, label: `Days practised of ${days}`,
        delta: prev ? (m.activeDays - prev.activeDays) : null,
        deltaText: prev ? Math.abs(m.activeDays - prev.activeDays) + ' days' : '' }
    ]);

    const accChart = Charts.line(
      weeks.map(x => ({ label: x.label, v: Math.round(x.accuracy * 100), n: x.n })),
      { title: 'How often they got it right, week by week', suffix: '%', max: 100, min: 0,
        sub: 'Higher is better. Remember the words get harder each week.' });

    const phonChart = weeks.some(x => x.misspellings >= 3) ? Charts.line(
      weeks.filter(x => x.misspellings >= 1).map(x => ({ label: x.label, v: Math.round(x.phoneticShare * 100), n: x.misspellings })),
      { title: 'Share of their misspellings that sound correct', suffix: '%', max: 100, min: 0,
        sub: 'This is the number to watch. Lower means they are switching from spelling by ear to spelling by sight.',
        note: 'A falling line here is the clearest sign the Montessori phonics habit is giving way to visual memory.' }) : '';

    const patternChart = Charts.compareBars(cmp.rows, {
      title: 'What kind of mistakes, and whether they are shrinking',
      sub: cmp.hasPrev ? 'Each bar is that pattern\'s share of all their misspellings.'
                       : 'Each bar is that pattern\'s share of all their misspellings.',
      aLabel: 'This period', bLabel: 'The period before', suffix: '%'
    });

    const masteryChart = weeks.length >= 2
      ? Charts.cumulative(masterySeries(weeks), { title: 'Words locked in over time',
          sub: 'A word counts once they have got it right three times running.' })
      : '';

    const actChart = Charts.activity(dailyActivity(Math.min(days, 56)).map(d => ({
      label: window.U.fmtDay(new Date(d.day).getTime()), n: d.n
    })), { title: 'When they practised' });

    return `
    <div class="card report" id="theReport" style="margin-top:18px">
      <style>${Charts.CSS}</style>
      <div class="row between wrap no-print" style="margin-bottom:8px">
        <span class="pill sky">${esc(rangeLabel(days))}</span>
        <div class="row">
          <button class="btn-ghost btn-s" id="printRep">Print / Save as PDF</button>
          <button class="btn-ghost btn-s" id="dlRep">Save file</button>
        </div>
      </div>

      <div style="text-align:center;padding:6px 0 14px;border-bottom:2px solid var(--honey)">
        <div style="font-family:var(--font-head);font-size:.75rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-faint)">AraBuzz Coach Report</div>
        <h1 style="margin:6px 0 2px">${esc(name)}</h1>
        <p class="small faint" style="margin:0">${esc(window.U.fmtDate(Date.now()))} · ${esc(rangeLabel(days))} · based on ${o.answers} answers
        ${prev ? ` · compared with ${esc(window.U.fmtDate(ex.previous.ts))}` : ''}
        ${r.confidence === 'low' ? ' · <b>early days, treat as a first impression</b>' : ''}</p>
      </div>

      <blockquote style="font-size:1.1rem;margin-top:18px"><b>${esc(r.headline)}</b></blockquote>

      <div style="margin:18px 0 6px">${tiles}</div>
      ${prev ? `<p class="tiny faint" style="text-align:center;margin:0 0 8px">
        Arrows compare against your report of ${esc(window.U.fmtDate(ex.previous.ts))}.</p>` : ''}

      <h2>What has changed since last time</h2>
      ${paras(r.sinceLastReport)}

      <h2>Where ${esc(name)} is right now</h2>
      ${paras(r.whereTheyAre || r.whereSheIs)}

      <div class="report-section" style="margin:22px 0">${accChart}</div>

      <table>
        <tr><th>Answers given</th><td>${o.answers}</td><th>Got right</th><td>${Math.round((o.accuracy || 0) * 100)}%</td></tr>
        <tr><th>Words practised</th><td>${o.wordsSeen}</td><th>Words locked in</th><td>${o.wordsMastered}</td></tr>
        <tr><th>Days practised</th><td>${e.activeDays} of ${days}</td><th>Longest streak</th><td>${e.bestStreak} days</td></tr>
        ${moved !== null ? `<tr><th>Change across the period</th><td colspan="3">${
          moved > 2 ? `<b style="color:var(--sage-deep)">up ${moved} points</b> — ${Math.round(o.accuracyEarlyInPeriod * 100)}% at the start, ${Math.round(o.accuracyLateInPeriod * 100)}% by the end`
          : moved < -2 ? `down ${Math.abs(moved)} points — but note the words get harder each week`
          : 'holding steady'}</td></tr>` : ''}
      </table>

      <h2>What she's good at</h2>
      <ul>${r.strengths.map(s => `<li><b>${esc(s.title)}.</b> ${esc(s.detail)}</li>`).join('')}</ul>

      <h2>The patterns behind their mistakes</h2>
      ${payload.spellingPatterns.soundsRightShare >= 0.4 ? `
        <blockquote><b>${Math.round(payload.spellingPatterns.soundsRightShare * 100)}% of ${esc(name)}'s misspellings would sound
        correct if you read them out loud.</b> That is the single most useful number in this report — it says
        their hearing and phonics are fine, and the gap is purely in remembering how words <i>look</i>.</blockquote>` : ''}
      ${phonChart ? `<div class="report-section" style="margin:20px 0">${phonChart}</div>` : ''}
      <div class="report-section" style="margin:22px 0">${patternChart}</div>
      ${r.patterns.map(p => {
        const sv = SEV[p.howBad] || SEV['work-on'];
        return `
        <div style="margin:16px 0;padding:14px 18px;border-left:4px solid var(--${sv[2]});background:var(--${sv[2]}-soft);border-radius:0 12px 12px 0">
          <div class="row between wrap"><h3 style="margin:0">${esc(p.name)}</h3>
            <span class="pill ${sv[2]} tiny">${sv[0]} ${sv[1]}</span></div>
          <p style="margin:8px 0 0">${esc(p.whatsHappening)}</p>
          <p style="margin:8px 0 0"><b>Seen in:</b> ${p.evidence.map(x => esc(x)).join(' · ')}</p>
          <p style="margin:8px 0 0" class="small"><b>Why it happens:</b> ${esc(p.whyItHappens)}</p>
        </div>`;
      }).join('')}

      <h2>Do these three things this week</h2>
      <ol>${r.thisWeek.map(t => `<li style="margin-bottom:12px">
        <b>${esc(t.action)}</b> <span class="pill tiny">${t.minutes} min</span>
        <div class="small muted">${esc(t.why)}</div></li>`).join('')}</ol>

      <h2>Words to drill before the next test</h2>
      <div class="row wrap" style="gap:8px">
        ${r.wordsToDrill.map(x => `<span class="pill coral">${esc(x)}</span>`).join('')}
      </div>
      ${payload.upcomingTest ? `<p class="small muted" style="margin-top:10px">Next school test:
        <b>${esc(window.U.fmtDate(new Date(payload.upcomingTest.date).getTime()))}</b> — ${esc(payload.upcomingTest.topic || '')}</p>` : ''}

      ${masteryChart ? `<h2>Words going in for good</h2>
      <div class="report-section" style="margin:14px 0 22px">${masteryChart}</div>` : ''}

      <h2>Are they actually enjoying it?</h2>
      ${paras(r.motivation)}
      <div class="report-section" style="margin:16px 0 20px">${actChart}</div>
      <table>
        <tr><th>Sessions</th><td>${e.sessions}</td><th>Average length</th><td>${e.averageSessionMinutes} min</td></tr>
        <tr><th>Current streak</th><td>${e.currentStreak} days</td><th>Badges earned</th><td>${e.badgesEarned}</td></tr>
        <tr><th>Games they pick</th><td colspan="3">${Object.keys(e.gamesChosen).map(k => `${esc(k)} (${e.gamesChosen[k]})`).join(', ') || '—'}</td></tr>
      </table>

      <div style="margin-top:24px;padding:18px 22px;background:var(--sage-soft);border-radius:18px">
        <div class="kicker">Say this to her</div>
        <p style="margin:6px 0 0;font-size:1.05rem">“${esc(r.sayToThem || r.sayToHer)}”</p>
      </div>

      <p class="tiny faint" style="margin-top:22px;text-align:center">
        Generated by AraBuzz from ${o.answers} recorded answers. A CoKindle Labs initiative.<br>
        This is a practice summary, not a clinical or diagnostic assessment.
      </p>
    </div>`;
  }

  function paras(text) {
    return String(text || '').split(/\n{2,}|\n/).filter(x => x.trim())
      .map(p => `<p>${esc(p.trim())}</p>`).join('');
  }

  function wrapReportHTML(inner) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AraBuzz Coach Report</title>
<style>
/* No web fonts: a saved report must open anywhere, offline, and when emailed. */
body{font-family:Lexend,'Segoe UI',system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.75;color:#22333B;background:#FAF7F2;margin:0;padding:34px 20px}
.report{max-width:800px;margin:0 auto;background:#fff;padding:44px;border-radius:20px;box-shadow:0 8px 30px rgba(34,51,59,.08);text-align:justify}
h1,h2,h3{font-family:'Baloo 2','Trebuchet MS',system-ui,sans-serif;line-height:1.25;text-align:left}
h1{font-size:2rem;margin:.2em 0}h2{font-size:1.4rem;color:#2E6E8E;border-bottom:2px solid #E8A33D;padding-bottom:6px;margin-top:30px}
h3{font-size:1.1rem;margin:.4em 0}
p{margin:0 0 1.1em}ul,ol{padding-left:22px}li{margin-bottom:8px}
blockquote{margin:14px 0;padding:14px 20px;background:#FCEFD6;border-left:4px solid #E8A33D;border-radius:0 12px 12px 0}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:.92rem}
th,td{padding:10px 12px;border:1px solid #E5DDD1;text-align:left}th{background:#F3EEE5;font-family:'Baloo 2',sans-serif;width:22%}
.pill{display:inline-block;background:#F3EEE5;border-radius:999px;padding:4px 12px;font-size:.82rem;margin:2px}
.pill.coral{background:#FBE7E0;color:#C25F45}.pill.honey{background:#FCEFD6;color:#C9832A}
.pill.plum{background:#EFEAF2;color:#6E5C7A}.pill.sky{background:#E3EFF4;color:#2E6E8E}.pill.tiny{font-size:.7rem}
.small{font-size:.88rem}.tiny{font-size:.75rem}.muted{color:#4A5C64}.faint{color:#8697A0}
.row{display:flex;gap:10px}.wrap{flex-wrap:wrap}.between{justify-content:space-between}
.kicker{font-family:'Baloo 2',sans-serif;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#8697A0}
.no-print{display:none}
@media print{body{background:#fff;padding:0}.report{box-shadow:none;padding:0;max-width:none}}
</style></head><body>${inner.replace(/class="card report"/, 'class="report"')}</body></html>`;
  }

  function wireReport(html) {
    const p = $('#printRep'), d = $('#dlRep');
    if (p) p.onclick = () => {
      const win = window.open('', '_blank');
      win.document.write(wrapReportHTML($('#theReport').outerHTML));
      win.document.close();
      setTimeout(() => win.print(), 700);
    };
    if (d) d.onclick = () => {
      const blob = new Blob([wrapReportHTML($('#theReport').outerHTML)], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `AraBuzz-Coach-Report-${new Date().toISOString().slice(0, 10)}.html`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    };
  }

  /* ====================================================================== */
  /*  6. SETTINGS                                                           */
  /* ====================================================================== */
  function tabSettings() {
    const box = $('#ptab');
    const s = Store.db.settings;
    const use = Store.usageThisWeek();
    const voices = window.U.loadVoices();
    const own = API.usingOwnKey();
    const C = window.CONFIG;
    const policy = s.modelPolicy || C.DEFAULT_POLICY;

    const admin = isAdmin();
    box.innerHTML = `
      ${!admin ? '' : `<div class="card">
        <h2>Anthropic API key</h2>
        ${own ? `
          <div class="feedback good" style="margin-bottom:14px">
            <b>Using your own key</b>
            <p class="small" style="margin:4px 0 0">Stored on this device only.</p>
          </div>`
        : `<div class="feedback" style="background:var(--sky-soft);border:2px solid var(--macaw-blue);margin-bottom:14px">
            <b>Using the key built into AraBuzz</b>
            <p class="small" style="margin:4px 0 0">Nothing to set up — it just works. Put your own key
               in below if you'd rather the usage went to your own account.</p>
          </div>`}
        <div class="field">
          <label>Your API key ${own ? '' : '<span class="faint">(optional)</span>'}</label>
          <input type="password" id="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-…">
        </div>
        <div class="row wrap" style="gap:10px">
          <button class="btn-primary btn-s" id="saveKey">Save</button>
          <button class="btn-ghost btn-s" id="testKey">Test connection</button>
          ${own ? `<button class="btn-quiet btn-s" id="resetKey">Go back to the built-in key</button>` : ''}
        </div>
        <details style="margin-top:14px">
          <summary class="small muted" style="cursor:pointer">Advanced — use my own proxy instead</summary>
          <div class="field" style="margin-top:10px">
            <label>API base URL</label>
            <input type="text" id="apiBase" value="${esc(s.apiBase || '')}" placeholder="https://my-proxy.example.com">
            <p class="hint">Leave blank to talk to Anthropic directly. Point this at a small proxy that
               holds the key server-side and the key never sits on the device at all — useful if AraBuzz
               ever goes beyond your own family.</p>
          </div>
        </details>
        <div id="keyStat"></div>
      </div>`}

      ${!admin ? '' : `<div class="card" style="margin-top:14px">
        <h3>Quality and cost</h3>
        <p class="muted small">Different jobs need different models, and matching them properly is
           where the saving is. On your real Spell Buzz sheets the small fast model extracted exactly
           the same words, topics and dates as the big one — for a quarter of the cost. So reading
           documents runs small, and the two jobs where quality shows (building a week's material,
           writing your report) run large.</p>
        <div class="grid" style="gap:10px;margin-top:12px">
          ${Object.keys(C.POLICIES).map(k => {
            const p = C.POLICIES[k];
            return `<div class="tile" data-policy="${k}" style="${k === policy
              ? 'border-color:var(--honey);background:var(--honey-soft)' : ''}">
              <div class="row between"><b>${esc(p.label)}</b><span>${k === policy ? '' : '⬜'}</span></div>
              <p>${esc(p.blurb)}</p></div>`;
          }).join('')}
        </div>
        <details style="margin-top:14px">
          <summary class="small muted" style="cursor:pointer">Advanced — pick a model per job</summary>
          <table class="data" style="margin-top:10px"><tbody>
            ${Object.keys(C.JOB_LABELS).map(job => `<tr>
              <td class="small">${esc(C.JOB_LABELS[job])}</td>
              <td><select data-job="${job}" style="min-width:210px">
                <option value="">Follow the setting above (${esc(C.POLICIES[policy].models[job] || '—')})</option>
                ${C.MODELS.map(m => `<option value="${m}" ${
                  (s.modelOverrides || {})[job] === m ? 'selected' : ''}>${m}</option>`).join('')}
              </select></td></tr>`).join('')}
          </tbody></table>
        </details>
      </div>`}

      ${!admin ? '' : `<div class="card" style="margin-top:14px">
        <h3>What it has cost so far</h3>
        <div class="grid grid-3" style="margin-top:10px">
          ${[['This week', use.calls + ' calls'], ['Tokens in', use.inTok.toLocaleString()],
             ['Estimated', '$' + use.est.toFixed(3)]]
            .map(([t, v]) => `<div class="card flat pad-s center-text" style="background:var(--paper-2);border:none">
              <div style="font-family:var(--font-head);font-size:1.35rem;font-weight:800">${v}</div>
              <div class="tiny faint">${t}</div></div>`).join('')}
        </div>
        <div class="field" style="margin-top:12px;max-width:220px">
          <label>Warn me above (calls per week)</label>
          <input type="number" id="warnCalls" value="${s.warnCallsPerWeek}" min="5" max="500">
        </div>
        ${use.calls > s.warnCallsPerWeek ? `<p class="small" style="color:var(--coral-deep)">
          Above the limit you set (${s.warnCallsPerWeek}/week).</p>` : ''}
        <p class="hint">Roughly two calls per uploaded sheet, plus a couple a week from practice and
           one per report. On Balanced a busy week lands well under a dollar.</p>
        ${Store.db.usage.length ? `<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Recent calls</summary>
          <table class="data" style="margin-top:8px"><tbody>
          ${Store.db.usage.slice(-14).reverse().map(u => `<tr>
            <td class="small">${esc(window.U.fmtDate(u.ts))}</td>
            <td class="small"><b>${esc(u.kind)}</b></td>
            <td class="tiny faint">${esc(u.model || '')}</td>
            <td class="small faint">${u.inTok}→${u.outTok}</td>
            <td class="small">$${(u.est || 0).toFixed(4)}</td></tr>`).join('')}
          </tbody></table></details>` : ''}
      </div>`}

      <div class="card" style="margin-top:14px">
        <h3>How the practice behaves</h3>
        <div class="grid grid-2">
          <div class="field"><label>Questions per quiz</label>
            <select id="qlen">${[5, 8, 10, 12, 15, 20].map(n => `<option ${s.quizLength === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label>Reading speed for spoken words</label>
            <select id="rate">${[['0.65', 'Slow'], ['0.85', 'Normal'], ['1', 'Quick']]
              .map(([v, t]) => `<option value="${v}" ${String(s.speakRate) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Voice</label>
          <select id="voice">
            <option value="">Choose automatically</option>
            ${voices.map(v => `<option value="${esc(v.voiceURI)}" ${s.voiceURI === v.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}
          </select>
          <button class="btn-ghost btn-s" id="testVoice" style="margin-top:8px">Test</button>
        </div>
        <label class="row" style="gap:10px;cursor:pointer;margin-top:6px">
          <input type="checkbox" id="sound" ${s.sound ? 'checked' : ''} style="width:auto"> Sound effects
        </label>
        <label class="row" style="gap:10px;cursor:pointer;margin-top:10px">
          <input type="checkbox" id="spotOn" ${s.allowSpotSpelling ? 'checked' : ''} style="width:auto">
          Include "Spot the Spelling"
        </label>
        <p class="hint">Spot the Spelling shows wrong spellings alongside the right one. It mirrors the
           proofreading children do at school, but some teachers prefer children never see a misspelt word.
           AraBuzz already holds it back until a word is partly learned — turn it off entirely here.</p>
        <label class="row" style="gap:10px;cursor:pointer;margin-top:10px">
          <input type="checkbox" id="darkOn" ${s.theme !== 'light' ? 'checked' : ''} style="width:auto"> Night mode
        </label>
      </div>

      ${!Store.db.profile ? '' : `<div class="card" style="margin-top:14px">
        <h3>Who is using AraBuzz</h3>
        <div class="grid grid-2">
          <div class="field"><label>Your kid's name</label><input id="kidName" value="${esc(Store.db.profile.name)}"></div>
          <div class="field"><label>PIN for this area</label>
            <button class="btn-ghost" id="changePin" style="width:100%">Change PIN</button></div>
        </div>
        <div class="row wrap" style="gap:10px">
          <button class="btn-ghost btn-s" id="redoBaseline">Re-take the starting check</button>
          <button class="btn-ghost btn-s" id="newChild"> Set up a different child</button>
        </div>
        <p class="hint"><b>Set up a different child</b> keeps every word list but clears
           the name, scores, streak, garden, badges and history, then runs the welcome and starting check
           again — so a sibling can start clean. Download a copy of your data first, below, if you
           want to keep the records.</p>
      </div>`}

      <div class="card" style="margin-top:14px">
        <h3>Your data</h3>
        <p class="muted small">Everything AraBuzz knows about your family — the words, every answer,
           every note — belongs to you. Both promises from the agreement live here.</p>
        <div class="row wrap" style="gap:10px;margin-top:10px">
          <button class="btn-primary btn-s" id="dlEverything">Download everything</button>
          ${admin ? '' : `<button class="btn-danger btn-s" id="delEverything">Delete everything and leave</button>`}
        </div>
        <p class="hint">Download gives you a file with the lot — keep it wherever you like.
           ${admin ? '' : `Delete removes your family's record from AraBuzz — every kid, every answer,
           every note, gone from our side — signs this device out and wipes it clean. It cannot be undone.`}</p>
      </div>

      <div class="card" style="margin-top:14px;text-align:center">
        <img src="assets/cokindle-labs.png" alt="CoKindle Labs" style="height:64px">
        <p class="small muted" style="margin:10px 0 0"><b>AraBuzz</b> · a CoKindle Labs initiative</p>
        <p class="tiny faint" style="margin:4px 0 0">Built for Aradhana. Version 1.1</p>
      </div>`;

    if ($('#saveKey')) $('#saveKey').onclick = () => {
      s.apiKey = $('#apiKey').value.trim();
      s.apiBase = ($('#apiBase') && $('#apiBase').value.trim()) || '';
      s.warnCallsPerWeek = +$('#warnCalls').value || 40;
      Store.save(true); UI.syncVault(true);
      toast('Saved.', 'good'); paint();
    };
    if ($('#resetKey')) $('#resetKey').onclick = async () => {
      const yes = await confirmBox('Use the built-in key again?',
        'Your own key will be removed from this device.', 'Use built-in');
      if (!yes) return;
      s.apiKey = ''; Store.save(true); toast('Back to the built-in key.', 'good'); paint();
    };
    if ($('#testKey')) $('#testKey').onclick = async () => {
      s.apiKey = $('#apiKey').value.trim();
      s.apiBase = ($('#apiBase') && $('#apiBase').value.trim()) || '';
      Store.save(true);
      const st = $('#keyStat');
      st.innerHTML = `<div class="row" style="gap:10px;margin-top:12px"><span class="loader"></span><span class="small muted">Testing…</span></div>`;
      try {
        const ms = await API.test();
        st.innerHTML = `<div class="feedback good" style="margin-top:12px"><b>Working</b>
          <p class="small" style="margin:4px 0 0">Replied in ${ms} ms.</p></div>`;
      } catch (e) {
        st.innerHTML = `<div class="feedback bad" style="margin-top:12px"><b>Not working</b>
          <p class="small" style="margin:4px 0 0">${esc(e.message || e)}</p></div>`;
      }
    };

    window.U.$$('[data-policy]').forEach(t => t.onclick = () => {
      s.modelPolicy = t.dataset.policy; Store.save(true); UI.syncVault(); paint();
      toast(C.POLICIES[s.modelPolicy].label.trim() + ' selected.', 'good');
    });
    window.U.$$('[data-job]').forEach(sel => sel.onchange = () => {
      s.modelOverrides = s.modelOverrides || {};
      if (sel.value) s.modelOverrides[sel.dataset.job] = sel.value;
      else delete s.modelOverrides[sel.dataset.job];
      Store.save(true); UI.syncVault();
    });

    const bind = (id, fn) => { const n = $('#' + id); if (n) n.onchange = () => { fn(n); Store.save(true); UI.syncVault(); }; };
    bind('qlen', n => s.quizLength = +n.value);
    bind('rate', n => s.speakRate = +n.value);
    bind('voice', n => s.voiceURI = n.value);
    bind('sound', n => s.sound = n.checked);
    bind('spotOn', n => s.allowSpotSpelling = n.checked);
    bind('warnCalls', n => s.warnCallsPerWeek = +n.value || 40);
    bind('darkOn', n => {
      s.theme = n.checked ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', s.theme === 'dark' ? 'dark' : '');
      if (window.Scene) Scene.update(true);
    });
    $('#testVoice').onclick = () => { s.voiceURI = $('#voice').value; window.U.speak('Cerebellum'); };
    if ($('#kidName')) $('#kidName').onchange = e => { Store.db.profile.name = e.target.value.trim() || 'Speller'; Store.save(true); UI.syncVault(); };

    if ($('#changePin')) $('#changePin').onclick = async () => {
      const p = await promptBox('New PIN', 'At least 4 digits.', '••••', 'number');
      if (p === null) return;
      const pin = String(p).trim();
      if (pin.length < 4) return toast('Needs at least 4 digits.');
      try {
        // The PIN lives in the family account, so it opens this area on every
        // device at once. Only a device that has never signed in keeps it locally.
        if (window.Cloud && Cloud.signedIn && Cloud.signedIn()) await Cloud.setPin(pin);
        else { s.pin = pin; Store.save(true); }
        toast('PIN updated.', 'good');
      } catch (e) { toast('Could not update the PIN — ' + (e.message || e), 'bad'); }
    };
    if ($('#redoBaseline')) $('#redoBaseline').onclick = async () => {
      const yes = await confirmBox('Re-take the starting check?',
        'They answer about twenty questions again. The old result is replaced but all the practice history stays.', 'Re-take');
      if (!yes) return;
      const nm = Store.db.profile.name;
      Store.db.profile.baseline = null; Store.save(true);
      UI.retakeBaseline();
      toast('Hand the device to ' + nm + '.');
    };
    if ($('#newChild')) $('#newChild').onclick = newChild;

    /* -------- the two promises from the agreement: a copy, and a way out */
    $('#dlEverything').onclick = () => {
      Vault.download(Store.db);
      toast('Your copy is downloading.', 'good');
    };
    if ($('#delEverything')) $('#delEverything').onclick = async () => {
      const yes = await confirmBox('Delete everything and leave?',
        `Your family's record — every kid, every answer, every note — is removed from
         AraBuzz for good, and this device is wiped clean.<br><br>
         <b>This cannot be undone.</b> Download a copy first if you want to keep anything.`,
        'Delete everything');
      if (!yes) return;
      const typed = await promptBox('Type DELETE to confirm', 'Just so a stray tap cannot do it.', 'DELETE');
      if (typed === null) return;
      if (String(typed).trim().toUpperCase() !== 'DELETE') return toast('Nothing was deleted.');
      try {
        if (window.Cloud && Cloud.signedIn && Cloud.signedIn()) {
          const { error } = await Cloud.rpc('delete_my_family');
          if (error) throw error;
          await Cloud.signOut();
        }
      } catch (e) {
        return toast('Could not delete from the server — ' + (e.message || e), 'bad');
      }
      try { Store.wipe(); } catch (e) {}
      location.replace(location.pathname);
    };
  }

  /** Hand AraBuzz to a different child: keep the word lists, clear the person. */
  async function newChild() {
    const yes = await confirmBox('Set up a different child?',
      `Every word list you have uploaded is kept.<br><br>
       <b>${esc(Store.db.profile ? Store.db.profile.name : 'The current child')}'s</b> name, points, level,
       streak, badges, garden, answer history and saved reports will all be cleared.<br><br>
       This cannot be undone from inside the app — use <b>Download everything</b> in Settings first if you want to keep the records.`,
      'Yes, start fresh');
    if (!yes) return;

    const keep = await confirmBox('Keep the word lists?',
      'Choose <b>Keep</b> to hand over the same weeks they have been practising.<br>Choose <b>Cancel</b> to clear the word lists too and start completely empty.',
      'Keep the word lists');

    const db = Store.db;
    if (!keep) { db.weeks = []; db.words = {}; }
    db.profile = null;
    db.progress = {};
    db.attempts = [];
    db.sessions = [];
    db.reports = [];
    db.game = Store.blank().game;
    Object.keys(db.words).forEach(id => Store.ensureProgress(id));
    Store.save(true);
    UI.checkpointVault();
    toast('Ready for a fresh start.', 'good');
    UI.startFresh();
  }

  w.Parent = { paint, openUpload, buildReportPayload, renderReport, wrapReportHTML, generateOnboardingReport };
})(window);
