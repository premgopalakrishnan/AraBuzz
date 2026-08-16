/* ==========================================================================
   AraBuzz — icons.js
   One drawn icon set, one grid, one stroke weight.

   Emoji were the single loudest "cheap app" signal in the old interface — a
   dozen different illustrators, a dozen different weights, and a different
   look on every device. Everything in the chrome is now drawn here on a 24pt
   grid at 1.6 stroke with round caps, so the whole app reads as one hand.
   ========================================================================== */
(function (w) {
  'use strict';

  const P = {
    /* --- navigation ------------------------------------------------- */
    home:   '<path d="M4 10.6 12 4l8 6.6"/><path d="M6.4 9.6V19a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1V9.6"/><path d="M10 20v-5h4v5"/>',
    book:   '<path d="M12 6.5C10.4 5.2 8.4 4.6 5.6 4.6A1 1 0 0 0 4.6 5.6v11.2a1 1 0 0 0 1 1c2.8 0 4.8.6 6.4 1.9 1.6-1.3 3.6-1.9 6.4-1.9a1 1 0 0 0 1-1V5.6a1 1 0 0 0-1-1c-2.8 0-4.8.6-6.4 1.9Z"/><path d="M12 6.5V19.7"/>',
    medal:  '<circle cx="12" cy="14.6" r="5"/><path d="M9.4 9.9 7 3.6h10l-2.4 6.3"/><path d="m12 12.4.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2L9.1 14.6l2-.3Z"/>',
    macaw:  '<circle cx="10.2" cy="11.6" r="5.4"/><path d="M15.2 9.6c3.4-.4 5.4 1.3 5 3.9-.4 2.4-2.3 4-4.6 4.2"/><circle cx="12" cy="10.2" r="1.35" fill="currentColor" stroke="none"/><path d="M9 6.4C8.4 4.2 7 3.2 5.6 3.6c.2 1.8 1.1 3 2.4 3.7"/>',
    help:   '<circle cx="12" cy="12" r="8.4"/><path d="M9.7 9.6a2.4 2.4 0 0 1 4.6.8c0 1.6-2.3 2-2.3 3.4"/><circle cx="12" cy="16.7" r="0.9" fill="currentColor" stroke="none"/>',
    lock:   '<rect x="5.2" y="10.4" width="13.6" height="9.4" rx="2.4"/><path d="M8.4 10.4V7.9a3.6 3.6 0 0 1 7.2 0v2.5"/><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none"/>',
    back:   '<path d="M14.6 5.6 8.2 12l6.4 6.4"/>',
    next:   '<path d="M9.4 5.6 15.8 12l-6.4 6.4"/>',
    close:  '<path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4"/>',
    swap:   '<path d="M4.6 8.4h13l-3-3M19.4 15.6h-13l3 3"/>',
    plus:   '<path d="M12 5.4v13.2M5.4 12h13.2"/>',
    chart:  '<path d="M4.6 19.4h14.8"/><path d="M7.6 19.4v-5.6M11.8 19.4V8.2M16 19.4v-8.4"/>',

    /* --- games ------------------------------------------------------- */
    pencil: '<path d="M15.4 4.9a2.2 2.2 0 0 1 3.1 3.1L9 17.6l-4 1 1-4Z"/><path d="M14 6.3 17.1 9.4"/>',
    keys:   '<rect x="3.2" y="6.6" width="17.6" height="11.4" rx="2.2"/><path d="M7 10h.01M10.2 10h.01M13.4 10h.01M16.6 10h.01M7 13.4h.01M10.2 13.4h.01M13.4 13.4h.01M16.6 13.4h.01" stroke-width="2.1" stroke-linecap="round"/><path d="M8.6 16.6h6.8"/>',
    ear:    '<path d="M8.2 20.4c-1.6-1.5-1.3-3-2.4-4.6C4.8 14.4 4.4 13 4.4 11.2a7 7 0 0 1 14 0c0 3-2.2 4-4 4.6-1.2.4-1.6 1.4-1.6 2.4a2.1 2.1 0 0 1-3.5 1.6"/><path d="M9 11a3 3 0 0 1 6 0c0 1.4-1 1.9-1.8 2.3"/>',
    speech: '<path d="M20.2 12.4c0 3.8-3.7 6.9-8.2 6.9-1 0-2-.2-2.9-.5l-4.7 1.5 1.4-3.9a6.4 6.4 0 0 1-2-4.6C3.8 8.6 7.5 5.5 12 5.5s8.2 3.1 8.2 6.9Z"/><path d="M8.8 12.4h.01M12 12.4h.01M15.2 12.4h.01" stroke-width="2.2" stroke-linecap="round"/>',
    puzzle: '<path d="M10.2 4.6h3.6v2.2a1.7 1.7 0 1 0 3.4 0V4.6h2.2v3.6h-2.2a1.7 1.7 0 1 0 0 3.4h2.2v3.6h-3.6v2.2a1.7 1.7 0 1 1-3.4 0v-2.2h-3.6v-3.6H6.8a1.7 1.7 0 1 1 0-3.4h2.2V4.6Z"/>',
    dice:   '<rect x="4.4" y="4.4" width="15.2" height="15.2" rx="3.4"/><circle cx="8.9" cy="8.9" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.1" cy="8.9" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="8.9" cy="15.1" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.1" cy="15.1" r="1.15" fill="currentColor" stroke="none"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="M15.4 15.4 20 20"/>',
    trophy: '<path d="M8 4.8h8v4.6a4 4 0 0 1-8 0Z"/><path d="M8 6.4H5.4v1.4a3 3 0 0 0 2.8 3M16 6.4h2.6v1.4a3 3 0 0 1-2.8 3"/><path d="M12 13.4v3.2M9 19.2h6"/>',
    bolt:   '<path d="M13.4 3.6 6.6 13.2h4.6l-.8 7.2 7-9.8h-4.7Z"/>',

    /* --- rewards ----------------------------------------------------- */
    star:   '<path d="m12 4.4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8Z"/>',
    flame:  '<path d="M12 3.6s.9 2.6-.8 4.6c-1.6 1.9-4 2.7-4 6a4.8 4.8 0 0 0 9.6 0c0-1.6-.7-2.6-1.4-3.5-.6 1-1.3 1.4-2 1.4 1.4-3.2-1.4-8.5-1.4-8.5Z"/>',
    leaf:   '<path d="M19.4 4.9C11 4.2 5.4 7.7 5.4 13.6c0 2 .8 3.7 2 4.8C9 15.7 12.4 12.6 17 11c-3.6 2.1-6.4 4.8-8.2 8.4"/>',
    tree:   '<path d="M12 20v-5.4"/><path d="M12 14.6c-3.4 0-5.6-1.9-5.6-4.4 0-1 .3-1.8.9-2.5-.1-.4-.2-.8-.2-1.2 0-1.9 1.6-3.1 3.4-3.1.6 0 1.1.1 1.5.4.4-.3.9-.4 1.5-.4 1.8 0 3.4 1.2 3.4 3.1 0 .4-.1.8-.2 1.2.6.7.9 1.5.9 2.5 0 2.5-2.2 4.4-5.6 4.4Z"/>',
    sprout: '<path d="M12 20v-6.6"/><path d="M12 13.4C12 9.8 9.4 7.6 5.6 7.6c0 3.6 2.6 5.8 6.4 5.8Z"/><path d="M12 13.4c0-3 2.2-4.8 5.4-4.8 0 3-2.2 4.8-5.4 4.8Z"/>',
    target: '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>',

    /* --- utility ----------------------------------------------------- */
    speaker:'<path d="M11.4 5.4 7 9H4.4v6H7l4.4 3.6Z"/><path d="M15.2 9.4a3.6 3.6 0 0 1 0 5.2M17.8 7a7 7 0 0 1 0 10"/>',
    spell:  '<path d="M4.6 17.4 8.2 6.6l3.6 10.8"/><path d="M5.9 13.8h4.6"/><path d="M15.4 17.4V9.8M15.4 12.6c0-1.2 1-2.2 2.2-2.2s2.2 1 2.2 2.2v4.8"/>',
    check:  '<path d="m5.4 12.6 4.4 4.4 8.8-9.6"/>',
    cross:  '<path d="M7 7 17 17M17 7 7 17"/>',
    upload: '<path d="M12 16V4.8M8.2 8.4 12 4.6l3.8 3.8"/><path d="M4.8 15v3.4a1.6 1.6 0 0 0 1.6 1.6h11.2a1.6 1.6 0 0 0 1.6-1.6V15"/>',
    doc:    '<path d="M13.6 4h-6a1.6 1.6 0 0 0-1.6 1.6v12.8A1.6 1.6 0 0 0 7.6 20h8.8a1.6 1.6 0 0 0 1.6-1.6V8.4Z"/><path d="M13.6 4v4.4H18"/><path d="M9.2 12.6h5.6M9.2 16h4"/>',
    save:   '<rect x="4.4" y="4.4" width="15.2" height="15.2" rx="2.2"/><path d="M8 4.4v5.2h8V4.4M8 19.6v-5.2h8v5.2"/>',
    gear:   '<circle cx="12" cy="12" r="3.1"/><path d="M12 3.6v2.2M12 18.2v2.2M20.4 12h-2.2M5.8 12H3.6M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
    clock:  '<circle cx="12" cy="12" r="8"/><path d="M12 7.4V12l3 1.8"/>',
    mail: 'M3 6.5h18v11H3z M3 7l9 6.5L21 7',
    sparkle:'<path d="M12 3.6c.6 3.9 1.9 5.2 5.8 5.8-3.9.6-5.2 1.9-5.8 5.8-.6-3.9-1.9-5.2-5.8-5.8 3.9-.6 5.2-1.9 5.8-5.8Z"/><path d="M18.4 15.4c.3 1.9.9 2.5 2.8 2.8-1.9.3-2.5.9-2.8 2.8-.3-1.9-.9-2.5-2.8-2.8 1.9-.3 2.5-.9 2.8-2.8Z"/>'
  };

  /**
   * @param {string} name   key from the set above
   * @param {object} o      {size, stroke, cls, style}
   */
  function icon(name, o) {
    o = o || {};
    const d = P[name];
    if (!d) return '';
    const size = o.size || 24;
    return `<svg class="ic ${o.cls || ''}" width="${size}" height="${size}" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="${o.stroke || 1.6}"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ${o.style ? `style="${o.style}"` : ''}>${d}</svg>`;
  }

  /** Icon + label, vertically optically aligned. */
  function chip(name, label, o) {
    o = o || {};
    return `<span class="ichip ${o.cls || ''}">${icon(name, { size: o.size || 17, stroke: o.stroke || 1.8 })}<span>${label}</span></span>`;
  }

  /* --------------------------------------------------------------------------
     The seven growth stages of a word, drawn rather than borrowed from an emoji
     font. Same stroke grammar as everything else, so a garden of them reads as
     one illustration instead of a sticker sheet.
     -------------------------------------------------------------------------- */
  const PLANTS = [
    // 0 seed
    '<ellipse cx="12" cy="17.4" rx="3.4" ry="2.6" transform="rotate(-16 12 17.4)"/><path d="M10.3 16.6c.7-.7 2-.9 3-.4"/>',
    // 1 sprout
    '<path d="M12 20v-4.6"/><path d="M12 15.4c-2.4 0-4-1.4-4-3.6 2.4 0 4 1.4 4 3.6Z"/>',
    // 2 two leaves
    '<path d="M12 20v-6.4"/><path d="M12 14.6c-2.7 0-4.5-1.6-4.5-4 2.7 0 4.5 1.6 4.5 4Z"/><path d="M12 15.4c0-2.2 1.6-3.6 4-3.6 0 2.2-1.6 3.6-4 3.6Z"/>',
    // 3 small stem with three leaves
    '<path d="M12 20V9.6"/><path d="M12 14c-2.8 0-4.6-1.7-4.6-4.2 2.8 0 4.6 1.7 4.6 4.2Z"/><path d="M12 15.6c0-2.3 1.7-3.8 4.2-3.8 0 2.3-1.7 3.8-4.2 3.8Z"/><path d="M12 10.4c0-2.2 1.2-3.6 3-4 0 2.2-1.1 3.6-3 4Z"/>',
    // 4 bushy
    '<path d="M12 20v-7"/><path d="M12 13c-3.4 0-5.6-2-5.6-4.8C9.8 8.2 12 10.2 12 13Z"/><path d="M12 14.4c0-2.7 2-4.5 5-4.5 0 2.7-2 4.5-5 4.5Z"/><path d="M12 9.2c0-2.5 1.4-4 3.4-4.5 0 2.5-1.4 4-3.4 4.5Z"/>',
    // 5 in flower
    '<path d="M12 20v-6.6"/><path d="M12 13.6c-2.8 0-4.6-1.7-4.6-4.2 2.8 0 4.6 1.7 4.6 4.2Z"/><path d="M12 14.6c0-2.3 1.7-3.8 4.2-3.8 0 2.3-1.7 3.8-4.2 3.8Z"/><circle cx="12" cy="6" r="1.5"/><path d="M12 4.5a1.6 1.6 0 1 1 0-.1M13.5 6a1.6 1.6 0 1 1 .1 0M12 7.5a1.6 1.6 0 1 1 0 .1M10.5 6a1.6 1.6 0 1 1-.1 0"/>',
    // 6 tree
    '<path d="M12 20v-5.4"/><path d="M12 14.6c-3.4 0-5.6-1.9-5.6-4.4 0-1 .3-1.8.9-2.5-.1-.4-.2-.8-.2-1.2 0-1.9 1.6-3.1 3.4-3.1.6 0 1.1.1 1.5.4.4-.3.9-.4 1.5-.4 1.8 0 3.4 1.2 3.4 3.1 0 .4-.1.8-.2 1.2.6.7.9 1.5.9 2.5 0 2.5-2.2 4.4-5.6 4.4Z"/>'
  ];

  function plant(stage, o) {
    o = o || {};
    const d = PLANTS[Math.max(0, Math.min(PLANTS.length - 1, stage | 0))];
    const size = o.size || 30;
    return `<svg class="ic ${o.cls || ''}" width="${size}" height="${size}" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="${o.stroke || 1.5}"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }

  /** Star row for a score — filled or hollow, never an emoji. */
  function stars(n, of, o) {
    o = o || {};
    return Array.from({ length: of || 3 }, (_, i) =>
      `<span class="${i < n ? '' : 'off'}">${icon('star', { size: o.size || 18, stroke: 1.7 })}</span>`).join('');
  }

  w.Icon = { icon, chip, plant, stars, PLANT_COUNT: PLANTS.length,
             has: n => !!P[n], names: Object.keys(P) };
})(window);
