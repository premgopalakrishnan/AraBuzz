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
      online: navigator.onLine !== false,
      live: !!(w.Cloud && Cloud.signedIn())
    };
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

  /**
   * Empty the outbox. Safe to call at any time and from anywhere — it does
   * nothing if it is already running, offline, or nobody is signed in.
   *
   * Order matters: sessions before attempts, because an attempt points at a
   * session. Progress and game state last, because they are a picture of
   * "now" and are read fresh at this moment rather than when they changed.
   */
  async function flush(force) {
    if (flushing) return;
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
        for (const part of chunk(sending.map(o => o.r), BATCH)) {
          const { error } = await Cloud.from(kind === 'session' ? 'sessions' : 'attempts')
            .upsert(part, { onConflict: 'id' });
          if (error) throw error;
        }
        // Only now is it safe to forget them.
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
          const { error } = await Cloud.from('progress')
            .upsert(part, { onConflict: 'child_id,word_id' });
          if (error) throw error;
        }
        progKeys.forEach(k => dirtyProg.delete(k));
      }

      /* ---- 3 · game state ---- */
      if (gameKeys.length) {
        const rows = gameKeys.map(gameRow).filter(Boolean);
        if (rows.length) {
          const { error } = await Cloud.from('game_state')
            .upsert(rows, { onConflict: 'child_id' });
          if (error) throw error;
        }
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
    if (pulling) return;
    if (!w.Cloud || !Cloud.available() || !Cloud.signedIn()) return;
    if (navigator.onLine === false) return;
    pulling = true;
    try {
      const me = Cloud.whoAmI() || await Cloud.load();
      if (!me || !me.parent) return;

      adoptChildren(me);
      await pullDecks();

      if (opts && opts.deep) {
        for (const kid of (me.children || [])) {
          try { await pullChildState(kid.id); } catch (e) { console.warn('[sync] child state', e); }
        }
      }

      S().save(true);
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

  w.Sync = {
    start, pull, flush, status, onChange,
    noteAttempt, noteSession, noteProgress, noteGame,
    createChild, saveChild,
    uuid, isDbId, wordIn, wordOut,
    get outboxSize() { return outbox.length; }
  };
})(window);
