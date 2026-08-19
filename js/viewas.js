/* ==========================================================================
   AraBuzz — viewas.js
   Prem, looking at a family's own screens.

   The admin console used to open a child in a modal: a summary, in a layout
   no parent has ever seen. Useful for a glance, useless for the thing Prem
   actually needs — "what is this parent looking at, right now, on their
   phone, when they tell me something is wrong?" A support conversation about
   a screen you have never seen is a guessing game.

   So this borrows the whole app instead. Their children, their sheets, their
   practice, their notes are loaded into Store, and the ordinary grown-ups
   screens are rendered from them. Same pages, same order, same words. The
   only difference is a band across the top saying whose account this is.

   THREE THINGS KEEP IT SAFE, AND ALL THREE ARE DELIBERATE
   1. This device's own data is set aside, not overwritten, and handed back
      untouched on the way out. Saving is off the whole time.
   2. Looking cannot change anything. Writes are refused at the Cloud layer —
      one guard, not twenty — until Prem turns on "Act as this parent", which
      is a separate, deliberate switch with its own warning.
   3. Syncing is paused throughout. A device that syncs while holding another
      family's data would push this laptop's outbox into their account, which
      is the worst thing this feature could possibly do.

   Every entry is recorded in admin_views before anything loads, exactly as
   the old modal did — parents were promised that and it still holds.
   ========================================================================== */
(function (w) {
  'use strict';

  const { $, esc, toast, confirmBox } = w.U;

  let on = null;        // { family, parents, acting }

  const active      = () => !!on;
  const lookingOnly = () => !!on && !on.acting;

  /* ------------------------------------------------------------ the loading
     Everything a parent's screens read, fetched as the admin (row-level
     security allows it) and shaped exactly like the local db so that every
     screen renders without knowing anything unusual is happening. */
  async function buildDb(family) {
    const fresh = Store.blank();
    fresh.familyId = family.id;

    const kids = (family.children || []).filter(c => c.active !== false);
    const kidIds = kids.map(c => c.id);

    const [{ data: decks }, { data: prog }, { data: att }, { data: sess },
           { data: reps }, { data: game }] = await Promise.all([
      Cloud.from('decks').select('*').order('no', { ascending: false }),
      kidIds.length ? Cloud.from('progress').select('*').in('child_id', kidIds) : { data: [] },
      kidIds.length ? Cloud.from('attempts').select('*').in('child_id', kidIds).order('ts', { ascending: false }).limit(3000) : { data: [] },
      kidIds.length ? Cloud.from('sessions').select('*').in('child_id', kidIds).order('ts', { ascending: false }).limit(400) : { data: [] },
      kidIds.length ? Cloud.from('reports').select('*').in('child_id', kidIds).order('ts', { ascending: false }).limit(40) : { data: [] },
      kidIds.length ? Cloud.from('game_state').select('*').in('child_id', kidIds) : { data: [] }
    ]);

    /* Sheets: the school's, plus any that belong to one of THIS family's
       children. A personal sheet from another family is invisible here for
       the same reason it is invisible to them — it is not theirs. */
    const mine = (decks || []).filter(d => !d.child_id || kidIds.includes(d.child_id));
    const ids = mine.map(d => d.id);
    const { data: words } = ids.length
      ? await Cloud.from('words').select('*').in('deck_id', ids).order('sort')
      : { data: [] };

    const byDeck = {};
    (words || []).forEach(row => {
      fresh.words[row.id] = w.Sync.wordIn ? Sync.wordIn(row) : { id: row.id, word: row.word };
      (byDeck[row.deck_id] = byDeck[row.deck_id] || []).push(row.id);
    });
    fresh.weeks = mine.map(d => ({
      id: d.id, no: d.no, title: d.title, topic: d.topic || '',
      sentOn: d.sent_on || '', assessedOn: d.assessed_on || '',
      createdAt: d.created_at ? Date.parse(d.created_at) : Date.now(),
      published: d.status === 'published', fromCloud: true,
      childId: d.child_id || null, wordIds: byDeck[d.id] || []
    }));

    const packProgress = (childId) => {
      const out = {};
      (prog || []).filter(r => r.child_id === childId).forEach(r => {
        out[r.word_id] = {
          box: r.box || 0, due: r.due_at ? Date.parse(r.due_at) : 0,
          seen: r.seen || 0, right: r.right_count || 0, wrong: r.wrong_count || 0,
          streak: r.streak || 0, lastModes: r.last_modes || [],
          variantUse: r.variant_use || {}, misspellings: r.misspellings || [],
          firstSeen: r.first_seen ? Date.parse(r.first_seen) : 0,
          lastSeen: r.last_seen ? Date.parse(r.last_seen) : 0
        };
      });
      return out;
    };
    const packAttempts = (childId) => (att || []).filter(a => a.child_id === childId).map(a => ({
      ts: Date.parse(a.ts), wordId: a.word_id, given: a.given, ok: a.ok,
      mode: a.mode, correct: a.correct, errors: a.errors || [], ms: a.ms || 0
    }));
    const packSessions = (childId) => (sess || []).filter(x => x.child_id === childId).map(x => ({
      ts: Date.parse(x.ts), kind: x.kind, preset: x.preset, label: x.label,
      total: x.total, correct: x.correct, points: x.points, stars: x.stars, ms: x.ms || 0
    }));
    const packReports = (childId) => (reps || []).filter(r => r.child_id === childId).map(r => {
      const pay = r.payload || {};
      return { id: Store.uid('r'), cloudId: r.id, ts: Date.parse(r.ts), html: r.html || '',
               kind: pay.kind || 'weekly', range: pay.kind === 'onboarding' ? 'Starting point' : 'Weekly note',
               headline: pay.result ? pay.result.headline : '', metrics: pay.metrics || null };
    });
    const packGame = (childId) => {
      const g = (game || []).find(x => x.child_id === childId);
      const blank = Store.blank().game;
      if (!g) return blank;
      return Object.assign(blank, {
        points: g.points || 0, level: g.level || 1, streakDays: g.streak_days || 0,
        bestStreak: g.best_streak || 0, lastPlayDay: g.last_play_day || '',
        badges: g.badges || [], freezes: g.freezes == null ? 1 : g.freezes,
        totalSessions: g.total_sessions || 0
      });
    };

    fresh.children = kids.map(c => ({
      id: c.id,
      profile: { name: c.name, emoji: c.avatar || null, colour: c.colour || null,
                 pronoun: c.pronoun || 'they', classLabel: c.class_label || '',
                 baseline: c.baseline || null, createdAt: Date.parse(c.created_at) || Date.now() },
      progress: packProgress(c.id), attempts: packAttempts(c.id),
      sessions: packSessions(c.id), reports: packReports(c.id), game: packGame(c.id)
    }));

    if (fresh.children.length) {
      const first = fresh.children[0];
      fresh.activeChildId = first.id;
      fresh.profile  = Object.assign({}, first.profile);
      fresh.progress = first.progress;
      fresh.attempts = first.attempts;
      fresh.sessions = first.sessions;
      fresh.reports  = first.reports;
      fresh.game     = first.game;
    }
    return fresh;
  }

  /* ------------------------------------------------------------------ entry */
  async function start(family) {
    if (on) return;
    if (!family || !family.id) return toast('Pick a family first.');

    /* The admin's own PIN, every time — the same gate the old modal used. */
    const pin = await w.U.promptBox('Your PIN',
      'Opening a family’s screens needs your PIN, every time.', '••••••', 'password');
    if (!pin) return;
    let ok = false;
    try { ok = await Cloud.checkPin(String(pin).trim()); } catch (e) {}
    if (!ok) return toast('That’s not it.', 'bad');

    /* Recorded before anything is read. If the record cannot be written, the
       door stays shut — parents were told every look is logged. */
    try {
      const { error } = await Cloud.from('admin_views').insert({
        admin_id: Cloud.session.user.id, family_id: family.id, child_id: null
      });
      if (error) throw error;
    } catch (e) {
      return toast('Not opened — the record of you looking could not be written.', 'bad', 5000);
    }

    toast('Loading their screens…', '', 1800);
    let theirs;
    try { theirs = await buildDb(family); }
    catch (e) { return toast('Could not load that family — ' + (e.message || e), 'bad', 5000); }

    if (w.Sync && Sync.pause) Sync.pause();
    Store.borrow(theirs);
    on = { family, acting: false };

    banner();
    w.Parent.paint({ tab: 'about' });
  }

  function stop() {
    if (!on) return;
    Store.giveBack();
    if (w.Sync && Sync.resume) Sync.resume();
    on = null;
    const b = document.getElementById('vaBar');
    if (b) b.remove();
    document.body.classList.remove('viewing-as');
    if (w.Admin && Admin.paint) Admin.paint({ tab: 'families' });
    else w.UI.go('admin');
  }

  /* ----------------------------------------------------------------- banner */
  function banner() {
    let bar = document.getElementById('vaBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'vaBar';
      document.body.appendChild(bar);
      document.body.classList.add('viewing-as');
    }
    const fam = on.family;
    bar.className = 'va-bar' + (on.acting ? ' acting' : '');
    bar.innerHTML = `
      <span class="va-what">${on.acting ? 'ACTING AS' : 'LOOKING AT'}</span>
      <b>${esc(fam.name || 'this family')}</b>
      <span class="va-note">${on.acting
        ? 'anything you change is theirs, for real'
        : 'nothing you touch is saved'}</span>
      <button class="btn-quiet btn-s" id="vaAct">${on.acting ? 'Stop acting' : 'Act as this parent'}</button>
      <button class="btn-primary btn-s" id="vaOut">Leave</button>`;

    document.getElementById('vaOut').onclick = stop;
    document.getElementById('vaAct').onclick = async () => {
      if (on.acting) {
        on.acting = false;
        Store.allowWrites(false);
        banner();
        return toast('Back to looking. Nothing you do is saved.', '', 3000);
      }
      const yes = await confirmBox('Act as this parent?',
        `<p style="margin:0 0 10px">From now until you turn this off, what you do here is done to
            <b>${esc(fam.name || 'this family')}</b>'s real account — their words, their settings,
            their child's practice.</p>
         <p style="margin:0">Useful when a parent is on the phone and stuck. Easy to regret when you
            are only browsing. Your visit is already recorded either way.</p>`,
        'Yes, act for them');
      if (!yes) return;
      on.acting = true;
      Store.allowWrites(true);
      banner();
      toast('You are acting for them now. Changes are real.', 'bad', 4200);
    };
  }

  w.ViewAs = { start, stop, active, lookingOnly, get family() { return on ? on.family : null; } };
})(window);
