/* ==========================================================================
   AraBuzz — ownwork.js
   Her own mistakes, from her own books.

   Prem photographed a page of Aradhana's Charlotte's Web workbook: her
   pencil, her teacher's green pen above it. spayder → spider. dayd → died.
   haul → how. moching → watching. smol → small. asced → asked. Mer is →
   where is. Seven words, not one of which has ever been on a Spell Buzz
   sheet, and every one of them the same child spelling exactly what she
   hears.

   The weekly sheet says what the class is learning. This says what SHE is
   getting wrong. It is better data and nobody was collecting it.

   HOW IT WORKS, AND WHY IT IS BUILT THIS CAUTIOUSLY
   A parent photographs a marked page. It is read, and the pairs come back on
   screen. Then the parent goes through them and says yes — because reading a
   nine-year-old's pencil and a teacher's cursive from a phone photo is hard,
   and the one unforgivable bug in a spelling app is teaching a child a word
   that is wrong. Nothing is practised until a grown-up has looked at it.

   The photograph is never kept. It is shrunk on the device, read, and gone.

   What is saved is an ordinary sheet — a deck of words like any other —
   except that it belongs to one child instead of the class. So every game,
   the Leitner boxes, Spell Quest and the coach note pick these words up with
   no special handling anywhere. Her sister never sees them.
   ========================================================================== */
(function (w) {
  'use strict';

  const { $, esc, toast, confirmBox } = w.U;

  const MAX_EDGE = 1600;      // a page is perfectly readable at this size
  const QUALITY  = 0.82;

  let found = null;           // what came back, awaiting a parent's eye
  let busy  = false;

  /* ---------------------------------------------------------------- photo
     A phone photograph of a page is 4–12 MB and mostly wasted detail. It is
     shrunk here, on the device, before anything is sent: faster for the
     parent, cheaper for the account, and the full-size original never leaves
     the phone at all. */
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const cvs = document.createElement('canvas');
        cvs.width  = Math.round(img.width * scale);
        cvs.height = Math.round(img.height * scale);
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
        const data = cvs.toDataURL('image/jpeg', QUALITY);
        resolve({ media: 'image/jpeg', b64: data.split(',')[1], preview: data });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as a picture.')); };
      img.src = url;
    });
  }

  /* ------------------------------------------------------------------ tab */
  function paint() {
    const box = $('#ptab');
    const db = Store.db;
    const name = (db.profile && db.profile.name) || 'your child';
    const p = window.U.pronouns(db.profile && db.profile.pronoun);
    const own = Store.ownWeek();
    const kept = own ? (own.wordIds || []).length : 0;

    box.innerHTML = `
      <div class="card">
        <h2>${esc(name)}&rsquo;s own work</h2>
        <p class="muted">The weekly sheet tells you what the class is learning. A page ${esc(p.their())}
           teacher has marked tells you what <b>${esc(name)}</b> is actually getting wrong — and
           those are usually different words entirely.</p>
        <p class="muted small">Photograph any pages of ${esc(p.their())} writing — a workbook, a worksheet, a test
           that has come back. If a teacher has marked it, AraBuzz reads their corrections. If nobody
           has marked it, AraBuzz reads it through and says which words it thinks are misspelled,
           clearly labelled as its own opinion rather than a teacher's. Either way
           <b>you decide what is worth practising</b> before anything is added, and the photo is not
           kept: it is read and then gone.</p>

        <div class="row wrap" style="gap:10px;margin-top:14px">
          <label class="btn-primary" for="owShot" style="cursor:pointer">
            ${Icon.icon('sparkle', { size: 16 })} Take a photo</label>
          <input type="file" id="owShot" accept="image/*" capture="environment" style="display:none">
          <label class="btn-ghost" for="owFile" style="cursor:pointer">Choose pictures</label>
          <input type="file" id="owFile" accept="image/*" multiple style="display:none">
        </div>
        <p class="hint" style="margin-top:10px">One page at a time. Lay it flat, get the whole page
           in the frame, and let the light fall on it rather than your shadow.</p>
        <div id="owStatus" style="margin-top:12px"></div>
      </div>

      <div id="owFound"></div>

      <div class="card" style="margin-top:14px">
        <h3>Words kept so far <span class="pill tiny">${kept}</span></h3>
        ${kept ? `
          <p class="muted small">These sit alongside the school's sheets. ${esc(name)} can choose
             them in any game, and the coach note counts them like any other practice.
             ${p.Cap.their()} brothers and sisters never see them.</p>
          <div id="owList" style="margin-top:12px">${keptListHTML(own)}</div>`
        : `<p class="muted small">Nothing yet. The first page you photograph will start this list.</p>`}
      </div>`;

    wire();
  }

  function keptListHTML(own) {
    const db = Store.db;
    const rows = (own.wordIds || []).map(id => db.words[id]).filter(Boolean);
    if (!rows.length) return '<p class="muted small">Nothing yet.</p>';
    const pr = window.U.pronouns(Store.db.profile && Store.db.profile.pronoun);
    return `<div class="row wrap" style="gap:8px">
      ${rows.map(x => {
        const wrote = (x.extras && x.extras.written) || '';
        return `<span class="pill" title="${wrote ? esc(pr.they() + ' wrote: ' + wrote) : ''}">
          <b>${esc(x.word)}</b>${wrote ? ` <span class="faint">· ${esc(wrote)}</span>` : ''}
          <button class="linky" data-owdel="${esc(x.id)}" title="Remove this word"
            style="margin-left:6px">×</button></span>`;
      }).join('')}
    </div>`;
  }

  function wire() {
    /* A workbook is pages, not a page. The picker accepts several at once and
       they are read one after another — not in parallel, because each read is
       real work at the far end and a parent photographing a whole workbook
       should not fire eight of them in the same second. Everything found
       lands in ONE review list, so the parent ticks through a single sitting
       of results rather than eight little ones. */
    async function readOne(file) {
      if (window.ViewAs && ViewAs.lookingOnly && ViewAs.lookingOnly()) {
        throw new Error('You are looking at this family, not acting for them. ' +
                        'Turn on "Act as this parent" first.');
      }
      const shrunk = await shrink(file);
      const res = await fetch('/api/read-work', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + Cloud.token },
        body: JSON.stringify({
          image: shrunk.b64, mediaType: shrunk.media,
          childId: Store.db.activeChildId
        })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'The page could not be read.');
      j.preview = shrunk.preview;
      return j;
    }

    /* Several pages become one result. Words are deduplicated on the correct
       spelling, keeping the first reading of each — the second photograph of
       the same worksheet should not double anything. */
    function combine(pages) {
      const seen = new Set();
      const take = list => (list || []).filter(x => {
        const key = String((x && (x.correct || x.written)) || '').toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const good = pages.filter(pg => pg.readable !== false);
      return {
        readable: good.length > 0,
        marked: good.some(pg => pg.marked !== false),
        spellings: [].concat(...good.map(pg => take(pg.spellings))),
        spotted: [].concat(...good.map(pg => take(pg.spotted))),
        other: [].concat(...good.map(pg => pg.other || [])),
        note: good.length ? '' : (pages[0] && pages[0].note) || '',
        pages: pages.length,
        unreadable: pages.length - good.length,
        preview: (good[0] || pages[0] || {}).preview || null
      };
    }

    const go = async (files) => {
      const list = Array.from(files || []).filter(Boolean);
      if (!list.length || busy) return;
      busy = true;
      const st = $('#owStatus');
      const results = [];
      const failures = [];
      try {
        for (let i = 0; i < list.length; i++) {
          st.innerHTML = `<div class="loading-box"><span class="loader"></span>
            <p class="muted small" style="margin:0">Reading ${list.length > 1
              ? `page ${i + 1} of ${list.length}` : 'the page'}…${results.length
              ? ` <span class="faint">(${results.reduce((n, pg) =>
                  n + ((pg.spellings || []).length + (pg.spotted || []).length), 0)} words so far)</span>` : ''}</p></div>`;
          try { results.push(await readOne(list[i])); }
          catch (e) { failures.push(e.message || String(e)); }
        }
        if (!results.length) throw new Error(failures[0] || 'The pages could not be read.');
        st.innerHTML = failures.length
          ? `<div class="feedback" style="margin-bottom:10px"><b>${failures.length === 1
              ? 'One page could not be read' : failures.length + ' pages could not be read'}.</b>
             <p class="small" style="margin:6px 0 0">Everything readable is below — the rest can be
             photographed again whenever suits.</p></div>`
          : '';
        found = list.length > 1 ? combine(results) : results[0];
        paintFound();
      } catch (e) {
        st.innerHTML = `<div class="feedback bad"><b>Could not read ${list.length > 1 ? 'those pages' : 'that page'}.</b>
          <p class="small" style="margin:6px 0 0">${esc(e.message || e)}</p></div>`;
      } finally { busy = false; }
    };

    ['owShot', 'owFile'].forEach(id => {
      const el = $('#' + id);
      if (el) el.onchange = () => { const fs = Array.from(el.files || []); el.value = ''; go(fs); };
    });

    w.U.$$('[data-owdel]').forEach(b => b.onclick = async () => {
      const id = b.dataset.owdel;
      const word = Store.db.words[id];
      const yes = await confirmBox('Remove this word?',
        `“${esc(word ? word.word : 'this word')}” will stop coming up in games. Everything already
         practised is untouched.`, 'Remove');
      if (!yes) return;
      await removeWord(id);
      paint();
    });
  }

  /* -------------------------------------------------- what came back, to check */
  function paintFound() {
    const box = $('#owFound');
    if (!found) { box.innerHTML = ''; return; }
    const name = (Store.db.profile && Store.db.profile.name) || 'your child';

    if (found.readable === false) {
      box.innerHTML = `<div class="card" style="margin-top:14px">
        <h3>That photo was hard to read</h3>
        <p class="muted small">${esc(found.note || 'Try again a little closer, with the page flat and the light on it.')}</p>
        <button class="btn-ghost btn-s" id="owAgain">Try another photo</button>
      </div>`;
      $('#owAgain').onclick = () => { found = null; paint(); };
      return;
    }

    const list = found.spellings || [];
    const spotted = found.spotted || [];
    if (!list.length && !spotted.length) {
      box.innerHTML = `<div class="card" style="margin-top:14px">
        <h3>${found.marked === false ? 'Nothing misspelled on that page' : 'No spelling corrections on that page'}</h3>
        <p class="muted small">${found.marked === false
          ? 'Nobody had marked it, and AraBuzz read it through without finding a spelling it was sure was wrong. That is good news — and it will not guess just to have something to show you.'
          : 'Either the teacher marked nothing, or the marks are not spellings.'}
           ${found.other && found.other.length ? 'There were other kinds of correction — see below.' : ''}</p>
        ${otherHTML()}
        <button class="btn-ghost btn-s" id="owAgain" style="margin-top:10px">Photograph another page</button>
      </div>`;
      $('#owAgain').onclick = () => { found = null; paint(); };
      return;
    }

    box.innerHTML = `
      <div class="card glow" style="margin-top:14px">
        <h3>${found.pageTitle ? `<i>${esc(found.pageTitle)}</i>` : 'What the page shows'}</h3>
        <p class="muted small"><b>Check these before they go in.</b> Handwriting is hard to read from
           a photo, and a word saved wrongly here would be practised wrongly. Untick anything that is
           not right, and fix any spelling that has been misread.</p>

        ${list.length ? `
        <h4 style="margin:16px 0 4px">${Icon.icon('check', { size: 15 })} Marked by the teacher
          <span class="pill tiny sage">${list.length}</span></h4>
        <p class="tiny faint" style="margin:0 0 10px">Corrections already on the page in someone else's hand.</p>
        ${rowsHTML(list, 't')}` : ''}

        ${spotted.length ? `
        <h4 style="margin:${list.length ? '20px' : '16px'} 0 4px">${Icon.icon('sparkle', { size: 15 })}
          Spotted by AraBuzz <span class="pill tiny honey">${spotted.length}</span></h4>
        <p class="tiny faint" style="margin:0 0 10px">Nobody marked this page, so these are
          <b>AraBuzz's opinion, not a teacher's</b> — they start unticked on purpose. Read each one
          and tick only what you agree with.</p>
        ${rowsHTML(spotted, 's')}` : ''}

        ${otherHTML()}

        <div class="row wrap" style="gap:10px;margin-top:16px">
          <button class="btn-go" id="owSave">Add the ticked words to ${esc(name)}'s practice</button>
          <button class="btn-quiet" id="owCancel">Throw this away</button>
        </div>
        <p class="hint" style="margin-top:10px">The photo is not saved either way.</p>
        <div id="owSaveStat" style="margin-top:10px"></div>
      </div>`;

    $('#owCancel').onclick = () => { found = null; paint(); };
    $('#owSave').onclick = save;
  }

  /** One line per finding. `kind` is 't' for a teacher's correction, which
   *  arrives ticked, or 's' for one AraBuzz spotted itself, which never does
   *  — an opinion has to be agreed with before a child practises it. */
  /* ------------------------------------------------- connecting the dots --
     The page is read COLD — the reader knows nothing about this child, on
     purpose, because a reader told what to expect starts seeing what it
     expects. The connecting to everything AraBuzz already knows happens
     HERE, in plain code, the moment the reading lands — and this line under
     each word is that connection made visible to the parent:

       · the word is already in the games → its live score
       · the mistake matches a habit the practice record already shows →
         named, so the parent sees the worksheet CONFIRMING the app
       · neither → honestly called new

     No model is asked anything; this is arithmetic against her own record. */
  function habitTags() {
    const c = {}; let wrong = 0;
    Store.recentAttempts(30).forEach(a => {
      if (!a.ok && a.given) { wrong++; (a.tags || []).forEach(t => { c[t] = (c[t] || 0) + 1; }); }
    });
    return Object.keys(c).filter(t => wrong >= 5 && c[t] / wrong >= 0.2);
  }

  const TAG_WORDS = {
    soundsRight: 'spelling it the way it sounds', doubles: 'double letters',
    vowels: 'the middle vowel', endings: 'word endings', silent: 'silent letters',
    order: 'letter order', missing: 'a letter dropped', extra: 'an extra letter'
  };

  function connectionNote(correct, written) {
    try {
      const key = String(correct || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!key) return '';
      const hit = Object.keys(Store.db.words).find(id =>
        String(Store.db.words[id].word).toLowerCase().replace(/[^a-z]/g, '') === key);
      if (hit) {
        const pr = Store.db.progress[hit];
        if (pr && pr.seen) {
          return `already in the games — right ${pr.right} of ${pr.seen} there`;
        }
        return 'already on a practice list, not met in a game yet';
      }
      if (written && window.Phonics) {
        const an = Phonics.analyse(correct, written);
        const habits = habitTags();
        const match = (an && an.tags || []).find(t => habits.includes(t));
        if (match) return `new word, familiar habit — ${TAG_WORDS[match] || match}, same as in the games`;
        if (an && an.soundsRight) return 'new word, spelled exactly as it sounds';
      }
      return 'new — first time AraBuzz has seen this word';
    } catch (e) { return ''; }
  }

  function rowsHTML(rows, kind) {
    return `<div>${rows.map((x, i) => {
      const id = kind + i;
      const on = kind === 't' && x.confident;
      return `
        <label class="ob-agree" for="ow-${id}" style="margin:0 0 8px;padding:12px 14px;align-items:center;
          ${x.confident ? '' : 'border-color:var(--clay);background:var(--clay-soft)'}">
          <input type="checkbox" id="ow-${id}" data-owpick="${id}" ${on ? 'checked' : ''}>
          <span class="grow">
            <span class="faint" style="text-decoration:line-through">${esc(x.written)}</span>
            <b style="margin:0 8px">→</b>
            <input type="text" class="ow-word" data-owword="${id}" value="${esc(x.correct)}"
                   style="width:auto;display:inline-block;padding:6px 10px;font-weight:600">
            ${x.sameSound ? `<span class="pill tiny honey" style="margin-left:8px">sounds right</span>` : ''}
            ${x.confident ? '' : `<span class="pill tiny coral" style="margin-left:8px">please check — unsure</span>`}
            ${(() => { const c = connectionNote(x.correct, x.written);
              return c ? `<span class="faint tiny" style="display:block;margin-top:4px">${esc(c)}</span>` : ''; })()}
          </span>
        </label>`;
    }).join('')}</div>`;
  }

  function otherHTML() {
    const other = (found && found.other) || [];
    if (!other.length) return '';
    return `<details style="margin-top:12px">
      <summary><b>${window.U.plural(other.length, 'other correction')}</b> — not spellings</summary>
      <p class="muted small" style="margin:8px 0 0">Capitals, punctuation, a tense, a word choice.
         These are worth a word at the kitchen table, but AraBuzz does not drill them.</p>
      <ul class="small" style="margin:8px 0 0;padding-left:20px">
        ${other.map(o => `<li><span class="faint">${esc(o.wrote)}</span> → <b>${esc(o.shouldBe)}</b>
          <span class="pill tiny">${esc(o.kind || '')}</span></li>`).join('')}
      </ul></details>`;
  }

  /* ----------------------------------------------------------------- saving */
  async function save() {
    const picks = [];
    w.U.$$('[data-owpick]').forEach(c => {
      if (!c.checked) return;
      const id = c.dataset.owpick;
      const src = id[0] === 't' ? (found.spellings || []) : (found.spotted || []);
      const row = src[+id.slice(1)];
      if (!row) return;
      const field = document.querySelector(`[data-owword="${id}"]`);
      const correct = (field ? field.value : row.correct).trim();
      if (correct) picks.push({ correct, written: row.written, sameSound: row.sameSound,
                                byTeacher: id[0] === 't' });
    });
    if (!picks.length) return toast('Nothing is ticked.');

    const btn = $('#owSave');
    btn.disabled = true;
    btn.innerHTML = '<span class="loader"></span> Adding';
    try {
      const added = await addWords(picks, found.pageTitle || '');
      found = null;
      paint();
      toast(added
        ? `${window.U.plural(added, 'word')} added — ${added === 1 ? 'it is' : 'they are'} in ${window.U.pronouns(Store.db.profile && Store.db.profile.pronoun).their()} games from now on.`
        : 'Those words were already there.', 'good', 4200);
    } catch (e) {
      $('#owSaveStat').innerHTML = `<div class="feedback bad"><b>Could not add them.</b>
        <p class="small" style="margin:6px 0 0">${esc(e.message || e)}</p></div>`;
      btn.disabled = false;
      btn.textContent = 'Try again';
    }
  }

  /* ------------------------------------------------------- the child's sheet
     Saved as an ordinary deck with one difference: it carries her child id,
     so row-level security keeps it inside this family and the app keeps it
     out of her sister's games. Everything downstream — the boxes, the games,
     the coach note — treats it as just another sheet, which is exactly why
     this feature needed almost no new machinery. */
  async function ownDeck() {
    const childId = Store.db.activeChildId;
    if (!window.Cloud || !Cloud.signedIn() || !window.Sync || !Sync.isDbId(childId)) {
      throw new Error('Sign in on this device first — these words are kept in the family account.');
    }
    const { data: has, error: e0 } = await Cloud.from('decks')
      .select('id').eq('child_id', childId).limit(1);
    if (e0) throw e0;
    if (has && has[0]) return has[0].id;

    const name = (Store.db.profile && Store.db.profile.name) || 'This child';
    const { data, error } = await Cloud.from('decks').insert({
      child_id: childId,
      title: `${name}'s own work`,
      topic: 'From marked schoolwork',
      status: 'published',
      audience: 'family',
      source_name: 'Marked schoolwork'
    }).select().single();
    if (error) throw error;
    return data.id;
  }

  async function addWords(picks, sourceLabel) {
    const deckId = await ownDeck();

    /* Never store the same word twice. A child gets "friend" wrong in three
       different books; it is one word to practise, not three. */
    const { data: existing, error: e1 } = await Cloud.from('words')
      .select('id, word').eq('deck_id', deckId);
    if (e1) throw e1;
    const have = new Set((existing || []).map(x => Store.wordKey(x.word)));

    const rows = [];
    picks.forEach((p, i) => {
      const key = Store.wordKey(p.correct);
      if (have.has(key)) return;
      have.add(key);
      rows.push({
        deck_id: deckId,
        sort: (existing || []).length + i,
        word: p.correct,
        /* word_key is NOT sent: the database generates it from `word` itself
           (a GENERATED column refuses any value from outside — this exact
           insert failed on a real worksheet until the line came out). The
           local `key` above is still used for de-duplicating this batch. */
        /* Her own attempt is the most useful thing on the page: it is what
           the games quote back to her, and what the coach note reasons from. */
        extras: {
          written: p.written,
          soundsRight: !!p.sameSound,
          /* Whether a teacher marked this or AraBuzz spotted it. Worth
             keeping: if a word ever turns out to be wrong, this says who to
             blame, and the coach note can weigh the two differently. */
          byTeacher: p.byTeacher !== false,
          from: sourceLabel || 'schoolwork',
          addedAt: new Date().toISOString()
        }
      });
    });
    if (!rows.length) return 0;

    const { error: e2 } = await Cloud.from('words').insert(rows);
    if (e2) throw e2;
    await Sync.pull();
    Store.save(true);
    return rows.length;
  }

  async function removeWord(id) {
    if (window.Cloud && Cloud.signedIn()) {
      const { error } = await Cloud.from('words').delete().eq('id', id);
      if (error) { toast('Could not remove it — ' + (error.message || ''), 'bad'); return; }
      await Sync.pull();
      Store.save(true);
    }
  }

  w.OwnWork = { paint, shrink, save, addWords, removeWord };
})(window);
