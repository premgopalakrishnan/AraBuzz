/* ==========================================================================
   AraBuzz — admin.js
   Prem's console. Nobody else has one.

   There are five families and nine children. This is not an administration
   system and should never grow into one — it exists to do six things:

     invite a family · publish a sheet · see that a child is actually playing ·
     see what it is costing · switch a family off · look at a child's data when
     a parent asks for help

   Two rules from the product, enforced here rather than assumed:

     · NO CHILD IS EVER COMPARED WITH ANOTHER. This screen shows nine children
       on one page, which makes a league table the easiest mistake in the world
       to make. So: no sorting by score, no ranking, no class average, no
       totals across children. Each child is a card that stands alone, and the
       order is the order they joined. If you ever find yourself adding a
       "top performers" section, read this paragraph again.
     · LOOKING AT A CHILD IS RECORDED. Opening a child's data writes a row to
       admin_views before it shows anything. Parents were told that in the
       consent screen, so it is a promise, not a feature.
   ========================================================================== */
(function (w) {
  'use strict';

  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = window.U ? U.esc : (s => String(s == null ? '' : s));
  const toast = (m, k, t) => window.U.toast(m, k, t);

  let tab = 'families';
  let data = null;         // the last admin_overview()
  let dataAt = 0;          // when it was fetched
  let loading = false;
  let inviteNotice = null; // the result of the last invitation, kept across repaints
  let watching = false;    // the live-refresh loop, started once

  /** modal() gives back a card that already contains its own close button;
   *  everything we write goes inside the body, not over the top of it. */
  const body = m => m.box.querySelector('.modal-body') || m.box;

  const money = n => '$' + (Math.round((+n || 0) * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00');
  const when = ts => {
    if (!ts) return 'not yet';
    const d = new Date(ts), days = Math.floor((Date.now() - d) / 864e5);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return days + ' days ago';
    return window.U.fmtDate(d.getTime());
  };

  /* ======================================================================
     LOADING
     ====================================================================== */
  async function refresh() {
    loading = true;
    try {
      const { data: d, error } = await Cloud.rpc('admin_overview');
      if (error) throw error;
      data = d;
      dataAt = Date.now();
    } catch (e) {
      console.error('[admin]', e);
      data = null;
      toast(e.message || 'Could not load the console.', 'bad');
    } finally {
      loading = false;
    }
  }

  /* ======================================================================
     THE SCREEN
     ====================================================================== */
  async function paint(opts) {
    if (opts && opts.tab) tab = opts.tab;
    const scr = $('#scr-admin');
    const me = Cloud.whoAmI();

    if (!me || !me.isAdmin) {
      scr.innerHTML = `<div class="card" style="max-width:520px;margin:40px auto;text-align:center">
        <h1>Not for you</h1><p class="muted">This is the AraBuzz admin console.</p>
        <button class="btn-primary" id="adBack">Back</button></div>`;
      $('#adBack').onclick = () => UI.go('home');
      return;
    }

    if (!data) {
      scr.innerHTML = `<div class="loading-box" style="margin:60px auto">
        <span class="loader"></span><p class="muted small">Reading the account…</p></div>`;
      await refresh();
    }

    const kids = allChildren();
    scr.innerHTML = `
      <div class="row between wrap" style="gap:10px">
        <div>
          <h1 style="margin-bottom:2px">AraBuzz admin</h1>
          <p class="muted small" style="margin:0">
            ${window.U.plural(familyCount(), 'family', 'families')} ·
            ${window.U.plural(kids.length, 'child', 'children')} ·
            ${money(data && data.spend ? data.spend.all_time : 0)} spent in total</p>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn-quiet btn-s" id="adRefresh">${Icon.icon('swap', { size: 15 })} Refresh</button>
          <button class="btn-ghost btn-s" id="adExit">← Back to the app</button>
        </div>
      </div>

      <div class="tabs" id="atabs" style="margin-top:16px">
        ${[['families', 'home', 'Families'], ['invite', 'mail', 'Invite'],
           ['upload', 'upload', 'Add words'], ['sheets', 'book', 'Sheets'],
           ['spend', 'chart', 'Usage']]
          .map(([k, i, t]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">
             ${Icon.icon(i, { size: 16 })} ${t}</button>`).join('')}
      </div>
      <div id="atab"></div>`;

    $('#adExit').onclick = () => UI.go('home');
    $('#adRefresh').onclick = async (e) => {
      e.target.disabled = true; data = null; await paint(); };
    $$('#atabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; paint(); });

    ({ families: tabFamilies, invite: tabInvite, upload: tabUploadHere,
       sheets: tabSheets, spend: tabSpend }[tab] || tabFamilies)();
    watch();
  }

  /** Adding a sheet lives here now — the same flow parent.js has always had,
   *  painted into this console instead of the grown-ups screen. */
  function tabUploadHere() {
    if (window.Parent && Parent.openUpload) Parent.openUpload();
    else $('#atab').innerHTML = '<p class="muted">Not available.</p>';
  }

  /* ======================================================================
     STAYING FRESH
     The console re-reads the account every half minute while it is on
     screen, and the moment the window regains focus — so an invitation
     being accepted, a child finishing a game, or anything else shows up on
     its own. It never repaints under your fingers: if a modal is open or
     you are typing in a field, it waits for the next pass.
     ====================================================================== */
  function safeToRepaint() {
    if (document.hidden) return false;
    if (!window.UI || UI.current !== 'admin') return false;
    // Never repaint over a sheet being read, checked or published — that
    // work-in-progress lives only on this screen and would be lost.
    if (tab === 'upload') return false;
    if (document.querySelector('.modal-bg')) return false;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')
          && $('#scr-admin') && $('#scr-admin').contains(a)) return false;
    return true;
  }

  async function liveCheck() {
    if (!safeToRepaint()) return;
    const before = JSON.stringify(data);
    try {
      const { data: d, error } = await Cloud.rpc('admin_overview');
      if (error || !d) return;
      if (JSON.stringify(d) !== before) {
        data = d; dataAt = Date.now();
        if (safeToRepaint()) paint();
      } else {
        dataAt = Date.now();
      }
    } catch (e) { /* quiet — the next pass will try again */ }
  }

  function watch() {
    if (watching) return;
    watching = true;
    setInterval(liveCheck, 30000);
    window.addEventListener('focus', () => {
      if (Date.now() - dataAt > 10000) liveCheck();
    });
  }

  const families = () => (data && data.families) || [];
  const familyCount = () => families().length;
  const allChildren = () => families().reduce((a, f) => a.concat(f.children || []), []);

  /* ======================================================================
     FAMILIES
     One card per family, in joining order. Deliberately not sortable.
     ====================================================================== */
  function tabFamilies() {
    const list = families();
    $('#atab').innerHTML = list.length ? `
      <p class="hint" style="margin:14px 0 4px">In the order they joined. There is no
         ranking here on purpose — no child is measured against another.</p>
      ${list.map(familyCard).join('')}`
      : `<div class="card" style="text-align:center;margin-top:20px">
           <p class="muted">No families yet. Start with the <b>Invite</b> tab.</p></div>`;

    $$('#atab [data-child]').forEach(b => b.onclick = () => openChild(b.dataset.child, b.dataset.family));
    $$('#atab [data-toggle-family]').forEach(b => b.onclick = () => toggleFamily(b.dataset.toggleFamily, b.dataset.to === '1'));
    $$('#atab [data-toggle-child]').forEach(b => b.onclick = () => toggleChild(b.dataset.toggleChild, b.dataset.to === '1'));
  }

  function familyCard(f) {
    const parents = f.parents || [];
    const kids = f.children || [];
    const mine = parents.some(p => p.role === 'admin');
    return `
      <div class="card" style="margin-top:14px;${f.active ? '' : 'opacity:.6'}">
        <div class="row between wrap" style="gap:8px">
          <div>
            <h3 style="margin:0">${esc(f.name)}
              ${f.active ? '' : '<span class="pill">switched off</span>'}</h3>
            <p class="muted small" style="margin:2px 0 0">
              ${parents.map(p => esc(p.name) + (p.email ? ` &lt;${esc(p.email)}&gt;` : '')).join(' · ') || 'no parent yet'}
            </p>
          </div>
          ${mine
            ? '<span class="pill honey">your family</span>'
            : `<button class="btn-quiet btn-s" data-toggle-family="${f.id}" data-to="${f.active ? 0 : 1}">
                 ${f.active ? 'Switch off' : 'Switch back on'}</button>`}
        </div>

        <div class="row wrap" style="gap:6px;margin:10px 0 4px">
          ${parents.map(p => `
            <span class="pill ${p.consented ? 'sage' : ''}">${p.consented ? 'agreed' : 'not yet agreed'}</span>
            <span class="pill ${p.pin_set ? 'sage' : ''}">${p.pin_set ? 'PIN set' : 'no PIN'}</span>
            ${p.role === 'admin' ? '<span class="pill honey">admin</span>' : ''}`).join('')}
        </div>

        ${kids.length ? kids.map(c => childRow(c, f)).join('') : `
          <p class="muted small" style="margin:10px 0 0">No child added yet — the parent has
             signed in but not finished setting up.</p>`}
      </div>`;
  }

  /* A child's own row. Numbers describe only this child; there is nothing here
     to compare against, and that is the point. */
  function childRow(c, f) {
    const started = c.answers > 0;
    const stage = !c.has_baseline ? 'has not done the first check'
                : c.sessions === 0 ? 'first check done, no practice yet'
                : `${window.U.plural(c.sessions, 'game')} played`;
    return `
      <div class="card flat" style="margin-top:10px;${c.active ? '' : 'opacity:.55'}">
        <div class="row between wrap" style="gap:8px">
          <div>
            <b>${esc(c.name)}</b>
            <span class="faint small">· ${esc(c.pronoun || 'they')}${c.class_label ? ' · ' + esc(c.class_label) : ''}</span>
            <p class="muted small" style="margin:2px 0 0">${esc(stage)} · last played ${when(c.last_seen)}</p>
          </div>
          <div class="row" style="gap:6px">
            <button class="btn-quiet btn-s" data-child="${c.id}" data-family="${f.id}">Open</button>
            <button class="btn-quiet btn-s" data-toggle-child="${c.id}" data-to="${c.active ? 0 : 1}">
              ${c.active ? 'Switch off' : 'On'}</button>
          </div>
        </div>
        ${started ? `
          <div class="row wrap" style="gap:6px;margin-top:8px">
            <span class="pill">${c.words} words met</span>
            <span class="pill sage">${c.grown} known well</span>
            <span class="pill honey">${c.points} points</span>
            ${c.streak ? `<span class="pill coral">${c.streak} day streak</span>` : ''}
            ${c.reports ? `<span class="pill sky">${window.U.plural(c.reports, 'note')}</span>` : ''}
            <span class="pill faint">${money(c.spend)}</span>
          </div>` : ''}
      </div>`;
  }

  async function toggleFamily(id, on) {
    if (!on && !await window.U.confirmBox('Switch this family off?',
      `AraBuzz stops for their children straight away. Nothing is deleted, and you can
       switch them back on at any time.`, 'Switch off')) return;
    const patch = on ? { active: true, deactivated_at: null }
                     : { active: false, deactivated_at: new Date().toISOString() };
    const { error } = await Cloud.from('families').update(patch).eq('id', id);
    if (error) return toast(error.message, 'bad');
    data = null; paint();
    toast(on ? 'Switched back on.' : 'Switched off.', 'good');
  }

  async function toggleChild(id, on) {
    const patch = on ? { active: true, deactivated_at: null }
                     : { active: false, deactivated_at: new Date().toISOString() };
    const { error } = await Cloud.from('children').update(patch).eq('id', id);
    if (error) return toast(error.message, 'bad');
    data = null; paint();
  }

  /* ======================================================================
     LOOKING AT ONE CHILD
     Recorded before anything is shown. If the recording fails, nothing is
     shown — the promise in the consent screen comes first.
     ====================================================================== */
  async function openChild(childId, familyId) {
    /* The PIN first. One PIN — the admin's own — gates looking at ANY child.
       An unattended laptop with the console open must not be enough. */
    const pin = await window.U.promptBox('Your PIN',
      'Looking at a child\u2019s data needs your PIN, every time.', '\u2022\u2022\u2022\u2022', 'password');
    if (!pin) return;
    let pinOk = false;
    try { pinOk = await Cloud.checkPin(String(pin).trim()); } catch (e) {}
    if (!pinOk) return toast('That\u2019s not it.', 'bad');

    const kid = allChildren().find(c => c.id === childId) || {};
    const fam = families().find(f => (f.children || []).some(c => c.id === childId)) || {};

    const m = window.U.modal(`<div class="center-text" style="padding:20px">
      <span class="loader"></span><p class="muted small">Recording that you looked, then opening…</p></div>`);

    try {
      const { error } = await Cloud.from('admin_views').insert({
        admin_id: Cloud.session.user.id, family_id: fam.id || familyId || null, child_id: childId
      });
      if (error) throw error;
    } catch (e) {
      body(m).innerHTML = `<div class="feedback bad"><b>Not opened.</b>
        <p class="small" style="margin:6px 0 0">The record of you looking could not be written,
        and you told parents every look is recorded. So this stays shut.</p>
        <p class="small faint">${esc(e.message || e)}</p></div>`;
      return;
    }

    const famId = fam.id || familyId || null;
    const [{ data: prog }, { data: sess }, { data: att }, { data: shares }] = await Promise.all([
      Cloud.from('progress').select('box, seen, right_count, wrong_count, misspellings, word_id').eq('child_id', childId),
      Cloud.from('sessions').select('ts, kind, label, total, correct, points').eq('child_id', childId).order('ts', { ascending: false }).limit(12),
      Cloud.from('attempts').select('ts, given, ok, mode, errors, word_id').eq('child_id', childId).order('ts', { ascending: false }).limit(60),
      // the same cost picture the parent's Settings shows them, from the ledger
      famId ? Cloud.from('api_usage_shares').select('ts, kind, share_cost, share_in_tok, share_out_tok').eq('family_id', famId)
            : Promise.resolve({ data: [] })
    ]);

    const rows = prog || [];
    const wrong = (att || []).filter(a => !a.ok && a.given);
    const p = window.U.pronouns(kid.pronoun);

    /* What this family is costing — sliced exactly the way the parent's own
       Settings slices it, so "view as" genuinely shows what they see. */
    const week = Date.now() - 7 * 864e5;
    const sh = shares || [];
    const shWeek = sh.filter(x => Date.parse(x.ts) >= week);
    const sum = (list, f) => list.reduce((a, x) => a + (+x[f] || 0), 0);
    const cost = {
      weekCalls: shWeek.length,
      weekIn: sum(shWeek, 'share_in_tok'),
      weekOut: sum(shWeek, 'share_out_tok'),
      weekEst: sum(shWeek, 'share_cost'),
      allEst: sum(sh, 'share_cost'),
      allCalls: sh.length
    };

    body(m).innerHTML = `
      <div class="row between wrap" style="gap:8px">
        <h2 style="margin:0">${esc(kid.name)}</h2>
        <span class="pill faint">${esc(fam.name || '')}</span>
      </div>
      <p class="muted small" style="margin:4px 0 12px">
        You are looking at a child who is not yours. This has been recorded, with the time.
        ${p.Cap.their()} parent can see that record.</p>

      <div class="row wrap" style="gap:6px">
        <span class="pill">${rows.length} words met</span>
        <span class="pill sage">${rows.filter(r => (r.box || 0) >= 5).length} known well</span>
        <span class="pill">${window.U.plural((sess || []).length, 'recent game')}</span>
      </div>

      <h4 style="margin:16px 0 6px">Recent games</h4>
      ${(sess || []).length ? `<div class="list">${(sess || []).map(s => `
        <div class="row between"><span class="small">${esc(s.label || s.kind || 'practice')}</span>
        <span class="small faint">${s.correct}/${s.total} · ${window.U.fmtDay(Date.parse(s.ts))}</span></div>`).join('')}</div>`
        : '<p class="muted small">Nothing played yet.</p>'}

      <h4 style="margin:16px 0 6px">What it costs this family</h4>
      <p class="tiny faint" style="margin:0 0 8px">The same numbers their own Settings
         page shows them — their share of every AI call, from the ledger.</p>
      <div class="row wrap" style="gap:6px">
        <span class="pill honey">${money(cost.weekEst)} this week</span>
        <span class="pill">${window.U.plural(cost.weekCalls, 'call')} this week</span>
        <span class="pill sky">${cost.weekIn.toLocaleString()} in / ${cost.weekOut.toLocaleString()} out tokens</span>
        <span class="pill faint">${money(cost.allEst)} all time · ${window.U.plural(cost.allCalls, 'call')}</span>
      </div>

      <h4 style="margin:16px 0 6px">What ${p.they()} ${p.s('get')} wrong</h4>
      ${wrong.length ? `<div class="list">${wrong.slice(0, 14).map(a => `
        <div class="row between"><span class="small">wrote “${esc(a.given)}”</span>
        <span class="small faint">${esc((a.errors && a.errors.primary) || a.mode || '')}</span></div>`).join('')}</div>`
        : '<p class="muted small">Nothing wrong recorded yet.</p>'}

      <p class="tiny faint" style="margin-top:16px">This is a support view. Nothing here can be
         edited, and no report is written from it.</p>
      <button class="btn-primary btn-block" id="adClose" style="margin-top:10px">Close</button>`;
    body(m).querySelector('#adClose').onclick = () => m.close();
  }

  /* ======================================================================
     INVITING A FAMILY
     ====================================================================== */
  function tabInvite() {
    const invites = (data && data.invites) || [];
    const open = invites.filter(i => !i.accepted_at && Date.parse(i.expires_at) > Date.now());
    const used = invites.filter(i => i.accepted_at);

    $('#atab').innerHTML = `
      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">Invite someone</h3>
        <p class="muted small">Their name and their email — that's all. The invitation is
           emailed to them the moment you press the button, and you also get a WhatsApp
           version to copy if you'd rather send it yourself.</p>
        <div class="field"><label for="ivFam">Their first name</label>
          <input id="ivFam" placeholder="Meera"></div>
        <p class="hint" style="margin:-6px 0 14px">Just what you call them. It greets them by
           name in the email, and it is how they appear on this screen.</p>
        <div class="field"><label for="ivMail">Their email</label>
          <input id="ivMail" type="email" placeholder="meera@example.com"></div>
        <button class="btn-primary" id="ivGo" data-label="Invite them">Invite them</button>
        <div id="ivOut" style="margin-top:12px">${inviteNotice || ''}</div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">Waiting to be used (${open.length})</h3>
        ${open.length ? open.map(inviteRow).join('') : '<p class="muted small">None outstanding.</p>'}
      </div>

      ${used.length ? `<div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">Already used</h3>
        ${used.map(i => `<div class="row between"><span class="small">${esc(i.family_name)}</span>
          <span class="small faint">joined ${when(i.accepted_at)}</span></div>`).join('')}
      </div>` : ''}`;

    $('#ivGo').onclick = makeInvite;
    wireCopies();
    $$('#atab [data-cancel-invite]').forEach(b => b.onclick = async () => {
      const yes = await window.U.confirmBox('Cancel this invitation?',
        `${esc(b.dataset.cancelName)}'s code stops working immediately. If they already
         have the email, its link and code will simply say the invitation isn't valid.
         You can always invite them again.`, 'Cancel it');
      if (!yes) return;
      const { error } = await Cloud.from('invites').delete().eq('id', b.dataset.cancelInvite);
      if (error) return toast(error.message, 'bad');
      toast('Invitation cancelled.', 'good');
      data = null; paint();
    });
    $$('#atab [data-remail]').forEach(b => b.onclick = async () => {
      const [name, email, code] = b.dataset.remail.split('|');
      b.disabled = true; b.textContent = 'Sending…';
      const r = await emailInvite(name, email, code);
      b.textContent = r.ok ? 'Sent again' : 'Failed';
      setTimeout(() => { b.disabled = false; b.textContent = 'Email it again'; }, 2500);
      if (!r.ok) toast(r.error || 'Could not send.', 'bad');
    });
  }

  function inviteRow(i) {
    const link = appLink(i.code);
    return `
      <div class="card flat" style="margin-top:10px">
        <div class="row between wrap" style="gap:8px">
          <div><b>${esc(i.family_name)}</b>
            <p class="muted small" style="margin:2px 0 0">${esc(i.email || 'no email noted')} ·
               expires ${window.U.fmtDate(Date.parse(i.expires_at))}</p></div>
          <span class="pill honey" style="font-family:var(--font-body);letter-spacing:.08em">${esc(i.code)}</span>
        </div>
        <div class="row wrap" style="gap:6px;margin-top:8px">
          ${i.email ? `<button class="btn-quiet btn-s" data-remail="${esc(i.family_name)}|${esc(i.email)}|${esc(i.code)}">Email it again</button>` : ''}
          <button class="btn-quiet btn-s" data-copy="${esc(link)}">Copy link</button>
          <button class="btn-quiet btn-s" data-copy-msg="${esc(i.family_name)}|${esc(link)}">Copy WhatsApp message</button>
          <button class="btn-quiet btn-s" data-cancel-invite="${i.id}" data-cancel-name="${esc(i.family_name)}">Cancel invite</button>
        </div>
      </div>`;
  }

  async function makeInvite() {
    const name = $('#ivFam').value.trim();
    const email = $('#ivMail').value.trim();
    if (name.length < 2) return toast('Type their first name first.', 'bad');
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Type their email — the invitation is sent there.', 'bad');
    const btn = $('#ivGo'); btn.disabled = true; btn.textContent = 'Inviting…';
    try {
      const row = await Cloud.createInvite(name, email, null);
      const link = appLink(row.code);
      const mailed = await emailInvite(name, email, row.code);
      inviteNotice = `
        <div class="feedback ${mailed.ok ? 'good' : 'bad'}">
          <b>${mailed.ok ? `Invitation emailed to ${esc(email)}.` : 'The invitation exists, but the email did not send.'}</b>
          <p class="small" style="margin:6px 0">${mailed.ok
            ? `Code <b>${esc(row.code)}</b> — valid for 30 days, usable once. If it lands in
               their spam, the WhatsApp version below says the same thing.`
            : esc(mailed.error || '') + ' You can still send it yourself:'}</p>
          <div class="row wrap" style="gap:6px">
            <button class="btn-primary btn-s" data-copy-msg="${esc(name)}|${esc(link)}">Copy the WhatsApp message</button>
            <button class="btn-quiet btn-s" data-copy="${esc(link)}">Copy just the link</button>
          </div>
        </div>`;
      // repaint with fresh data, so the new invitation is already in the
      // waiting list below the moment the button finishes
      data = null;
      await paint();
    } catch (e) {
      toast(e.message || 'Could not make the invitation.', 'bad');
      btn.disabled = false; btn.textContent = 'Invite them';
    }
  }

  /** Every link AraBuzz hands out uses the real address, never vercel.app. */
  function appLink(code) {
    const base = (window.CONFIG && CONFIG.APP_URL) || location.origin;
    return base + '/?join=' + encodeURIComponent(code);
  }

  /** The server sends it, as arabuzz@cokindlelabs.com. */
  async function emailInvite(name, email, code) {
    try {
      const res = await fetch('/api/invite-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + Cloud.token },
        body: JSON.stringify({ name, email, code })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: j.error || ('Sending failed (' + res.status + ')') };
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  /** Prem's own words, so he can send it without rewriting it. These are
   *  people he knows, so it opens with their name rather than "Dear family". */
  function inviteMessage(name, link) {
    return `Hi ${name}! I built a small spelling app for the kids — it takes the weekly ` +
      `Spell Buzz sheets shared by the school and turns them into game-based practice they ` +
      `genuinely enjoy. To the kids it feels like playing; what they're really doing is ` +
      `training their spellings. Once a week it sends you a short note on what your child ` +
      `is finding tricky.\n\n` +
      `It's not a business — I made it for our own kids, and I'm sharing it only with ` +
      `close friends. And you can delete your data and exit the app anytime you wish.\n\n` +
      `Your link: ${link}\n\n` +
      `It takes about three minutes to set up. Any trouble, message me.\n\n— Prem`;
  }

  function wireCopies() {
    $$('[data-copy]').forEach(b => b.onclick = () => copy(b.dataset.copy, b));
    $$('[data-copy-msg]').forEach(b => b.onclick = () => {
      const [fam, link] = b.dataset.copyMsg.split('|');
      copy(inviteMessage(fam, link), b);
    });
  }

  function copy(text, btn) {
    const done = () => { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = t; }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => fallback(text, done));
    else fallback(text, done);
  }
  function fallback(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy it by hand:\n' + text); }
    ta.remove();
  }

  /* ======================================================================
     SHEETS
     A sheet is read, checked and enriched in the ordinary "Add words" tab —
     on this device, where the PDF is. This tab is only about who gets it.
     ====================================================================== */
  function tabSheets() {
    const decks = (data && data.decks) || [];
    const published = decks.filter(d => d.status === 'published');
    const drafts = decks.filter(d => d.status !== 'published');
    const local = (Store.db.weeks || []).filter(k => !decks.some(d => d.id === k.id));

    $('#atab').innerHTML = `
      ${local.length ? `
      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">On this device, not yet sent out (${local.length})</h3>
        <p class="muted small">Read and enriched here. Publishing copies the words to the
           database so the other families' devices can pick them up.</p>
        ${local.map(k => `
          <div class="card flat" style="margin-top:10px">
            <div class="row between wrap" style="gap:8px">
              <div><b>${esc(k.title)}</b> <span class="faint small">${Store.weekTag(k)}</span>
                <p class="muted small" style="margin:2px 0 0">${window.U.plural((k.wordIds || []).length, 'word')}${k.topic ? ' · ' + esc(k.topic) : ''}</p></div>
              <button class="btn-primary btn-s" data-publish="${k.id}">Publish</button>
            </div>
          </div>`).join('')}
      </div>` : ''}

      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">Published (${published.length})</h3>
        ${published.length ? published.map(deckRow).join('') : '<p class="muted small">Nothing published yet.</p>'}
      </div>

      ${drafts.length ? `<div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">Withdrawn (${drafts.length})</h3>
        <p class="muted small">Nobody can see these. Their practice history is untouched.</p>
        ${drafts.map(deckRow).join('')}
      </div>` : ''}`;

    $$('#atab [data-publish]').forEach(b => b.onclick = () => publishWeek(b.dataset.publish, b));
    $$('#atab [data-unpublish]').forEach(b => b.onclick = () => setStatus(b.dataset.unpublish, 'draft'));
    $$('#atab [data-republish]').forEach(b => b.onclick = () => setStatus(b.dataset.republish, 'published'));
    $$('#atab [data-audience]').forEach(b => b.onclick = () => chooseAudience(b.dataset.audience));
  }

  function deckRow(d) {
    const who = d.audience === 'all' ? 'everyone'
      : `${window.U.plural((d.assigned_to || []).length, 'family', 'families')}`;
    return `
      <div class="card flat" style="margin-top:10px">
        <div class="row between wrap" style="gap:8px">
          <div><b>${esc(d.title)}</b> <span class="faint small">${d.no < 10 ? '0' + d.no : d.no}</span>
            <p class="muted small" style="margin:2px 0 0">
              ${window.U.plural(d.word_count, 'word')}${d.topic ? ' · ' + esc(d.topic) : ''} ·
              goes to <b>${esc(who)}</b>${d.assessed_on ? ' · test ' + esc(d.assessed_on) : ''}</p></div>
          <div class="row" style="gap:6px">
            <button class="btn-quiet btn-s" data-audience="${d.id}">Who gets it</button>
            ${d.status === 'published'
              ? `<button class="btn-quiet btn-s" data-unpublish="${d.id}">Withdraw</button>`
              : `<button class="btn-primary btn-s" data-republish="${d.id}">Publish</button>`}
          </div>
        </div>
      </div>`;
  }

  /**
   * Copy a set that exists on this device into the database.
   *
   * The words get fresh database ids. The next sync merges this device's own
   * copy into them, carrying every try and every misspelling across — so
   * publishing a sheet Aradhana has already practised does not cost her
   * history. (sync.js: absorbLocalDuplicate.)
   */
  async function publishWeek(weekId, btn) {
    const wk = Store.db.weeks.find(k => k.id === weekId);
    if (!wk) return;
    const words = Store.weekWords(weekId);
    if (!words.length) return toast('That set has no words in it.', 'bad');

    const missing = words.filter(x => !x.meaning).length;
    if (missing && !await window.U.confirmBox('Publish without the school’s meanings?',
      `${window.U.plural(missing, 'word')} in this set has no definition from the sheet.
       AraBuzz never invents one, so those words will practise without a meaning.`,
      'Publish anyway')) return;

    btn.disabled = true; btn.textContent = 'Publishing…';
    try {
      const { data: deck, error: e1 } = await Cloud.from('decks').insert({
        title: wk.title, topic: wk.topic || null,
        sent_on: wk.sentOn || null, assessed_on: wk.assessedOn || null,
        status: 'published', audience: 'all',
        source_name: wk.sourceName || null,
        created_by: Cloud.session.user.id,
        published_at: new Date().toISOString()
      }).select().single();
      if (e1) throw e1;

      const rows = words.map((x, i) => Sync.wordOut(x, deck.id, i));
      const { error: e2 } = await Cloud.from('words').insert(rows);
      if (e2) throw e2;

      toast(`${wk.title} published to every family.`, 'good', 3000);
      await Sync.pull();          // merges this device's copy into the published one
      data = null;
      paint();
    } catch (e) {
      console.error(e);
      btn.disabled = false; btn.textContent = 'Publish';
      toast(e.message || 'Could not publish.', 'bad');
    }
  }

  async function setStatus(deckId, status) {
    if (status === 'draft' && !await window.U.confirmBox('Withdraw this sheet?',
      `It disappears from every family's app. Nothing anybody has practised is deleted, and
       you can publish it again whenever you like.`, 'Withdraw')) return;
    const patch = { status };
    if (status === 'published') patch.published_at = new Date().toISOString();
    const { error } = await Cloud.from('decks').update(patch).eq('id', deckId);
    if (error) return toast(error.message, 'bad');
    data = null; paint();
  }

  /** Everyone, or a chosen few. Five families, so a list of checkboxes is the
   *  right amount of machinery. */
  async function chooseAudience(deckId) {
    const deck = ((data && data.decks) || []).find(d => d.id === deckId);
    const chosen = new Set(deck.assigned_to || []);
    const m = window.U.modal(`
      <h2 style="margin-top:0">Who gets “${esc(deck.title)}”?</h2>
      <label class="ob-agree" for="audAll"><input type="checkbox" id="audAll"
        ${deck.audience === 'all' ? 'checked' : ''}><span>Everyone</span></label>
      <div id="audList" style="margin-top:10px;${deck.audience === 'all' ? 'opacity:.4;pointer-events:none' : ''}">
        ${families().map(f => `
          <label class="ob-agree" for="aud_${f.id}">
            <input type="checkbox" id="aud_${f.id}" data-fam="${f.id}" ${chosen.has(f.id) ? 'checked' : ''}>
            <span>${esc(f.name)}</span></label>`).join('')}
      </div>
      <button class="btn-primary btn-block" id="audSave" style="margin-top:14px">Save</button>`);

    const all = body(m).querySelector('#audAll');
    all.onchange = () => {
      const list = body(m).querySelector('#audList');
      list.style.opacity = all.checked ? '.4' : '1';
      list.style.pointerEvents = all.checked ? 'none' : 'auto';
    };

    body(m).querySelector('#audSave').onclick = async () => {
      const audience = all.checked ? 'all' : 'selected';
      const picked = Array.from(body(m).querySelectorAll('#audList input:checked')).map(i => i.dataset.fam);
      try {
        const { error: e1 } = await Cloud.from('decks').update({ audience }).eq('id', deckId);
        if (e1) throw e1;
        const { error: e2 } = await Cloud.from('deck_assignments').delete().eq('deck_id', deckId);
        if (e2) throw e2;
        if (audience === 'selected' && picked.length) {
          const { error: e3 } = await Cloud.from('deck_assignments')
            .insert(picked.map(fid => ({ deck_id: deckId, family_id: fid })));
          if (e3) throw e3;
        }
        m.close(); data = null; paint();
        toast('Saved.', 'good');
      } catch (e) { toast(e.message || 'Could not save.', 'bad'); }
    };
  }

  /* ======================================================================
     USAGE
     What it costs, and per family so Prem can see if one is running away
     with it. Cost is not a measure of a child, so it is never on a card next
     to their progress.
     ====================================================================== */
  function tabSpend() {
    const s = (data && data.spend) || {};
    const rows = families().map(f => ({
      name: f.name,
      spend: (f.children || []).reduce((a, c) => a + (+c.spend || 0), 0),
      answers: (f.children || []).reduce((a, c) => a + (c.answers || 0), 0)
    }));

    $('#atab').innerHTML = `
      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">What AraBuzz is costing</h3>
        <div class="row wrap" style="gap:8px;margin-top:8px">
          <span class="pill honey">${money(s.all_time)} all time</span>
          <span class="pill sky">${money(s.this_week)} this week</span>
          <span class="pill">${window.U.plural(s.calls_this_week || 0, 'call')} this week</span>
        </div>
        <p class="hint" style="margin-top:12px">Reading a sheet and building its practice material
           is the expensive part, and it happens once per sheet for everybody. The weekly notes are
           small. Everything a child actually plays costs nothing at all.</p>
      </div>

      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">By family</h3>
        ${rows.length ? rows.map(r => `
          <div class="row between" style="padding:6px 0">
            <span class="small">${esc(r.name)}</span>
            <span class="small faint">${money(r.spend)} · ${window.U.plural(r.answers, 'answer')}</span>
          </div>`).join('') : '<p class="muted small">Nothing yet.</p>'}
      </div>`;
  }

  w.Admin = { paint, refresh, get data() { return data; } };
})(window);
