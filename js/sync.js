/* ==========================================================================
   AraBuzz — sync.js
   The bridge between the device and the database.

   THE ONE RULE THIS FILE EXISTS TO KEEP: a child never waits for a network.

   Everything she does is written to localStorage first and answered from
   localStorage. This file runs afterwards, quietly, in the background. If the
   wifi is off, if the server is down, if she is in the back of a car — the app
   behaves exactly the same and this file simply has more to do later.

   How it works, in four sentences:

     · Anything she does that is worth keeping is appended to an OUTBOX in
       localStorage. The outbox survives the app being closed, the tab being
       killed and the device being restarted.
     · Every row is given a proper UUID here, on the device, before it is
       queued — so sending it twice is harmless. The database takes the second
       copy and overwrites the first with an identical row. That is what makes
       a flaky connection safe.
     · Pulling is the other direction: word lists published by Prem, and the
       children on the account, come DOWN and become ordinary local data. A
       new iPad therefore fills itself in.
     · family_id is never sent. A trigger in Postgres derives it from the
       child, and row-level security refuses anything that does not match.

   Local identifiers and database identifiers are deliberately THE SAME VALUE.
   A child, a word and a set all carry their database UUID as their local id,
   so there is no mapping table to drift out of step. Anything created on this
   device before it ever met the database keeps its old short id (`w3f9a…`),
   which is how this file tells the two apart: a short id means local-only, and
   local-only rows are never pushed, because the database has no word for them
   to point at.
   ========================================================================== */
(function (w) {
  'use strict';

  const OUTBOX_KEY = 'arabuzz.outbox.v1';
  const MARK_KEY   = 'arabuzz.sync.v1';

  const MAX_OUTBOX     = 4000;    // beyond this, the oldest answers are dropped
  const BATCH          = 200;     // rows per request
  const DEBOUNCE_MS    = 4000;    // wait this long after the last change
  const HEARTBEAT_MS   = 60000;   // and try again at least this often
  const PULL_EVERY_MS  = 300000;  // fresh sheets/children appear within 5 min, no reopen needed
  const BACKOFF_MS     = [4000, 15000, 60000, 300000];

  /* A database id looks like this; a local-only one never does. */
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isDbId = v => typeof v === 'string' && UUID_RE.test(v);

  const S = () => w.Store;

  /* ------------------------------------------------------------------ state */
  let outbox      = [];
  let dirtyProg   = new Set();   // "childId::wordId"
  let dirtyGame   = new Set();   // childId
  let timer = null, beat = null;
  let flushing = false, pulling = false;
  let fails = 0;
  let started = false;

  const state = { lastPush: 0, lastPull: 0, error: null, pending: 0 };
  const watchers = [];

  /* Rows the database will never accept — an answer about a word that has
     since been deleted, say. They are set aside here rather than retried for
     ever, because a single one of them used to hold up everything queued
     behind it and the count on screen would sit there, unmoving, all evening. */
  const BLOCKED_KEY = 'arabuzz.sync.blocked.v1';
  const MAX_BLOCKED = 60;
  let blocked = [];
  function loadBlocked() {
    try { const r = localStorage.getItem(BLOCKED_KEY); blocked = r ? JSON.parse(r) : []; }
    catch (e) { blocked = []; }
    if (!Array.isArray(blocked)) blocked = [];
  }
  function saveBlocked() {
    try { localStorage.setItem(BLOCKED_KEY, JSON.stringify(blocked.slice(-MAX_BLOCKED))); }
    catch (e) {}
  }
  function setAside(table, row, err) {
    blocked.push({
      table: table,
      id: (row && (row.id || row.child_id)) || null,
      word_id: (row && row.word_id) || null,
      code: (err && err.code) || '',
      msg: (err && err.message) || String(err || ''),
      at: Date.now()
    });
    if (blocked.length > MAX_BLOCKED) blocked = blocked.slice(-MAX_BLOCKED);
    saveBlocked();
    console.warn('[sync] set aside a row the database refused', table, err);
  }

  function onChange(fn) { watchers.push(fn); }
  function announce() {
    state.pending = outbox.length + dirtyProg.size + dirtyGame.size;
    watchers.forEach(fn => { try { fn(status()); } catch (e) { console.error(e); } });
  }

  function status() {
    return {
      pending: outbox.length + dirtyProg.size + dirtyGame.size,
      lastPush: state.lastPush,
      lastPull: state.lastPull,
      error: state.error,
      failing: fails > 0,
      blocked: blocked.length,
      online: navigator.onLine !== false,
      live: !!(w.Cloud && Cloud.signedIn())
    };
  }

  /* ------------------------------------------------------- what is waiting
     status() answers "is anything waiting?" with a number. That number is
     what the pill shows, and it was not enough: a parent who sees "38 changes
     waiting" has no idea what 38 of anything means, whether it matters, or
     whether there is anything they can do about it.

     This answers the same question in nouns. It also names the two states
     that look identical from outside and are not — waiting for the internet,
     and refused by the account — because only one of them is going to clear
     on its own. */
  const KINDS = {
    attempt: ['answer', 'Words she typed, right and wrong.'],
    session: ['practice round', 'The score at the end of each game.']
  };

  function details() {
    const counts = {};
    outbox.forEach(o => { counts[o.t] = (counts[o.t] || 0) + 1; });
    const items = [];
    Object.keys(KINDS).forEach(k => {
      if (counts[k]) items.push({ key: k, n: counts[k], noun: KINDS[k][0], why: KINDS[k][1] });
    });
    Object.keys(counts).forEach(k => {
      if (!KINDS[k]) items.push({ key: k, n: counts[k], noun: 'change', why: '' });
    });
    if (dirtyProg.size) items.push({ key: 'progress', n: dirtyProg.size, noun: 'word',
      why: 'Which practice box each word has moved into.' });
    if (dirtyGame.size) items.push({ key: 'game', n: dirtyGame.size, noun: 'scoreboard',
      why: 'Points, level and the daily streak.' });

    /* Coach notes are not in the outbox — they are written straight into the
       account when they are made, and only end up here if that write failed
       or happened offline. They are the one thing a parent actually reads,
       so they are counted separately and named. */
    let notes = 0;
    try {
      const db = S().db;
      const bags = [db].concat(db.children || []);
      bags.forEach(b => (b.reports || []).forEach(r => { if (!r.cloudId) notes++; }));
    } catch (e) {}
    if (notes) items.push({ key: 'report', n: notes, noun: 'coach note',
      why: 'Written on this device and not yet in your account.' });

    return Object.assign(status(), {
      items,
      waiting: items.reduce((n, x) => n + x.n, 0),
      blocked: blocked.slice(),
      paused: paused
    });
  }

  /** Everything, both ways, right now — and tell the caller how it went.
   *  Clears the back-off first: a parent pressing a button is a better
   *  reason to try than a timer, even if the last four attempts failed. */
  async function syncNow() {
    fails = 0;
    state.error = null;
    announce();
    await flush(true);
    await pull({ deep: true });
    return details();
  }

  /* ------------------------------------------------------------------- ids */
  function uuid() {
    if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID();
    // Old Safari. Same shape, same uniqueness for our purposes.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
      const r = (w.crypto && w.crypto.getRandomValues)
        ? w.crypto.getRandomValues(new Uint8Array(1))[0] % 16
        : Math.floor(Math.random() * 16);
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /* --------------------------------------------------------------- outbox */
  function loadOutbox() {
    try {
      const raw = localStorage.getItem(OUTBOX_KEY);
      outbox = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(outbox)) outbox = [];
    } catch (e) { outbox = []; }
  }

  function saveOutbox() {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    } catch (e) {
      // Storage full. Her own device always wins: shed the oldest answers,
      // which are the least valuable thing in here, and keep going.
      outbox = outbox.filter(o => o.t !== 'attempt').concat(
        outbox.filter(o => o.t === 'attempt').slice(-500));
      try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch (_) {}
    }
  }

  function queue(kind, row) {
    outbox.push({ t: kind, r: row });
    if (outbox.length > MAX_OUTBOX) {
      const keep = outbox.filter(o => o.t !== 'attempt');
      const att  = outbox.filter(o => o.t === 'attempt').slice(-(MAX_OUTBOX - keep.length));
      outbox = keep.concat(att);
    }
    saveOutbox();
    schedule();
  }

  function marks() {
    try { return JSON.parse(localStorage.getItem(MARK_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function mark(patch) {
    try { localStorage.setItem(MARK_KEY, JSON.stringify(Object.assign(marks(), patch))); }
    catch (e) {}
  }

  /* ======================================================================
     WHAT THE APP TELLS US
     Four small hooks, called from store.js, game.js and engine.js. None of
     them touch the network; they append to a list and return.
     ====================================================================== */

  /** An answer, right or wrong. */
  function noteAttempt(a) {
    const childId = S().db.activeChildId;
    if (!isDbId(childId)) return;             // a child who has never met the database
    queue('attempt', {
      id: a.id && isDbId(a.id) ? a.id : uuid(),
      child_id: childId,
      word_id: isDbId(a.wordId) ? a.wordId : null,
      session_id: isDbId(a.sessionId) ? a.sessionId : null,
      deck_id: isDbId(a.weekId) ? a.weekId : null,
      ts: new Date(a.ts || Date.now()).toISOString(),
      mode: a.mode || null,
      given: String(a.given == null ? '' : a.given),
      ok: !!a.ok,
      ms: Math.max(0, Math.round(a.ms || 0)) || null,
      // The letter-level diagnosis. This is what the weekly note is built on,
      // so it travels with the answer rather than being recomputed later.
      errors: {
        tags: a.tags || [],
        primary: a.primary || null,
        soundsRight: !!a.soundsRight,
        firstTry: !!a.firstTry,
        correct: a.correct || null
      }
    });
  }

  /** A finished game. */
  function noteSession(s) {
    const childId = S().db.activeChildId;
    if (!isDbId(childId) || !s) return;
    queue('session', {
      id: isDbId(s.id) ? s.id : uuid(),
      child_id: childId,
      ts: new Date(s.ts || Date.now()).toISOString(),
      kind: s.kind || 'quiz',
      preset: s.preset || null,
      label: s.label || null,
      deck_ids: (s.weekIds || []).filter(isDbId),
      total: s.total || 0,
      correct: s.correct || 0,
      points: s.points || 0,
      stars: s.stars || 0,
      ms: Math.max(0, Math.round(s.ms || 0)) || null
    });
    noteGame();
  }

  /** A word whose Leitner box, streak or misspellings have moved. */
  function noteProgress(wordId) {
    const childId = S().db.activeChildId;
    if (!isDbId(childId) || !isDbId(wordId)) return;
    dirtyProg.add(childId + '::' + wordId);
    schedule();
  }

  /** Points, level, streak, badges. */
  function noteGame() {
    const childId = S().db.activeChildId;
    if (!isDbId(childId)) return;
    dirtyGame.add(childId);
    schedule();
  }

  /* ======================================================================
     PUSHING
     ====================================================================== */

  function schedule() {
    announce();
    clearTimeout(timer);
    timer = setTimeout(() => { flush(); }, DEBOUNCE_MS);
  }

  /** Read a child's progress row, whether they are the child playing now or
   *  one of the others parked in db.children. */
  function progressOf(childId, wordId) {
    const db = S().db;
    if (childId === db.activeChildId) return db.progress[wordId] || null;
    const slot = (db.children || []).find(c => c.id === childId);
    return slot && slot.progress ? (slot.progress[wordId] || null) : null;
  }

  function gameOf(childId) {
    const db = S().db;
    if (childId === db.activeChildId) return db.game || null;
    const slot = (db.children || []).find(c => c.id === childId);
    return slot ? slot.game : null;
  }

  const iso = ms => (ms ? new Date(ms).toISOString() : null);

  function progressRow(childId, wordId) {
    const p = progressOf(childId, wordId);
    if (!p) return null;
    return {
      child_id: childId,
      word_id: wordId,
      box: p.box || 0,
      due_at: iso(p.due),
      seen: p.seen || 0,
      right_count: p.right || 0,
      wrong_count: p.wrong || 0,
      streak: p.streak || 0,
      last_modes: p.lastModes || [],
      variant_use: p.variantUse || {},
      misspellings: p.misspellings || [],
      first_seen: iso(p.firstSeen),
      last_seen: iso(p.lastSeen),
      updated_at: new Date().toISOString()
    };
  }

  function gameRow(childId) {
    const g = gameOf(childId);
    if (!g) return null;
    return {
      child_id: childId,
      points: g.points || 0,
      level: g.level || 1,
      streak_days: g.streakDays || 0,
      best_streak: g.bestStreak || 0,
      last_play_day: g.lastPlayDay || null,
      badges: g.badges || [],
      freezes: g.freezes == null ? 1 : g.freezes,
      total_sessions: g.totalSessions || 0,
      updated_at: new Date().toISOString()
    };
  }

  function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  /* ----------------------------------------------------- refusal vs outage
     Two very different failures wear the same coat. A dropped wifi, an
     expired token or a server having a bad minute is TEMPORARY — the right
     answer is to keep the rows and try again shortly. A broken foreign key,
     a check constraint or a row-level-security refusal is PERMANENT — trying
     again in five minutes, and every five minutes after that, changes
     nothing except that everything queued behind it never leaves the device.
     Postgres error codes tell the two apart: 22xxx (bad value), 23xxx
     (constraint), 42xxx (permission / undefined) are all permanent. */
  function isPermanent(err) {
    const code = String((err && err.code) || '');
    if (/^(22|23|42)/.test(code)) return true;
    if (code === 'PGRST204' || code === 'PGRST301') return true;
    const st = Number(err && (err.status || err.statusCode));
    if (st === 400 || st === 403 || st === 404 || st === 409 || st === 422) return true;
    return false;
  }

  /**
   * Send rows without ever letting one bad row hold the rest hostage.
   * If a batch is refused for a permanent reason it is split in half, and
   * half again, until the offending row stands alone — that one is set aside
   * and everything else goes through. A temporary failure is re-thrown, so
   * the caller keeps the rows and backs off as before.
   */
  async function sendRows(table, rows, conflict) {
    const work = [rows.slice()];
    const rejected = [];
    while (work.length) {
      const part = work.shift();
      if (!part.length) continue;
      const { error } = await Cloud.from(table).upsert(part, { onConflict: conflict });
      if (!error) continue;
      if (!isPermanent(error)) throw error;          // outage — retry the lot later
      if (part.length === 1) { setAside(table, part[0], error); rejected.push(part[0]); continue; }
      const mid = Math.ceil(part.length / 2);
      work.unshift(part.slice(0, mid), part.slice(mid));
    }
    return rejected;
  }

  /**
   * Empty the outbox. Safe to call at any time and from anywhere — it does
   * nothing if it is already running, offline, or nobody is signed in.
   *
   * Order matters: sessions before attempts, because an attempt points at a
   * session. Progress and game state last, because they are a picture of
   * "now" and are read fresh at this moment rather than when they changed.
   */
  /* Everything stops while another family's data is on screen. Syncing then
     would push this device's outbox into whichever account is being looked
     at — the single most damaging thing "view as" could do. */
  let paused = false;
  function pause() { paused = true; }
  function resume() { paused = false; }

  async function flush(force) {
    if (paused || flushing) return;
    if (!w.Cloud || !Cloud.available() || !Cloud.signedIn()) return;
    if (navigator.onLine === false) return;

    const me = Cloud.whoAmI();
    if (!me || !me.parent) return;

    // Something is wrong at the far end — back off rather than hammering it.
    if (!force && fails && Date.now() - state.lastPush < BACKOFF_MS[Math.min(fails - 1, BACKOFF_MS.length - 1)]) return;

    const progKeys = Array.from(dirtyProg);
    const gameKeys = Array.from(dirtyGame);
    if (!outbox.length && !progKeys.length && !gameKeys.length) return;

    flushing = true;
    state.error = null;
    S().stashActive();          // make sure the parked children are up to date

    try {
      /* ---- 1 · sessions, then attempts, in the order they were queued ----
         Note what is being removed: the exact items we sent, not everything of
         that kind. She may well be answering another question while this is in
         flight, and anything queued during the send has not been sent yet. */
      for (const kind of ['session', 'attempt']) {
        const sending = outbox.filter(o => o.t === kind);
        if (!sending.length) continue;
        const table = kind === 'session' ? 'sessions' : 'attempts';
        for (const part of chunk(sending.map(o => o.r), BATCH)) {
          await sendRows(table, part, 'id');
        }
        /* Only now is it safe to forget them — including the ones the
           database refused outright, which are recorded in `blocked` and
           must not be queued again. */
        const sent = new Set(sending);
        outbox = outbox.filter(o => !sent.has(o));
        saveOutbox();
      }

      /* ---- 2 · progress, read fresh ---- */
      if (progKeys.length) {
        const rows = progKeys
          .map(k => { const [c, wd] = k.split('::'); return progressRow(c, wd); })
          .filter(Boolean);
        for (const part of chunk(rows, BATCH)) {
          await sendRows('progress', part, 'child_id,word_id');
        }
        progKeys.forEach(k => dirtyProg.delete(k));
      }

      /* ---- 3 · game state ---- */
      if (gameKeys.length) {
        const rows = gameKeys.map(gameRow).filter(Boolean);
        if (rows.length) await sendRows('game_state', rows, 'child_id');
        gameKeys.forEach(k => dirtyGame.delete(k));
      }

      fails = 0;
      state.lastPush = Date.now();
      mark({ lastPush: state.lastPush });
    } catch (e) {
      fails++;
      state.lastPush = Date.now();
      state.error = e && e.message ? e.message : String(e);
      console.warn('[sync] push failed, will retry', e);
    } finally {
      flushing = false;
      announce();
    }
  }

  /* ======================================================================
     PULLING
     Word lists and children come down. This is what makes a second device —
     her iPad, after the parent set everything up on a phone — fill itself in
     without anybody typing anything twice.
     ====================================================================== */

  /** Database word → the shape the rest of the app already understands. */
  function wordIn(row) {
    const x = row.extras || {};
    return {
      id: row.id,
      word: row.word,
      meaning: row.meaning || '',
      kidMeaning: row.kid_meaning || '',
      syllables: row.syllables || '',
      trickyBit: row.tricky_bit || '',
      memoryTrick: row.memory_trick || '',
      clues: row.clues || [],
      sentences: x.sentences || [],
      misspellings: x.misspellings || [],
      wrongMeanings: x.wrongMeanings || [],
      pronunciation: x.pronunciation || '',
      partOfSpeech: x.partOfSpeech || '',
      crosswordClue: x.crosswordClue || '',
      funFact: x.funFact || '',
      sort: row.sort || 0,
      addedAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
  }

  /** …and back the other way, for the admin console when it publishes a sheet. */
  function wordOut(pack, deckId, sort) {
    return {
      id: isDbId(pack.id) ? pack.id : uuid(),
      deck_id: deckId,
      sort: sort || 0,
      word: pack.word,
      meaning: pack.meaning || null,
      kid_meaning: pack.kidMeaning || null,
      syllables: pack.syllables || null,
      tricky_bit: pack.trickyBit || null,
      memory_trick: pack.memoryTrick || null,
      clues: pack.clues || [],
      extras: {
        sentences: pack.sentences || [],
        misspellings: pack.misspellings || [],
        wrongMeanings: pack.wrongMeanings || [],
        pronunciation: pack.pronunciation || '',
        partOfSpeech: pack.partOfSpeech || '',
        crosswordClue: pack.crosswordClue || '',
        funFact: pack.funFact || ''
      }
    };
  }

  /**
   * This device may already know a word under a local id, because it was
   * practised from a sheet loaded here before the database existed. When the
   * same word arrives from the database, the two must become one — and the
   * history has to survive, because it is the whole point.
   *
   * So: every child's progress on the old id is moved to the database id,
   * every set that mentions the old id is repointed, and only then is the old
   * word forgotten.
   */
  function absorbLocalDuplicate(db, dbId, key) {
    const stale = Object.keys(db.words).filter(id =>
      id !== dbId && !isDbId(id) && S().wordKey(db.words[id].word) === key);
    if (!stale.length) return;

    stale.forEach(oldId => {
      const move = (bag) => {
        if (!bag || !bag[oldId]) return;
        const from = bag[oldId];
        const to = bag[dbId];
        if (!to || !(to.seen || 0)) bag[dbId] = from;          // nothing there yet — keep it whole
        else {                                                  // both have history: add it up
          to.seen  = (to.seen  || 0) + (from.seen  || 0);
          to.right = (to.right || 0) + (from.right || 0);
          to.wrong = (to.wrong || 0) + (from.wrong || 0);
          to.box   = Math.max(to.box || 0, from.box || 0);
          to.misspellings = S().uniq([].concat(to.misspellings || [], from.misspellings || [])).slice(-8);
          to.firstSeen = Math.min(to.firstSeen || Infinity, from.firstSeen || Infinity) || 0;
          to.lastSeen  = Math.max(to.lastSeen || 0, from.lastSeen || 0);
        }
        delete bag[oldId];
      };
      move(db.progress);
      (db.children || []).forEach(c => move(c.progress));

      const repoint = (list) => list.map(id => (id === oldId ? dbId : id));
      (db.weeks || []).forEach(k => { k.wordIds = S().uniq(repoint(k.wordIds || [])); });
      db.attempts.forEach(a => { if (a.wordId === oldId) a.wordId = dbId; });
      (db.children || []).forEach(c =>
        (c.attempts || []).forEach(a => { if (a.wordId === oldId) a.wordId = dbId; }));

      delete db.words[oldId];
    });
  }

  /** Word lists Prem has published, and which of them this family may see. */
  async function pullDecks() {
    const { data: decks, error: e1 } = await Cloud.from('decks')
      .select('*').eq('status', 'published').order('no');
    if (e1) throw e1;

    /* A sheet Prem has deleted — or withdrawn — leaves this device too: the
       week, its words (unless another week still uses them), and their
       progress rows. Devices used to keep local copies of sheets that no
       longer existed anywhere, which is why "delete and start from scratch"
       never quite finished the job. Practice history is untouched: every
       recorded answer carries its own copy of the word it was about. */
    {
      const dbx = S().db;
      const liveIds = new Set((decks || []).map(d => d.id));
      const gone = (dbx.weeks || []).filter(k => k.fromCloud && !liveIds.has(k.id));
      if (gone.length) {
        const goneIds = new Set(gone.map(k => k.id));
        dbx.weeks = dbx.weeks.filter(k => !goneIds.has(k.id));
        const used = new Set();
        dbx.weeks.forEach(k => (k.wordIds || []).forEach(id => used.add(id)));
        Object.keys(dbx.words).forEach(id => { if (!used.has(id)) delete dbx.words[id]; });
        const sweep = bag => { if (bag) Object.keys(bag).forEach(id => { if (!used.has(id)) delete bag[id]; }); };
        sweep(dbx.progress);
        (dbx.children || []).forEach(c => sweep(c.progress));
        S().save(true);
      }
    }

    if (!decks || !decks.length) return 0;

    const ids = decks.map(d => d.id);
    const { data: words, error: e2 } = await Cloud.from('words')
      .select('*').in('deck_id', ids).order('sort');
    if (e2) throw e2;

    const db = S().db;
    const byDeck = {};
    (words || []).forEach(row => {
      const pack = wordIn(row);
      absorbLocalDuplicate(db, row.id, S().wordKey(pack.word));
      db.words[row.id] = Object.assign(db.words[row.id] || {}, pack);
      S().ensureProgress(row.id);
      (db.children || []).forEach(c => {
        if (c.progress && !c.progress[row.id]) {
          c.progress[row.id] = { box: 0, due: 0, seen: 0, right: 0, wrong: 0, streak: 0,
                                 lastModes: [], variantUse: {}, misspellings: [],
                                 firstSeen: 0, lastSeen: 0 };
        }
      });
      (byDeck[row.deck_id] = byDeck[row.deck_id] || []).push(row.id);
    });

    decks.forEach(d => {
      const at = db.weeks.findIndex(k => k.id === d.id);
      const wk = {
        id: d.id,
        no: d.no,
        title: d.title,
        topic: d.topic || '',
        sentOn: d.sent_on || '',
        assessedOn: d.assessed_on || '',
        createdAt: d.created_at ? Date.parse(d.created_at) : Date.now(),
        published: true,
        fromCloud: true,
        /* A sheet from the school belongs to everybody. A page of one child's
           own marked work belongs to her alone — her sister must never be
           asked to spell the words her sister got wrong. */
        childId: d.child_id || null,
        wordIds: byDeck[d.id] || []
      };
      if (at >= 0) db.weeks[at] = Object.assign(db.weeks[at], wk);
      else db.weeks.unshift(wk);
    });

    /* A local, unpublished week whose words have all been absorbed into a
       published deck is the SAME sheet wearing its old id. Leaving it in the
       list showed a second "Publish" button for a sheet already out — one
       more tap made a duplicate, empty deck. It goes; the published copy
       carries everything, including the practice history just merged in. */
    const cloudWeekIds = new Set(decks.map(d => d.id));
    db.weeks = db.weeks.filter(k => {
      if (cloudWeekIds.has(k.id) || k.fromCloud || isDbId(k.id)) return true;
      const ids = k.wordIds || [];
      if (!ids.length) return false;                        // empty local shell
      const covered = db.weeks.some(o =>
        o !== k && cloudWeekIds.has(o.id) && ids.every(id => (o.wordIds || []).includes(id)));
      return !covered;
    });

    db.weeks.sort((a, b) => (b.no || 0) - (a.no || 0));
    db.weekSeq = Math.max(db.weekSeq || 0, ...db.weeks.map(k => k.no || 0), 0);
    return decks.length;
  }

  /**
   * The children on the account become the children on this device, carrying
   * their database id as their local id. A second device therefore recognises
   * her the moment the parent signs in on it, with no "which child is this?".
   */
  function adoptChildren(me) {
    const db = S().db;
    const cloudKids = (me && me.children ? me.children : []).filter(c => c.active !== false);
    if (!cloudKids.length) return;

    S().stashActive();

    cloudKids.forEach(kid => {
      const at = (db.children || []).findIndex(c => c.id === kid.id);
      if (at < 0) {
        S().addChild(kid.name, {
          id: kid.id,
          emoji: kid.avatar || null,
          colour: kid.colour || null,
          pronoun: kid.pronoun || 'they',
          classLabel: kid.class_label || ''
        });
      } else {
        const slot = db.children[at];
        slot.profile = Object.assign({ createdAt: Date.now() }, slot.profile, {
          name: kid.name,
          pronoun: kid.pronoun || (slot.profile && slot.profile.pronoun) || 'they',
          classLabel: kid.class_label || ''
        });
        if (kid.avatar) slot.profile.emoji = kid.avatar;
        if (kid.colour) slot.profile.colour = kid.colour;
        if (kid.baseline && !slot.profile.baseline) slot.profile.baseline = kid.baseline;
        /* The active child lives in the LIVE fields, not the slot — update
           both, or the next stash writes the old name straight back and the
           picker shows "Speller" for a child the account knows by name. */
        if (kid.id === db.activeChildId && db.profile) {
          db.profile.name = kid.name;
          db.profile.pronoun = kid.pronoun || db.profile.pronoun || 'they';
          if (kid.avatar) db.profile.emoji = kid.avatar;
          if (kid.colour) db.profile.colour = kid.colour;
          /* The starting-point answers too. Without this line a child who
             did her first quiz on one device arrives on the next one with no
             baseline in the live profile, the coach report decides there is
             nothing to write about, and the starting-point note is never
             written at all — on any device. */
          if (kid.baseline && !db.profile.baseline) db.profile.baseline = kid.baseline;
        }
      }
    });

    // If nobody is playing yet, the first child on the account is.
    if (!db.activeChildId || !db.children.some(c => c.id === db.activeChildId)) {
      S().switchChild(cloudKids[0].id);
    }
    S().save(true);
  }

  /**
   * A device that has never been played on gets the child's history handed to
   * it. A device that HAS been played on is left alone — what is on the device
   * is newer than what is in the database by definition, because the device is
   * where it happened.
   */
  async function pullChildState(childId) {
    const db = S().db;
    const slot = db.children.find(c => c.id === childId);
    if (!slot) return;
    const played = (slot.sessions || []).length || (slot.attempts || []).length;
    if (played) return;

    const [{ data: prog }, { data: game }, { data: sess }] = await Promise.all([
      Cloud.from('progress').select('*').eq('child_id', childId),
      Cloud.from('game_state').select('*').eq('child_id', childId).maybeSingle(),
      Cloud.from('sessions').select('*').eq('child_id', childId).order('ts', { ascending: false }).limit(200)
    ]);

    const bag = {};
    (prog || []).forEach(r => {
      bag[r.word_id] = {
        box: r.box || 0,
        due: r.due_at ? Date.parse(r.due_at) : 0,
        seen: r.seen || 0, right: r.right_count || 0, wrong: r.wrong_count || 0,
        streak: r.streak || 0,
        lastModes: r.last_modes || [], variantUse: r.variant_use || {},
        misspellings: r.misspellings || [],
        firstSeen: r.first_seen ? Date.parse(r.first_seen) : 0,
        lastSeen: r.last_seen ? Date.parse(r.last_seen) : 0
      };
    });
    slot.progress = Object.assign(bag, slot.progress || {});

    if (game) {
      slot.game = {
        points: game.points || 0, level: game.level || 1,
        streakDays: game.streak_days || 0, bestStreak: game.best_streak || 0,
        lastPlayDay: game.last_play_day || '', badges: game.badges || [],
        freezes: game.freezes == null ? 1 : game.freezes,
        totalSessions: game.total_sessions || 0, plumes: 0
      };
    }

    slot.sessions = (sess || []).map(r => ({
      id: r.id, ts: r.ts ? Date.parse(r.ts) : Date.now(),
      kind: r.kind || 'quiz', preset: r.preset || '', label: r.label || '',
      weekIds: r.deck_ids || [], total: r.total || 0, correct: r.correct || 0,
      points: r.points || 0, stars: r.stars || 0, ms: r.ms || 0
    }));

    if (db.activeChildId === childId) {
      db.progress = slot.progress;
      db.game = slot.game;
      db.sessions = slot.sessions;
    }
    S().save(true);
  }

  /** Everything that comes down, in the right order. */
  async function pull(opts) {
    if (paused || pulling) return;
    if (!w.Cloud || !Cloud.available() || !Cloud.signedIn()) return;
    if (navigator.onLine === false) return;
    pulling = true;
    try {
      const me = Cloud.whoAmI() || await Cloud.load();
      if (!me || !me.parent) return;

      /* Whose family does the data on this device belong to? If the person
         now signed in belongs to a DIFFERENT family — a deleted-and-reinvited
         test family, a fresh start, someone else's phone — everything personal
         on the device is from a family that no longer owns it. It is wiped
         before anything is adopted or pushed, or a ghost child from the old
         family walks straight into the new one. Settings survive; they belong
         to the device, not the family. */
      const db0 = S().db;
      const famId = me.parent.family_id;
      if (db0.familyId && famId && db0.familyId !== famId) {
        console.warn('[sync] a different family signed in — starting this device fresh for them');
        db0.children = []; db0.activeChildId = null; db0.profile = null;
        db0.progress = {}; db0.attempts = []; db0.sessions = []; db0.reports = [];
        db0.weeks = []; db0.words = {};
        db0.game = S().blank().game;
        outbox = []; saveOutbox(); dirtyProg.clear(); dirtyGame.clear();
        blocked = []; saveBlocked();
        S().save(true);
      }
      if (famId) { db0.familyId = famId; }

      adoptChildren(me);
      await pullDecks();

      if (opts && opts.deep) {
        for (const kid of (me.children || [])) {
          try { await pullChildState(kid.id); } catch (e) { console.warn('[sync] child state', e); }
        }
      }

      S().save(true);

      /* A note written on this device belongs in the account too. This used
         to happen only when a parent opened the Coach Report, which meant a
         note could sit on one laptop for days while the other showed fewer.
         Now every sync sweeps them up, so the devices agree without anybody
         being told to go and look at something. */
      /* Notes move BOTH ways here, for EVERY child, on every sync.

         The gap Prem hit was this: her iPad showed two coach notes and his
         laptop showed one. Neither device was wrong. The Wednesday note is
         written by the server as structured data with no HTML — each device
         renders it into a readable note itself when it merges — and the merge
         only ever ran inside the Coach Report tab, for whichever child
         happened to be open, silently doing nothing if anything about that
         moment was not right. So a note could be in the account and invisible
         on a device that had simply never opened the right tab.

         Pushing without pulling made it worse: this loop used to send notes
         up and never bring any down. Both directions now run here, for all
         her children, whether or not anybody opens anything. */
      if (w.Parent) {
        for (const kid of (me.children || [])) {
          if (Parent.pushAnyStrandedReports) {
            try { await Parent.pushAnyStrandedReports(kid.id); }
            catch (e) { console.warn('[sync] note up', e); }
          }
          if (Parent.mergeCloudReports) {
            try { await Parent.mergeCloudReports(kid.id); }
            catch (e) { console.warn('[sync] note down', e); }
          }
        }
      }

      state.lastPull = Date.now();
      mark({ lastPull: state.lastPull });
      if (w.UI && UI.refreshAfterSync) UI.refreshAfterSync();
    } catch (e) {
      state.error = e && e.message ? e.message : String(e);
      console.warn('[sync] pull failed', e);
    } finally {
      pulling = false;
      announce();
    }
  }

  /* ======================================================================
     CREATING A CHILD
     One place, so a child can never exist on the device but not in the
     database — which is exactly how two devices end up disagreeing about who
     she is.
     ====================================================================== */
  async function createChild(fields) {
    if (w.Cloud && Cloud.available() && Cloud.signedIn()) {
      const row = await Cloud.addChild({
        name: fields.name,
        avatar: fields.emoji || null,
        colour: fields.colour || null,
        pronoun: fields.pronoun || 'they',
        classLabel: fields.classLabel || ''
      });
      S().addChild(row.name, {
        id: row.id,
        emoji: row.avatar || fields.emoji,
        colour: row.colour || fields.colour,
        pronoun: row.pronoun || fields.pronoun || 'they',
        classLabel: row.class_label || ''
      });
      return row.id;
    }
    // No account on this device — the old, purely local behaviour.
    const kid = S().addChild(fields.name, fields);
    return kid.id;
  }

  /** Anything the parent changes about a child goes both places. */
  async function saveChild(childId, patch) {
    const db = S().db;
    const slot = db.children.find(c => c.id === childId);
    if (slot && slot.profile) {
      if (patch.name != null)     slot.profile.name = patch.name;
      if (patch.pronoun != null)  slot.profile.pronoun = patch.pronoun;
      if (patch.emoji != null)    slot.profile.emoji = patch.emoji;
      if (patch.colour != null)   slot.profile.colour = patch.colour;
      if (patch.baseline != null) slot.profile.baseline = patch.baseline;
      if (childId === db.activeChildId) db.profile = slot.profile;
    }
    S().save(true);

    if (!isDbId(childId) || !w.Cloud || !Cloud.signedIn()) return;
    const out = {};
    if (patch.name != null)     out.name = patch.name;
    if (patch.pronoun != null)  out.pronoun = patch.pronoun;
    if (patch.emoji != null)    out.avatar = patch.emoji;
    if (patch.colour != null)   out.colour = patch.colour;
    if (patch.baseline != null) out.baseline = patch.baseline;
    if (!Object.keys(out).length) return;
    try { await Cloud.saveChild(childId, out); }
    catch (e) { console.warn('[sync] child not saved', e); }
  }

  /* ======================================================================
     STARTING UP
     ====================================================================== */
  async function start() {
    if (started) return;
    started = true;

    await pull({ deep: true });
    flush(true);

    clearInterval(beat);
    beat = setInterval(() => {
      flush();
      // New sheets, new children, new notes appear on their own — nobody
      // should have to close and reopen the app to see what Prem published.
      if (Date.now() - state.lastPull > PULL_EVERY_MS) pull();
    }, HEARTBEAT_MS);

    // The three moments worth catching: the wifi coming back, the app being
    // put away, and the app being closed.
    w.addEventListener('online', () => { fails = 0; flush(true); pull(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flush(true);
      else { flush(); if (Date.now() - state.lastPull > 60000) pull(); }
    });
    w.addEventListener('pagehide', () => { try { S().save(true); saveOutbox(); } catch (e) {} });

    if (w.Cloud && Cloud.onChange) {
      Cloud.onChange(() => { pull({ deep: true }); });
    }
    announce();
  }

  /* Read the outbox the moment this file loads, not when syncing starts.
     A parent can be signed out — or simply offline at the wrong moment — while
     a child carries on playing, and the first thing queued after that would
     otherwise be written over the top of everything already waiting to be sent. */
  loadOutbox();
  loadBlocked();

  w.Sync = {
    start, pull, flush, status, details, syncNow, onChange, pause, resume,
    get blockedRows() { return blocked.slice(); },
    clearBlocked() { blocked = []; saveBlocked(); announce(); },
    noteAttempt, noteSession, noteProgress, noteGame,
    createChild, saveChild,
    uuid, isDbId, wordIn, wordOut,
    get outboxSize() { return outbox.length; }
  };
})(window);
