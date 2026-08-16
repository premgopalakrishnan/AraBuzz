/* ==========================================================================
   AraBuzz — scene.js
   The world, and how the app dresses itself to match.

   All the drawing now lives in garden.js. This file decides *which* garden she
   is looking at — the time of day is set by how much of her word list is fully
   grown — and then does three things with it:

     1  Paints the fixed backdrop behind every screen (a quiet wash of that
        garden's own sky and earth; the detail stays in the picture itself).
     2  Tints the app's surfaces so the whole product shifts with her progress.
     3  Builds the hero — a wide band of the real garden across the top of Home,
        big enough that she cannot miss it.

   Readability is never negotiable: every card she reads from stays opaque, so
   contrast doesn't depend on which stage she has reached.
   ========================================================================== */
(function (w) {
  'use strict';

  const G = () => window.Garden;

  /* Surfaces for each stage, in both themes. Day surfaces are warm paper; night
     surfaces are the same hue family pulled deep, so the garden glows. */
  const SURFACE = {
    dawn:    { light: ['#FBF4EC', '#F3E7DA'], dark: ['#14121C', '#1D1926'], accent: '#E08A5B' },
    morning: { light: ['#F8FAFB', '#EBF1F3'], dark: ['#0F1519', '#182126'], accent: '#4E97C4' },
    day:     { light: ['#F7FAFA', '#E9F1F2'], dark: ['#0D1417', '#161F23'], accent: '#3D8FBF' },
    golden:  { light: ['#FCF5EC', '#F5E6D6'], dark: ['#171118', '#221822'], accent: '#D98A3F' },
    starlit: { light: ['#F4F3F8', '#E7E6F0'], dark: ['#080A14', '#10131F'], accent: '#8E9BE0' }
  };

  const STAGES = ['dawn', 'morning', 'day', 'golden', 'starlit'];

  let host = null, currentKey = null;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function progress() {
    const grown = window.Game ? Game.grownCount() : 0;
    const total = Math.max(12, (window.Store ? Store.allWords().length : 0) || 12);
    return { grown, total, pct: Math.min(1, grown / total) };
  }

  /** The old API: a stage object, now backed by the garden's own light. */
  function stageFor(pct) {
    const key = G() ? Garden.stageKeyFor(pct) : 'day';
    const L = G() ? Garden.LIGHT[key] : {};
    return Object.assign({ key, at: G() ? Garden.AT[key] : 0, sky: L.sky || [] }, L);
  }
  function nextStage(pct) {
    const nx = G() ? Garden.nextStage(pct) : null;
    return nx ? stageFor(nx.at) : null;
  }

  /* ---------------------------------------------------------------- paint */
  function mount() {
    host = document.getElementById('scene');
    if (!host) {
      host = document.createElement('div');
      host.id = 'scene';
      host.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(host, document.body.firstChild);
    }
  }

  function update(force) {
    if (!host) mount();
    const p = progress();
    const key = G() ? Garden.stageKeyFor(p.pct) : 'day';
    if (key === currentKey && !force) return;
    currentKey = key;
    applyTokens(key);
    backdrop(key);
  }

  /** The stage tints the app's own surfaces, so the whole thing shifts together. */
  function applyTokens(key) {
    const r = document.documentElement;
    const night = !window.Store || Store.db.settings.theme !== 'light';
    const s = SURFACE[key] || SURFACE.day;
    const pair = night ? s.dark : s.light;
    r.style.setProperty('--paper', pair[0]);
    r.style.setProperty('--paper-2', pair[1]);
    r.setAttribute('data-stage', key);
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', pair[0]);
  }

  /**
   * The backdrop behind every screen. Deliberately quiet — a wash of this
   * garden's sky over its earth, with one soft pool of light where the sun is.
   * The garden itself is a picture you look *at*, not wallpaper.
   */
  function backdrop(key) {
    const L = G() ? Garden.LIGHT[key] : null;
    if (!L) return;
    const night = !window.Store || Store.db.settings.theme !== 'light';
    const s = SURFACE[key] || SURFACE.day;
    host.innerHTML = `
      <div class="sky" style="background:
        radial-gradient(120% 62% at ${L.sun.x * 100}% ${L.sun.y * 30}%,
          ${L.sun.glow}${night ? '3d' : '66'} 0%, transparent 62%),
        linear-gradient(180deg, ${L.sky[1]} 0%, ${L.sky[2]} 44%, ${L.grass} 100%)"></div>
      <div class="veil" style="background:${(night ? s.dark : s.light)[0]}"></div>`;
  }

  /* ======================================================================
     HERO — a wide band of the real garden across the top of Home.
     ====================================================================== */
  function hero() {
    const p = progress();
    const key = G() ? Garden.stageKeyFor(p.pct) : 'day';
    const L = G() ? Garden.LIGHT[key] : { name: '', blurb: '' };
    const nx = G() ? Garden.nextStage(p.pct) : null;
    const need = nx ? Math.max(1, Math.ceil((nx.at - p.pct) * p.total)) : 0;
    const plants = plantList(18);

    const art = G() ? Garden.scene({
      plants, pct: p.pct, stage: key, seed: 771, detail: .55,
      crop: { y: 208, h: 330 },
      aria: `${p.grown} of ${p.total} words grown.`
    }) : '';

    return `
    <div class="hero" id="worldHero">
      <div class="hero-art">${art}</div>
      <div class="hero-shade"></div>
      <div class="hero-copy">
        <div class="hero-kicker">${esc(L.name)}</div>
        <div class="hero-title">Your garden</div>
        <div class="hero-sub">${esc(L.blurb)}</div>
        <div class="hero-bar"><i style="width:${Math.round(p.pct * 100)}%"></i></div>
        <div class="hero-count"><b>${p.grown}</b> of <b>${p.total}</b> words grown${
          nx ? ` · <b>${need} more</b> and it turns to <b>${esc(nx.name.toLowerCase())}</b>`
             : ' · the whole plot is in bloom'}</div>
      </div>
    </div>`;
  }

  /**
   * Which words appear as plants. Everything, if it fits; otherwise the ones
   * she has grown furthest plus the ones she is actively working on, so the
   * picture always shows real progress rather than a random sample.
   */
  function plantList(cap) {
    if (!window.Store || !window.Game) return [];
    const all = Store.allWords().map(wd => ({
      id: wd.id, label: wd.word,
      box: (Store.db.progress[wd.id] || {}).box || 0,
      seen: (Store.db.progress[wd.id] || {}).seen || 0
    }));
    if (!cap || all.length <= cap) return all;
    return all.slice().sort((a, b) => (b.box - a.box) || (b.seen - a.seen)).slice(0, cap);
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** A one-off celebration when the world moves to a new time of day. */
  function announceIfChanged(prevGrown) {
    const p = progress();
    const before = G() ? Garden.stageKeyFor(Math.min(1, prevGrown / p.total)) : 'day';
    const after = G() ? Garden.stageKeyFor(p.pct) : 'day';
    if (before === after) return null;
    return stageFor(p.pct);
  }

  w.Scene = {
    update, hero, stageFor, nextStage, announceIfChanged, plantList, STAGES, SURFACE,
    get reduced() { return reduced; }
  };
})(window);
