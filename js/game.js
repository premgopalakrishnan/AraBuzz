/* ==========================================================================
   AraBuzz — game.js
   Points, levels, streaks, badges and the Word Garden.

   Design notes (these matter more than they look):
     • Points are never taken away. Losing points makes children stop playing.
     • The streak has one free "freeze" so a single missed day doesn't undo
       three weeks of habit — the streak is the strongest return-driver we have,
       and it must not feel brittle.
     • Levelling is front-loaded: the first few come quickly, then slow down.
     • Rewards are things she OWNS (Ara's feathers, her garden), not just numbers.
   ========================================================================== */
(function (w) {
  'use strict';

  const S = () => window.Store;

  /* ---------------------------------------------------------------- levels */
  function pointsForLevel(n) {           // cumulative points needed to REACH level n
    let total = 0;
    for (let i = 1; i < n; i++) total += 80 + 40 * i;
    return total;
  }
  function levelFor(points) {
    let n = 1;
    while (pointsForLevel(n + 1) <= points && n < 60) n++;
    return n;
  }
  function levelProgress(points) {
    const lv = levelFor(points);
    const base = pointsForLevel(lv), next = pointsForLevel(lv + 1);
    return { level: lv, into: points - base, need: next - base, pct: (points - base) / (next - base) };
  }

  /* ---------------------------------------------------------------- points */
  const POINTS = { first: 10, second: 6, hinted: 4, choice: 8, speedMax: 5 };

  function awardPoints(n) {
    const g = S().db.game;
    const before = levelFor(g.points);
    g.points += Math.max(0, Math.round(n));
    const after = levelFor(g.points);
    return { gained: n, levelUp: after > before, level: after };
  }

  /* --------------------------------------------------------------- streaks */
  function touchStreak() {
    const g = S().db.game;
    const today = S().today();
    if (g.lastPlayDay === today) return { changed: false, streak: g.streakDays };

    const gap = g.lastPlayDay ? window.U.daysBetween(g.lastPlayDay, today) : 999;
    let usedFreeze = false, broke = false;

    if (!g.lastPlayDay) g.streakDays = 1;
    else if (gap === 1) g.streakDays += 1;
    else if (gap === 2 && g.freezes > 0) { g.freezes--; g.streakDays += 1; usedFreeze = true; }
    else { g.streakDays = 1; broke = gap > 1; }

    g.lastPlayDay = today;
    g.bestStreak = Math.max(g.bestStreak || 0, g.streakDays);

    // earn a freeze back every 7 days, capped at 2
    if (g.streakDays % 7 === 0) g.freezes = Math.min(2, (g.freezes || 0) + 1);

    return { changed: true, streak: g.streakDays, usedFreeze, broke };
  }

  /* ---------------------------------------------------------------- badges */
  const BADGES = [
    { id: 'first_flight', ic: 'leaf', name: 'First Flight',    ds: 'Finish your first quiz' },
    { id: 'perfect', ic: 'target', name: 'Perfect Buzz',    ds: 'Every word right in one quiz' },
    { id: 'streak3', ic: 'flame', name: '3 Day Streak',    ds: 'Play 3 days in a row' },
    { id: 'streak7', ic: 'flame', name: 'Week Warrior',    ds: 'Play 7 days in a row' },
    { id: 'streak14', ic: 'bolt', name: 'Two Week Wonder', ds: '14 days in a row' },
    { id: 'streak30', ic: 'trophy', name: 'Month Master',    ds: '30 days in a row' },
    { id: 'words10', ic: 'sprout', name: 'Ten Grown',       ds: '10 words fully grown' },
    { id: 'words25', ic: 'leaf', name: 'Garden Keeper',   ds: '25 words fully grown' },
    { id: 'words50', ic: 'tree', name: 'Word Forest',     ds: '50 words fully grown' },
    { id: 'tricky', ic: 'sparkle', name: 'Tricky Tamer',    ds: 'Master a word you kept getting wrong' },
    { id: 'speedster', ic: 'clock', name: 'Speedster',       ds: 'Ace a Beat the Buzzer round' },
    { id: 'crossword', ic: 'puzzle', name: 'Puzzle Brain',    ds: 'Finish a whole crossword' },
    { id: 'wordsearch', ic: 'search', name: 'Eagle Eye',       ds: 'Find every word in a word search' },
    { id: 'listener', ic: 'ear', name: 'Good Ears',       ds: '30 right in Listen and Spell' },
    { id: 'explorer', ic: 'target', name: 'Explorer',        ds: 'Try every kind of question' },
    { id: 'champion', ic: 'trophy', name: 'Champion',        ds: 'Score 90% in a Championship Buzz' },
    { id: 'comeback', ic: 'star', name: 'Welcome Back',    ds: 'Come back after a break' },
    { id: 'earlybird', ic: 'sparkle', name: 'Early Bird',      ds: 'Practise before 8 in the morning' },
    { id: 'nightowl', ic: 'macaw', name: 'Night Owl',       ds: 'Practise after 8 at night' },
    { id: 'century', ic: 'medal', name: 'Century',         ds: 'Answer 100 questions altogether' }
  ];

  function has(id) { return S().db.game.badges.indexOf(id) >= 0; }

  function grant(id) {
    if (has(id)) return null;
    S().db.game.badges.push(id);
    return BADGES.find(b => b.id === id) || null;
  }

  /** Runs after every session. Returns the badges newly earned. */
  function checkBadges(ctx) {
    const db = S().db, g = db.game, out = [];
    const add = id => { const b = grant(id); if (b) out.push(b); };

    if (g.totalSessions >= 1) add('first_flight');
    if (ctx && ctx.total >= 6 && ctx.correct === ctx.total) add('perfect');
    if (g.streakDays >= 3) add('streak3');
    if (g.streakDays >= 7) add('streak7');
    if (g.streakDays >= 14) add('streak14');
    if (g.streakDays >= 30) add('streak30');

    const grown = grownCount();
    if (grown >= 10) add('words10');
    if (grown >= 25) add('words25');
    if (grown >= 50) add('words50');

    // mastered something she used to fail
    const tricky = Object.keys(db.progress).some(id => {
      const p = db.progress[id];
      return p.wrong >= 3 && (p.box || 0) >= 5;
    });
    if (tricky) add('tricky');

    if (ctx && ctx.preset === 'buzzer' && ctx.total >= 8 && ctx.correct / ctx.total >= 0.9) add('speedster');
    if (ctx && ctx.preset === 'championship' && ctx.total >= 8 && ctx.correct / ctx.total >= 0.9) add('champion');
    if (ctx && ctx.kind === 'crossword' && ctx.complete) add('crossword');
    if (ctx && ctx.kind === 'wordsearch' && ctx.complete) add('wordsearch');

    const listenRight = db.attempts.filter(a => a.mode === 'listen' && a.ok).length;
    if (listenRight >= 30) add('listener');

    const modesTried = new Set(db.attempts.map(a => a.mode));
    if (window.Engine.ALL_MODES.every(m => modesTried.has(m))) add('explorer');

    if (db.attempts.length >= 100) add('century');

    const h = new Date().getHours();
    if (h < 8) add('earlybird');
    if (h >= 20) add('nightowl');

    if (ctx && ctx.gapDays >= 3) add('comeback');

    return out;
  }

  /* ----------------------------------------------------------- word garden */
  // Each word is a plant. It grows through the Leitner boxes.
  /** A word's plant is drawn (see icons.js), not an emoji — so a garden of
   *  them reads as one illustration rather than a sticker sheet. */
  function plantFor(wordId) {
    const pr = S().db.progress[wordId] || {};
    const box = Math.min(6, pr.box || 0);
    return {
      stage: box,
      svg: (o) => window.Icon ? Icon.plant(box, o) : '',
      box, pct: box / 6, grown: box >= 5
    };
  }

  function grownCount() {
    return Object.keys(S().db.progress).filter(id => (S().db.progress[id].box || 0) >= 5).length;
  }

  function garden() {
    return S().allWords().map(wd => ({ word: wd, plant: plantFor(wd.id), prog: S().db.progress[wd.id] || {} }))
      .sort((a, b) => b.plant.box - a.plant.box || a.word.word.localeCompare(b.word.word));
  }

  /* -------------------------------------------------------------- session  */
  function finishSession(ctx) {
    const db = S().db, g = db.game;
    const prevDay = g.lastPlayDay;
    const gapDays = prevDay ? window.U.daysBetween(prevDay, S().today()) : 0;

    g.totalSessions = (g.totalSessions || 0) + 1;
    const streak = touchStreak();

    db.sessions.unshift({
      id: S().uid('s'), ts: Date.now(),
      kind: ctx.kind || 'quiz', preset: ctx.preset || '', label: ctx.label || '',
      weekIds: ctx.weekIds || [], total: ctx.total || 0, correct: ctx.correct || 0,
      points: ctx.points || 0, stars: ctx.stars || 0, ms: ctx.ms || 0
    });
    if (db.sessions.length > 400) db.sessions.length = 400;

    const badges = checkBadges(Object.assign({ gapDays }, ctx));
    S().save();
    return { streak, badges, gapDays };
  }

  /* ---------------------------------------------------------------- stats  */
  function todayCount() {
    const t = S().today();
    return S().db.sessions.filter(s => new Date(s.ts).toISOString().slice(0, 10) === t).length;
  }

  function stats() {
    const db = S().db;
    const att = db.attempts;
    const right = att.filter(a => a.ok).length;
    return {
      points: db.game.points,
      level: levelFor(db.game.points),
      streak: db.game.streakDays,
      bestStreak: db.game.bestStreak,
      sessions: db.game.totalSessions,
      answered: att.length,
      accuracy: att.length ? right / att.length : 0,
      grown: grownCount(),
      words: Object.keys(db.words).length,
      badges: db.game.badges.length,
      badgeTotal: BADGES.length
    };
  }

  w.Game = {
    POINTS, BADGES,
    pointsForLevel, levelFor, levelProgress, awardPoints,
    touchStreak, has, grant, checkBadges,
    plantFor, grownCount, garden, finishSession, todayCount, stats
  };
})(window);
