/* ==========================================================================
   AraBuzz — quiz.js
   Runs a quiz, the two puzzle games, and the results screen.
   ========================================================================== */
(function (w) {
  'use strict';

  const { $, el, esc, toast, modal, confetti, floatPoints } = window.U;

  let s = null;          // live session state

  /* ====================================================================== */
  /*  START                                                                 */
  /* ====================================================================== */
  function start(opts) {
    const pool = (opts.pool || []).filter(Boolean);
    if (pool.length < 3) { toast('Not enough words to practise yet.'); return; }

    const built = Engine.buildQuiz(pool, {
      preset: opts.preset || 'spellbuzz',
      count: Math.min(opts.count || 10, pool.length),
      selection: 'smart'
    });

    // Mixed Buzz drops a tiny three-word crossword in somewhere in the middle.
    // It breaks the rhythm, it is the format the school actually uses, and it
    // makes "mixed" mean something more than a shuffled question type.
    if (opts.miniCrossword && built.questions.length >= 6 && pool.length >= 4) {
      const mini = buildMini(pool, built.questions);
      if (mini) built.questions.splice(Math.floor(built.questions.length / 2), 0, mini);
    }

    s = {
      id: Store.uid('s'),
      preset: built.preset,
      label: opts.label || built.label,
      weekIds: opts.weekIds || [],
      pool,
      qs: built.questions,
      i: 0,
      tries: 0,
      hinted: false,
      correct: 0,
      points: 0,
      combo: 0,
      bestCombo: 0,
      misses: [],           // {wordId, word, given, analysis}
      marks: [],            // 'done' | 'miss'
      started: Date.now(),
      qStart: Date.now(),
      timed: built.preset === 'buzzer',
      timeLeft: 90,
      timer: null,
      answered: 0
    };

    UI.go('quiz');
    if (s.timed) startTimer();
    render();
  }

  /** A 3-word crossword built from words she has just been asked about. */
  function buildMini(pool, questions) {
    const used = questions.map(q => q.wordId);
    const candidates = pool
      .filter(wd => Puzzles.strip(wd.word).length >= 3 && Puzzles.strip(wd.word).length <= 11)
      .sort((a, b) => (used.includes(b.id) ? 1 : 0) - (used.includes(a.id) ? 1 : 0));
    const picked = Engine.shuffle(candidates.slice(0, 8)).slice(0, 3);
    if (picked.length < 3) return null;
    const grid = Puzzles.bestCrossword(picked.map(wd => ({
      id: wd.id, word: wd.word, clue: wd.crosswordClue || wd.kidMeaning || wd.meaning
    })), Date.now() % 99999, 8);
    if (!grid || grid.entries.length < 2) return null;
    return {
      id: 'mini' + Math.random().toString(36).slice(2, 6),
      wordId: picked[0].id, word: picked[0].word, mode: 'mini', kind: 'mini',
      answer: '', prompt: '', sub: 'Bonus round!', options: null, meta: { grid }
    };
  }

  function startTimer() {
    clearInterval(s.timer);
    s.timer = setInterval(() => {
      if (!s) return clearInterval(s && s.timer);
      s.timeLeft--;
      const t = $('#timeLeft');
      if (t) {
        t.textContent = s.timeLeft + 's';
        t.parentElement.className = 'pill ' + (s.timeLeft <= 15 ? 'coral' : 'sky');
      }
      if (s.timeLeft <= 0) { clearInterval(s.timer); finish(); }
    }, 1000);
  }

  /* ====================================================================== */
  /*  RENDER A QUESTION                                                     */
  /* ====================================================================== */
  function render() {
    const scr = $('#scr-quiz');
    if (!s) return;

    // Beat the Buzzer keeps generating until the clock stops
    if (s.timed && s.i >= s.qs.length) {
      const more = Engine.buildQuiz(s.pool, { preset: 'buzzer', count: 8 });
      s.qs = s.qs.concat(more.questions);
    }
    if (s.i >= s.qs.length) return finish();

    const q = s.qs[s.i];
    const wd = Store.db.words[q.wordId];
    s.qStart = Date.now();
    s.tries = 0;
    s.hinted = false;

    scr.innerHTML = `
      <div class="row between" style="margin-bottom:4px">
        <button class="btn-quiet btn-s" id="quit">← Stop</button>
        <div class="row" style="gap:6px">
          ${s.timed ? `<span class="pill sky">${Icon.icon('clock',{size:14})} <b id="timeLeft">${s.timeLeft}s</b></span>` : ''}
          <span class="pill honey">${Icon.icon('star',{size:14})} <b id="livePts">${s.points}</b></span>
          ${s.combo >= 2 ? `<span class="pill coral">${Icon.icon('flame',{size:14})} ${s.combo}</span>` : ''}
        </div>
      </div>

      <div class="qbar">${
        (s.timed ? s.marks : s.qs).map((_, k) => {
          const m = s.marks[k];
          return `<span class="${m === 'done' ? 'done' : m === 'miss' ? 'miss' : k === s.i ? 'now' : ''}"></span>`;
        }).join('') || '<span class="now"></span>'}
      </div>

      <div class="card glow" id="qcard">
        <div class="row between" style="margin-bottom:12px">
          <span class="kicker">${esc(modeLabel(q.mode))}</span>
          <span class="kicker">${s.timed ? `#${s.i + 1}` : `${s.i + 1} of ${s.qs.length}`}</span>
        </div>
        <div id="qbody"></div>
      </div>

      <div id="fb"></div>

      <div class="row center" style="margin-top:16px;gap:10px" id="qactions"></div>`;

    $('#quit').onclick = confirmQuit;
    const body = $('#qbody');
    const actions = $('#qactions');

    if (q.kind === 'type') renderType(q, wd, body, actions);
    else if (q.kind === 'choice') renderChoice(q, wd, body, actions);
    else if (q.kind === 'gaps') renderGaps(q, wd, body, actions);
    else if (q.kind === 'jumble') renderJumble(q, wd, body, actions);
    else if (q.kind === 'mini') renderMini(q, body, actions);
  }

  function modeLabel(m) {
    return { spell: 'Spell it', listen: 'Listen & spell', sentence: 'Fill the gap',
      meaning: 'What does it mean?', reverse: 'Which word?', missing: 'Missing letters',
      jumble: 'Jumbled up', spot: 'Spot the spelling',
      mini: 'Bonus mini crossword' }[m] || 'Question';
  }

  /* ------------------------------------------------------------ type ---- */
  function renderType(q, wd, body, actions) {
    const isListen = q.mode === 'listen';
    body.innerHTML = `
      ${isListen ? `
        <div class="center-text" style="padding:10px 0 4px">
          <button class="btn-primary btn-xl" id="hear">Hear the word</button>
          <div class="row center" style="gap:8px;margin-top:10px">
            <button class="btn-ghost btn-s" id="slow">Slower</button>
            <button class="btn-ghost btn-s" id="meaningBtn">What does it mean?</button>
            ${window.U.speedBtn()}
          </div>
        </div>`
        : `<p class="center-text" style="font-size:1.2rem;line-height:1.6;margin:6px 0 4px">${esc(q.prompt)}
             ${window.U.sayMeaningBtn(q.prompt, q.prompt === wd.meaning ? wd.kidMeaning : '')}</p>`}
      <p class="center-text small faint" style="margin:10px 0 14px">${esc(q.sub)}</p>
      <input type="text" class="spell-input" id="ans" placeholder="spell it here">
      <div id="hintBox"></div>`;

    const ans = window.U.noAutoCorrect($('#ans'));
    setTimeout(() => ans.focus(), 120);

    if (isListen) {
      const say = () => window.U.speak(wd.word);
      $('#hear').onclick = say;
      $('#slow').onclick = () => window.U.speak(wd.word, { rate: 0.55 });
      $('#meaningBtn').onclick = () => {
        $('#hintBox').innerHTML = `<p class="center-text muted" style="margin-top:14px">${esc(q.meta.meaning || '')}</p>`;
      };
      setTimeout(say, 300);
    }

    actions.innerHTML = `
      <button class="btn-ghost" id="hint"> Hint</button>
      <button class="btn-primary btn-xl" id="ok">Check</button>`;

    $('#hint').onclick = () => giveHint(q, wd);
    $('#ok').onclick = () => submitType(q, wd, ans.value);
    ans.onkeydown = e => { if (e.key === 'Enter') submitType(q, wd, ans.value); };
  }

  function giveHint(q, wd) {
    if (!s.hinted) { s.hinted = true; }
    const box = $('#hintBox');
    const bits = [];
    bits.push(`<b>${esc(wd.word[0].toUpperCase())}</b> …${wd.word.replace(/[a-z]/gi, '_').length} letters`);
    if (wd.syllables) bits.push(esc(wd.syllables));
    if (wd.trickyBit) bits.push('Watch out for ' + esc(wd.trickyBit));
    box.innerHTML = `<div class="feedback" style="background:var(--honey-soft);border:2px solid var(--honey)">
      <b class="ichip">${Icon.icon('sparkle',{size:16})}<span>Hint</span></b><p style="margin:6px 0 0">${bits.join(' · ')}</p></div>`;
    window.U.beep('tick');
  }

  function submitType(q, wd, given) {
    const val = String(given || '').trim();
    if (!val) { toast('Have a go — a guess is fine!'); return; }
    const res = Engine.check(q, val);
    handleAnswer(q, wd, val, res);
  }

  /* ------------------------------------------------------------ mini ---- */
  function renderMini(q, body, actions) {
    const g = q.meta.grid;
    body.innerHTML = `
      <p class="center-text" style="font-size:1.05rem;margin:0 0 4px"><b>Bonus round!</b></p>
      <p class="center-text small faint" style="margin:0 0 12px">Three words. Fill them in for extra points.</p>
      <div class="xw-wrap"><table class="xw">${
        g.cells.map((row, r) => `<tr>${row.map((c, col) =>
          c ? `<td class="cell" data-r="${r}" data-c="${col}">${c.num ? `<span class="num">${c.num}</span>` : ''}<input maxlength="1" data-r="${r}" data-c="${col}"></td>`
            : `<td class="blank"></td>`).join('')}</tr>`).join('')}
      </table></div>
      <div class="clues" style="margin-top:16px">
        <div><h3>Across</h3><ol>${g.across.map(e =>
          `<li value="${e.num}">${esc(e.clue)} <span class="faint tiny">(${e.letters.length})</span></li>`).join('') || '<span class="faint small">—</span>'}</ol></div>
        <div><h3>Down</h3><ol>${g.down.map(e =>
          `<li value="${e.num}">${esc(e.clue)} <span class="faint tiny">(${e.letters.length})</span></li>`).join('') || '<span class="faint small">—</span>'}</ol></div>
      </div>`;

    const cellAt = (r, c) => body.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
    window.U.$$('.xw input', body).forEach(inp => {
      window.U.noAutoCorrect(inp);
      inp.oninput = () => {
        inp.value = inp.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
        if (inp.value) {
          const r = +inp.dataset.r, c = +inp.dataset.c;
          const n = cellAt(r, c + 1) || cellAt(r + 1, c);
          if (n) n.focus();
        }
      };
    });
    setTimeout(() => { const f = body.querySelector('.xw input'); if (f) f.focus(); }, 120);

    actions.innerHTML = `<button class="btn-primary btn-xl" id="ok">Check</button>`;
    $('#ok').onclick = () => {
      let right = 0;
      g.entries.forEach(e => {
        let got = '';
        for (let i = 0; i < e.letters.length; i++) {
          const rr = e.row + (e.dir === 'down' ? i : 0);
          const cc = e.col + (e.dir === 'across' ? i : 0);
          const inp = cellAt(rr, cc);
          got += (inp && inp.value) ? inp.value.toUpperCase() : ' ';
        }
        const ok = got === e.letters;
        if (ok) right++;
        const wd = Store.db.words[e.id];
        if (wd) Engine.record({ wordId: wd.id, word: wd.word, mode: 'crossword', kind: 'type', answer: wd.word },
          got.trim(), ok, ok, 0, s.id);
      });
      const all = right === g.entries.length;
      const pts = right * 9;
      s.points += pts; s.answered++;
      s.marks[s.i] = all ? 'done' : 'miss';
      if (all) s.correct++;
      window.U.beep(all ? 'great' : right ? 'good' : 'bad');
      const pl = $('#livePts'); if (pl) pl.textContent = s.points;

      $('#fb').innerHTML = `<div class="feedback ${all ? 'good' : 'bad'}">
        <h3>${all ? 'All three! ' : `${right} of ${g.entries.length} right`}</h3>
        <div class="row wrap" style="gap:8px;margin-top:8px">
          ${g.entries.map(e => `<span class="pill ${'sage'}">${esc(e.word)}</span>`).join('')}
        </div>
        <p class="small" style="margin:8px 0 0">+${pts} points</p></div>`;
      actions.innerHTML = `<button class="btn-go btn-xl" id="nextQ">Next →</button>`;
      $('#nextQ').onclick = next;
    };
  }

  /* ---------------------------------------------------------- choice ---- */
  function renderChoice(q, wd, body, actions) {
    body.innerHTML = `
      ${q.meta.spelling || q.mode === 'meaning'
        ? `<div class="center-text"><div class="big-word">${esc(q.prompt)}</div></div>`
        : `<p class="center-text" style="font-size:1.2rem;line-height:1.6">${esc(q.prompt)}
             ${window.U.sayMeaningBtn(q.prompt, q.prompt === wd.meaning ? wd.kidMeaning : '')}</p>`}
      <p class="center-text small faint" style="margin:12px 0 16px">${esc(q.sub)}</p>
      <div class="opts" id="opts">
        ${q.options.map((o, i) => `
          <button class="opt ${q.meta.spelling ? 'spelling-opt' : ''}" data-v="${esc(o)}">
            <span class="key">${'ABCD'[i]}</span><span>${esc(o)}</span>
          </button>`).join('')}
      </div>`;
    actions.innerHTML = q.mode === 'meaning'
      ? `<button class="btn-ghost btn-s" id="hearIt">Hear the word</button> ${window.U.speedBtn()}` : '';
    if ($('#hearIt')) $('#hearIt').onclick = () => window.U.speak(wd.word);

    window.U.$$('#opts .opt').forEach(b => b.onclick = () => {
      const v = b.dataset.v;
      const res = Engine.check(q, v);
      window.U.$$('#opts .opt').forEach(x => {
        x.classList.add('locked');
        if (x.dataset.v === String(q.answer)) x.classList.add('correct');
        else if (x === b) x.classList.add('wrong');
      });
      handleAnswer(q, wd, v, res, true);
    });
  }

  /* ------------------------------------------------------------ gaps ---- */
  function renderGaps(q, wd, body, actions) {
    const word = wd.word;
    const gaps = q.meta.gaps;
    body.innerHTML = `
      <p class="center-text" style="font-size:1.05rem;line-height:1.6;margin-bottom:4px">${esc(q.prompt)}
        ${window.U.sayMeaningBtn(q.prompt, q.prompt === wd.meaning ? wd.kidMeaning : '')}</p>
      <p class="center-text small faint" style="margin:8px 0 4px">${esc(q.sub)}</p>
      <div class="letters" id="gapRow">
        ${word.split('').map((ch, i) => {
          if (ch === ' ') return `<span class="ltile space"></span>`;
          if (!/[a-z]/i.test(ch)) return `<span class="ltile fixed">${esc(ch)}</span>`;
          if (gaps.includes(i)) return `<input class="gap-input" data-i="${i}" maxlength="1" inputmode="text">`;
          return `<span class="ltile">${esc(ch)}</span>`;
        }).join('')}
      </div>`;
    actions.innerHTML = `
      <button class="btn-ghost btn-s" id="hearIt">Hear it</button>
      ${window.U.speedBtn()}
      <button class="btn-primary btn-xl" id="ok">Check</button>`;

    const inputs = window.U.$$('.gap-input');
    inputs.forEach((inp, k) => {
      window.U.noAutoCorrect(inp);
      inp.oninput = () => {
        inp.value = inp.value.replace(/[^a-zA-Z]/g, '');
        if (inp.value && inputs[k + 1]) inputs[k + 1].focus();
      };
      inp.onkeydown = e => {
        if (e.key === 'Backspace' && !inp.value && inputs[k - 1]) inputs[k - 1].focus();
        if (e.key === 'Enter') check();
      };
    });
    setTimeout(() => inputs[0] && inputs[0].focus(), 120);
    $('#hearIt').onclick = () => window.U.speak(wd.word);

    function check() {
      const chars = word.split('');
      inputs.forEach(inp => { chars[+inp.dataset.i] = inp.value || '_'; });
      const built = chars.join('');
      const res = Engine.check(q, built);
      handleAnswer(q, wd, built, res);
    }
    $('#ok').onclick = check;
  }

  /* ---------------------------------------------------------- jumble ---- */
  function renderJumble(q, wd, body, actions) {
    const tiles = q.meta.tiles.slice();
    let picked = [];

    body.innerHTML = `
      <p class="center-text" style="font-size:1.05rem;line-height:1.6">${esc(q.prompt)}
        ${window.U.sayMeaningBtn(q.prompt, q.prompt === wd.meaning ? wd.kidMeaning : '')}</p>
      <p class="center-text small faint" style="margin:8px 0 4px">${esc(q.sub)}</p>
      <div class="letters" id="slots"></div>
      <div style="height:6px"></div>
      <div class="letters" id="bank"></div>`;

    const slots = $('#slots'), bank = $('#bank');

    function paint() {
      slots.innerHTML = wd.word.split('').map((_, i) =>
        `<span class="ltile ${picked[i] ? 'filled' : 'slot'}" data-slot="${i}">${picked[i] ? esc(picked[i]) : ''}</span>`).join('');
      bank.innerHTML = tiles.map((t, i) =>
        `<span class="ltile ${picked.indexOf(i) >= 0 ? 'used' : ''}" data-bank="${i}">${esc(t)}</span>`).join('');

      window.U.$$('#bank .ltile').forEach(b => b.onclick = () => {
        const i = +b.dataset.bank;
        if (picked.indexOf(i) >= 0) return;
        const at = picked.findIndex(x => x === undefined);
        const free = picked.length < wd.word.length;
        if (at >= 0) picked[at] = i; else if (free) picked.push(i); else return;
        window.U.beep('tick'); paintValues();
      });
      window.U.$$('#slots .ltile').forEach(b => b.onclick = () => {
        const i = +b.dataset.slot;
        if (picked[i] === undefined) return;
        picked.splice(i, 1); paintValues();
      });
    }

    function paintValues() {
      const shown = picked.map(i => tiles[i]);
      slots.innerHTML = wd.word.split('').map((_, i) =>
        `<span class="ltile ${shown[i] ? 'filled' : 'slot'}" data-slot="${i}">${shown[i] ? esc(shown[i]) : ''}</span>`).join('');
      bank.innerHTML = tiles.map((t, i) =>
        `<span class="ltile ${picked.indexOf(i) >= 0 ? 'used' : ''}" data-bank="${i}">${esc(t)}</span>`).join('');
      bindTiles();
    }

    function bindTiles() {
      window.U.$$('#bank .ltile').forEach(b => b.onclick = () => {
        const i = +b.dataset.bank;
        if (picked.indexOf(i) >= 0) return;
        if (picked.length >= wd.word.length) return;
        picked.push(i); window.U.beep('tick'); paintValues();
      });
      window.U.$$('#slots .ltile').forEach(b => b.onclick = () => {
        const i = +b.dataset.slot;
        if (picked[i] === undefined) return;
        picked.splice(i, 1); paintValues();
      });
    }

    paint(); bindTiles();

    actions.innerHTML = `
      <button class="btn-ghost btn-s" id="clear">Clear</button>
      <button class="btn-ghost btn-s" id="hearIt">Hear it</button>
      ${window.U.speedBtn()}
      <button class="btn-primary btn-xl" id="ok">Check</button>`;
    $('#clear').onclick = () => { picked = []; paintValues(); };
    $('#hearIt').onclick = () => window.U.speak(wd.word);
    $('#ok').onclick = () => {
      let built = picked.map(i => tiles[i]).join('');
      if (!built) { toast('Tap the letters to build the word.'); return; }
      /* Two tiles carrying the same letter — a capital E and a small e — are
         the same letter to a child, so choosing the "other" one is not a
         mistake. Accept it, and teach the capital rule gently instead. */
      let capNote = false;
      if (built !== wd.word && built.toLowerCase() === wd.word.toLowerCase()) {
        capNote = true; built = wd.word;
      }
      handleAnswer(q, wd, built, Engine.check(q, built));
      if (capNote) {
        const fb = document.querySelector('#scr-quiz #fb');
        if (fb && fb.firstElementChild) fb.firstElementChild.insertAdjacentHTML('beforeend',
          `<p class="small" style="margin:8px 0 0">One thing worth knowing: <b>${esc(wd.word[0])}</b> is a capital here because the first letter of a name — or the first word of a sentence — always gets one.</p>`);
      }
    };
  }

  /* ====================================================================== */
  /*  ANSWER HANDLING                                                       */
  /* ====================================================================== */
  function handleAnswer(q, wd, given, res, isChoice) {
    const ms = Date.now() - s.qStart;
    s.tries++;
    const firstTry = s.tries === 1 && !s.hinted;

    if (res.ok) {
      // ---- correct
      let pts = isChoice ? Game.POINTS.choice
              : s.tries === 1 ? (s.hinted ? Game.POINTS.hinted : Game.POINTS.first)
              : Game.POINTS.second;
      s.combo++;
      s.bestCombo = Math.max(s.bestCombo, s.combo);
      if (s.combo >= 3) pts += Math.min(10, (s.combo - 2) * 2);
      if (s.timed) pts += Math.max(0, Math.round(Game.POINTS.speedMax * (1 - Math.min(1, ms / 9000))));

      s.points += pts;
      s.correct++;
      s.marks[s.i] = 'done';
      s.answered++;
      Engine.record(q, given, true, firstTry, ms, s.id);

      window.U.beep(s.combo >= 3 ? 'great' : 'good');
      const card = $('#qcard');
      if (card) {
        const r = card.getBoundingClientRect();
        floatPoints('+' + pts, r.left + r.width / 2, r.top + 40);
      }
      const pl = $('#livePts'); if (pl) pl.textContent = s.points;

      showFeedback(true, q, wd, given, res, () => next());
      return;
    }

    // ---- wrong
    if (!isChoice && s.tries === 1) {
      // One more go, with her mistake shown back to her. This is the single
      // most valuable moment in the whole app — she sees exactly which letters
      // went astray while the word is still in her head.
      Engine.record(q, given, false, false, ms, s.id);
      const card = $('#qcard'); if (card) { card.classList.add('shake'); setTimeout(() => card.classList.remove('shake'), 500); }
      window.U.beep('bad');
      $('#fb').innerHTML = `
        <div class="feedback bad">
          <h3>Not quite — have another go</h3>
          <div class="diff">${Phonics.diffHTML(wd.word, given)}</div>
          <p class="small" style="margin:6px 0 0">
            <span class="miss" style="padding:2px 5px;border-radius:4px">green</span> = letters you need ·
            <span class="bad" style="padding:2px 5px;border-radius:4px">struck out</span> = not in the word
            ${res.analysis && res.analysis.note ? ' · ' + esc(res.analysis.note) : ''}
          </p>
        </div>`;
      const inp = $('#ans');
      if (inp) { inp.value = ''; inp.focus(); }
      window.U.$$('.gap-input').forEach(x => { x.value = ''; });
      const first = window.U.$$('.gap-input')[0]; if (first) first.focus();
      s.combo = 0;
      return;
    }

    // out of tries
    s.combo = 0;
    s.marks[s.i] = 'miss';
    s.answered++;
    const analysis = Engine.record(q, given, false, false, ms, s.id);
    s.misses.push({ wordId: q.wordId, word: wd.word, given: String(given), analysis, mode: q.mode });
    window.U.beep('bad');
    showFeedback(false, q, wd, given, res, () => next());
  }

  function showFeedback(ok, q, wd, given, res, done) {
    const fb = $('#fb');
    const isChoice = q.kind === 'choice';

    fb.innerHTML = ok ? `
      <div class="feedback good">
        <div class="row" style="gap:14px;align-items:flex-start">
          <div style="flex:none">${Ara.svg({ level: Game.levelFor(Store.db.game.points), width: 70, mood: 'celebrate', plain: true })}</div>
          <div class="grow">
            <h3>${esc(Ara.say('right'))}</h3>
            <div class="big-word" style="font-size:1.8rem">${esc(wd.word)}</div>
            ${wd.kidMeaning ? `<p class="small muted" style="margin:6px 0 0">${esc(wd.kidMeaning)}</p>` : ''}
          </div>
        </div>
      </div>` : `
      <div class="feedback bad">
        <h3>${esc(Ara.say('wrong'))}</h3>
        ${!isChoice ? `<p class="small muted" style="margin:0">You wrote:</p>
          <div class="diff">${Phonics.diffHTML(wd.word, given)}</div>` : ''}
        ${(() => {
          /* The right answer, described in the language of THIS question.
             A meaning question ends with the meaning — not "the word is",
             which belongs to the spelling games. */
          if (isChoice && q.mode === 'meaning') return `
            <p class="small muted" style="margin:10px 0 0"><b>${esc(wd.word)}</b> means:</p>
            <div class="diff" style="font-size:1rem">${esc(String(q.answer || wd.kidMeaning || wd.meaning || ''))}</div>`;
          if (isChoice) return `
            <p class="small muted" style="margin:10px 0 0">The right ${q.mode === 'spot' ? 'spelling' : 'word'} is:</p>
            <div class="diff">${esc(wd.word)}</div>`;
          return `
            <p class="small muted" style="margin:10px 0 0">The word is:</p>
            <div class="diff">${Phonics.highlightCorrect(wd.word, given)}</div>`;
        })()}
        ${(q.mode !== 'meaning' && res.analysis && res.analysis.soundsRight)
          ? `<p class="small" style="margin:8px 0 0">Good ears! That's exactly how it <i>sounds</i> — English just spells it differently.</p>` : ''}
        ${(q.mode !== 'meaning' && wd.trickyBit) ? `<p class="small" style="margin:8px 0 0"><b>Remember:</b> ${esc(wd.trickyBit)}</p>` : ''}
        ${(q.mode !== 'meaning' && wd.memoryTrick) ? `<p class="small ichip" style="margin:6px 0 0">${Icon.icon('sparkle',{size:15})}<span>${esc(wd.memoryTrick)}</span></p>` : ''}
      </div>`;

    const actions = $('#qactions');
    actions.innerHTML = `
      ${!ok ? `<button class="btn-ghost" id="sayIt">Hear it</button>
               <button class="btn-ghost" id="spellIt">Spell it to me</button>` : ''}
      <button class="btn-${ok ? 'go' : 'primary'} btn-xl" id="nextQ">${s.i + 1 >= s.qs.length && !s.timed ? 'See my score →' : 'Next →'}</button>`;
    if ($('#sayIt')) $('#sayIt').onclick = () => window.U.speak(wd.word);
    if ($('#spellIt')) $('#spellIt').onclick = () => window.U.spellOut(wd.word);
    $('#nextQ').onclick = done;
    setTimeout(() => { const b = $('#nextQ'); if (b) b.focus(); }, 60);

    // auto-advance on a correct answer in the timed round
    if (ok && s.timed) setTimeout(() => { if (s) done(); }, 700);
  }

  function next() {
    if (!s) return;
    s.i++;
    if (!s.timed && s.i >= s.qs.length) return finish();
    render();
  }

  async function confirmQuit() {
    const yes = await window.U.confirmBox('Stop here?',
      'Your points so far are safe, and the words you practised still count.', 'Yes, stop');
    if (!yes) return;
    if (s && s.answered > 0) finish();
    else { clearInterval(s && s.timer); s = null; UI.go('home'); }
  }

  /* ====================================================================== */
  /*  FINISH                                                                */
  /* ====================================================================== */
  async function finish() {
    if (!s) return;
    clearInterval(s.timer);
    const sess = s; s = null;
    const grownBefore = Game.grownCount();

    const total = sess.answered || sess.qs.length;
    const pctRight = total ? sess.correct / total : 0;
    const stars = Engine.stars(pctRight);
    const bonus = stars * 12;
    const totalPoints = sess.points + bonus;

    const before = Game.levelFor(Store.db.game.points);
    Game.awardPoints(totalPoints);
    const after = Game.levelFor(Store.db.game.points);

    const res = Game.finishSession({
      kind: 'quiz', preset: sess.preset, label: sess.label, weekIds: sess.weekIds,
      total, correct: sess.correct, points: totalPoints, stars, ms: Date.now() - sess.started
    });

    Store.save(true);
    UI.checkpointVault();
    const newWorld = window.Scene ? Scene.announceIfChanged(grownBefore) : null;

    // Painting must never be able to swallow the coaching that follows it.
    try {
      paintResult(sess, { total, pctRight, stars, bonus, totalPoints,
                          levelUp: after > before, level: after, res, newWorld });
    } catch (e) {
      console.error('result screen failed', e);
      UI.go('home');
    }

    // Batched, cached, once-per-word-ever: fetch memory tricks for the misses.
    coachMisses(sess.misses);
    // And quietly refill variety for any words running dry.
    topUpIfNeeded(sess.pool);
  }

  function paintResult(sess, r) {
    UI.go('result');
    const scr = $('#scr-result');
    const name = Store.db.profile.name;
    const mood = r.pctRight >= 0.8 ? 'celebrate' : r.pctRight >= 0.5 ? 'happy' : 'idle';

    scr.innerHTML = `
      <div class="card glow center-text">
        <div class="ara-stage ara-cheer">${Ara.svg({ level: r.level, width: 170, mood })}</div>
        <div class="stars" style="margin:10px 0">${Icon.stars(r.stars, 3, { size: 34 })}</div>
        <h1 style="margin:2px 0">${esc(
          r.pctRight >= 0.95 ? 'Perfect!' : r.pctRight >= 0.8 ? 'Brilliant!' :
          r.pctRight >= 0.55 ? 'Nice work!' : 'Good effort!')}</h1>
        <p class="muted">${sess.rushStats
          ? `You locked in <b>${sess.rushStats.cleared} of ${sess.rushStats.of}</b> words`
          : `You got <b>${sess.correct} of ${r.total}</b> right`}${
          sess.bestCombo >= 3 ? ` · best run <b>${sess.bestCombo}</b> in a row` : ''}</p>
        ${sess.rushStats ? `<div class="row center wrap" style="gap:8px;margin-top:10px">
          <span class="pill sky">${Icon.icon('keys',{size:15})} ${sess.rushStats.wpm} words per minute</span>
          <span class="pill sage">${Icon.icon('target',{size:15})} ${sess.rushStats.acc}% of your letters right</span>
          <span class="pill">${sess.rushStats.keystrokes} letters typed</span>
        </div>` : ''}

        <div class="row center wrap" style="gap:8px;margin:16px 0">
          <span class="pill honey">${Icon.icon('star',{size:15})} +${r.totalPoints} points</span>
          ${r.bonus ? `<span class="pill sage">${Icon.icon('sparkle',{size:15})} +${r.bonus} star bonus</span>` : ''}
          <span class="pill coral">${Icon.icon('flame',{size:15})} ${Store.db.game.streakDays} day streak</span>
        </div>

        ${r.newWorld ? `<div class="stage-banner" style="margin:14px 0;background:linear-gradient(135deg, ${r.newWorld.sky[1]}, ${r.newWorld.sky[2]})">
          <div style="flex:none">${Garden.treeSVG({ pct: Game.grownCount() / Math.max(Store.allWords().length, 12), width: 96, stage: r.newWorld.key })}</div>
          <div class="grow" style="min-width:180px;text-align:left">
            <div style="font-family:var(--font-head);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;opacity:.85">Your world changed</div>
            <h3 style="margin:2px 0 2px;color:#fff">${esc(r.newWorld.name)}</h3>
            <p class="small" style="margin:0;opacity:.92">${esc(r.newWorld.blurb)} Look behind everything.</p>
          </div></div>` : ''}

        ${r.levelUp ? `<div class="card flat" style="background:var(--honey-soft);border:none;margin:12px 0">
          <h3 style="margin:0">Level ${r.level}</h3>
          <p class="small" style="margin:4px 0 0">${esc(Ara.say('levelup'))} Ara is now a <b>${esc(Ara.stageFor(r.level).name)}</b>.</p>
        </div>` : ''}

        ${r.res.badges.length ? `<div class="card flat" style="background:var(--sage-soft);border:none;margin:12px 0">
          <h3 style="margin:0">New badge${r.res.badges.length > 1 ? 's' : ''}!</h3>
          <div class="row center wrap" style="gap:10px;margin-top:8px">
            ${r.res.badges.map(b => `<span class="pill honey">${Icon.icon(b.ic,{size:15})} ${esc(b.name)}</span>`).join('')}
          </div></div>` : ''}
      </div>

      ${sess.misses.length ? `
        <div class="card" style="margin-top:16px">
          <h2>Let's fix these ${sess.misses.length === 1 ? 'one' : sess.misses.length}</h2>
          <p class="small muted">Ara will bring these back sooner. That's a good thing.</p>
          <div id="missList" style="margin-top:12px"></div>
          <div id="trickSpin" class="row center" style="gap:10px;margin-top:12px"></div>
        </div>` : `
        <div class="card center-text" style="margin-top:16px">
          <h2>Not a single miss</h2>
          <p class="muted" style="margin:0">Every word right. Try a harder pool, or come back tomorrow to keep the streak.</p>
        </div>`}

      <div class="row center wrap" style="gap:10px;margin:22px 0">
        <button class="btn-ghost" id="homeBtn">${Icon.icon('home',{size:17})} Home</button>
        ${sess.misses.length ? `<button class="btn-primary" id="fixBtn">Practise just the misses</button>` : ''}
        <button class="btn-go btn-xl" id="againBtn">Play again →</button>
      </div>
      <p class="center-text small faint">A new game means new words, new clues and a new order. It's never the same twice.</p>`;

    if (sess.misses.length) paintMisses(sess.misses);

    $('#homeBtn').onclick = () => UI.go('home');
    $('#againBtn').onclick = () => {
      if (sess.preset === 'rush') return startRush(sess.pool, { count: 6 });
      if (sess.preset === 'crossword') return startCrossword(sess.pool);
      if (sess.preset === 'wordsearch') return startWordSearch(sess.pool);
      start({ preset: sess.preset, pool: sess.pool, count: sess.qs.length,
              weekIds: sess.weekIds, label: sess.label });
    };
    if ($('#fixBtn')) $('#fixBtn').onclick = () => {
      const words = sess.misses.map(m => Store.db.words[m.wordId]).filter(Boolean);
      const extra = Engine.shuffle(sess.pool.filter(p => !words.some(x => x.id === p.id))).slice(0, 2);
      start({ preset: 'spellbuzz', pool: words.concat(extra), count: Math.max(4, words.length + 2), label: 'Fixing misses' });
    };

    if (window.Scene) Scene.update(true);
    if (r.newWorld) confetti(150);
    else if (r.stars === 3) confetti(120);
    else if (r.levelUp) confetti(80);
    if (r.levelUp) window.U.beep('level');
  }

  function paintMisses(misses) {
    const box = $('#missList');
    if (!box) return;
    const CHOICE_MODES = ['meaning', 'reverse', 'spot'];
    box.innerHTML = misses.map(m => {
      const wd = Store.db.words[m.wordId] || {};
      const wasChoice = CHOICE_MODES.includes(m.mode);
      const chip = !m.given ? ''
        : m.mode === 'meaning' ? `<span class="pill coral tiny">picked the wrong meaning</span>`
        : m.mode === 'reverse' ? `<span class="pill coral tiny">picked "${esc(m.given)}"</span>`
        : wasChoice ? `<span class="pill coral tiny">chose "${esc(m.given)}"</span>`
        : `<span class="pill coral tiny">you wrote "${esc(m.given)}"</span>`;
      return `<div class="card flat pad-s" style="background:var(--paper-2);border:none;margin-bottom:10px">
        <div class="row between wrap" style="gap:8px">
          <div class="grow">
            <div class="row wrap" style="gap:10px;align-items:baseline">
              <b style="font-size:1.25rem;letter-spacing:.05em">${esc(m.word)}</b>
              ${chip}
            </div>
            ${m.mode === 'meaning' ? `<p class="small muted" style="margin:6px 0 0">It means: ${esc(wd.kidMeaning || wd.meaning || '')}</p>` : ''}
            ${m.analysis && m.analysis.soundsRight
              ? `<p class="small" style="margin:6px 0 0">That's how it sounds — the letters just work differently.</p>` : ''}
            ${m.analysis && m.analysis.note ? `<p class="small muted" style="margin:4px 0 0">Slip: ${esc(m.analysis.note)}</p>` : ''}
            <p class="small muted" style="margin:4px 0 0" data-trick="${esc(m.wordId)}">${
              wd.memoryTrick ? esc(wd.memoryTrick) : (wd.trickyBit ? 'Watch out for ' + esc(wd.trickyBit) : '')}</p>
          </div>
          <button class="btn-ghost btn-icon" data-say="${esc(m.word)}">${Icon.icon('speaker',{size:17})}</button>
        </div>
      </div>`;
    }).join('');
    window.U.$$('#missList [data-say]').forEach(b => b.onclick = () => window.U.speak(b.dataset.say));
  }

  /* ---------------------------------------------------- API: coach misses */
  async function coachMisses(misses) {
    if (!misses || !misses.length || !API.hasKey()) return;
    // Only words that have never had a trick generated — one call per word, ever.
    // Capped at six: the whole batch is one request, so a long list would leave
    // her watching a spinner. The rest get coached next time they come up.
    let need = [];
    misses.forEach(m => {
      const wd = Store.db.words[m.wordId];
      if (wd && !wd.memoryTrick && !need.some(n => n.id === wd.id)) {
        const pr = Store.db.progress[wd.id] || {};
        need.push({ id: wd.id, word: wd.word, meaning: wd.meaning,
                    misses: (pr.wrong || 0), herSpellings: (pr.misspellings || []).slice(-3) });
      }
    });
    need = need.sort((a, b) => b.misses - a.misses).slice(0, 6);
    if (!need.length) return;

    const spin = $('#trickSpin');
    if (spin) spin.innerHTML = `<span class="loader"></span><span class="small faint">Ara is thinking of a way to remember ${need.length === 1 ? 'that word' : 'these'}…</span>`;

    try {
      const tricks = await API.memoryTricks(need);
      tricks.forEach(t => {
        const wd = Store.allWords().find(x => Store.wordKey(x.word) === Store.wordKey(t.word));
        if (wd) { wd.memoryTrick = t.memoryTrick; if (t.whyTricky) wd.whyTricky = t.whyTricky; }
      });
      Store.save(true); UI.syncVault();
      if (spin) spin.innerHTML = '';
      // refresh the visible list so she sees the tricks appear
      tricks.forEach(t => {
        const wd = Store.allWords().find(x => Store.wordKey(x.word) === Store.wordKey(t.word));
        if (!wd) return;
        const p = document.querySelector(`[data-trick="${wd.id}"]`);
        if (p) { p.innerHTML = esc(t.memoryTrick); p.classList.add('pop'); }
      });
    } catch (e) {
      if (spin) spin.innerHTML = '';
      console.warn('memoryTricks failed', e);   // silent for the child
    }
  }

  async function topUpIfNeeded(pool) {
    if (!API.hasKey()) return;
    const need = Engine.needTopUp(pool, 10);
    if (need.length < 3) return;                 // batch it — don't call for one word
    try {
      const items = need.map(wd => {
        const pr = Store.db.progress[wd.id] || {};
        return {
          word: wd.word, meaning: wd.meaning,
          existingClues: (wd.clues || []).slice(-4),
          existingMisspellings: (wd.misspellings || []).slice(-6),
          childWrote: (pr.misspellings || []).slice(-5)   // their own errors, this child only
        };
      });
      const packs = await API.topUp(items);
      packs.forEach(p => {
        const wd = Store.allWords().find(x => Store.wordKey(x.word) === Store.wordKey(p.word));
        if (!wd) return;
        wd.clues = Store.uniq((wd.clues || []).concat(p.clues || []));
        wd.sentences = Store.uniq((wd.sentences || []).concat(p.sentences || []));
        wd.misspellings = Store.uniq((wd.misspellings || []).concat(p.misspellings || []));
        const pr = Store.ensureProgress(wd.id);
        pr.variantUse = {};                       // fresh material, fresh rotation
      });
      Store.save(true); UI.syncVault();
    } catch (e) { console.warn('topUp failed', e); }
  }

  /* ====================================================================== */
  /*  CROSSWORD                                                             */
  /* ====================================================================== */
  let xw = null;

  function startCrossword(pool) {
    const entries = pool
      .filter(wd => Puzzles.strip(wd.word).length >= 3)
      .map(wd => ({ id: wd.id, word: wd.word, clue: wd.crosswordClue || wd.kidMeaning || wd.meaning }));
    if (entries.length < 4) { toast('Need at least 4 words for a crossword.'); return; }

    const chosen = Engine.pickWords(pool, Math.min(12, entries.length), { confidenceShare: 0.3 })
      .map(wd => entries.find(e => e.id === wd.id)).filter(Boolean);

    const grid = Puzzles.bestCrossword(chosen.length >= 4 ? chosen : entries.slice(0, 10), Date.now() % 100000);
    if (!grid) { toast('Could not build a crossword from these words — try more words.'); return; }

    xw = { grid, pool, started: Date.now(), checked: 0, solved: new Set() };
    UI.go('puzzle');
    paintCrossword();
  }

  function paintCrossword() {
    const scr = $('#scr-puzzle');
    const g = xw.grid;
    scr.innerHTML = `
      <div class="row between"><button class="btn-quiet btn-s" id="quit">← Stop</button>
        <span class="pill sky">${Icon.icon('puzzle',{size:14})} ${g.entries.length} words</span></div>
      <h1>Crossword</h1>
      <p class="muted small">Tap a clue, then type. Multi-word answers go in without spaces.</p>
      <div class="card xw-wrap">
        <table class="xw">${
          g.cells.map((row, r) => `<tr>${row.map((c, col) =>
            c ? `<td class="cell" data-r="${r}" data-c="${col}">${c.num ? `<span class="num">${c.num}</span>` : ''}<input maxlength="1" data-r="${r}" data-c="${col}"></td>`
              : `<td class="blank"></td>`).join('')}</tr>`).join('')}
        </table>
      </div>
      <div class="clues">
        <div><h3>Across</h3><ol id="acr">${g.across.map(e =>
          `<li value="${e.num}" data-id="${e.id}" data-dir="across">${esc(e.clue)} <span class="faint tiny">(${e.letters.length})</span></li>`).join('')}</ol></div>
        <div><h3>Down</h3><ol id="dwn">${g.down.map(e =>
          `<li value="${e.num}" data-id="${e.id}" data-dir="down">${esc(e.clue)} <span class="faint tiny">(${e.letters.length})</span></li>`).join('')}</ol></div>
      </div>
      <div class="row center wrap" style="gap:10px;margin:22px 0">
        <button class="btn-ghost" id="checkBtn">Check my answers</button>
        <button class="btn-ghost btn-s" id="revealBtn">Show me one word</button>
        <button class="btn-primary" id="doneBtn">I'm finished →</button>
      </div>`;

    $('#quit').onclick = () => UI.go('home');

    const inputs = window.U.$$('.xw input');
    inputs.forEach(inp => {
      window.U.noAutoCorrect(inp);
      inp.oninput = () => {
        inp.value = inp.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
        if (inp.value) moveNext(inp);
        markSolved();
      };
      inp.onfocus = () => highlight(inp);
      inp.onkeydown = e => {
        if (e.key === 'Backspace' && !inp.value) movePrev(inp);
        if (e.key === 'ArrowRight') step(inp, 0, 1);
        if (e.key === 'ArrowLeft') step(inp, 0, -1);
        if (e.key === 'ArrowDown') step(inp, 1, 0);
        if (e.key === 'ArrowUp') step(inp, -1, 0);
      };
    });

    let dir = 'across';
    function cellAt(r, c) { return document.querySelector(`.xw input[data-r="${r}"][data-c="${c}"]`); }
    function step(inp, dr, dc) {
      const r = +inp.dataset.r, c = +inp.dataset.c;
      const n = cellAt(r + dr, c + dc); if (n) n.focus();
    }
    function moveNext(inp) { step(inp, dir === 'across' ? 0 : 1, dir === 'across' ? 1 : 0); }
    function movePrev(inp) { step(inp, dir === 'across' ? 0 : -1, dir === 'across' ? -1 : 0); }

    function highlight(inp) {
      window.U.$$('.xw td.cell').forEach(td => td.classList.remove('hl'));
      const r = +inp.dataset.r, c = +inp.dataset.c;
      const entry = g.entries.find(e => e.dir === dir && inRange(e, r, c)) ||
                    g.entries.find(e => inRange(e, r, c));
      if (!entry) return;
      dir = entry.dir;
      for (let i = 0; i < entry.letters.length; i++) {
        const rr = entry.row + (entry.dir === 'down' ? i : 0);
        const cc = entry.col + (entry.dir === 'across' ? i : 0);
        const td = document.querySelector(`.xw td[data-r="${rr}"][data-c="${cc}"]`);
        if (td) td.classList.add('hl');
      }
    }
    function inRange(e, r, c) {
      if (e.dir === 'across') return e.row === r && c >= e.col && c < e.col + e.letters.length;
      return e.col === c && r >= e.row && r < e.row + e.letters.length;
    }

    window.U.$$('#acr li, #dwn li').forEach(li => li.onclick = () => {
      const e = g.entries.find(x => x.id === li.dataset.id && x.dir === li.dataset.dir);
      if (!e) return;
      dir = e.dir;
      const inp = cellAt(e.row, e.col); if (inp) { inp.focus(); highlight(inp); }
    });

    function readEntry(e) {
      let out = '';
      for (let i = 0; i < e.letters.length; i++) {
        const rr = e.row + (e.dir === 'down' ? i : 0);
        const cc = e.col + (e.dir === 'across' ? i : 0);
        const inp = cellAt(rr, cc);
        out += (inp && inp.value) ? inp.value.toUpperCase() : ' ';
      }
      return out;
    }

    function markSolved() {
      g.entries.forEach(e => {
        const got = readEntry(e);
        const li = document.querySelector(`[data-id="${e.id}"][data-dir="${e.dir}"]`);
        if (got === e.letters) { xw.solved.add(e.id + e.dir); if (li) li.classList.add('solved'); }
        else { xw.solved.delete(e.id + e.dir); if (li) li.classList.remove('solved'); }
      });
    }

    $('#checkBtn').onclick = () => {
      xw.checked++;
      let right = 0, wrong = 0;
      g.entries.forEach(e => {
        const got = readEntry(e);
        for (let i = 0; i < e.letters.length; i++) {
          const rr = e.row + (e.dir === 'down' ? i : 0);
          const cc = e.col + (e.dir === 'across' ? i : 0);
          const td = document.querySelector(`.xw td[data-r="${rr}"][data-c="${cc}"]`);
          const inp = cellAt(rr, cc);
          if (!td || !inp || !inp.value) continue;
          td.classList.remove('ok', 'no');
          if (inp.value.toUpperCase() === e.letters[i]) td.classList.add('ok');
          else td.classList.add('no');
        }
        if (got === e.letters) right++; else if (got.trim()) wrong++;
      });
      toast(`${right} of ${g.entries.length} words correct`, right === g.entries.length ? 'good' : '');
      markSolved();
    };

    $('#revealBtn').onclick = () => {
      const unsolved = g.entries.filter(e => !xw.solved.has(e.id + e.dir));
      if (!unsolved.length) return toast('All done already!');
      const e = unsolved[Math.floor(Math.random() * unsolved.length)];
      for (let i = 0; i < e.letters.length; i++) {
        const rr = e.row + (e.dir === 'down' ? i : 0);
        const cc = e.col + (e.dir === 'across' ? i : 0);
        const inp = cellAt(rr, cc); if (inp) inp.value = e.letters[i];
      }
      markSolved();
      toast('There you go — ' + e.word);
    };

    $('#doneBtn').onclick = () => finishCrossword(readEntry);
  }

  function finishCrossword(readEntry) {
    const g = xw.grid;
    let correct = 0;
    const misses = [];
    g.entries.forEach(e => {
      const got = readEntry(e).trim();
      const wd = Store.db.words[e.id];
      const ok = readEntry(e) === e.letters;
      if (ok) correct++;
      else if (wd) misses.push({ wordId: wd.id, word: wd.word, given: got, analysis: got ? Phonics.analyse(wd.word, got) : null, mode: 'crossword' });
      if (wd) {
        Engine.record({ wordId: wd.id, word: wd.word, mode: 'crossword', kind: 'type', answer: wd.word },
          got || '', ok, ok && xw.checked === 0, Date.now() - xw.started, 'xw');
      }
    });

    const total = g.entries.length;
    const pctRight = correct / total;
    const stars = Engine.stars(pctRight);
    const points = correct * 12 + stars * 12;
    const before = Game.levelFor(Store.db.game.points);
    Game.awardPoints(points);
    const after = Game.levelFor(Store.db.game.points);

    const res = Game.finishSession({
      kind: 'crossword', preset: 'crossword', label: 'Crossword',
      total, correct, points, stars, ms: Date.now() - xw.started, complete: correct === total
    });
    Store.save(true); UI.checkpointVault();

    const sess = { preset: 'crossword', pool: xw.pool, qs: new Array(total), correct,
                   misses, bestCombo: 0, weekIds: [], label: 'Crossword' };
    xw = null;
    paintResult(sess, { total, pctRight, stars, bonus: stars * 12, totalPoints: points,
                        levelUp: after > before, level: after, res });
    coachMisses(misses);
  }

  /* ======================================================================
     WORD RUSH — the typing game.

     Writing a word out twenty times as an imposition teaches almost nothing,
     because after the third line the hand is copying and the brain has left.
     This does the opposite: it takes the scaffold AWAY, one step at a time.

        1. COPY IT     the word sits above the box — she types what she sees
        2. QUICK PEEK  it shows for two seconds, then vanishes mid-word
        3. FROM MEMORY only the meaning and Ara's voice

     That fade is the whole trick — copying builds the motor pattern, and
     removing the model forces retrieval, which is what actually fixes spelling.
     It reads as a typing game because it IS one: live per-letter colour,
     words-per-minute, an accuracy meter and a combo counter.
     Only stage 3 counts as a real test in her records; stages 1 and 2 are
     practice, so copying never inflates her scores.
     ====================================================================== */
  let rush = null;

  /* Two levels, not three — copying it once and then writing it from memory
     is enough. Three passes plus slip-backs meant the same word four or five
     times in a row, which stops feeling like a game. */
  const RUSH_STAGES = [
    { key: 'copy',   label: 'Copy it',     hint: 'Type what you see.' },
    { key: 'memory', label: 'From memory', hint: 'No looking. You have got this.' }
  ];

  function startRush(pool, opts) {
    const o = opts || {};
    const words = Engine.pickWords(pool, Math.min(o.count || 6, pool.length), { confidenceShare: 0.25 });
    if (words.length < 2) { toast('Not enough words for a rush.'); return; }

    rush = {
      pool,
      queue: words.map(wd => ({ wd, stage: 0, cleared: false, slips: 0 })),
      at: 0,
      typed: '',
      started: Date.now(),
      keystrokes: 0,
      hits: 0,
      combo: 0,
      bestCombo: 0,
      points: 0,
      cleared: 0,
      recalls: 0,
      recallOk: 0,
      peekTimer: null,
      sessionId: Store.uid('s')
    };
    UI.go('puzzle');
    paintRush();
  }

  function rushCurrent() {
    if (!rush) return null;
    // next unfinished word, wrapping round
    for (let i = 0; i < rush.queue.length; i++) {
      const idx = (rush.at + i) % rush.queue.length;
      if (!rush.queue[idx].cleared) { rush.at = idx; return rush.queue[idx]; }
    }
    return null;
  }

  function paintRush() {
    const scr = $('#scr-puzzle');
    const item = rushCurrent();
    if (!item) return finishRush();

    const wd = item.wd;
    const stage = RUSH_STAGES[item.stage];
    const showWord = item.stage === 0;
    const elapsed = Math.max(1, (Date.now() - rush.started) / 60000);
    const wpm = Math.round((rush.hits / 5) / elapsed);
    const acc = rush.keystrokes ? Math.round(rush.hits / rush.keystrokes * 100) : 100;

    scr.innerHTML = `
      <div class="row between">
        <button class="btn-quiet btn-s" id="quit">← Stop</button>
        <div class="row" style="gap:6px">
          <span class="pill sky">${Icon.icon('keys',{size:14})} <b id="wpm">${wpm}</b> wpm</span>
          <span class="pill sage">${Icon.icon('target',{size:14})} <b id="acc">${acc}</b>%</span>
          <span class="pill honey">${Icon.icon('star',{size:14})} <b id="pts">${rush.points}</b></span>
          ${rush.combo >= 3 ? `<span class="pill coral">${Icon.icon('flame',{size:14})} ${rush.combo}</span>` : ''}
        </div>
      </div>

      <h1 style="margin-bottom:2px">Word Rush</h1>
      <p class="muted small" style="margin-top:0">Copy it once, then write it from memory — two levels and the word is yours.</p>

      <div class="card glow" style="text-align:center" id="rushCard">
        <div class="rush-stage">
          ${RUSH_STAGES.map((s, k) =>
            `<span class="${k < item.stage ? 'done' : k === item.stage ? 'on' : ''}">${esc(s.label)}</span>`).join('')}
        </div>
        <p class="small faint" style="margin:8px 0 0">${esc(stage.hint)}</p>

        <div class="rush-bubble-wrap">
          <div class="rush-bubble" id="bubble">
            ${showWord
              ? `<div class="rush-target" id="target">${esc(wd.word)}</div>`
              : `<div style="max-width:420px">
                   <p style="font-size:1.02rem;line-height:1.5;margin:0">${esc(wd.kidMeaning || wd.meaning)}</p>
                 </div>`}
          </div>
        </div>
        ${showWord ? '' : `<button class="btn-ghost btn-s" id="hear">Hear it again</button>`}

        <div class="rush-type" id="type"></div>

        <input class="rush-input" id="rushIn" autocomplete="off" autocorrect="off"
               autocapitalize="off" spellcheck="false" inputmode="text">
        <div class="rush-tap" id="tapHere">Tap here and start typing </div>

        <div class="row center wrap" style="gap:8px;margin-top:14px">
          <button class="btn-ghost btn-s" id="say">Say it</button>
          <button class="btn-ghost btn-s" id="spellIt">Spell it to me</button>
          ${window.U.speedBtn()}
          ${item.stage > 0 ? `<button class="btn-ghost btn-s" id="peek">Show me (costs the combo)</button>` : ''}
          <button class="btn-quiet btn-s" id="skip">Skip this one</button>
        </div>
      </div>

      <div class="rush-queue">
        ${rush.queue.map((q, k) => `<span class="${q.cleared ? 'cleared' : k === rush.at ? 'active' : ''}">
          ${q.cleared ? ' ' : ''}${esc(q.wd.word)}${q.cleared ? '' : ' · ' + (q.stage + 1) + '/2'}</span>`).join('')}
      </div>

      <p class="center-text small faint" style="margin-top:16px">
        ${rush.cleared} of ${rush.queue.length} words cleared</p>`;

    const el = sel => scr.querySelector(sel);
    el('#quit').onclick = confirmQuitRush;
    el('#say').onclick = () => window.U.speak(wd.word);
    el('#spellIt').onclick = () => window.U.spellOut(wd.word);
    el('#skip').onclick = () => { rush.at = (rush.at + 1) % rush.queue.length; rush.typed = ''; paintRush(); };
    if (el('#hear')) el('#hear').onclick = () => window.U.speak(wd.word);
    if (el('#peek')) el('#peek').onclick = () => {
      rush.combo = 0;
      const t = $('#target') || window.U.el('div');
      toast(wd.word, '', 1600);
      window.U.speak(wd.word);
    };

    rush.typed = '';
    paintRushLetters();

    const input = $('#rushIn');
    const focusIn = () => { input.focus({ preventScroll: true }); };
    $('#tapHere').onclick = focusIn;
    $('#rushCard').onclick = e => { if (!e.target.closest('button')) focusIn(); };
    setTimeout(focusIn, 120);

    input.oninput = () => { handleRushInput(input.value); };
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); handleRushInput(input.value, true); }
    };
    input.onblur = () => { const t = $('#tapHere'); if (t) t.style.borderColor = 'var(--coral)'; };
    input.onfocus = () => { const t = $('#tapHere'); if (t) { t.style.borderColor = 'var(--line)'; t.textContent = 'Keep typing…'; } };

    clearTimeout(rush.peekTimer);
    if (item.stage === 1) setTimeout(() => window.U.speak(wd.word), 320);
    /* The first time a word appears it introduces itself properly — the word,
       then what it means. Once per word, and only from the sheet's own
       meaning; nothing is invented. */
    if (item.stage === 0 && !item.introduced) {
      item.introduced = true;
      setTimeout(() => window.U.speak(wd.word, {
        onend: () => setTimeout(() => window.U.speak(wd.kidMeaning || wd.meaning || '', { rate: 0.92 }), 280)
      }), 320);
    }
  }

  /** Live per-letter echo — green for right, red for wrong, amber on the cursor. */
  function paintRushLetters() {
    const item = rushCurrent(); if (!item) return;
    const target = item.wd.word;
    const typed = rush.typed;
    const box = $('#type'); if (!box) return;

    box.innerHTML = target.split('').map((ch, i) => {
      if (ch === ' ') return `<span class="rush-ch space"></span>`;
      const got = typed[i];
      let cls = '';
      if (got != null) cls = got.toLowerCase() === ch.toLowerCase() ? 'hit' : 'miss';
      else if (i === typed.length) cls = 'now';
      return `<span class="rush-ch ${cls}">${esc(got != null ? got : (cls === 'now' ? '' : '·'))}</span>`;
    }).join('');
  }

  function handleRushInput(value, forced) {
    const item = rushCurrent(); if (!item) return;
    const target = item.wd.word;
    const prev = rush.typed;
    let v = String(value || '');

    // count keystrokes as they arrive, and score each new letter
    if (v.length > prev.length) {
      for (let i = prev.length; i < v.length; i++) {
        rush.keystrokes++;
        const want = target[i];
        if (want != null && v[i] && v[i].toLowerCase() === want.toLowerCase()) {
          rush.hits++; rush.combo++;
          rush.bestCombo = Math.max(rush.bestCombo, rush.combo);
        } else {
          rush.combo = 0;
          window.U.beep('bad');
        }
      }
    }
    rush.typed = v;
    paintRushLetters();

    const done = v.length >= target.replace(/\s/g, '').length || v.length >= target.length;
    const match = Phonics.clean(v) === Phonics.clean(target);

    if (match && (done || forced || v.length >= target.length)) return rushWordDone(item, true);
    if (forced && !match) return rushWordDone(item, false);
    // typed the full length but wrong
    if (v.length >= target.length && !match) return rushWordDone(item, false);
  }

  function rushWordDone(item, ok) {
    const input = $('#rushIn'); if (input) input.value = '';
    const isRecall = item.stage === 1;

    if (isRecall) {
      rush.recalls++;
      if (ok) rush.recallOk++;
      // Only the from-memory round goes into her records — copying is not a test.
      Engine.record(
        { wordId: item.wd.id, word: item.wd.word, mode: 'rush', kind: 'type', answer: item.wd.word },
        rush.typed, ok, ok, 0, rush.sessionId
      );
    }

    if (ok) {
      const gain = [5, 14][item.stage] + Math.min(8, Math.floor(rush.combo / 4));
      rush.points += gain;
      window.U.beep(item.stage === 1 ? 'great' : 'good');
      window.U.speak(item.wd.word);
      const card = $('#rushCard');
      if (card) {
        const r = card.getBoundingClientRect();
        floatPoints('+' + gain, r.left + r.width / 2, r.top + 60);
      }
      popBubble();
      if (item.stage >= 1) {
        item.cleared = true;
        rush.cleared++;
        confetti(40);
        toast(`${item.wd.word} — locked in! `, 'good', 1800);
      } else {
        item.stage++;
      }
    } else {
      item.slips++;
      rush.combo = 0;
      window.U.beep('bad');
      // stay on the same level and simply try again — never punitive, and
      // never the same word five times over
      const card = $('#rushCard');
      if (card) { card.classList.add('shake'); setTimeout(() => card.classList.remove('shake'), 450); }
      toast('Not quite — let’s look at it again', 'bad', 1500);
    }

    rush.typed = '';
    setTimeout(paintRush, ok && item.cleared ? 700 : 450);
  }

  /** Burst the bubble into a scatter of dots. Pure delight, no logic attached. */
  function popBubble() {
    const b = $('#bubble');
    if (!b) return;
    const wrap = b.parentElement;
    const cols = ['#E8A33D', '#6B9080', '#E07A5F', '#9B8AA6', '#5B8FA8'];
    const r = b.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    for (let i = 0; i < 14; i++) {
      const s = window.U.el('div', { class: 'rush-spark' });
      const ang = (Math.PI * 2 * i) / 14;
      const dist = 60 + Math.random() * 60;
      s.style.background = cols[i % cols.length];
      s.style.left = (r.left - wr.left + r.width / 2) + 'px';
      s.style.top = (r.top - wr.top + r.height / 2) + 'px';
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      wrap.appendChild(s);
      setTimeout(() => s.remove(), 700);
    }
    b.classList.add('pop');
  }

  async function confirmQuitRush() {
    const yes = await window.U.confirmBox('Stop the rush?',
      'Everything you cleared so far still counts.', 'Yes, stop');
    if (yes) finishRush();
  }

  function finishRush() {
    if (!rush) return;
    clearTimeout(rush.peekTimer);
    const r = rush; rush = null;

    const total = r.recalls || r.queue.length;
    const correct = r.recalls ? r.recallOk : r.cleared;
    const pctRight = total ? correct / total : 0;
    const stars = r.cleared === r.queue.length ? 3 : Engine.stars(r.cleared / r.queue.length);
    const points = r.points + stars * 12;
    const before = Game.levelFor(Store.db.game.points);
    Game.awardPoints(points);
    const after = Game.levelFor(Store.db.game.points);

    const mins = Math.max(1, (Date.now() - r.started) / 60000);
    const wpm = Math.round((r.hits / 5) / mins);
    const acc = r.keystrokes ? Math.round(r.hits / r.keystrokes * 100) : 100;

    const res = Game.finishSession({
      kind: 'rush', preset: 'rush', label: 'Word Rush',
      total: r.queue.length, correct: r.cleared, points, stars,
      ms: Date.now() - r.started, complete: r.cleared === r.queue.length
    });
    Store.save(true); UI.checkpointVault();

    const sess = {
      preset: 'rush', pool: r.pool, qs: new Array(r.queue.length), correct: r.cleared,
      misses: [], bestCombo: r.bestCombo, weekIds: [], label: 'Word Rush',
      rushStats: { wpm, acc, keystrokes: r.keystrokes, cleared: r.cleared, of: r.queue.length }
    };
    paintResult(sess, {
      total: r.queue.length, pctRight: r.cleared / r.queue.length, stars,
      bonus: stars * 12, totalPoints: points, levelUp: after > before, level: after, res
    });
  }

  /* ====================================================================== */
  /*  WORD SEARCH                                                           */
  /* ====================================================================== */
  let ws = null;

  function startWordSearch(pool) {
    const chosen = Engine.pickWords(pool, Math.min(10, pool.length), { confidenceShare: 0.3 });
    const built = Puzzles.wordsearch(chosen, Date.now() % 100000, { backwards: true });
    if (!built.words.length) { toast('Could not build a word search.'); return; }
    ws = { built, pool, found: new Set(), started: Date.now(), sel: [] };
    UI.go('puzzle');
    paintWordSearch();
  }

  function paintWordSearch() {
    const scr = $('#scr-puzzle');
    const b = ws.built;
    scr.innerHTML = `
      <div class="row between"><button class="btn-quiet btn-s" id="quit">← Stop</button>
        <span class="pill sky">${Icon.icon('search',{size:14})} <b id="foundN">0</b>/${b.words.length}</span></div>
      <h1>Word Search</h1>
      <p class="muted small">Drag across the letters — words can go in any direction, even backwards.</p>
      <div class="card" style="overflow:auto">
        <table class="ws" id="wsGrid">${
          b.grid.map((row, r) => `<tr>${row.map((ch, c) =>
            `<td data-r="${r}" data-c="${c}">${ch}</td>`).join('')}</tr>`).join('')}
        </table>
      </div>
      <div class="card" style="margin-top:14px">
        <h3>Find these</h3>
        <div class="row wrap" style="gap:8px;margin-top:8px" id="wsList">
          ${b.words.map(x => `<span class="pill" data-w="${esc(x.id)}">${esc(x.word)}</span>`).join('')}
        </div>
      </div>
      <div class="row center" style="margin:22px 0;gap:10px">
        <button class="btn-primary" id="doneBtn">I'm finished →</button>
      </div>`;

    $('#quit').onclick = () => UI.go('home');
    $('#doneBtn').onclick = finishWordSearch;

    const grid = $('#wsGrid');
    let dragging = false, startCell = null;

    const cellFrom = (target) => target && target.tagName === 'TD' ? target : null;
    const pointCell = (e) => {
      const t = e.touches ? document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY) : e.target;
      return cellFrom(t);
    };

    function clearSel() { window.U.$$('#wsGrid td.sel').forEach(t => t.classList.remove('sel')); }

    function lineBetween(a, b) {
      const r1 = +a.dataset.r, c1 = +a.dataset.c, r2 = +b.dataset.r, c2 = +b.dataset.c;
      const dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1);
      const len = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) + 1;
      // must be a straight line: horizontal, vertical or exact diagonal
      if (!(r1 === r2 || c1 === c2 || Math.abs(r2 - r1) === Math.abs(c2 - c1))) return null;
      const cells = [];
      for (let i = 0; i < len; i++) {
        const td = document.querySelector(`#wsGrid td[data-r="${r1 + dr * i}"][data-c="${c1 + dc * i}"]`);
        if (!td) return null;
        cells.push(td);
      }
      return cells;
    }

    function begin(e) {
      const td = pointCell(e); if (!td) return;
      dragging = true; startCell = td; clearSel(); td.classList.add('sel');
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      const td = pointCell(e); if (!td) return;
      const cells = lineBetween(startCell, td);
      if (!cells) return;
      clearSel(); cells.forEach(c => c.classList.add('sel'));
      e.preventDefault();
    }
    function end() {
      if (!dragging) return;
      dragging = false;
      const sel = window.U.$$('#wsGrid td.sel');
      const text = sel.map(t => t.textContent).join('');
      const rev = text.split('').reverse().join('');
      const hit = b.words.find(x => !ws.found.has(x.id) && (x.letters === text || x.letters === rev));
      if (hit) {
        ws.found.add(hit.id);
        sel.forEach(t => { t.classList.remove('sel'); t.classList.add('found'); });
        const pill = document.querySelector(`#wsList [data-w="${hit.id}"]`);
        if (pill) { pill.classList.add('sage'); pill.style.textDecoration = 'line-through'; }
        $('#foundN').textContent = ws.found.size;
        window.U.beep('good');
        window.U.speak(hit.word);
        const wd = Store.db.words[hit.id];
        if (wd) Engine.record({ wordId: wd.id, word: wd.word, mode: 'wordsearch', kind: 'choice', answer: wd.word },
          wd.word, true, true, 0, 'ws');
        if (ws.found.size === b.words.length) { confetti(110); setTimeout(finishWordSearch, 700); }
      } else {
        clearSel();
      }
    }

    grid.addEventListener('mousedown', begin);
    grid.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    grid.addEventListener('touchstart', begin, { passive: false });
    grid.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
  }

  function finishWordSearch() {
    if (!ws) return;
    const b = ws.built;
    const correct = ws.found.size, total = b.words.length;
    const pctRight = correct / total;
    const stars = Engine.stars(pctRight);
    const points = correct * 8 + stars * 10;
    const before = Game.levelFor(Store.db.game.points);
    Game.awardPoints(points);
    const after = Game.levelFor(Store.db.game.points);
    const res = Game.finishSession({
      kind: 'wordsearch', preset: 'wordsearch', label: 'Word Search',
      total, correct, points, stars, ms: Date.now() - ws.started, complete: correct === total
    });
    Store.save(true); UI.checkpointVault();
    const sess = { preset: 'wordsearch', pool: ws.pool, qs: new Array(total), correct,
                   misses: [], bestCombo: 0, weekIds: [], label: 'Word Search' };
    ws = null;
    paintResult(sess, { total, pctRight, stars, bonus: stars * 10, totalPoints: points,
                        levelUp: after > before, level: after, res });
  }

  w.Quiz = { start, startCrossword, startWordSearch, startRush, get active() { return !!s; } };
})(window);
