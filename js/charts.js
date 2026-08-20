/* ==========================================================================
   AraBuzz — charts.js
   Small, dependency-free SVG charts for the Coach Report and the Progress tab.

   Colour: the two-series palette below was checked with the data-viz validator
   (lightness band, chroma floor, colour-blind separation, normal-vision floor,
   contrast vs surface) and passes all six in both modes:
       light  #0E7FB5 / #C9832A  on #FFFFFF
       dark   #3A9AC9 / #C07E26  on #22322F
   Single-series charts use series 1 alone and carry no legend — the title names
   the series. Two-series charts always ship a legend AND direct labels, so
   identity is never colour-alone. Status colours (good / watch / concern) are
   reserved and always appear with a word beside them, never colour alone.
   ========================================================================== */
(function (w) {
  'use strict';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function dark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  const P = () => dark()
    ? { s1: '#3A9AC9', s2: '#C07E26', ink: '#F1EDE4', mute: '#8C9C97', grid: '#33463F', surf: '#22322F',
        good: '#7FB79F', warn: '#D9A247', bad: '#E08A70' }
    : { s1: '#0E7FB5', s2: '#C9832A', ink: '#22333B', mute: '#8697A0', grid: '#E5DDD1', surf: '#FFFFFF',
        good: '#4E7264', warn: '#C9832A', bad: '#C25F45' };

  const uid = () => 'c' + Math.random().toString(36).slice(2, 8);
  const nice = n => (Math.round(n * 10) / 10);

  /* ---------------------------------------------------------------- frame */
  function frame(w0, h0, body, opts) {
    const o = opts || {};
    return `<figure class="viz" style="margin:0">
      ${o.title ? `<figcaption class="viz-title">${esc(o.title)}</figcaption>` : ''}
      ${o.sub ? `<div class="viz-sub">${esc(o.sub)}</div>` : ''}
      ${o.legend || ''}
      <svg viewBox="0 0 ${w0} ${h0}" width="100%" role="img"
           aria-label="${esc(o.alt || o.title || 'chart')}" style="display:block;overflow:visible">
        ${body}
      </svg>
      ${o.note ? `<div class="viz-note">${esc(o.note)}</div>` : ''}
    </figure>`;
  }

  function legend(items) {
    return `<div class="viz-legend">${items.map(i =>
      `<span class="viz-key"><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join('')}</div>`;
  }

  /* ======================================================================
     LINE — one measure over time. Single series, so no legend; the last
     point is directly labelled rather than every point.
     ====================================================================== */
  function line(data, opts) {
    const o = Object.assign({ height: 190, suffix: '%', max: null, min: 0, band: null }, opts || {});
    const c = P();
    if (!data || data.length < 2) return empty(o.title, 'Needs at least two weeks of practice.');

    const W = 640, H = o.height, padL = 42, padR = 54, padT = 14, padB = 30;
    const vals = data.map(d => d.v);
    const max = o.max != null ? o.max : Math.max(...vals) * 1.15 || 1;
    const min = o.min != null ? o.min : Math.min(...vals) * 0.85;
    const x = i => padL + (W - padL - padR) * (data.length === 1 ? 0.5 : i / (data.length - 1));
    const y = v => padT + (H - padT - padB) * (1 - (v - min) / (max - min || 1));
    const id = uid();

    const ticks = [min, min + (max - min) / 2, max];
    const grid = ticks.map(t =>
      `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="${c.grid}" stroke-width="1"/>
       <text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${c.mute}">${nice(t)}${o.suffix}</text>`).join('');

    const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.v)}`).join(' ');
    const area = `${path} L${x(data.length - 1)},${H - padB} L${x(0)},${H - padB} Z`;

    const dots = data.map((d, i) =>
      `<circle cx="${x(i)}" cy="${y(d.v)}" r="5" fill="${c.surf}" stroke="${c.s1}" stroke-width="2.5">
         <title>${esc(d.label)}: ${nice(d.v)}${o.suffix}${d.n ? ` (${d.n} answers)` : ''}</title>
       </circle>`).join('');

    const labels = data.map((d, i) => {
      const show = data.length <= 7 || i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 5) === 0;
      return show ? `<text x="${x(i)}" y="${H - padB + 17}" text-anchor="middle" font-size="10.5" fill="${c.mute}">${esc(d.label)}</text>` : '';
    }).join('');

    const last = data[data.length - 1];
    const endLabel = `<text x="${x(data.length - 1) + 11}" y="${y(last.v) + 4}" font-size="13"
        font-weight="600" fill="${c.ink}">${nice(last.v)}${o.suffix}</text>`;

    const trendNote = (() => {
      const d = last.v - data[0].v;
      if (Math.abs(d) < 2) return 'Holding steady across the period.';
      /* A move from 31% to 71% is forty percentage POINTS, not forty per
         cent — saying "up 40%" of a percentage is simply wrong, and a
         parent reading a report about accuracy will notice. */
      const unit = o.suffix === '%' ? ' points' : o.suffix;
      return d > 0 ? `Up ${nice(Math.abs(d))}${unit} since ${data[0].label}.`
                   : `Down ${nice(Math.abs(d))}${unit} since ${data[0].label}.`;
    })();

    return frame(W, H, `
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${c.s1}" stop-opacity=".22"/>
        <stop offset="100%" stop-color="${c.s1}" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#${id})"/>
      <path d="${path}" fill="none" stroke="${c.s1}" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}${labels}${endLabel}`,
      { title: o.title, sub: o.sub, note: o.note || trendNote, alt: o.title });
  }

  /* ======================================================================
     GROUPED BARS — the same categories measured in two periods.
     Two series, so: legend present, and every bar directly labelled.
     ====================================================================== */
  function compareBars(rows, opts) {
    const o = Object.assign({ height: null, aLabel: 'Now', bLabel: 'Before', suffix: '' }, opts || {});
    const c = P();
    if (!rows || !rows.length) return empty(o.title, 'Nothing recorded in this period.');

    const rowH = 46, W = 640, padL = 168, padR = 46, padT = 6;
    const H = padT + rows.length * rowH + 6;
    const max = Math.max(1, ...rows.map(r => Math.max(r.a || 0, r.b || 0))) * 1.12;
    const wOf = v => Math.max(0, (W - padL - padR) * ((v || 0) / max));

    const body = rows.map((r, i) => {
      const top = padT + i * rowH;
      const hasB = r.b != null;
      const barH = hasB ? 12 : 18;
      const yA = top + (hasB ? 4 : 8);
      const yB = top + 4 + 12 + 2;                       // 2px surface gap between bars
      const bar = (yy, val, col) => `
        <rect x="${padL}" y="${yy}" width="${wOf(val)}" height="${barH}" rx="4" fill="${col}"/>
        <text x="${padL + wOf(val) + 7}" y="${yy + barH - 1.5}" font-size="11.5"
              fill="${c.ink}" font-weight="600">${nice(val)}${o.suffix}</text>`;
      return `
        <text x="${padL - 12}" y="${top + (hasB ? 20 : 21)}" text-anchor="end" font-size="12.5"
              fill="${c.ink}">${esc(r.label)}</text>
        ${bar(yA, r.a, c.s1)}
        ${hasB ? bar(yB, r.b, c.s2) : ''}`;
    }).join('');

    return frame(W, H, body, {
      title: o.title, sub: o.sub, note: o.note, alt: o.title,
      legend: rows.some(r => r.b != null)
        ? legend([{ color: c.s1, label: o.aLabel }, { color: c.s2, label: o.bLabel }]) : ''
    });
  }

  /* ======================================================================
     STEP AREA — cumulative count (words locked in).
     ====================================================================== */
  function cumulative(data, opts) {
    const o = Object.assign({ height: 170 }, opts || {});
    const c = P();
    if (!data || data.length < 2) return empty(o.title, 'Not enough history yet.');

    const W = 640, H = o.height, padL = 38, padR = 50, padT = 14, padB = 28;
    const max = Math.max(1, ...data.map(d => d.v)) * 1.18;
    const x = i => padL + (W - padL - padR) * (i / (data.length - 1));
    const y = v => padT + (H - padT - padB) * (1 - v / max);
    const id = uid();

    let path = '';
    data.forEach((d, i) => { path += `${i ? 'L' : 'M'}${x(i)},${y(d.v)} `; });

    const last = data[data.length - 1];
    return frame(W, H, `
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${c.s1}" stop-opacity=".26"/>
        <stop offset="100%" stop-color="${c.s1}" stop-opacity="0"/></linearGradient></defs>
      <line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" stroke="${c.grid}" stroke-width="1"/>
      <path d="${path} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#${id})"/>
      <path d="${path}" fill="none" stroke="${c.s1}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${x(data.length - 1)}" cy="${y(last.v)}" r="5" fill="${c.surf}" stroke="${c.s1}" stroke-width="2.5"/>
      <text x="${x(data.length - 1) + 11}" y="${y(last.v) + 4}" font-size="13" font-weight="600" fill="${c.ink}">${last.v}</text>
      ${data.map((d, i) => (i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 5) === 0)
        ? `<text x="${x(i)}" y="${H - padB + 17}" text-anchor="middle" font-size="10.5" fill="${c.mute}">${esc(d.label)}</text>` : '').join('')}`,
      { title: o.title, sub: o.sub, note: o.note, alt: o.title });
  }

  /* ======================================================================
     ACTIVITY — one thin bar per day. Magnitude over time, single series.
     ====================================================================== */
  function activity(days, opts) {
    const o = Object.assign({ height: 92 }, opts || {});
    const c = P();
    if (!days || !days.length) return empty(o.title, 'No practice recorded yet.');

    const W = 640, H = o.height, padB = 20, padT = 6;
    const gap = 2;
    const bw = Math.max(3, (W - gap * (days.length - 1)) / days.length);
    const max = Math.max(1, ...days.map(d => d.n));
    const active = days.filter(d => d.n).length;

    const bars = days.map((d, i) => {
      const h = d.n ? Math.max(4, (H - padT - padB) * (d.n / max)) : 3;
      const x = i * (bw + gap);
      return `<rect x="${x}" y="${H - padB - h}" width="${bw}" height="${h}" rx="${Math.min(3, bw / 2)}"
                fill="${d.n ? c.s1 : c.grid}"><title>${esc(d.label)}: ${d.n} answers</title></rect>`;
    }).join('');

    const first = days[0], last = days[days.length - 1];
    return frame(W, H, `${bars}
      <text x="0" y="${H - 4}" font-size="10.5" fill="${c.mute}">${esc(first.label)}</text>
      <text x="${W}" y="${H - 4}" font-size="10.5" fill="${c.mute}" text-anchor="end">${esc(last.label)}</text>`,
      { title: o.title, sub: o.sub, alt: o.title,
        note: o.note || `Practised on ${active} of the last ${days.length} days.` });
  }

  /* ======================================================================
     STAT TILES — a headline number is not a chart. Deltas carry a word as
     well as a colour, so the direction is never colour-alone.
     ====================================================================== */
  function tiles(items) {
    const c = P();
    return `<div class="viz-tiles">${items.map(t => {
      const d = t.delta;
      const dir = d == null ? null : d > 0.0001 ? 'up' : d < -0.0001 ? 'down' : 'flat';
      const goodDir = t.higherIsBetter === false ? 'down' : 'up';
      const col = dir === 'flat' || dir == null ? c.mute : (dir === goodDir ? c.good : c.bad);
      const word = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'no change';
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
      return `<div class="viz-tile">
        <div class="viz-tile-v">${esc(t.value)}</div>
        <div class="viz-tile-l">${esc(t.label)}</div>
        ${dir ? `<div class="viz-tile-d" style="color:${col}">${arrow} ${word} ${esc(t.deltaText || '')}</div>`
              : (t.sub ? `<div class="viz-tile-d" style="color:${c.mute}">${esc(t.sub)}</div>` : '')}
      </div>`;
    }).join('')}</div>`;
  }

  function empty(title, msg) {
    const c = P();
    return `<figure class="viz" style="margin:0">
      ${title ? `<figcaption class="viz-title">${esc(title)}</figcaption>` : ''}
      <div class="viz-empty" style="color:${c.mute}">${esc(msg)}</div></figure>`;
  }

  /* ------------------------------------------------ styles (also for print
     and for the standalone exported report, which carries its own copy) --- */
  const CSS = `
.viz { font-family: inherit; }
.viz-title { font-family: var(--font-head, inherit); font-weight: 700; font-size: 1rem;
             margin: 0 0 2px; color: var(--ink, #22333B); }
.viz-sub { font-size: .82rem; color: var(--ink-faint, #8697A0); margin-bottom: 10px; }
.viz-note { font-size: .8rem; color: var(--ink-soft, #4A5C64); margin-top: 8px; }
.viz-empty { font-size: .88rem; padding: 18px 0; }
.viz-legend { display: flex; flex-wrap: wrap; gap: 14px; margin: 2px 0 10px; }
.viz-key { display: inline-flex; align-items: center; gap: 6px; font-size: .82rem;
           color: var(--ink-soft, #4A5C64); }
.viz-key i { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
.viz-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; }
.viz-tile { background: var(--paper-2, #F3EEE5); border-radius: 14px; padding: 13px 14px; }
.viz-tile-v { font-family: var(--font-head, inherit); font-size: 1.7rem; font-weight: 800;
              line-height: 1.05; color: var(--ink, #22333B); }
.viz-tile-l { font-size: .74rem; color: var(--ink-faint, #8697A0); margin-top: 2px; line-height: 1.3; }
.viz-tile-d { font-size: .74rem; margin-top: 5px; font-weight: 600; }
@media print { .viz svg { max-width: 100%; } .viz { break-inside: avoid; } }
`;

  w.Charts = { line, compareBars, cumulative, activity, tiles, empty, legend, CSS, palette: P };
})(window);
