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
      quest: 'Spell Quest',
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
    /* The question itself always quotes the school's definition. A child who
       is still stuck can ask for AraBuzz's own way of describing it — here,
       as help, rather than in place of the sheet's words. */
    const extra = q.meta && q.meta.extraClue;
    const line = bits.join(' · ');
    box.innerHTML = `<div class="feedback" style="background:var(--honey-soft);border:2px solid var(--honey)">
      <b class="ichip">${Icon.icon('sparkle',{size:16})}<span>Hint</span></b>
      <p style="margin:6px 0 0">${line}
        <button type="button" class="btn-quiet btn-icon" data-say-text="${esc(line.replace(/<[^>]*>/g, ''))}"
          title="Read the hint to me">${Icon.icon('speaker',{size:15})}</button></p>
      ${extra ? `<p class="small" style="margin:8px 0 0">💡 Another way to think about it:
        <i>${esc(extra)}</i>
        <button type="button" class="btn-quiet btn-icon" data-say-text="${esc(extra)}"
          title="Read this to me">${Icon.icon('speaker',{size:15})}</button></p>` : ''}</div>`;
    window.U.speak(line.replace(/<[^>]*>/g, '') + (extra ? '. ' + extra : ''));
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
    const refreshMini = gridFeedback(g, (r, c) =>
      body.querySelector(`.xw td[data-r="${r}"][data-c="${c}"]`));
    window.U.$$('.xw input', body).forEach(inp => {
      window.U.noAutoCorrect(inp);
      inp.oninput = () => {
        inp.value = inp.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
        if (inp.value) {
          const r = +inp.dataset.r, c = +inp.dataset.c;
          const n = cellAt(r, c + 1) || cellAt(r + 1, c);
          if (n) n.focus();
        }
        refreshMini();
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
        if (wd && countsAsAttempt(wd.word, got.trim(), ok)) {
          Engine.record({ wordId: wd.id, word: wd.word, mode: 'crossword', kind: 'type', answer: wd.word },
            got.trim(), ok, ok, 0, s.id);
        }
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
    /* A correction should reach her ears as well as her eyes: the word,
       slowly, then the one thing worth remembering about it. */
    if (!ok) setTimeout(() => {
      window.U.speak(wd.word, { rate: 0.65, onend: () => {
        const tip = wd.trickyBit || '';
        if (tip) setTimeout(() => window.U.speak(tip, { rate: 0.9 }), 260);
      } });
    }, 320);
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

  /* ------------------------------------------------------- grid feedback --
     Sitting with Aradhana it was obvious that the crossword told her nothing
     where she was looking. She would finish a word, the clue underneath the
     grid would go green and get a line through it, and the squares her eyes
     were actually on would sit there unchanged. So she kept checking the
     clue list to find out whether she had got it — which is exactly the
     break in flow the game is supposed to avoid.

     This paints the answer into the squares:

       right          the whole word turns green and stays green, the letters
                      pop out one after another, and a small burst of specks
                      goes off over that word. Half a second, local to the
                      word, nothing covering the screen.

       finished, not right
                      the squares go a soft red. Quietly — no sound, no
                      movement. And only once every square of that word has
                      a letter in it, so she is never told she is wrong
                      halfway through writing.

       still writing  nothing at all.

     Where an across and a down cross, green wins: a letter that is doing its
     job in one word should not be painted as a mistake because the other
     word through it is not finished yet.

     Shared by the full crossword and the bonus grid inside Mixed Buzz. */
  function gridFeedback(grid, tdAt) {
    const celebrated = new Set();

    function cellsOf(e) {
      const out = [];
      for (let i = 0; i < e.letters.length; i++) {
        const rr = e.row + (e.dir === 'down' ? i : 0);
        const cc = e.col + (e.dir === 'across' ? i : 0);
        out.push(tdAt(rr, cc));
      }
      return out;
    }

    function celebrate(cells) {
      const boxes = [];
      cells.forEach((td, i) => {
        if (!td) return;
        td.classList.remove('pop');
        void td.offsetWidth;                       // restart the animation
        td.style.animationDelay = (i * 45) + 'ms';
        const inp = td.querySelector('input');
        if (inp) inp.style.animationDelay = (i * 45) + 'ms';
        td.classList.add('pop');
        boxes.push(td.getBoundingClientRect());
        setTimeout(() => {
          td.classList.remove('pop');
          td.style.animationDelay = '';
          if (inp) inp.style.animationDelay = '';
        }, 900 + i * 45);
      });
      if (!boxes.length) return;
      const left = Math.min.apply(null, boxes.map(b => b.left));
      const top = Math.min.apply(null, boxes.map(b => b.top));
      const right = Math.max.apply(null, boxes.map(b => b.right));
      const bottom = Math.max.apply(null, boxes.map(b => b.bottom));
      window.U.sparkle({ left, top, width: right - left, height: bottom - top },
                       6 + boxes.length * 2);
      window.U.beep('good');
    }

    return function refresh() {
      /* Three states, not two. Prem watched the whole word go one flat red
         and asked the obvious question: which letter was the mistake? So a
         finished-but-wrong word now answers it — the letters that are right
         keep the soft wash, and only the letters that are actually wrong get
         the stronger mark. She fixes the marked ones instead of retyping the
         word and guessing. */
      const green = new Set(), red = new Set(), miss = new Set(), fresh = [];

      grid.entries.forEach(e => {
        const key = e.id + '|' + e.dir;
        const cells = cellsOf(e);
        let got = '', filled = 0;
        cells.forEach(td => {
          const inp = td && td.querySelector('input');
          const v = (inp && inp.value) ? inp.value.toUpperCase() : '';
          if (v) filled++;
          got += v || ' ';
        });
        if (got === e.letters) {
          cells.forEach(td => { if (td) green.add(td); });
          if (!celebrated.has(key)) { celebrated.add(key); fresh.push(cells); }
        } else {
          celebrated.delete(key);                  // she changed it — it may win again
          if (filled === e.letters.length) {
            cells.forEach((td, i) => {
              if (!td) return;
              red.add(td);
              if (got[i] !== e.letters[i]) miss.add(td);
            });
          }
        }
      });

      grid.entries.forEach(e => cellsOf(e).forEach(td => {
        if (!td) return;
        const isGreen = green.has(td);
        td.classList.toggle('won', isGreen);
        td.classList.toggle('softno', !isGreen && red.has(td));
        /* A crossing letter that is doing its job in a solved word is never
           marked as anyone's mistake. */
        td.classList.toggle('miss', !isGreen && miss.has(td));
      }));

      fresh.forEach(celebrate);
    };
  }

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

    const refreshGrid = gridFeedback(g, (r, c) =>
      document.querySelector(`.xw td[data-r="${r}"][data-c="${c}"]`));

    function markSolved() {
      g.entries.forEach(e => {
        const got = readEntry(e);
        const li = document.querySelector(`[data-id="${e.id}"][data-dir="${e.dir}"]`);
        if (got === e.letters) { xw.solved.add(e.id + e.dir); if (li) li.classList.add('solved'); }
        else { xw.solved.delete(e.id + e.dir); if (li) li.classList.remove('solved'); }
      });
      refreshGrid();
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
          /* Only the letters that are wrong need calling out here — the ones
             that are right are already green from the live paint. */
          if (inp.value.toUpperCase() !== e.letters[i]) td.classList.add('no');
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
      if (wd && countsAsAttempt(wd.word, got, ok)) {
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
      // Only the from-memory round goes into her records — copying is not a test,
      // and neither is a hand resting on the keyboard while the timer runs out.
      if (countsAsAttempt(item.wd.word, rush.typed, ok)) {
        Engine.record(
          { wordId: item.wd.id, word: item.wd.word, mode: 'rush', kind: 'type', answer: item.wd.word },
          rush.typed, ok, ok, 0, rush.sessionId
        );
      }
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


  /* ======================================================================
     WHAT COUNTS AS AN ATTEMPT

     Aradhana's record held answers she never gave. Against "Interdependence"
     it had stored "U", "A  E" and "I T   EN  N E" — snapshots of a half-filled
     crossword grid, saved as if she had spelled the word that way. Word Rush
     had "jjjjjjjjj" and "fttttttttt", a timer running out with a hand on the
     keyboard. Thirty-one of her recorded misses were not attempts at all,
     against thirty that were.

     That is not a cosmetic problem. Those rows drive the Leitner boxes, her
     accuracy, the share of errors that "sound right", and the evidence quoted
     back at a parent in every automatic note. "Lifestyle" sat in box zero
     partly because of them, and the app was quietly reporting a 94% speller
     as a 49% one.

     A right answer is always an attempt. A wrong one has to look like a
     child trying.
     ====================================================================== */
  function countsAsAttempt(word, given, ok) {
    if (ok) return true;                       // getting it right always counts
    const raw = String(given == null ? '' : given);
    const g = raw.replace(/\s+/g, '');
    if (!g) return false;                      // nothing typed at all

    /* A grid with holes in it. The crossword fills unknown squares with
       spaces, so "A  E" and "I T   EN  N E" are pictures of the grid, not
       spellings. TWO or more spaces in a row is the tell — a single space is
       a child writing "well bying", which is a real attempt at a real word
       and must survive. */
    if (/\S\s{2,}\S/.test(raw.trim())) return false;

    /* A fragment. Fewer than half the letters is somebody who stopped, not
       somebody who spelled it wrongly. */
    const letters = String(word || '').replace(/[^a-z]/gi, '').length;
    if (letters && g.length < Math.max(3, letters * 0.5)) return false;

    /* One key held down, or a short run repeated to fill the box —
       "jjjjjjjjj", "fttttttttt", "idkidkidkidk", "lololololo". */
    if (/^(.)\1+$/i.test(g)) return false;
    if (/(.)\1{4,}/i.test(g)) return false;
    if (/(.{2,4})\1{2,}/i.test(g)) return false;

    /* A long answer built from almost no letters is a keyboard, not a word. */
    if (g.length >= 8 && new Set(g.toLowerCase()).size <= 3) return false;

    /* The alphabet, or a walk along the keyboard. */
    const low = g.toLowerCase();
    if ('abcdefghijklmnopqrstuvwxyz'.includes(low) && low.length > 4) return false;
    if (/(qwerty|asdf|zxcv|hjkl)/.test(low)) return false;

    return true;
  }

  /* ======================================================================
     SPELL QUEST — the one Aradhana asked for.

     Before AraBuzz existed she was practising by asking ChatGPT for a clue
     and typing the spelling back into the chat, one word at a time, watching
     a score climb to 14/14. She liked THAT. This is that game, built
     properly: a conversation with Ara that walks the whole week's list, one
     clue at a time, never moving on until the word is right.

     Three things make it different from the other games, and all three are
     deliberate:

       · It is a CONVERSATION, not a form. Her answer appears as her message.
       · It covers the WHOLE list, in order, and ends with "MASTERED" — a
         finish line, not a sample of ten questions.
       · It never gives up on a word. Wrong answers earn a bigger hint and
         another go; a word that beats her three times is parked and comes
         back at the end, which is exactly how her ChatGPT session went.

     Everything else is ordinary AraBuzz underneath: every answer goes through
     Engine.record, so the Leitner boxes, her own misspellings, the tricky-word
     list and the coach note all learn from it exactly as they do from Spell
     Buzz. Points, streak, badges and sync are the same too.
     ====================================================================== */
  let quest = null;

  function startQuest(pool, opts) {
    const o = opts || {};
    if (!pool || !pool.length) { toast('No words to quest with yet.'); return; }

    /* The whole list, in the order the sheet gave them — that is what makes
       it feel like finishing the week rather than sampling it. A very long
       pool (all weeks at once) is trimmed to a sitting that stays a game. */
    const MAX = 20;
    let words = pool.slice();
    if (words.length > MAX) words = Engine.pickWords(pool, MAX, { confidenceShare: 0.3 });

    quest = {
      pool,
      words,
      i: 0,
      tries: 0,
      correct: 0,
      points: 0,
      parked: [],            // words that beat her — they come back at the end
      round: 1,              // 1 = the list, 2 = the parked words
      log: [],               // the whole conversation
      started: Date.now(),
      qStart: Date.now(),
      sessionId: (window.Sync ? Sync.uuid() : Store.uid('s')),
      weekIds: o.weekIds && o.weekIds !== 'tricky' ? o.weekIds : [],
      title: o.title || questTitle(o, words)
    };

    UI.go('puzzle');
    watchNetwork();
    say(`<b>🏆 ${esc(quest.title)}</b>`);
    say(`Here is how it works: I give you a clue, you type the spelling. ` +
        `Get it and you earn a star ⭐. Miss it and I give you a hint and you have ` +
        `one more go — then I just show you, and we move on. Any word that beats me ` +
        `to it comes back before the end. 😉`);

    /* This is the one game that talks back, and talking back needs a line to
       the outside world. Say so at the door, in her language, rather than
       letting her wonder later why I have gone quiet and simple. */
    if (araIsLive()) {
      say(`You can <b>talk to me</b> in here too — ask me anything about a word and I will ` +
          `answer properly. <span class="q-from">Just this game needs the internet for that. 📶</span>`);
    } else {
      say(`⚠️ <b>No internet right now</b>, so I cannot chat properly — my hints will be ` +
          `shorter and simpler than usual. Everything still counts, and every star is ` +
          `still yours. Come back online when you can and I will be my chatty self again. 😊`, 'hint');
    }
    say(`<b>${words.length} words.</b> Ready? Here we go! 👇`);
    paintQuest();
    clearIdle();
    setTimeout(askClue, 260);
  }

  /** "The Blood Quest!" — named after the sheet, the way she named hers. */
  function questTitle(o, words) {
    const wk = (o.weekIds && o.weekIds.length === 1)
      ? (Store.db.weeks || []).find(k => k.id === o.weekIds[0]) : null;
    const topic = wk && (wk.topic || wk.title);
    if (topic) {
      const t = String(topic).replace(/\s*(spell\s*buzz|week\s*\d+)\s*/ig, '').trim();
      if (t) return `The ${t} Quest!`;
    }
    return 'Spell Quest!';
  }

  /* Every bubble carries the plain words to read aloud. A child who finds
     reading harder than spelling should never be stuck looking at a hint she
     cannot get into her head — the help moments SPEAK themselves, and every
     bubble keeps a 🔊 she can tap again. */
  const say = (html, cls, voice) => {
    if (!quest) return;
    const plain = voice != null ? String(voice)
      : String(html).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ')
          .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
          .replace(/\s+/g, ' ').trim();
    quest.log.push({ who: 'ara', html, cls: cls || '', voice: plain });
    // A correction or a hint is read out at once — that is the moment help
    // is needed most, and it is exactly what Prem asked for.
    /* Only help gets read out, and only if she has left the voice on. The
       cheers used to speak too, which meant Ara talked over her typing after
       every correct answer — the thing she actually complained about. */
    if (cls === 'hint' || cls === 'final') {
      setTimeout(() => window.U.speakAuto(plain), 260);
    }
  };
  const heard = text => { if (quest) quest.log.push({ who: 'kid', html: esc(text) }); };
  const pick = list => list[Math.floor(Math.random() * list.length)];

  /* ---- Ara's voice in the quest -------------------------------------
     The thing Aradhana actually liked was being TALKED TO: praised for the
     specific thing she did, teased gently when a word beat her, and never
     told she was "wrong". So nothing here is a fixed string — every reaction
     is picked from a handful, and the ones that matter are earned:
     first-try, fought-for, a streak, a genuinely hard word. */
  const CHEER_FIRST = ['🎉 Correct!', '⭐ Yes!', '✨ Spot on!', '🎯 Nailed it!', '🙌 Correct!'];
  const CHEER_FOUGHT = ['💪 Got it!', '👏 There it is!', '🎉 Yes — you found it!', '🔓 Cracked it!'];
  const PRAISE_FIRST = ['perfectly spelled!', 'first time, no hesitation!', 'straight in!',
                        'not a letter out of place!', 'exactly right!'];
  const PRAISE_FOUGHT = ['and you worked it out yourself. 👏', 'that one made you think — even better. 🧠',
                         'you fixed it without being told. That is the good kind of hard. 💪',
                         'second time lucky? No — second time <i>earned</i>. 😄'];
  const NEARLY = ['So close! 🤏', 'Nearly!', 'Ooh, almost.', 'Good try — not quite yet. 💪',
                  'Close enough to taste it. 😄'];
  const STREAK = { 3: '🔥 Three in a row!', 5: '🔥🔥 Five in a row — you are on fire!',
                   8: '⚡ Eight in a row! Ara can barely keep up.',
                   10: '🏅 TEN in a row. That is showing off (keep going).' };

  /* ======================================================================
     ARA, LIVE
     What Aradhana missed was not cleverness — it was being HEARD. She typed
     "wel byng" and was told the word had ten letters and started with W. She
     had written the W herself.

     So the reply is now written, in the moment, by a model that is shown
     exactly what she typed and what the app worked out about it. The app's
     own line still exists — but as the safety net underneath, not the thing
     she normally reads. If there is no signal, no account, or the model is
     slow, she never notices: the net catches it in the same bubble.
     ====================================================================== */

  /** Can Ara actually hold a conversation right now? She needs three things:
   *  a connection, a signed-in family account, and the app's own server. Any
   *  one missing and the game still plays perfectly — he is simply briefer. */
  function araIsLive() {
    if (navigator.onLine === false) return false;
    if (!window.API || !API.coachTurn) return false;
    return !!(window.Cloud && Cloud.signedIn && Cloud.signedIn() && Cloud.token);
  }

  /* How much talking one word can carry before it stops being practice.
     Four questions is generous for a nine-year-old who is genuinely stuck;
     twenty-five across a whole game is more than she will ever reach
     honestly, and caps what a bored evening can turn this into. */
  const CHAT_PER_WORD  = 4;
  const CHAT_PER_QUEST = 25;

  /* How many goes at one word before Ara simply shows her and moves on. */
  const TRIES_PER_WORD = 2;

  const flatten = t => String(t || '').toLowerCase().replace(/[^a-z]/g, '');

  /** Everything the app knows about her answer, as plain facts a model can
   *  be trusted with. Note what is NOT here: no praise, no phrasing, no
   *  teaching. Facts only — the wording is Ara's job. */
  function questFacts(wd, given, an) {
    const C = flatten(wd.word), G = flatten(given);
    let p = 0;
    while (p < C.length && p < G.length && C[p] === G[p]) p++;
    return {
      rightPrefix: p >= 2 ? p : 0,
      prefixText: p >= 2 ? C.slice(0, p).split('').join('-') : '',
      soundsRight: !!(an && an.soundsRight),
      note: (an && an.note) || '',
      sameFirst: !!(C[0] && G[0] && C[0] === G[0]),
      sameLength: !!G && C.length === G.length,
      trickyBit: wd.trickyBit || '',
      twoParts: /[\s-]/.test(String(wd.word).trim())
    };
  }

  /** Is she spelling, or has she stopped to talk to me? A word with no
   *  spaces is an attempt. A question mark, or a sentence that opens the way
   *  questions open, is her talking — and being answered instead of marked
   *  wrong is most of what she liked about the chat she was using before. */
  function isTalking(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (/[?？]$/.test(t)) return true;
    if (!/\s/.test(t)) return false;                 // one word: a spelling
    return /^(why|what|how|who|when|where|can|could|is|are|do|does|did|should|i (don|dont|do not|am|think|need)|help|tell|explain|say|repeat)\b/i.test(t);
  }

  /* A bubble that is being written. She sees the dots straight away, so the
     game feels alive while Ara thinks — and the dots are replaced in place,
     never stacked on top of each other. */
  let thinkSeq = 0;
  function thinking() {
    if (!quest) return null;
    const id = 'tk' + (++thinkSeq);
    quest.log.push({ who: 'ara', thinking: true, id, html: '', cls: '' });
    paintQuest();
    return id;
  }
  function resolveBubble(id, html, cls, voice) {
    if (!quest) return;
    const at = quest.log.findIndex(m => m.id === id);
    const plain = voice != null ? String(voice) : plainOf(html);
    const row = { who: 'ara', html, cls: cls || '', voice: plain };
    if (at < 0) quest.log.push(row); else quest.log[at] = row;
    paintQuest();
    if (cls === 'hint' || cls === 'final' || cls === 'chat') {
      setTimeout(() => window.U.speakAuto(plain), 220);
    }
  }
  const plainOf = html => String(html).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();

  /**
   * Ask Ara for a line, show it when it lands, and fall back to the app's own
   * words if it does not. Always resolves — the game never waits on a network.
   */
  async function araLine(kind, wd, given, facts, fallbackHTML, cls) {
    /* No connection, no pretending. Skipping the dots entirely is what makes
       an offline game feel finished rather than broken — she never waits for
       something that was never coming. */
    if (!araIsLive()) {
      const plain = plainOf(fallbackHTML);
      quest.log.push({ who: 'ara', html: fallbackHTML, cls: cls || 'hint', voice: plain });
      paintQuest();
      setTimeout(() => window.U.speakAuto(plain), 220);
      return;
    }
    const id = thinking();
    let reply = null;
    try {
      if (window.API && API.coachTurn) {
        reply = await API.coachTurn({
          kind,
          childId: (window.Sync && Sync.isDbId(Store.db.activeChildId)) ? Store.db.activeChildId : null,
          word: wd ? wd.word : '',
          definition: wd ? (wd.meaning || wd.kidMeaning || '') : '',
          attempt: given || '',
          tries: quest ? quest.tries : 1,
          facts: facts || {},
          history: (quest ? quest.log : []).filter(m => !m.thinking).slice(-4)
            .map(m => ({ who: m.who, text: m.who === 'kid' ? plainOf(m.html) : (m.voice || plainOf(m.html)) }))
        }, 6000);
      }
    } catch (e) { reply = null; }
    if (!quest) return;
    const line = reply && reply.line;
    if (reply && reply.offTopic) quest.offTopic = (quest.offTopic || 0) + 1;
    else if (line) quest.offTopic = 0;
    if (line) resolveBubble(id, esc(line), cls || 'hint', line);
    else resolveBubble(id, fallbackHTML, cls || 'hint');
  }

  /* ---- the safety net -------------------------------------------------
     Only read when Ara cannot be reached. Even so it must never again say
     something she has already proved she knows. */
  function localWrongHTML(wd, given, an, tries) {
    const f = questFacts(wd, given, an);
    const letters = flatten(wd.word).length;

    const opener = f.soundsRight
      ? 'That is <b>exactly how it sounds</b> — your ears are right, English is just being English. 🙃'
      : (f.rightPrefix
          ? `You have got <b>${esc(f.prefixText.toUpperCase())}</b> — that start is right.`
          : pick(NEARLY));

    /* Say the one useful thing. Never the first letter if she wrote it,
       never the letter count if she already has it. */
    let tip = '';
    if (f.note) tip = `The bit to change: <b>${esc(f.note)}</b>.`;
    else if (!f.sameFirst) tip = `It starts with <b>${esc(String(wd.word)[0].toUpperCase())}</b>.`;
    else if (f.twoParts) tip = `It is really <b>two small words</b> joined together.`;
    else if (!f.sameLength) tip = `It is <b>${letters}</b> letters long.`;
    else tip = `Every letter is in there — two of them have swapped places.`;

    const tricky = (tries >= 2 && wd.trickyBit)
      ? `<br><b>The bit that catches everyone:</b> ${esc(wd.trickyBit)}` : '';
    const diff = tries >= 2
      ? `<div class="diff" style="margin:8px 0">${Phonics.diffHTML(wd.word, given)}</div>` : '';

    return `${opener}<br>${tip}${tricky}${diff}` +
      `<p style="margin:6px 0 0">${pick(['Have another go 👇', 'One more — you have got this. 👇',
        'Fix that bit and it is yours. 👇'])}</p>`;
  }

  function questWord() {
    if (!quest) return null;
    return quest.round === 1 ? quest.words[quest.i] : quest.parked[quest.i];
  }
  function questTotal() { return quest ? quest.words.length : 0; }

  /** One clue, in her own game's voice. */
  function askClue() {
    if (!quest) return;
    const wd = questWord();
    if (!wd) return finishQuest();
    quest.tries = 0;
    quest.qStart = Date.now();

    /* The school's own definition, word for word. Aradhana noticed at once
       when the game asked her about a word using language her Spell Buzz
       sheet never used — and she was right to. The sheet's wording is what
       she has read all week and what the test will use. AraBuzz's own
       riddle clue is still here, but it waits behind "another clue" for a
       child who wants a second way in. */
    const school = (wd.meaning || '').trim();
    const clues = (wd.clues || []).filter(Boolean);
    const clue = school || wd.kidMeaning || 'Spell this week’s word.';
    quest.extraClue = school && clues.length ? clues[Math.floor(Math.random() * clues.length)] : '';
    const n = quest.round === 1 ? (quest.i + 1) : (quest.words.length + quest.i + 1);

    say(`<span class="q-kicker">🧩 CLUE ${n}${quest.round === 2 ? ' · one more try' : ''}</span>` +
        `<p style="margin:6px 0 0">${esc(clue)}</p>` +
        (school ? `<p class="q-from">— from your Spell Buzz sheet 📄</p>` : '') +
        `<p class="q-ask">⌨️ Type the spelling below</p>`, '', clue);
    paintQuest();
    armIdle();
  }

  /** Her answer, checked letter by letter — the heart of the game. */
  async function answerQuest(raw) {
    if (!quest || quest.busy) return;
    const given = String(raw || '').trim();
    if (!given) return;
    const wd = questWord();
    if (!wd) return;

    clearIdle();

    /* She has stopped to ask something. Answer her — do not mark it wrong.
       This is the single biggest difference between a game and a
       conversation, and it is the thing she was really asking for. */
    if (isTalking(given) && !Phonics.analyse(wd.word, given).ok) {
      heard(given);

      /* Three limits, and none of them are about the machine. A conversation
         is help; an endless conversation is a way of not spelling the word.
         And a child who has found that asking silly things gets a fun answer
         will keep asking silly things — so the fence gets quieter and firmer
         the more she leans on it, without ever telling her off. */
      const key = quest.round + ':' + quest.i;
      if (quest.chatKey !== key) { quest.chatKey = key; quest.chatN = 0; }
      quest.chatN++;
      quest.chatTotal = (quest.chatTotal || 0) + 1;

      const tooMany = quest.chatN > CHAT_PER_WORD;
      const wandering = (quest.offTopic || 0) >= 2;
      const spent = quest.chatTotal > CHAT_PER_QUEST;

      if (tooMany || wandering || spent) {
        const line = wandering
          ? `I only know about the words on your sheet 🦜 — this one first, then ask me again.`
          : `Let us get this one down first, then I am all ears. 👂 What is your best guess?`;
        quest.log.push({ who: 'ara', html: line, cls: 'chat', voice: plainOf(line) });
        paintQuest();
        setTimeout(() => window.U.speakAuto(plainOf(line)), 200);
        armIdle();
        return;
      }

      quest.busy = true;
      paintQuest();
      await araLine('chat', wd, given, questFacts(wd, '', null),
        `Good question! Have a look at the clue again — the answer is hiding in what it means. 👇`, 'chat');
      quest.busy = false;
      paintQuest();
      armIdle();
      return;
    }

    heard(given);
    quest.tries++;
    quest.busy = true;
    paintQuest();

    const ms = Date.now() - quest.qStart;
    const q = { wordId: wd.id, word: wd.word, mode: 'quest', kind: 'type', answer: wd.word, meta: {} };
    const an = Phonics.analyse(wd.word, given);
    const ok = an.ok;

    /* Every answer counts, right or wrong, first try or fifth — this is what
       feeds the boxes, the tricky list and the parent's note. */
    Engine.record(q, given, ok, quest.tries === 1, ms, quest.sessionId);

    if (ok) {
      /* Two tries means only two prices. A word she fixes on the second go is
         worth nearly as much as one she got straight away — the fixing is the
         learning, and pricing it like a failure taught the wrong thing. */
      const pts = quest.tries === 1 ? Game.POINTS.first : Game.POINTS.second;
      quest.points += pts;
      quest.correct++;
      quest.run = quest.tries === 1 ? (quest.run || 0) + 1 : 0;
      window.U.beep('great');
      window.U.speakAuto(wd.word);

      const firstGo = quest.tries === 1;
      const long = flatten(wd.word).length >= 10;
      const scoreLine = `<p class="q-score">⭐ ${quest.correct}/${questTotal()} · +${pts} points</p>`;
      const localGood =
        `<b>${pick(firstGo ? CHEER_FIRST : CHEER_FOUGHT)}</b> ` +
        `<span class="q-word">${esc(wd.word)}</span> — ${pick(firstGo ? PRAISE_FIRST : PRAISE_FOUGHT)}` +
        (firstGo && long ? `<p style="margin:6px 0 0">And that was a <b>long</b> one — ${flatten(wd.word).length} letters, no wobble. 😮</p>` : '') +
        (STREAK[quest.run] ? `<p style="margin:6px 0 0">${STREAK[quest.run]}</p>` : '');

      /* A word she had to fight for deserves a reaction about THAT word —
         what she fixed, not a stock cheer. A first-try win is fast and
         should stay fast, so it keeps the local line and costs nothing. */
      if (firstGo) {
        say(localGood + scoreLine, 'good');
      } else {
        const id = thinking();
        let line = null;
        try {
          const r = (window.API && API.coachTurn) ? await API.coachTurn({
            kind: 'right', childId: (window.Sync && Sync.isDbId(Store.db.activeChildId)) ? Store.db.activeChildId : null,
            word: wd.word, definition: wd.meaning || wd.kidMeaning || '',
            attempt: given, tries: quest.tries, facts: questFacts(wd, given, an),
            history: []
          }, 5000) : null;
          line = r && r.line;
        } catch (e) { line = null; }
        if (!quest) return;
        resolveBubble(id,
          line ? `<b>${pick(CHEER_FOUGHT)}</b> <span class="q-word">${esc(wd.word)}</span> — ${esc(line)}${scoreLine}`
               : localGood + scoreLine,
          'good',
          line ? `${wd.word}. ${line}` : null);
      }
      quest.busy = false;
      nextQuest();
      return;
    }

    /* Not yet. Ara answers her, in her own words, about what she actually
       typed. The app's line waits underneath in case she cannot be reached. */
    window.U.beep('bad');
    quest.run = 0;

    /* TWO tries, not three. Aradhana's words: being asked a third time makes
       it feel like being made to study. The chat she liked showed her the
       answer and moved on — and the word still comes back later in the same
       game, which is the part that actually teaches. A third demand at the
       same wall teaches nothing except that the wall is there. */
    if (quest.tries >= TRIES_PER_WORD) {
      const localGiveUp =
        `${pick(['No worries — here it is: ', 'Here you go: ', 'This one is a sneaky one. Here it is: ',
                 'Have a look at it: '])}` +
        `<span class="q-word">${esc(wd.word)}</span>` +
        `${wd.memoryTrick ? `<p style="margin:6px 0 0">💡 ${esc(wd.memoryTrick)}</p>` : ''}` +
        `<p style="margin:6px 0 0">${quest.round === 1
          ? pick(['Keep it in your pocket — it comes back at the end. 😉',
                  'It will pop up again later, so no rush now.',
                  'On we go — you will see this one again before we finish. 👉'])
          : 'It got away this time. It will be waiting in your next game. 😉'}</p>`;

      const id = thinking();
      let line = null;
      try {
        const r2 = (window.API && API.coachTurn) ? await API.coachTurn({
          kind: 'parked', childId: (window.Sync && Sync.isDbId(Store.db.activeChildId)) ? Store.db.activeChildId : null,
          word: wd.word, definition: wd.meaning || wd.kidMeaning || '',
          attempt: given, tries: quest.tries, facts: questFacts(wd, given, an), history: []
        }, 5000) : null;
        line = r2 && r2.line;
      } catch (e) { line = null; }
      if (!quest) return;
      /* The word itself is shown here on purpose — three tries are up, and
         seeing it is the lesson. Ara's line goes above it. */
      resolveBubble(id,
        (line ? `${esc(line)}<p style="margin:8px 0 0">Here it is: <span class="q-word">${esc(wd.word)}</span></p>`
              : localGiveUp) +
        `${line && wd.memoryTrick ? `<p style="margin:6px 0 0">💡 ${esc(wd.memoryTrick)}</p>` : ''}`,
        'hint',
        (line ? line + '. ' : '') + 'Here it is. ' + wd.word);
      if (window.U.autoVoiceOn()) {
        window.U.speak(wd.word, { rate: 0.6 });
        window.U.spellOut(wd.word);
      }
      if (quest.round === 1) quest.parked.push(wd);
      quest.busy = false;
      nextQuest();
      return;
    }

    await araLine('wrong', wd, given, questFacts(wd, given, an),
                  localWrongHTML(wd, given, an, quest.tries), 'hint');
    quest.busy = false;
    paintQuest();
    armIdle();
  }

  /* ---- gone quiet -----------------------------------------------------
     A nine-year-old who is stuck goes silent, not loud. After a while Ara
     notices, the way a person sitting next to her would. Once per word, so
     it is company and not nagging. */
  let idleTimer = null;
  function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
  function armIdle() {
    clearIdle();
    if (!quest || quest.over) return;
    idleTimer = setTimeout(async () => {
      if (!quest || quest.over || quest.busy || quest.nudged === quest.i + ':' + quest.round) return;
      const wd = questWord();
      if (!wd) return;
      quest.nudged = quest.i + ':' + quest.round;
      await araLine('stuck', wd, '', questFacts(wd, '', null),
        `Take your time — read the clue once more and write what you hear. 👂`, 'hint');
    }, 32000);
  }

  function nextQuest() {
    if (!quest) return;
    quest.i++;
    const done = quest.round === 1
      ? quest.i >= quest.words.length
      : quest.i >= quest.parked.length;
    paintQuest();

    if (!done) { setTimeout(askClue, 700); return; }

    // The list is finished. Anything parked comes back for one last go.
    if (quest.round === 1 && quest.parked.length) {
      quest.round = 2; quest.i = 0;
      const names = quest.parked.map(x => x.word);
      setTimeout(() => {
        say(`<b>That's the whole list! 🎊</b> ${quest.correct}/${questTotal()} first time round.`);
        say(names.length === 1
          ? `Now only <b>${esc(names[0])}</b> needs one more try. 😉`
          : `Now these need one more try: <b>${esc(names.join(', '))}</b> 😉`);
        paintQuest();
        setTimeout(askClue, 500);
      }, 700);
      return;
    }
    setTimeout(finishQuest, 800);
  }

  function finishQuest() {
    if (!quest) return;
    clearIdle();
    const q = quest;
    const total = q.words.length;
    const pct = total ? q.correct / total : 0;
    const stars = q.correct === total ? 3 : Engine.stars(pct);
    const bonus = stars * 12;
    const points = q.points + bonus;

    const before = Game.levelFor(Store.db.game.points);
    Game.awardPoints(points);
    const after = Game.levelFor(Store.db.game.points);

    /* The same finish line as every other game: session recorded, streak
       touched, badges checked, everything synced. */
    const res = Game.finishSession({
      kind: 'quest', preset: 'quest', label: q.title,
      total, correct: q.correct, points, stars,
      ms: Date.now() - q.started, weekIds: q.weekIds,
      complete: q.correct === total
    });
    Store.save(true); UI.checkpointVault();

    const perfect = q.correct === total;
    say(`<b>🏆 FINAL SCORE: ${q.correct}/${total}</b> ${'🌟'.repeat(Math.max(1, stars))}` +
        `<p class="q-score">+${points} points${bonus ? ` (${bonus} bonus for ${stars} star${stars > 1 ? 's' : ''})` : ''}</p>` +
        (perfect
          ? `<p style="margin:8px 0 0"><b>${esc(q.title.replace(/!$/, ''))} = MASTERED!</b> 🎉 Every single word right. That is the whole list, beaten.</p>`
          : `<p style="margin:8px 0 0">Well played! The words that got away will come back in your next game — that is how they stick.</p>`) +
        (after > before ? `<p style="margin:8px 0 0">🎈 <b>Level ${after}!</b> Ara just grew.</p>` : '') +
        ((res.badges || []).length
          ? `<p style="margin:8px 0 0">🏅 New badge: <b>${res.badges.map(b => esc(b.name)).join(', ')}</b></p>` : ''),
      'final');

    quest = Object.assign({}, q, { over: true, log: q.log });
    paintQuest();
    confetti(perfect ? 110 : 60);
    window.U.beep('great');
  }

  function paintQuest() {
    const scr = $('#scr-puzzle');
    if (!quest) return;
    const over = !!quest.over;
    const total = questTotal();

    scr.innerHTML = `
      <div class="row between" style="margin-bottom:6px">
        <button class="btn-quiet btn-s" id="quit">← Stop</button>
        <div class="row" style="gap:6px">
          <button class="q-mute${window.U.autoVoiceOn() ? '' : ' off'}" id="qMute"
            title="${window.U.autoVoiceOn() ? 'Ara reads things out — tap to make her quiet' : 'Ara is quiet — tap if you want her to read things out'}"
            aria-label="Voice on or off">${Icon.icon(window.U.autoVoiceOn() ? 'speaker' : 'mute', { size: 15 })}
            <span class="q-mute-w">${window.U.autoVoiceOn() ? 'Quiet, Ara' : 'Ara is quiet'}</span></button>
          <span class="pill honey">${Icon.icon('star', { size: 14 })} <b>${quest.correct}</b>/${total}</span>
          ${quest.points ? `<span class="pill sky">+${quest.points}</span>` : ''}
        </div>
      </div>

      ${araIsLive() ? '' : `<div class="q-offline" id="qOffline">
        <b>No internet</b> — connect for better answers</div>`}

      <div class="qbar" style="margin-bottom:10px">${quest.words.map((_, k) => {
        const done = quest.round === 2 || k < quest.i;
        return `<span class="${done ? 'done' : (quest.round === 1 && k === quest.i ? 'now' : '')}"></span>`;
      }).join('')}</div>

      <div class="quest-log" id="qlog">
        ${quest.log.map(m => m.thinking
          ? `<div class="q-row"><div class="q-ara">${Ara.svg({ level: Game.levelFor(Store.db.game.points), width: 34, mood: 'happy', plain: true })}</div>
               <div class="q-bubble thinking" aria-label="Ara is writing"><span class="q-dots"><i></i><i></i><i></i></span></div></div>`
          : m.who === 'ara'
          ? `<div class="q-row"><div class="q-ara">${Ara.svg({ level: Game.levelFor(Store.db.game.points), width: 34, mood: 'happy', plain: true })}</div>
               <div class="q-bubble ${m.cls}">${m.html}
                 ${m.voice ? `<button type="button" class="q-say" data-say-text="${esc(m.voice)}"
                     title="Read this to me" aria-label="Read this to me">${Icon.icon('speaker', { size: 15 })}</button>` : ''}</div></div>`
          : `<div class="q-row mine"><div class="q-bubble mine">${m.html}</div></div>`).join('')}
      </div>

      ${over ? `
        <div class="row center wrap" style="gap:10px;margin-top:16px">
          <button class="btn-ghost" id="qHome">${Icon.icon('home', { size: 17 })} Home</button>
          <button class="btn-go btn-xl" id="qAgain">Play again →</button>
        </div>`
      : `
        <div class="quest-compose">
          <input type="text" id="qIn" class="quest-input" placeholder="type the spelling — or ask me anything…"
                 autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send">
          <button class="btn-primary" id="qSend"${quest.busy ? ' disabled' : ''}>Send</button>
        </div>
        <div class="row center wrap" style="gap:8px;margin-top:10px">
          <button class="btn-quiet btn-s" id="qHear">${Icon.icon('speaker', { size: 15 })} Read the clue again</button>
          ${quest.extraClue ? `<button class="btn-quiet btn-s" id="qMore">💡 Another clue</button>` : ''}
          ${window.U.speedBtn()}
        </div>
        <p class="hint center-text" style="margin-top:8px">No rush — spelling it yourself is the whole point.
           Stuck? Just ask me, like <i>“why two Ls?”</i> 💬</p>`}`;

    const log = $('#qlog');
    if (log) log.scrollTop = log.scrollHeight;

    const el = sel => scr.querySelector(sel);
    el('#quit').onclick = confirmQuitQuest;

    /* Hers to decide, mid-game, without hunting through a grown-up's screen.
       It stops whatever is being said right now as well as everything after,
       because the annoying part is being talked over. */
    el('#qMute').onclick = () => {
      const now = !window.U.autoVoiceOn();
      window.U.setAutoVoice(now);
      paintQuest();
      window.U.toast(now ? 'Ara will read things out again.' : 'Quiet mode. Tap a 🔊 any time you want to hear something.', '', 2600);
    };

    if (over) {
      el('#qHome').onclick = () => { quest = null; UI.go('home'); };
      el('#qAgain').onclick = () => { const p = quest.pool, w = quest.weekIds; quest = null; startQuest(p, { weekIds: w }); };
      return;
    }

    const lastAra = [...quest.log].reverse().find(m => m.who === 'ara' && m.voice);
    if (el('#qHear')) el('#qHear').onclick = () => { if (lastAra) window.U.speak(lastAra.voice); };
    if (el('#qMore')) el('#qMore').onclick = () => {
      const extra = quest.extraClue;
      quest.extraClue = '';                       // one extra clue per word
      say(`💡 Another way to think about it: ${esc(extra)}`, 'hint', 'Another way to think about it. ' + extra);
      paintQuest();
    };

    const inp = el('#qIn');
    const send = () => { const v = inp.value; inp.value = ''; answerQuest(v); };
    el('#qSend').onclick = send;
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
    window.U.noAutoCorrect(inp);
    setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }, 80);
  }

  /* The connection can come and go mid-game. Repaint when it does, so the
     pill is never a stale claim — and so Ara starts talking again the moment
     she can, without the child having to restart anything. */
  let netWatch = false;
  function watchNetwork() {
    if (netWatch) return;
    netWatch = true;
    const onNet = () => { if (quest && !quest.over) paintQuest(); };
    w.addEventListener('online', onNet);
    w.addEventListener('offline', onNet);
  }

  async function confirmQuitQuest() {
    clearIdle();
    const yes = await window.U.confirmBox('Stop the quest?',
      'Every word you got right still counts, and Ara keeps what you practised.', 'Yes, stop');
    if (!yes) return;
    if (quest && quest.correct > 0) finishQuest();
    else { quest = null; UI.go('home'); }
  }

  w.Quiz = { start, startCrossword, startWordSearch, startRush, startQuest,
              get active() { return !!s || !!quest; } };
})(window);
