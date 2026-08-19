/* ==========================================================================
   AraBuzz — store.js
   All data lives on this device. Nothing is sent anywhere except the words
   themselves, which go to the Anthropic API for enrichment/analysis.
   ========================================================================== */
(function (w) {
  'use strict';

  const KEY = 'arabuzz.v1';
  const MAX_ATTEMPTS = 6000;

  /* --------------------------------------------------------------------------
     Several children share one AraBuzz.

     Word lists, settings and the API usage log are SHARED — you upload the
     school sheet once and every child gets it. Everything personal (profile,
     progress, answers, sessions, points, badges, reports) belongs to one child
     and is swapped in and out of the live fields below when you switch.

     The rest of the app keeps reading db.profile / db.progress / db.attempts
     exactly as before, so switching child is invisible to every other file.
     -------------------------------------------------------------------------- */
  const PERSONAL = ['profile', 'progress', 'attempts', 'sessions', 'game', 'reports'];

  const blank = () => ({
    version: 2,
    createdAt: Date.now(),
    children: [],               // [{id, ...personal fields}]
    activeChildId: null,
    profile: null,              // {name, createdAt, baseline, colour, emoji}
    settings: {
      apiKey: '',               // blank = use the built-in key from config.js
      apiBase: '',              // blank = talk to Anthropic directly
      modelPolicy: 'balanced',  // economy | balanced | best
      modelOverrides: {},       // job -> model, beats the policy
      model: 'claude-sonnet-5', // last-resort fallback only
      pin: '',
      theme: 'dark',
      quizLength: 10,
      sound: true,
      speakRate: 0.85,
      voiceURI: '',
      cloudVoice: false,       // off until a parent turns it on, eyes open
      dailyGoal: 1,
      allowSpotSpelling: true,
      warnCallsPerWeek: 40
    },
    weeks: [],                  // {id,no,title,topic,sentOn,assessedOn,createdAt,published,wordIds[]}
    weekSeq: 0,                 // last serial number handed out (never reused)
    words: {},                  // id -> word pack
    progress: {},               // wordId -> {box,due,seen,right,wrong,streak,lastModes[],variantUse{},misspellings[]}
    attempts: [],               // {id,ts,sessionId,wordId,mode,given,ok,ms,weekId,errors[]}
    sessions: [],               // {id,ts,kind,label,weekIds,total,correct,points,stars,ms}
    game: {
      points: 0, level: 1, streakDays: 0, lastPlayDay: '', bestStreak: 0,
      badges: [], freezes: 1, totalSessions: 0, plumes: 0
    },
    usage: [],                  // {ts,kind,model,inTok,outTok,est}
    reports: []                 // {id,ts,html,range}
  });

  let db = blank();
  let saveTimer = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        db = Object.assign(blank(), parsed);
        db.settings = Object.assign(blank().settings, parsed.settings || {});
        db.game = Object.assign(blank().game, parsed.game || {});
        migrateToChildren();
        numberWeeks();
      }
    } catch (e) {
      console.error('Load failed, starting fresh', e);
      db = blank();
    }
    return db;
  }

  /* ------------------------------------------------------------- children */
  const AVATARS = ['🦜', '🦉', '🐢', '🦊', '🐼', '🦁', '🐨', '🦄'];
  const COLOURS = ['#E8A33D', '#5B8FA8', '#6B9080', '#E07A5F', '#9B8AA6', '#C77DB0', '#4FB8D9', '#7FB069'];

  /** A single-child database from v1 becomes child number one. */
  function migrateToChildren() {
    if (db.children && db.children.length) return;
    db.children = [];
    if (db.profile) {
      const id = uid('c');
      db.activeChildId = id;
      db.children.push(packChild(id));
    }
  }

  function packChild(id) {
    const slot = { id };
    PERSONAL.forEach(f => { slot[f] = db[f]; });
    return slot;
  }

  function emptyPersonal() {
    const b = blank();
    return { profile: null, progress: {}, attempts: [], sessions: [], game: b.game, reports: [] };
  }

  /** Write the live fields back into the active child's slot. */
  function stashActive() {
    if (!db.activeChildId) return;
    const at = db.children.findIndex(c => c.id === db.activeChildId);
    const slot = packChild(db.activeChildId);
    if (at >= 0) db.children[at] = slot; else db.children.push(slot);
  }

  /** Load a child's slot into the live fields. */
  function switchChild(id) {
    if (id === db.activeChildId) return db.profile;
    stashActive();
    const next = db.children.find(c => c.id === id);
    if (!next) return null;
    PERSONAL.forEach(f => { db[f] = next[f] || emptyPersonal()[f]; });
    db.game = Object.assign(blank().game, db.game || {});
    db.activeChildId = id;
    // every word needs a progress row for this child
    Object.keys(db.words).forEach(wid => ensureProgress(wid));
    save(true);
    return db.profile;
  }

  /** `opts.id` lets a child arriving from the database keep the id she already
   *  has there, so the device and the account never disagree about who she is. */
  function addChild(name, opts) {
    stashActive();
    const o = opts || {};
    const id = o.id || uid('c');
    if (db.children.some(c => c.id === id)) { switchChild(id); return db.children.find(c => c.id === id); }
    const n = db.children.length;
    const fresh = emptyPersonal();
    fresh.profile = {
      name: String(name || 'Speller').trim() || 'Speller',
      createdAt: Date.now(),
      baseline: null,
      pronoun: o.pronoun || 'they',
      classLabel: o.classLabel || '',
      emoji: o.emoji || AVATARS[n % AVATARS.length],
      colour: o.colour || COLOURS[n % COLOURS.length]
    };
    db.children.push(Object.assign({ id }, fresh));
    PERSONAL.forEach(f => { db[f] = fresh[f]; });
    db.activeChildId = id;
    Object.keys(db.words).forEach(wid => ensureProgress(wid));
    save(true);
    return db.children[db.children.length - 1];
  }

  function removeChild(id) {
    db.children = db.children.filter(c => c.id !== id);
    if (db.activeChildId === id) {
      db.activeChildId = null;
      if (db.children.length) switchChild(db.children[0].id);
      else { const e = emptyPersonal(); PERSONAL.forEach(f => { db[f] = e[f]; }); }
    }
    save(true);
  }

  /** Lightweight summary for the picker, without unpacking each child. */
  function childList() {
    /* Self-heal: a profile that predates multi-child support lives only in
       the live fields, with no children[] entry and no activeChildId. Give
       it one, or the picker shows a nameless "Speller" ghost beside it. */
    if (db.profile && !db.activeChildId) {
      const id = uid('c');
      db.activeChildId = id;
      db.children.push(packChild(id));
      save(true);
    }
    stashActive();
    // The account may know a child's name even when this device's slot lost
    // it — never show "Speller" for a kid the family can name.
    const me = (window.Cloud && Cloud.whoAmI && Cloud.whoAmI()) || null;
    const cloudName = id => {
      const k = me && me.children && me.children.find(x => x.id === id);
      return k ? k.name : null;
    };
    return db.children.map(c => {
      const p = c.profile || {};
      const g = c.game || {};
      return {
        id: c.id,
        name: p.name || cloudName(c.id) || 'Speller',
        emoji: p.emoji || '🦜',
        colour: p.colour || '#E8A33D',
        points: g.points || 0,
        streak: g.streakDays || 0,
        level: Math.max(1, g.level || 1),
        sessions: (c.sessions || []).length,
        lastPlayed: (c.sessions || [])[0] ? c.sessions[0].ts : (p.createdAt || 0),
        active: c.id === db.activeChildId
      };
    });
  }

  function save(now) {
    clearTimeout(saveTimer);
    const doIt = () => {
      try {
        if (db.attempts.length > MAX_ATTEMPTS) db.attempts = db.attempts.slice(-MAX_ATTEMPTS);
        stashActive();
        localStorage.setItem(KEY, JSON.stringify(db));
      } catch (e) {
        console.error('Save failed', e);
        // Storage full — shed oldest attempts and retry once
        db.attempts = db.attempts.slice(-1500);
        db.reports = db.reports.slice(-4);
        try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (_) {}
      }
    };
    if (now) doIt(); else saveTimer = setTimeout(doIt, 400);
  }

  const uid = (p) => (p || 'x') + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------------------------------------------------------------- words */
  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function wordKey(word) { return normalize(word); }

  /** Adds or merges a word pack. Words are cached FOREVER by their spelling,
   *  so a word that appears in week 2 and again in week 9 costs nothing twice. */
  function upsertWord(pack) {
    const key = wordKey(pack.word);
    const existing = Object.values(db.words).find(x => wordKey(x.word) === key);
    if (existing) {
      // merge new variants in without losing history
      existing.clues = uniq([].concat(existing.clues || [], pack.clues || []));
      existing.sentences = uniq([].concat(existing.sentences || [], pack.sentences || []));
      existing.misspellings = uniq([].concat(existing.misspellings || [], pack.misspellings || []));
      existing.wrongMeanings = uniq([].concat(existing.wrongMeanings || [], pack.wrongMeanings || []));
      ['meaning', 'kidMeaning', 'syllables', 'pronunciation', 'partOfSpeech',
       'crosswordClue', 'trickyBit', 'funFact', 'memoryTrick'].forEach(f => {
        if (pack[f] && !existing[f]) existing[f] = pack[f];
      });
      return existing;
    }
    const id = uid('w');
    db.words[id] = Object.assign({
      id, word: pack.word, clues: [], sentences: [], misspellings: [], wrongMeanings: [],
      addedAt: Date.now()
    }, pack, { id });
    ensureProgress(id);
    return db.words[id];
  }

  function uniq(arr) {
    const seen = new Set(); const out = [];
    (arr || []).forEach(x => {
      const k = String(x || '').trim().toLowerCase();
      if (!k || seen.has(k)) return; seen.add(k); out.push(String(x).trim());
    });
    return out;
  }

  function ensureProgress(wordId) {
    if (!db.progress[wordId]) {
      db.progress[wordId] = {
        box: 0, due: 0, seen: 0, right: 0, wrong: 0, streak: 0,
        lastModes: [], variantUse: {}, misspellings: [], firstSeen: 0, lastSeen: 0
      };
    }
    return db.progress[wordId];
  }

  /* ---------------------------------------------------------------- weeks */

  /** Sets already on the device get numbered by the order they were added. */
  function numberWeeks() {
    const missing = (db.weeks || []).filter(k => !k.no);
    if (!missing.length) { db.weekSeq = Math.max(db.weekSeq || 0, ...db.weeks.map(k => k.no || 0), 0); return; }
    missing.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    let n = Math.max(db.weekSeq || 0, ...db.weeks.map(k => k.no || 0), 0);
    missing.forEach(k => { k.no = ++n; });
    db.weekSeq = n;
  }

  /** "03" — the sheet's number, zero-padded. Computed fresh from the TEST
   *  dates every time, so every sheet — including ones uploaded long ago —
   *  is numbered in the order the school year actually runs, and the number
   *  a kid sees matches the number the console shows. Sheets without a test
   *  date fall to the end; ties keep their upload order. */
  function weekTag(wk) {
    if (!wk) return '';
    const key = k => (k.assessedOn || '9999') + '·' + String(k.no || 0).padStart(4, '0');
    const ordered = (db.weeks || []).slice().sort((a, b) => key(a) < key(b) ? -1 : 1);
    const n = ordered.findIndex(k => k.id === wk.id) + 1;
    return n > 0 ? (n < 10 ? '0' + n : String(n)) : '';
  }

  function addWeek(meta, packs) {
    const wk = {
      id: uid('k'),
      no: ++db.weekSeq,
      title: meta.title || 'Spell Buzz Week',
      topic: meta.topic || '',
      sentOn: meta.sentOn || '',
      assessedOn: meta.assessedOn || '',
      createdAt: Date.now(),
      published: true,
      wordIds: []
    };
    (packs || []).forEach(p => { const wd = upsertWord(p); wk.wordIds.push(wd.id); });
    db.weeks.unshift(wk);
    save();
    return wk;
  }

  function deleteWeek(id) {
    db.weeks = db.weeks.filter(w => w.id !== id);
    save();
  }

  function weekWords(weekId) {
    const wk = db.weeks.find(w => w.id === weekId);
    if (!wk) return [];
    return wk.wordIds.map(id => db.words[id]).filter(Boolean);
  }

  function wordsFor(weekIds) {
    if (!weekIds || !weekIds.length) return [];
    const set = [];
    const seen = new Set();
    weekIds.forEach(k => weekWords(k).forEach(wd => {
      if (!seen.has(wd.id)) { seen.add(wd.id); set.push(wd); }
    }));
    return set;
  }

  function allWords() { return Object.values(db.words); }

  function weekOfWord(wordId) {
    return db.weeks.find(w => w.wordIds.indexOf(wordId) >= 0);
  }

  /* ------------------------------------------------------------- attempts */
  function logAttempt(a) {
    // A proper UUID, generated here, so that sending it to the database twice
    // is harmless. That is what makes syncing over a bad connection safe.
    a.id = (w.Sync ? Sync.uuid() : uid('a'));
    a.ts = Date.now();
    db.attempts.push(a);
    if (w.Sync) Sync.noteAttempt(a);
    return a;
  }

  function attemptsFor(wordId) { return db.attempts.filter(a => a.wordId === wordId); }

  function recentAttempts(days) {
    const cut = Date.now() - (days || 30) * 864e5;
    return db.attempts.filter(a => a.ts >= cut);
  }

  /* ---------------------------------------------------------------- usage */
  function logUsage(u) {
    db.usage.push(Object.assign({ ts: Date.now() }, u));
    if (db.usage.length > 800) db.usage = db.usage.slice(-800);
    save();
  }

  function usageThisWeek() {
    const cut = Date.now() - 7 * 864e5;
    const rows = db.usage.filter(u => u.ts >= cut);
    return {
      calls: rows.length,
      inTok: rows.reduce((s, r) => s + (r.inTok || 0), 0),
      outTok: rows.reduce((s, r) => s + (r.outTok || 0), 0),
      est: rows.reduce((s, r) => s + (r.est || 0), 0)
    };
  }

  /* ----------------------------------------------------------- export/imp */
  function exportBlob() {
    return new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('Not an AraBuzz backup');
    db = Object.assign(blank(), parsed);
    db.settings = Object.assign(blank().settings, parsed.settings || {});
    db.game = Object.assign(blank().game, parsed.game || {});
    migrateToChildren();
    numberWeeks();
    save(true);
    return db;
  }

  function wipe() { localStorage.removeItem(KEY); db = blank(); }

  w.Store = {
    get db() { return db; },
    load, save, uid, today, blank,
    normalize, wordKey, upsertWord, ensureProgress, uniq,
    AVATARS, COLOURS, switchChild, addChild, removeChild, childList, stashActive,
    addWeek, deleteWeek, weekWords, wordsFor, allWords, weekOfWord, weekTag, numberWeeks,
    logAttempt, attemptsFor, recentAttempts,
    logUsage, usageThisWeek,
    exportBlob, importJSON, wipe
  };
})(window);
