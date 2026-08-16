/* ==========================================================================
   AraBuzz — garden.js
   The real garden.

   Not a row of icons on a card. A drawn plot of earth: bare tilled soil at the
   start, with seeds sitting in the furrows — and as each word is learned, that
   word's own seed germinates, puts out leaves, buds, flowers and finally fruits.
   Behind the beds stands one tree that grows with her overall progress.

   Everything here is drawn as SVG, so it stays sharp on an iPad and costs
   nothing to load. The realism comes from four things, not from detail:

     1  Depth. Four planes — far treeline, hedge, three beds stepping toward
        you, and out-of-focus grass right at the front. Things further away are
        smaller, paler, bluer and softly blurred, exactly as air makes them.
     2  One light. Every highlight is on the sun's side and every shadow falls
        away from it, including the soft contact shadow each plant casts on the
        soil. Consistent light is most of what reads as "real".
     3  Surface. The soil is not a brown rectangle — it is a noise-displaced
        wash with clods, pebbles, furrow shadows and damp patches.
     4  Imperfection. Nothing is evenly spaced, no two leaves are the same, and
        every plant leans a little. All of it is seeded, so her garden looks
        the same every time she opens it.
   ========================================================================== */
(function (w) {
  'use strict';

  /* ----------------------------------------------------------------- util */
  function rng(seed) {
    let s = (seed >>> 0) || 9;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function hash(str) {
    let h = 2166136261;
    String(str).split('').forEach(c => { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); });
    return h >>> 0;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const n1 = v => Math.round(v * 10) / 10;

  function hex(c) {
    c = c.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  }
  function rgb(a) {
    return '#' + a.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  /** Blend two colours. t=0 gives a, t=1 gives b. */
  function mix(a, b, t) {
    const x = hex(a), y = hex(b);
    return rgb([0, 1, 2].map(i => x[i] + (y[i] - x[i]) * t));
  }
  /** Lighten (t>0) or darken (t<0). */
  function shade(c, t) { return t >= 0 ? mix(c, '#ffffff', t) : mix(c, '#000000', -t); }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ==========================================================================
     LIGHT
     Five times of day, matched to how much of her list is fully grown. Each one
     carries a sky, a sun position, and — importantly — the colour and direction
     of shadow, plus how much the foliage is tinted by that light.
     ========================================================================== */
  const LIGHT = {
    dawn: {
      name: 'First light',
      sky: ['#1B3C68', '#7286B4', '#EFA98A', '#FCDCB6'],
      sun: { x: 0.20, y: 0.74, r: 46, core: '#FFF0CB', glow: '#FF9C6A', bloom: .8, moon: false },
      dir: -1, warm: '#FFC489', cool: '#3B4E77',
      haze: '#C9BBC4', hazeAmt: .34,
      soil: '#5A4230', grass: '#4E6B45',
      leafTint: '#C9A98C', leafTintAmt: .20,
      shadow: '#3A3350', shadowAmt: .30, shadowLen: 1.5,
      ambient: .40, blurb: 'The sun is only just up.'
    },
    morning: {
      name: 'Bright morning',
      sky: ['#3E7FB8', '#79ADD6', '#BFDCEB', '#E4EFF3'],
      sun: { x: 0.78, y: 0.22, r: 36, core: '#FFFCE9', glow: '#FFE9A8', bloom: .45, moon: false },
      dir: 1, warm: '#FFF0C4', cool: '#5D89B4',
      haze: '#CFE1EC', hazeAmt: .28,
      soil: '#6B4B33', grass: '#5C8A4A',
      leafTint: '#E7F0BF', leafTintAmt: .12,
      shadow: '#2E4A5E', shadowAmt: .24, shadowLen: 1.15,
      ambient: .62, blurb: 'A clear, bright morning.'
    },
    day: {
      name: 'Full day',
      sky: ['#1F6FA8', '#4E9BCD', '#9CC9E2', '#D9EAF0'],
      sun: { x: 0.66, y: 0.14, r: 30, core: '#FFFFF4', glow: '#FFF3C0', bloom: .34, moon: false },
      dir: 1, warm: '#FFF9DC', cool: '#4C7C9E',
      haze: '#C4DCE8', hazeAmt: .24,
      soil: '#6F4E34', grass: '#548A42',
      leafTint: '#FFFFFF', leafTintAmt: .04,
      shadow: '#1E4536', shadowAmt: .26, shadowLen: .75,
      ambient: .72, blurb: 'The middle of a big blue day.'
    },
    golden: {
      name: 'Golden hour',
      sky: ['#2B5F94', '#8E7FAE', '#EE9A63', '#FFD79B'],
      sun: { x: 0.14, y: 0.56, r: 52, core: '#FFF7DA', glow: '#FF8F45', bloom: .9, moon: false },
      dir: -1, warm: '#FFC98A', cool: '#4A5B84',
      haze: '#EFC49E', hazeAmt: .3,
      soil: '#6E4526', grass: '#587F3C',
      leafTint: '#F5C06A', leafTintAmt: .3,
      shadow: '#4A3355', shadowAmt: .32, shadowLen: 2.1,
      ambient: .52, blurb: 'The light has gone gold.'
    },
    starlit: {
      name: 'Starlight',
      sky: ['#050A1E', '#0D1636', '#1B2450', '#2E3468'],
      sun: { x: 0.74, y: 0.24, r: 26, core: '#F4F2FF', glow: '#9AA6E8', bloom: .55, moon: true },
      dir: 1, warm: '#B9C4F5', cool: '#0E1533',
      haze: '#1A2246', hazeAmt: .42,
      soil: '#2A2119', grass: '#20362A',
      leafTint: '#4A6C86', leafTintAmt: .42,
      shadow: '#050912', shadowAmt: .40, shadowLen: 1.0,
      ambient: .22, blurb: 'Fireflies, and a whole sky of stars.'
    }
  };
  const ORDER = ['dawn', 'morning', 'day', 'golden', 'starlit'];
  const AT = { dawn: 0, morning: .15, day: .35, golden: .60, starlit: .82 };

  function stageKeyFor(pct) {
    let k = 'dawn';
    ORDER.forEach(x => { if (pct >= AT[x]) k = x; });
    return k;
  }
  function nextStage(pct) {
    const k = ORDER.find(x => AT[x] > pct);
    return k ? { key: k, at: AT[k], name: LIGHT[k].name } : null;
  }

  /* ==========================================================================
     SPECIES
     Seven real garden plants, each with its own silhouette, leaf, flower and
     crop. A word always gets the same one, so she comes to know "the sunflower
     word" and "the strawberry word".
     ========================================================================== */
  const SPECIES = {
    tomato: {
      label: 'Tomato', H: 104, stemW: 4.2, stem: '#587F3A', bend: .16,
      leaf: { shape: 'lobed', len: 30, wid: 19, pairs: 4, ang: 62, col: '#3F6B2E' },
      flower: { kind: 'star', col: '#F0C53E', mid: '#B98B1E', r: 5, n: 6 },
      fruit: { kind: 'round', col: '#C33A2A', r: 6.5, n: 5 }
    },
    sunflower: {
      label: 'Sunflower', H: 136, stemW: 5.4, stem: '#547636', bend: .07,
      leaf: { shape: 'heart', len: 34, wid: 30, pairs: 3, ang: 52, col: '#3D6A2C' },
      flower: { kind: 'sun', col: '#E9A72F', mid: '#5D3F1E', r: 20, n: 1 },
      fruit: null
    },
    chilli: {
      label: 'Chilli', H: 86, stemW: 3.6, stem: '#4E7A38', bend: .2,
      leaf: { shape: 'oval', len: 24, wid: 12, pairs: 5, ang: 68, col: '#356329' },
      flower: { kind: 'star', col: '#F3F0DC', mid: '#C9C08E', r: 4, n: 5 },
      fruit: { kind: 'chilli', col: '#BE2E28', r: 5, n: 5 }
    },
    tulip: {
      label: 'Tulip', H: 76, stemW: 3.4, stem: '#4C7A3E', bend: .1,
      leaf: { shape: 'blade', len: 46, wid: 13, pairs: 2, ang: 78, col: '#3E6E3C' },
      flower: { kind: 'cup', col: '#C0455F', mid: '#8E2B45', r: 11, n: 1 },
      fruit: null
    },
    lavender: {
      label: 'Lavender', H: 72, stemW: 2.4, stem: '#6D7C4E', bend: .12,
      leaf: { shape: 'needle', len: 20, wid: 5, pairs: 5, ang: 72, col: '#5C7148' },
      flower: { kind: 'spike', col: '#7B6AA8', mid: '#584A82', r: 5, n: 4 },
      fruit: null
    },
    strawberry: {
      label: 'Strawberry', H: 46, stemW: 2.6, stem: '#4F7A34', bend: .22,
      leaf: { shape: 'trefoil', len: 20, wid: 17, pairs: 4, ang: 84, col: '#37662A' },
      flower: { kind: 'star', col: '#FBF7EE', mid: '#E7C555', r: 4.5, n: 4 },
      fruit: { kind: 'berry', col: '#C22F3A', r: 5.5, n: 4 }
    },
    lettuce: {
      label: 'Lettuce', H: 40, stemW: 2.2, stem: '#5C8236', bend: .05,
      leaf: { shape: 'ruffle', len: 26, wid: 22, pairs: 5, ang: 88, col: '#6A9A3C' },
      flower: null, fruit: null
    }
  };
  const SPECIES_KEYS = Object.keys(SPECIES);
  function speciesFor(id) { return SPECIES_KEYS[hash(id) % SPECIES_KEYS.length]; }

  /* how tall a plant stands, and what it carries, at each Leitner box */
  const GROWTH = [
    { h: 0.00, leaves: 0, buds: 0, flowers: 0, fruit: 0 },  // 0 · a seed in the soil
    { h: 0.09, leaves: 2, buds: 0, flowers: 0, fruit: 0 },  // 1 · breaking through
    { h: 0.24, leaves: 3, buds: 0, flowers: 0, fruit: 0 },  // 2 · a seedling
    { h: 0.46, leaves: 5, buds: 1, flowers: 0, fruit: 0 },  // 3 · a young plant
    { h: 0.70, leaves: 7, buds: 3, flowers: 1, fruit: 0 },  // 4 · nearly there
    { h: 0.90, leaves: 9, buds: 1, flowers: 4, fruit: 1 },  // 5 · in flower
    { h: 1.00, leaves: 10, buds: 0, flowers: 3, fruit: 5 }  // 6 · cropping
  ];
  const STAGE_NAME = ['A seed in the ground', 'Breaking through', 'A seedling',
    'A young plant', 'Nearly grown', 'In flower', 'Full of fruit'];

  /* ==========================================================================
     Plant parts
     ========================================================================== */

  /** A leaf drawn from its stalk, pointing up the -y axis. */
  function leafPath(len, wid, curl, shape) {
    const w2 = wid / 2, tipX = curl * len * 0.14, tipY = -len;
    if (shape === 'needle' || shape === 'blade') {
      return `M0 0 C ${-w2} ${-len * .3} ${-w2 * .55} ${-len * .8} ${tipX} ${tipY}
              C ${w2 * .55} ${-len * .8} ${w2} ${-len * .3} 0 0 Z`;
    }
    if (shape === 'heart') {
      return `M0 0 C ${-w2 * 1.1} ${-len * .2} ${-w2 * 1.15} ${-len * .78} ${tipX} ${tipY}
              C ${w2 * 1.15} ${-len * .78} ${w2 * 1.1} ${-len * .2} 0 0 Z`;
    }
    if (shape === 'lobed') {
      return `M0 0 C ${-w2 * .5} ${-len * .12} ${-w2} ${-len * .2} ${-w2 * .95} ${-len * .38}
              C ${-w2 * .55} ${-len * .44} ${-w2 * 1.05} ${-len * .58} ${-w2 * .7} ${-len * .72}
              C ${-w2 * .4} ${-len * .8} ${-w2 * .3} ${-len * .92} ${tipX} ${tipY}
              C ${w2 * .3} ${-len * .92} ${w2 * .4} ${-len * .8} ${w2 * .7} ${-len * .72}
              C ${w2 * 1.05} ${-len * .58} ${w2 * .55} ${-len * .44} ${w2 * .95} ${-len * .38}
              C ${w2} ${-len * .2} ${w2 * .5} ${-len * .12} 0 0 Z`;
    }
    if (shape === 'ruffle') {
      let d = `M0 0 `;
      const steps = 7;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, x = -w2 * Math.sin(t * Math.PI) * (1 + (i % 2 ? .16 : -.1));
        d += `Q ${x * 1.25} ${-len * (t - .07)} ${x} ${-len * t} `;
      }
      for (let i = steps; i >= 1; i--) {
        const t = i / steps, x = w2 * Math.sin(t * Math.PI) * (1 + (i % 2 ? .16 : -.1));
        d += `Q ${x * 1.25} ${-len * (t + .05)} ${x} ${-len * (t - 1 / steps)} `;
      }
      return d + 'Z';
    }
    // oval / trefoil default
    return `M0 0 C ${-w2} ${-len * .26} ${-w2 * .92} ${-len * .74} ${tipX} ${tipY}
            C ${w2 * .92} ${-len * .74} ${w2} ${-len * .26} 0 0 Z`;
  }

  function leaf(o) {
    const { x, y, ang, len, wid, shape, id, tone, curl } = o;
    const rib = `M0 0 Q ${curl * len * .06} ${-len * .5} ${curl * len * .13} ${-len * .94}`;
    const veins = shape === 'needle' ? '' : [0.3, 0.52, 0.74].map(t =>
      `<path d="M${curl * len * t * .1} ${-len * t} q ${wid * .26} ${-len * .06} ${wid * .34} ${-len * .12}"
         stroke="rgba(0,0,0,.16)" stroke-width=".7" fill="none"/>
       <path d="M${curl * len * t * .1} ${-len * t} q ${-wid * .26} ${-len * .06} ${-wid * .34} ${-len * .12}"
         stroke="rgba(0,0,0,.16)" stroke-width=".7" fill="none"/>`).join('');
    return `<g transform="translate(${n1(x)},${n1(y)}) rotate(${n1(ang)})">
      <path d="${leafPath(len, wid, curl, shape)}" fill="url(#lf${tone}${id})"/>
      <path d="${rib}" stroke="rgba(255,255,255,.28)" stroke-width="1" fill="none" stroke-linecap="round"/>
      ${veins}
    </g>`;
  }

  function flower(kind, x, y, r, col, mid, ang, id, R) {
    const t = ang || 0;
    if (kind === 'sun') {
      const petals = [];
      for (let i = 0; i < 21; i++) {
        const a = i * (360 / 21) + R() * 6;
        petals.push(`<ellipse rx="${n1(r * .30)}" ry="${n1(r * .82)}" cy="${n1(-r * .74)}"
          transform="rotate(${n1(a)})" fill="url(#pt${id})"/>`);
      }
      return `<g transform="translate(${n1(x)},${n1(y)}) rotate(${n1(t)})">
        ${petals.join('')}
        <circle r="${n1(r * .52)}" fill="${mid}"/>
        <circle r="${n1(r * .52)}" fill="url(#seedh${id})"/>
        <circle r="${n1(r * .3)}" fill="rgba(0,0,0,.22)"/>
      </g>`;
    }
    if (kind === 'cup') {
      const petal = (sx, w2, h2, fill) => `<path d="M${n1(sx)} ${n1(r * .3)}
        C ${n1(sx - w2)} ${n1(-h2 * .45)} ${n1(sx - w2 * .8)} ${n1(-h2 * .92)} ${n1(sx - w2 * .1)} ${n1(-h2)}
        C ${n1(sx + w2 * .75)} ${n1(-h2 * .9)} ${n1(sx + w2)} ${n1(-h2 * .4)} ${n1(sx)} ${n1(r * .3)} Z"
        fill="${fill}"/>`;
      return `<g transform="translate(${n1(x)},${n1(y)}) rotate(${n1(t)})">
        ${petal(-r * .42, r * .52, r * 1.62, shade(col, -.24))}
        ${petal(r * .42, r * .52, r * 1.58, shade(col, -.12))}
        ${petal(0, r * .62, r * 1.9, col)}
        <path d="M${n1(-r * .3)} ${n1(-r * .5)} C ${n1(-r * .3)} ${n1(-r * 1.3)} ${n1(-r * .1)} ${n1(-r * 1.7)} ${n1(r * .06)} ${n1(-r * 1.82)}"
              stroke="${shade(col, .34)}" stroke-width="1.5" fill="none" opacity=".75"/>
        <path d="M${n1(-r * .55)} ${n1(r * .2)} q ${n1(r * .55)} ${n1(-r * .35)} ${n1(r * 1.1)} 0"
              stroke="${shade(col, -.4)}" stroke-width="1.2" fill="none" opacity=".5"/>
      </g>`;
    }
    if (kind === 'spike') {
      const buds = [];
      for (let i = 0; i < 9; i++) {
        const yy = -i * r * .46, sx = (i % 2 ? 1 : -1) * r * .22, rr = r * (.34 - i * .018);
        buds.push(`<ellipse cx="${n1(sx)}" cy="${n1(yy)}" rx="${n1(rr)}" ry="${n1(rr * 1.5)}"
          fill="${i % 3 === 0 ? shade(col, .16) : col}"/>`);
      }
      return `<g transform="translate(${n1(x)},${n1(y)}) rotate(${n1(t)})">${buds.join('')}</g>`;
    }
    // star — a simple five/six petal bloom seen face on
    const n = 5, petals = [];
    for (let i = 0; i < n; i++) {
      petals.push(`<ellipse rx="${n1(r * .46)}" ry="${n1(r * .92)}" cy="${n1(-r * .58)}"
        transform="rotate(${n1(i * (360 / n) + R() * 8)})" fill="${i % 2 ? col : shade(col, -.07)}"/>`);
    }
    return `<g transform="translate(${n1(x)},${n1(y)}) rotate(${n1(t)})">
      ${petals.join('')}<circle r="${n1(r * .3)}" fill="${mid}"/></g>`;
  }

  function fruit(kind, x, y, r, col, id, R) {
    if (kind === 'chilli') {
      const bend = (R() < .5 ? 1 : -1) * r * .5;
      return `<g transform="translate(${n1(x)},${n1(y)})">
        <path d="M0 0 C ${bend} ${r * 1.2} ${bend * .6} ${r * 2.6} 0 ${r * 3.4}
                 C ${-bend * .5} ${r * 2.6} ${-r * .7} ${r * 1.1} 0 0 Z" fill="url(#fr${id})"/>
        <path d="M${-r * .2} ${r * .4} C ${bend * .5} ${r * 1.4} ${bend * .3} ${r * 2.3} ${-r * .1} ${r * 2.8}"
              stroke="rgba(255,255,255,.4)" stroke-width="1.1" fill="none"/>
        <path d="M${-r * .5} 0 q ${r * .5} ${-r * .5} ${r} 0" stroke="#4E7A34" stroke-width="1.6" fill="none"/>
      </g>`;
    }
    if (kind === 'berry') {
      return `<g transform="translate(${n1(x)},${n1(y)})">
        <path d="M${-r} ${-r * .3} C ${-r} ${r * .9} ${-r * .4} ${r * 1.6} 0 ${r * 1.7}
                 C ${r * .4} ${r * 1.6} ${r} ${r * .9} ${r} ${-r * .3}
                 C ${r * .6} ${-r} ${-r * .6} ${-r} ${-r} ${-r * .3} Z" fill="url(#fr${id})"/>
        ${[0, 1, 2, 3, 4].map(i => `<circle cx="${n1((R() - .5) * r * 1.2)}" cy="${n1(R() * r * 1.2)}"
          r=".8" fill="rgba(255,240,180,.75)"/>`).join('')}
        <path d="M${-r * .8} ${-r * .5} q ${r * .8} ${-r * .5} ${r * 1.6} 0" stroke="#40702E"
              stroke-width="2" fill="none" stroke-linecap="round"/>
      </g>`;
    }
    // round — tomato
    return `<g transform="translate(${n1(x)},${n1(y)})">
      <ellipse rx="${n1(r)}" ry="${n1(r * .92)}" fill="url(#fr${id})"/>
      <ellipse cx="${n1(-r * .3)}" cy="${n1(-r * .34)}" rx="${n1(r * .3)}" ry="${n1(r * .2)}"
        fill="rgba(255,255,255,.5)" transform="rotate(-25 ${n1(-r * .3)} ${n1(-r * .34)})"/>
      <path d="M${-r * .55} ${-r * .72} l ${r * .5} ${r * .2} l ${r * .55} ${-r * .24}"
        stroke="#3F6B2E" stroke-width="1.7" fill="none" stroke-linecap="round"/>
    </g>`;
  }

  /**
   * One plant, standing on the soil at (0,0) in its own coordinates.
   * @param {object} o {species, box, seed, id, L, scale, label}
   */
  function plant(o) {
    const sp0 = SPECIES[o.species] || SPECIES.tomato;
    /* petals and fruit take the colour of the light too — a sunflower at
       midnight is not the same yellow it is at noon */
    const Lt = o.L || LIGHT.day;
    const lit = c => mix(c, Lt.leafTint, Lt.leafTintAmt * .8);
    const sp = Object.assign({}, sp0, {
      flower: sp0.flower ? Object.assign({}, sp0.flower,
        { col: lit(sp0.flower.col), mid: lit(sp0.flower.mid) }) : null,
      fruit: sp0.fruit ? Object.assign({}, sp0.fruit, { col: lit(sp0.fruit.col) }) : null
    });
    const box = clamp(o.box | 0, 0, 6);
    const g = GROWTH[box];
    const R = rng(o.seed || 7);
    const id = o.id;
    const L = o.L || LIGHT.day;
    const dir = L.dir;
    const H = sp.H * g.h;
    const lean = (R() - .5) * .34;
    const parts = [];

    /* contact shadow — the single strongest cue that a thing is standing on
       the ground and not floating above it */
    const spread = 5 + H * .16;
    parts.push(`<ellipse cx="${n1(-dir * (2 + H * .07 * L.shadowLen))}" cy="1.5"
      rx="${n1(spread * (1 + L.shadowLen * .3))}" ry="${n1(2.4 + H * .028)}"
      fill="${L.shadow}" opacity="${(L.shadowAmt * .75).toFixed(2)}" filter="url(#soft${id})"/>`);

    if (box === 0) {
      /* bare earth: a shallow dimple with a seed sitting in it */
      parts.push(`
        <ellipse cx="0" cy="0" rx="9" ry="4" fill="#000" opacity=".18" filter="url(#soft${id})"/>
        <ellipse cx="0" cy="-.5" rx="7" ry="3" fill="${shade(L.soil, -.14)}"/>
        <g transform="translate(0,-2.2) rotate(${n1(R() * 40 - 20)})">
          <ellipse rx="3.6" ry="2.5" fill="url(#seed${id})"/>
          <ellipse cx="-1" cy="-.8" rx="1.3" ry=".8" fill="rgba(255,255,255,.35)"/>
        </g>`);
      return `<g class="gp" data-word="${esc(o.label || '')}">${parts.join('')}</g>`;
    }

    /* stem, leaning a little, tapering as it rises */
    const topX = lean * H * .5, topY = -H;
    const cx1 = lean * H * .12, cy1 = -H * .45;
    const wBase = sp.stemW * (0.5 + g.h * 0.6), wTop = wBase * .45;
    parts.push(`<path d="M${n1(-wBase / 2)} 0 Q ${n1(cx1 - wTop / 2)} ${n1(cy1)} ${n1(topX - wTop / 2)} ${n1(topY)}
      L ${n1(topX + wTop / 2)} ${n1(topY)} Q ${n1(cx1 + wTop / 2)} ${n1(cy1)} ${n1(wBase / 2)} 0 Z"
      fill="url(#st${id})"/>`);

    /* leaves, paired up the stem, biggest low down */
    const rosette = sp.leaf.shape === 'ruffle' || sp.leaf.shape === 'trefoil';
    for (let i = 0; i < g.leaves; i++) {
      const t = rosette ? (i / Math.max(1, g.leaves - 1)) * .5 + .05
                        : 0.12 + (i / Math.max(1, g.leaves)) * .82;
      const ly = -H * t, lx = lean * H * t * t;
      const side = i % 2 ? 1 : -1;
      const size = (rosette ? 1 : (1.12 - t * .5)) * (0.82 + R() * .36) * (0.55 + g.h * .55);
      const ang = side * (sp.leaf.ang * (rosette ? (0.5 + R() * .9) : (1 - t * .35))) + (R() - .5) * 14;
      // leaves facing the light are drawn a touch lighter
      const tone = (side * dir > 0) ? 'a' : (i % 3 === 0 ? 'c' : 'b');
      parts.push(leaf({
        x: lx, y: ly, ang, len: sp.leaf.len * size, wid: sp.leaf.wid * size,
        shape: sp.leaf.shape, id, tone, curl: side * (.4 + R() * .6)
      }));
    }

    /* buds, flowers, then fruit — a plant carries them in that order */
    const crownX = topX, crownY = topY;
    const around = (k, n, spreadX, spreadY) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = (i / Math.max(1, n)) * Math.PI * 2 + R();
        out.push({ x: crownX + Math.cos(a) * spreadX * (0.35 + R() * .8),
                   y: crownY + Math.abs(Math.sin(a)) * spreadY * (0.2 + R() * .9) });
      }
      return out;
    };

    if (sp.flower) {
      if (sp.flower.kind === 'sun' && g.flowers) {
        parts.push(flower('sun', crownX, crownY - sp.flower.r * .5, sp.flower.r * (0.7 + g.h * .3),
          sp.flower.col, sp.flower.mid, dir * -8, id, R));
      } else {
        around('f', g.flowers, sp.H * .22, sp.H * .3).forEach(p =>
          parts.push(flower(sp.flower.kind, p.x, p.y, sp.flower.r, sp.flower.col, sp.flower.mid,
            (R() - .5) * 30, id, R)));
        around('b', g.buds, sp.H * .18, sp.H * .22).forEach(p =>
          parts.push(`<ellipse cx="${n1(p.x)}" cy="${n1(p.y)}" rx="${n1(sp.flower.r * .4)}"
            ry="${n1(sp.flower.r * .62)}" fill="${shade(sp.leaf.col, .12)}"
            transform="rotate(${n1((R() - .5) * 40)} ${n1(p.x)} ${n1(p.y)})"/>`));
      }
    }
    if (sp.fruit && g.fruit) {
      around('r', Math.min(g.fruit, sp.fruit.n), sp.H * .2, sp.H * .34).forEach(p =>
        parts.push(fruit(sp.fruit.kind, p.x, p.y + sp.fruit.r, sp.fruit.r, sp.fruit.col, id, R)));
    }

    return `<g class="gp" data-word="${esc(o.label || '')}">${parts.join('')}</g>`;
  }

  /* ==========================================================================
     The tree at the back of the plot — overall progress, drawn as one plant
     rather than a number.
     ========================================================================== */
  function tree(o) {
    const pct = clamp(o.pct || 0, 0, 1);
    const L = o.L || LIGHT.day;
    const id = o.id;
    const R = rng(o.seed || 4242);
    const H = 44 + pct * 168;
    const bark = mix('#54402A', L.warm, .18);
    const out = [], tips = [];

    if (pct < .04) {
      /* newly planted — a whip tied to a stake, which is what a real young
         tree actually looks like in its first season */
      return `<g>
        <ellipse cx="${n1(-L.dir * 8)}" cy="2" rx="18" ry="4.5" fill="${L.shadow}"
          opacity="${L.shadowAmt}" filter="url(#soft${id})"/>
        <path d="M7 0 L 7 -40" stroke="${shade(bark, .18)}" stroke-width="3.4" stroke-linecap="round"/>
        <path d="M0 0 q -2 -18 -1 -36" stroke="url(#bark${id})" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M7 -28 q -4 2 -8 1" stroke="#8A7A55" stroke-width="2"/>
        <path d="M-1 -30 q -10 -7 -15 -18 M-1 -22 q 10 -6 15 -16" stroke="${bark}" stroke-width="2.2" fill="none"/>
        <ellipse cx="-17" cy="-50" rx="8" ry="5.4" fill="url(#lfa${id})" transform="rotate(-28 -17 -50)"/>
        <ellipse cx="15" cy="-40" rx="8" ry="5.4" fill="url(#lfb${id})" transform="rotate(28 15 -40)"/>
        <ellipse cx="-4" cy="-42" rx="7" ry="4.6" fill="url(#lfc${id})" transform="rotate(-8 -4 -42)"/>
      </g>`;
    }

    /* Branching: fewer, longer limbs low down splitting into many fine twigs.
       Real trees taper hard — each generation is about two-thirds the last. */
    const depth = pct < .18 ? 2 : pct < .38 ? 3 : pct < .66 ? 4 : 5;
    (function branch(x, y, ang, len, wid, d) {
      const bendDir = (R() - .5) * .5;
      const cx = x + Math.sin(ang + bendDir) * len * .55;
      const cy = y - Math.cos(ang + bendDir) * len * .55;
      const x2 = x + Math.sin(ang) * len, y2 = y - Math.cos(ang) * len;
      out.push(`<path d="M${n1(x)} ${n1(y)} Q ${n1(cx)} ${n1(cy)} ${n1(x2)} ${n1(y2)}"
        stroke="${bark}" stroke-width="${n1(wid)}" fill="none" stroke-linecap="round"/>`);
      if (d === 0) { tips.push({ x: x2, y: y2, r: 9 + len * .62 }); return; }
      const n = R() < .28 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * (0.46 + R() * .34) + (R() - .5) * .22;
        branch(x2, y2, ang + off, len * (.62 + R() * .16), wid * .6, d - 1);
      }
    })(0, -H * .3, 0, H * .3, 4 + pct * 11, depth);

    /* Canopy. Many small clumps rather than a few big circles — that is the
       whole difference between a real tree and a lollipop. Three passes:
       a dark mass, the mid green over it, then a lit rim on the sun's side. */
    const clumps = [];
    const passes = [
      { dx: -L.dir * 5, dy: 8, tone: 'b', s: 1.2,  n: 8,  r: [.30, .46], op: 1 },
      { dx: 0,          dy: 0, tone: 'a', s: 0.95, n: 11, r: [.20, .36], op: 1 },
      { dx: L.dir * 6,  dy: -7, tone: 'c', s: 0.6, n: 8,  r: [.12, .24], op: .95 }
    ];
    passes.forEach(p => tips.forEach(t => {
      for (let i = 0; i < p.n; i++) {
        const a = R() * Math.PI * 2, d = R() * t.r * .95;
        const jx = Math.cos(a) * d, jy = Math.sin(a) * d * .8;
        const rr = t.r * (p.r[0] + R() * (p.r[1] - p.r[0])) * p.s * 2;
        clumps.push(`<ellipse cx="${n1(t.x + jx + p.dx)}" cy="${n1(t.y + jy + p.dy)}"
          rx="${n1(rr)}" ry="${n1(rr * (.72 + R() * .24))}" fill="url(#lf${p.tone}${id})"
          opacity="${p.op}" transform="rotate(${n1((R() - .5) * 40)} ${n1(t.x + jx + p.dx)} ${n1(t.y + jy + p.dy)})"/>`);
      }
    }));

    /* blossom in golden hour, once the tree is really established */
    const extra = [];
    if (pct > .6) {
      for (let i = 0; i < 26; i++) {
        const t = tips[Math.floor(R() * tips.length)];
        if (!t) break;
        extra.push(`<circle cx="${n1(t.x + (R() - .5) * t.r * 1.3)}" cy="${n1(t.y + (R() - .5) * t.r)}"
          r="${(1.6 + R() * 1.8).toFixed(1)}" fill="${mix('#F6D9E2', L.warm, .3)}" opacity=".8"/>`);
      }
    }

    /* buttressed trunk — wider at the foot, with a root flare */
    const bw = 5 + pct * 13;
    const trunk = `M${n1(-bw)} 2
      C ${n1(-bw * .5)} ${n1(-H * .12)} ${n1(-bw * .34)} ${n1(-H * .2)} ${n1(-bw * .3)} ${n1(-H * .32)}
      L ${n1(bw * .3)} ${n1(-H * .32)}
      C ${n1(bw * .34)} ${n1(-H * .2)} ${n1(bw * .5)} ${n1(-H * .12)} ${n1(bw)} 2 Z`;

    return `<g>
      <ellipse cx="${n1(-L.dir * H * .2)}" cy="4" rx="${n1(24 + H * .26)}" ry="${n1(6 + H * .04)}"
        fill="${L.shadow}" opacity="${(L.shadowAmt * .85).toFixed(2)}" filter="url(#soft${id})"/>
      <path d="M${n1(-bw * 1.5)} 3 q ${n1(bw * .8)} -4 ${n1(bw * 1.5)} -1 q ${n1(bw * .8)} -3 ${n1(bw * 1.5)} 1 Z"
        fill="${shade(bark, -.2)}"/>
      <path d="${trunk}" fill="url(#bark${id})"/>
      ${out.join('')}
      <g filter="url(#leafy${id})">${clumps.join('')}</g>
      ${extra.join('')}
    </g>`;
  }

  /* ==========================================================================
     Ground
     ========================================================================== */
  /**
   * A bed of dug earth. The realism is in the surface: a graded wash, a real
   * noise crumb, a coarse second noise for damp and shade, then clods, pebbles
   * and the shadowed lip where the soil meets the grass behind it.
   */
  function soilBed(o) {
    const { x, y, w: bw, h: bh, id, L, seed } = o;
    const R = rng(seed);
    const base = L.soil;
    const bits = [];

    /* the bed's own outline: a soft-cornered slab with a slightly wavy front
       edge, because nobody digs a rectangle */
    /* A bed is a trapezoid, not a rectangle: narrower along its far edge than
       its near one, because it is running away from you. Both edges bow a
       little and the ends are ragged, because it was dug by hand. */
    const ti = o.ti || 0, bi = o.bi || 0;
    const fx1 = x + ti, fx2 = x + bw - ti;                 // far edge
    const nx1 = x + bi, nx2 = x + bw - bi;                 // near edge
    const yb = y + bh;
    const nearEdge =
      `C ${n1(nx1 + (nx2 - nx1) * .74)} ${n1(yb + 8)} ${n1(nx1 + (nx2 - nx1) * .28)} ${n1(yb + 7)} ${n1(nx1)} ${n1(yb - 2)}`;
    const shape =
      `M${n1(fx1)} ${n1(y + 4)}
       C ${n1(fx1 + (fx2 - fx1) * .3)} ${n1(y - 4)} ${n1(fx1 + (fx2 - fx1) * .7)} ${n1(y - 3)} ${n1(fx2)} ${n1(y + 5)}
       L ${n1(nx2)} ${n1(yb - 2)}
       ${nearEdge} Z`;

    /* raked furrows — broken, curved, never full width */
    for (let i = 0; i < 7; i++) {
      const ft = 0.16 + R() * .8, fy = y + bh * ft;
      const fin = ti + (bi - ti) * ft;
      const fx = x + fin + R() * (bw - fin * 2) * .5, fw = (bw - fin * 2) * (.18 + R() * .4);
      bits.push(`<path d="M${n1(fx)} ${n1(fy)} q ${n1(fw * .3)} ${n1(-2 - R() * 4)} ${n1(fw * .6)} ${n1(R() * 3)}
          t ${n1(fw * .5)} ${n1(-R() * 3)}" stroke="${shade(base, -.26)}"
          stroke-width="${n1(1.6 + R() * 2.6)}" fill="none" opacity=".45" stroke-linecap="round"/>
        <path d="M${n1(fx)} ${n1(fy - 2.4)} q ${n1(fw * .3)} ${n1(-2 - R() * 4)} ${n1(fw * .6)} ${n1(R() * 3)}
          t ${n1(fw * .5)} ${n1(-R() * 3)}" stroke="${shade(base, .2)}" stroke-width="1.1"
          fill="none" opacity=".3" stroke-linecap="round"/>`);
    }

    /* clods, and the occasional pebble catching the light */
    const nClods = Math.round(bw / 15);
    for (let i = 0; i < nClods; i++) {
      const ct = 0.08 + R() * .9, cy = y + bh * ct;
      const cin = ti + (bi - ti) * ct;
      const cx = x + cin + R() * (bw - cin * 2);
      const r = 1.4 + R() * 4.6;
      const pebble = R() < .12;
      bits.push(`<ellipse cx="${n1(cx + L.dir * -r * .3)}" cy="${n1(cy + r * .45)}" rx="${n1(r * 1.05)}"
          ry="${n1(r * .5)}" fill="#000" opacity=".22"/>
        <ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(r)}" ry="${n1(r * .66)}"
          fill="${pebble ? mix('#98908A', L.warm, .28) : shade(base, R() * .2 - .06)}"/>
        <ellipse cx="${n1(cx + L.dir * r * .3)}" cy="${n1(cy - r * .22)}" rx="${n1(r * .44)}"
          ry="${n1(r * .24)}" fill="rgba(255,255,255,${pebble ? .34 : .17})"/>`);
    }

    return `
      <g>
        <path d="${shape}" fill="url(#soil${id})"/>
        <g clip-path="url(#bedc${seed}${id})">
          <rect x="${n1(x)}" y="${n1(y)}" width="${n1(bw)}" height="${n1(bh)}"
                filter="url(#patch${id})" opacity=".7"/>
          ${bits.join('')}
          <rect x="${n1(x)}" y="${n1(y)}" width="${n1(bw)}" height="${n1(bh)}"
                filter="url(#crumb${id})" opacity=".85"/>
          <!-- the shaded lip where the dug bed drops away from the path behind -->
          <rect x="${n1(x)}" y="${n1(y - 2)}" width="${n1(bw)}" height="${n1(bh * .2)}"
                fill="${shade(base, -.5)}" opacity=".5" filter="url(#soft${id})"/>
        </g>
        <path d="M${n1(nx2)} ${n1(yb - 2)} ${nearEdge}" fill="none"
              stroke="${shade(base, .3)}" stroke-width="2.2" opacity=".55"/>
        <path d="M${n1(nx2)} ${n1(yb + 1)} ${nearEdge}" fill="none"
              stroke="${shade(base, -.45)}" stroke-width="3" opacity=".4"/>
        <clipPath id="bedc${seed}${id}"><path d="${shape}"/></clipPath>
      </g>`;
  }

  /**
   * Blades scattered over the whole lawn, thicker and taller as they come
   * forward. This is what stops the ground plane reading as a flat green sheet.
   */
  function turfDetail(o) {
    const { x, y, w: gw, h: gh, id, L, seed } = o;
    const detail = o.detail == null ? 1 : o.detail;
    const R = rng(seed);
    const blades = [];
    /* Real blades only where the eye can resolve them — along the near edge of
       each bed and in the front third. The rest of the lawn gets a stretched
       noise texture, which costs one element instead of four thousand. */
    const n = Math.round(900 * detail);
    for (let i = 0; i < n; i++) {
      const t = Math.pow(R(), .4);
      const by = y + gh * t;
      const bx = x + R() * gw;
      const len = 3 + t * t * 14;
      const lean = (R() - .5) * len;
      const tone = R() < .3 ? shade(L.grass, .22) : R() < .6 ? shade(L.grass, -.24)
                 : R() < .82 ? mix(L.grass, L.warm, .22) : L.grass;
      blades.push(`<path d="M${n1(bx)} ${n1(by)} q ${n1(lean * .3)} ${n1(-len * .6)} ${n1(lean)} ${n1(-len)}"
        stroke="${tone}" stroke-width="${n1(.7 + t * 1.6)}" fill="none" stroke-linecap="round"/>`);
    }
    /* mown sweeps, so the lawn is not one flat green */
    const sweeps = [];
    for (let i = 0; i < 5; i++) {
      sweeps.push(`<ellipse cx="${n1(x + R() * gw)}" cy="${n1(y + gh * (0.1 + R() * .85))}"
        rx="${n1(120 + R() * 260)}" ry="${n1(10 + R() * 22)}" fill="${shade(L.grass, -.24)}"
        opacity=".2" filter="url(#soft${id})"/>`);
    }
    return `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(gw)}" height="${n1(gh)}"
              filter="url(#sward${id})" opacity=".55"/>
            ${sweeps.join('')}${blades.join('')}`;
  }

  /** A band of turf. `fine` for mown lawn, `blur` + `tall` for the foreground. */
  function grassStrip(o) {
    const { x, y, w: gw, h: gh, id, L, seed, blur, fine, tall } = o;
    const R = rng(seed);
    const blades = [];
    const n = Math.round(gw / (blur ? 3.2 : fine ? 7 : 5));
    for (let i = 0; i < n; i++) {
      const bx = x + R() * gw;
      const bh2 = gh * (tall ? (0.6 + R() * 1.3) : fine ? (0.3 + R() * .5) : (0.45 + R() * .9));
      const lean = (R() - .5) * bh2 * .8;
      const t = R();
      const tone = t < .28 ? shade(L.grass, .18) : t < .58 ? shade(L.grass, -.16)
                 : t < .8 ? mix(L.grass, L.warm, .22) : L.grass;
      blades.push(`<path d="M${n1(bx)} ${n1(y + gh + 2)} q ${n1(lean * .25)} ${n1(-bh2 * .6)} ${n1(bx + lean - bx)} ${n1(-bh2)}"
        stroke="${tone}" stroke-width="${n1((tall ? 1.8 : 1) + R() * 1.6)}" fill="none"
        stroke-linecap="round" transform="translate(0,0)"/>`);
    }
    return `<g ${blur ? `filter="url(#near${id})"` : ''}>
      <rect x="${n1(x)}" y="${n1(y)}" width="${n1(gw)}" height="${n1(gh + 4)}" fill="url(#turf${id})"/>
      <rect x="${n1(x)}" y="${n1(y)}" width="${n1(gw)}" height="${n1(gh * .5)}" fill="#000"
            opacity=".14" filter="url(#soft${id})"/>
      ${blades.join('')}</g>`;
  }

  /* ==========================================================================
     THE SCENE

     Layout, from the horizon down. The sky takes only the top third — this is a
     picture of a garden, not of the weather. Everything below it steps toward
     you: hedge, lawn, then three beds that get wider, coarser and more detailed
     as they come forward, and finally a blurred fringe of grass at your feet.

     @param {object} o {plants:[{id,box,label}], pct, stage, crop, seed, interactive}
     ========================================================================== */
  const W = 1200, HH = 700;
  const SKY = 250;                                  // horizon line

  function scene(o) {
    o = o || {};
    const pct = clamp(o.pct == null ? 0 : o.pct, 0, 1);
    const key = o.stage || stageKeyFor(pct);
    const L = LIGHT[key] || LIGHT.day;
    const id = o.id || ('g' + Math.random().toString(36).slice(2, 7));
    const R = rng(o.seed || 20260816);
    const crop = o.crop || null;                    // {y,h} — show a band of it
    const vb = crop ? `0 ${crop.y} ${W} ${crop.h}` : `0 0 ${W} ${HH}`;

    /* --- palettes derived from the light ------------------------------- */
    const leafBase = '#3E6B2E';
    const tint = (c, amt) => mix(c, L.leafTint, L.leafTintAmt * (amt == null ? 1 : amt));
    const leafA = tint(shade(leafBase, .12)), leafB = tint(shade(leafBase, -.22)),
          leafC = tint(shade(leafBase, .32));
    const sunX = L.sun.x * W, sunY = L.sun.y * SKY;

    /* --- sky ----------------------------------------------------------- */
    const stars = [];
    if (key === 'starlit') {
      for (let i = 0; i < 110; i++) {
        const sx = R() * W, sy = R() * SKY, sr = .5 + R() * 1.4;
        stars.push(`<circle cx="${n1(sx)}" cy="${n1(sy)}" r="${n1(sr)}" fill="#fff"
          opacity="${(.25 + R() * .6).toFixed(2)}"><animate attributeName="opacity"
          values="${(.2 + R() * .25).toFixed(2)};${(.7 + R() * .3).toFixed(2)};${(.2 + R() * .25).toFixed(2)}"
          dur="${(2.5 + R() * 4).toFixed(1)}s" repeatCount="indefinite"/></circle>`);
      }
    }

    /* Clouds: flat-bottomed, stacked domes, lit from the sun's side. Two
       banks — a high thin one and a lower fuller one — so the sky has depth. */
    const clouds = key === 'starlit' ? '' : [0, 1, 2, 3].map(i => {
      const cy = 30 + i * 34 + R() * 16;
      const cw = (110 + R() * 210) * (0.6 + i * 0.16);
      const cx = R() * W;
      const op = (.62 - i * .07) * (key === 'day' ? .95 : .8);
      const lit = mix('#FFFFFF', L.warm, key === 'golden' || key === 'dawn' ? .5 : .12);
      const shd = mix(lit, L.cool, .28);
      const domes = [];
      const nd = 3 + Math.floor(R() * 3);
      for (let k = 0; k < nd; k++) {
        const dx = cx + (k - (nd - 1) / 2) * cw * .3 + (R() - .5) * cw * .12;
        const dr = cw * (.16 + R() * .2) * (k === Math.floor(nd / 2) ? 1.35 : 1);
        domes.push(`<ellipse cx="${n1(dx)}" cy="${n1(cy - dr * .35)}" rx="${n1(dr)}"
          ry="${n1(dr * .78)}" fill="${shd}"/>`);
        domes.push(`<ellipse cx="${n1(dx - L.dir * dr * .16)}" cy="${n1(cy - dr * .5)}"
          rx="${n1(dr * .82)}" ry="${n1(dr * .62)}" fill="${lit}"/>`);
      }
      return `<g opacity="${op.toFixed(2)}" filter="url(#cloud${id})">
        ${domes.join('')}
        <ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(cw * .56)}" ry="${n1(cw * .07)}" fill="${lit}"/>
      </g>`;
    }).join('');

    /* --- distant treeline: small, pale, blurred ------------------------ */
    const farTrees = [];
    for (let i = 0; i < 34; i++) {
      const tx = R() * W, th = 20 + R() * 40, tw = th * (0.55 + R() * .5);
      const col = mix(L.grass, L.haze, .5 + R() * .2);
      farTrees.push(`<ellipse cx="${n1(tx)}" cy="${n1(SKY - th * .42)}" rx="${n1(tw * .5)}"
        ry="${n1(th * .5)}" fill="${col}"/>`);
      if (R() < .3) farTrees.push(`<ellipse cx="${n1(tx + tw * .3)}" cy="${n1(SKY - th * .2)}"
        rx="${n1(tw * .34)}" ry="${n1(th * .3)}" fill="${col}"/>`);
    }

    /* --- hedge: the garden's back wall ---------------------------------
       A solid dark mass with a bobbled silhouette, lit along the top, with
       leaf texture only where it catches the light. Floating blobs read as
       clip-art; a mass with an edge reads as a hedge. */
    const hedgeTop = 244, hedgeBot = 302;
    let sil = `M-20 ${hedgeBot} L-20 ${hedgeTop + 12} `;
    for (let x0 = -20; x0 < W + 20; ) {
      const bw2 = 26 + R() * 54, dip = (R() - .5) * 16;
      sil += `Q ${n1(x0 + bw2 * .5)} ${n1(hedgeTop - 12 + dip)} ${n1(x0 + bw2)} ${n1(hedgeTop + 8 + dip * .4)} `;
      x0 += bw2;
    }
    sil += `L ${W + 20} ${hedgeBot} Z`;
    const hedgeDark = mix(shade(leafB, -.3), L.haze, .18);
    const hedge = [`<path d="${sil}" fill="${hedgeDark}"/>`];
    for (let i = 0; i < 190; i++) {
      const hx = -20 + R() * (W + 40);
      const t = Math.pow(R(), 1.5);                   // most texture near the top
      const hy = hedgeTop + 4 + t * (hedgeBot - hedgeTop - 4);
      const hr = 4 + R() * 9;
      const c = t < .35 ? mix(leafC, L.haze, .16) : t < .7 ? mix(leafA, L.haze, .2) : mix(leafB, L.haze, .1);
      hedge.push(`<ellipse cx="${n1(hx)}" cy="${n1(hy)}" rx="${n1(hr)}" ry="${n1(hr * .74)}"
        fill="${c}" opacity="${t < .35 ? .95 : .8}"/>`);
    }
    /* a couple of taller shrubs breaking the line */
    for (let i = 0; i < 6; i++) {
      const hx = R() * W, hh = 30 + R() * 34;
      hedge.push(`<ellipse cx="${n1(hx)}" cy="${n1(hedgeTop + 6 - hh * .28)}" rx="${n1(hh * .48)}"
        ry="${n1(hh * .58)}" fill="${mix(leafB, L.haze, .22)}"/>`);
      for (let k = 0; k < 9; k++) {
        hedge.push(`<ellipse cx="${n1(hx + (R() - .5) * hh * .8)}" cy="${n1(hedgeTop + 2 - hh * (.1 + R() * .5))}"
          rx="${n1(3 + R() * 6)}" ry="${n1(3 + R() * 5)}" fill="${mix(R() < .5 ? leafA : leafC, L.haze, .2)}"/>`);
      }
    }

    /* --- beds: three, each wider and closer than the last -------------- */
    const BEDS = [
      { y: 318, h: 66,  inset: 40,  ti: 108, bi: 62,  s: 0.72 },
      { y: 406, h: 88,  inset: 0,   ti: 84,  bi: 14,  s: 0.96 },
      { y: 508, h: 100, inset: -60, ti: 40,  bi: -40, s: 1.22 }
    ];

    /* Tallest at the back, as any gardener would plant it — so nothing in front
       hides anything behind, and the beds step down toward you. */
    const list = (o.plants || []).slice().sort((a, b) => (b.box | 0) - (a.box | 0));
    const weight = [0.26, 0.32, 0.42];
    const slots = [[], [], []];
    let cursor = 0;
    weight.forEach((wt, i) => {
      const take = i === 2 ? list.length - cursor : Math.round(list.length * wt);
      slots[i] = list.slice(cursor, cursor + take);
      cursor += take;
    });

    const bedSVG = [], plantSVG = [];
    BEDS.forEach((b, bi) => {
      bedSVG.push(soilBed({ x: b.inset, y: b.y, w: W - b.inset * 2, h: b.h, id, L,
                            ti: b.ti, bi: b.bi, seed: 71 + bi * 13 }));
      const row = slots[bi] || [];
      const layer = row.map((p, i) => {
        const r2 = rng(hash(p.id));
        const py = b.y + b.h * (0.38 + r2() * .54);
        const depth = (py - b.y) / b.h;                       // nearer the front of the bed = bigger
        const inset = b.inset + b.ti + (b.bi - b.ti) * depth + 22;
        const x0 = inset, x1 = W - inset;
        const gap = (x1 - x0) / Math.max(1, row.length);
        const px = x0 + gap * (i + .5) + (r2() - .5) * gap * .3;
        const sc = b.s * (0.86 + depth * .26) * (0.94 + r2() * .14);
        return `<g transform="translate(${n1(px)},${n1(py)}) scale(${sc.toFixed(3)})"
          ${o.interactive ? `data-id="${esc(p.id)}" class="gplant"` : ''}>
          ${o.interactive ? `<title>${esc(p.label || '')} — ${esc(STAGE_NAME[clamp(p.box | 0, 0, 6)])}</title>` : ''}
          ${plant({ species: p.species || speciesFor(p.id), box: p.box, seed: hash(p.id),
                    id, L, label: p.label })}
        </g>`;
      });
      // sort so plants lower in the bed are drawn last and overlap correctly
      plantSVG.push(bi === 0
        ? `<g opacity=".94" filter="url(#haze${id})">${layer.join('')}</g>`
        : layer.join(''));
    });

    /* --- a watering can left by the front bed: scale, and a human trace - */
    const prop = `
      <g transform="translate(${n1(W * (L.dir > 0 ? .07 : .9))},${508 + 92}) scale(.95)">
        <ellipse cx="6" cy="4" rx="26" ry="6" fill="${L.shadow}" opacity="${L.shadowAmt}" filter="url(#soft${id})"/>
        <path d="M-18 0 q-3 -26 3 -30 h26 q6 4 3 30 z" fill="url(#tin${id})"/>
        <path d="M-15 -30 h20" stroke="${shade('#8C9AA0', -.2)}" stroke-width="3" stroke-linecap="round"/>
        <path d="M11 -26 q16 -3 22 12 l6 14 l-7 2 l-6 -13 q-5 -8 -15 -6 z" fill="url(#tin${id})"/>
        <ellipse cx="36" cy="4" rx="7" ry="4.5" fill="${shade('#8C9AA0', .16)}"/>
        <path d="M-12 -30 q10 -14 20 -1" stroke="${shade('#8C9AA0', -.1)}" stroke-width="3.4"
              fill="none" stroke-linecap="round"/>
      </g>`;

    /* --- fireflies / drifting motes ------------------------------------ */
    const motes = [];
    if (key === 'starlit') {
      for (let i = 0; i < 22; i++) {
        const mx = R() * W, my = 300 + R() * 340, d = (3 + R() * 4).toFixed(1);
        motes.push(`<circle cx="${n1(mx)}" cy="${n1(my)}" r="${(1.3 + R() * 1.7).toFixed(1)}"
          fill="#FFE9A0" opacity=".9" filter="url(#glow${id})">
          <animate attributeName="opacity" values="0;.95;0" dur="${d}s" begin="${(R() * 4).toFixed(1)}s"
            repeatCount="indefinite"/>
          <animateTransform attributeName="transform" type="translate"
            values="0 0; ${n1((R() - .5) * 44)} ${n1(-18 - R() * 26)}; 0 0"
            dur="${(8 + R() * 8).toFixed(1)}s" repeatCount="indefinite"/></circle>`);
      }
    } else {
      for (let i = 0; i < 11; i++) {
        const mx = R() * W, my = 280 + R() * 340;
        motes.push(`<ellipse cx="${n1(mx)}" cy="${n1(my)}" rx="4" ry="2.6"
          fill="${mix('#fff', L.warm, .5)}" opacity="${(.3 + R() * .35).toFixed(2)}"
          filter="url(#soft${id})">
          <animateTransform attributeName="transform" type="translate"
            values="0 0; ${n1(20 + R() * 60)} ${n1(-12 - R() * 34)}; 0 0"
            dur="${(14 + R() * 14).toFixed(1)}s" repeatCount="indefinite"/></ellipse>`);
      }
    }

    /* --- butterflies, once the garden is really going ------------------ */
    const flutter = [];
    if (pct > .3 && key !== 'starlit') {
      for (let i = 0; i < 3; i++) {
        const bx = 150 + R() * (W - 300), by = 340 + R() * 200;
        const col = ['#E8A33D', '#C9556E', '#6F9BD1'][i % 3];
        flutter.push(`<g transform="translate(${n1(bx)},${n1(by)})">
          <g><animateTransform attributeName="transform" type="translate"
             values="0 0; ${n1((R() - .5) * 180)} ${n1(-30 - R() * 70)}; ${n1((R() - .5) * 100)} -12; 0 0"
             dur="${(16 + R() * 10).toFixed(1)}s" repeatCount="indefinite"/>
            <path d="M0 0 q -8 -9 -2 -12 q 7 -2 2 12 Z" fill="${col}" opacity=".92">
              <animateTransform attributeName="transform" type="scale" values="1 1;.35 1;1 1"
                dur=".4s" repeatCount="indefinite"/></path>
            <path d="M0 0 q 8 -9 2 -12 q -7 -2 -2 12 Z" fill="${shade(col, -.18)}" opacity=".92">
              <animateTransform attributeName="transform" type="scale" values="1 1;.35 1;1 1"
                dur=".4s" repeatCount="indefinite"/></path>
          </g></g>`);
      }
    }

    /* --- defs ---------------------------------------------------------- */
    const defs = `
    <defs>
      <linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${L.sky[0]}"/>
        <stop offset="42%"  stop-color="${L.sky[1]}"/>
        <stop offset="76%"  stop-color="${L.sky[2]}"/>
        <stop offset="100%" stop-color="${L.sky[3]}"/>
      </linearGradient>
      <radialGradient id="sun${id}" cx="50%" cy="50%">
        <stop offset="0%"  stop-color="${L.sun.core}"/>
        <stop offset="42%" stop-color="${L.sun.glow}" stop-opacity=".7"/>
        <stop offset="100%" stop-color="${L.sun.glow}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="soil${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${shade(L.soil, -.3)}"/>
        <stop offset="18%"  stop-color="${shade(L.soil, -.08)}"/>
        <stop offset="70%"  stop-color="${L.soil}"/>
        <stop offset="100%" stop-color="${shade(L.soil, .14)}"/>
      </linearGradient>
      <linearGradient id="turf${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${shade(L.grass, -.18)}"/>
        <stop offset="100%" stop-color="${shade(L.grass, .14)}"/>
      </linearGradient>
      <linearGradient id="lawn${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${mix(shade(L.grass, .1), L.haze, .42)}"/>
        <stop offset="16%"  stop-color="${mix(L.grass, L.haze, .18)}"/>
        <stop offset="55%"  stop-color="${L.grass}"/>
        <stop offset="100%" stop-color="${shade(L.grass, -.18)}"/>
      </linearGradient>
      <linearGradient id="tin${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${mix('#6E7C82', L.warm, .2)}"/>
        <stop offset="45%" stop-color="${mix('#AEBAC0', L.warm, .3)}"/>
        <stop offset="100%" stop-color="${mix('#5C686E', L.cool, .2)}"/>
      </linearGradient>
      <linearGradient id="bark${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="${shade(mix('#54402A', L.warm, .18), L.dir > 0 ? -.3 : .18)}"/>
        <stop offset="52%"  stop-color="${mix('#54402A', L.warm, .18)}"/>
        <stop offset="100%" stop-color="${shade(mix('#54402A', L.warm, .18), L.dir > 0 ? .18 : -.3)}"/>
      </linearGradient>
      <linearGradient id="st${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="${shade(tint('#4E7A34'), L.dir > 0 ? -.24 : .2)}"/>
        <stop offset="100%" stop-color="${shade(tint('#4E7A34'), L.dir > 0 ? .2 : -.24)}"/>
      </linearGradient>
      ${[['a', leafA], ['b', leafB], ['c', leafC]].map(([k, c]) => `
        <linearGradient id="lf${k}${id}" x1="${L.dir > 0 ? 0 : 1}" y1="1" x2="${L.dir > 0 ? 1 : 0}" y2="0">
          <stop offset="0%"   stop-color="${shade(c, -.26)}"/>
          <stop offset="52%"  stop-color="${c}"/>
          <stop offset="100%" stop-color="${shade(c, .24)}"/>
        </linearGradient>`).join('')}
      <linearGradient id="pt${id}" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%"   stop-color="${tint('#CE7F1D', .8)}"/>
        <stop offset="58%"  stop-color="${tint('#EDAE3B', .8)}"/>
        <stop offset="100%" stop-color="${tint('#FBDC85', .8)}"/>
      </linearGradient>
      <radialGradient id="seedh${id}" cx="38%" cy="34%">
        <stop offset="0%" stop-color="rgba(255,255,255,.3)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,.4)"/>
      </radialGradient>
      <radialGradient id="fr${id}" cx="34%" cy="28%">
        <stop offset="0%"   stop-color="${tint('#EA7050', .8)}"/>
        <stop offset="50%"  stop-color="${tint('#C7342A', .8)}"/>
        <stop offset="100%" stop-color="${tint('#871D1A', .8)}"/>
      </radialGradient>
      <radialGradient id="seed${id}" cx="34%" cy="30%">
        <stop offset="0%" stop-color="#CBA872"/><stop offset="100%" stop-color="#6E5029"/>
      </radialGradient>
      <radialGradient id="vig${id}" cx="50%" cy="42%" r="76%">
        <stop offset="52%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="${key === 'starlit' ? '#000610' : '#2A1B10'}" stop-opacity=".34"/>
      </radialGradient>
      <linearGradient id="warm${id}" x1="${L.dir > 0 ? 1 : 0}" y1="0" x2="${L.dir > 0 ? 0 : 1}" y2="1">
        <stop offset="0%"  stop-color="${L.warm}" stop-opacity="${(L.sun.bloom * .45).toFixed(2)}"/>
        <stop offset="58%" stop-color="${L.warm}" stop-opacity="0"/>
      </linearGradient>

      <filter id="soft${id}" x="-70%" y="-70%" width="240%" height="240%">
        <feGaussianBlur stdDeviation="3"/></filter>
      <filter id="glow${id}" x="-300%" y="-300%" width="700%" height="700%">
        <feGaussianBlur stdDeviation="2.4"/></filter>
      <filter id="far${id}" x="-10%" y="-20%" width="120%" height="140%">
        <feGaussianBlur stdDeviation="2.6"/></filter>
      <filter id="haze${id}" x="-10%" y="-20%" width="120%" height="140%">
        <feGaussianBlur stdDeviation=".9"/></filter>
      <!-- merges the canopy clumps into one leafy mass, then bites the edge
           back so the silhouette stays crisp and irregular -->
      <filter id="leafy${id}" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.2" result="b"/>
        <feColorMatrix in="b" type="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 14 -5.6"/>
      </filter>
      <filter id="near${id}" x="-10%" y="-20%" width="120%" height="140%">
        <feGaussianBlur stdDeviation="5"/></filter>
      <filter id="cloud${id}" x="-40%" y="-90%" width="180%" height="320%">
        <feGaussianBlur stdDeviation="2.6"/></filter>

      <!-- real grain: fine speckle for the crumb of the soil, and a much
           coarser second pass for damp patches and shade across the bed -->
      <filter id="crumb${id}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="4" seed="11" result="n"/>
        <feColorMatrix in="n" type="matrix"
          values="0 0 0 0 .12  0 0 0 0 .08  0 0 0 0 .05  .9 .5 0 0 -.28"/>
      </filter>
      <!-- stretched noise: fine, vertical, grass-coloured. Does the work of
           several thousand drawn blades for the cost of one rectangle. -->
      <filter id="sward${id}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".045 .9" numOctaves="3" seed="3" result="n"/>
        <feColorMatrix in="n" type="matrix"
          values="0 0 0 0 ${(hex(shade(L.grass, -.3))[0] / 255).toFixed(3)}
                  0 0 0 0 ${(hex(shade(L.grass, -.3))[1] / 255).toFixed(3)}
                  0 0 0 0 ${(hex(shade(L.grass, -.3))[2] / 255).toFixed(3)}
                  .85 .45 0 0 -.3"/>
      </filter>
      <filter id="patch${id}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".012 .05" numOctaves="3" seed="5" result="n"/>
        <feColorMatrix in="n" type="matrix"
          values="0 0 0 0 .1  0 0 0 0 .07  0 0 0 0 .04  .8 .4 0 0 -.34"/>
      </filter>
    </defs>`;

    return `
    <svg class="garden-svg" viewBox="${vb}" preserveAspectRatio="xMidYMid slice"
         xmlns="http://www.w3.org/2000/svg" role="img"
         aria-label="Your garden at ${esc(L.name.toLowerCase())}. ${esc(o.aria || '')}">
      ${defs}
      <rect x="0" y="0" width="${W}" height="${n1(SKY + 34)}" fill="url(#sky${id})"/>
      ${stars.join('')}
      <circle cx="${n1(sunX)}" cy="${n1(sunY)}" r="${n1(L.sun.r * 3.6)}" fill="url(#sun${id})"
        opacity="${L.sun.bloom}"/>
      <circle cx="${n1(sunX)}" cy="${n1(sunY)}" r="${n1(L.sun.r * .46)}" fill="${L.sun.core}"
        opacity="${L.sun.moon ? .97 : .92}"/>
      ${L.sun.moon ? `<circle cx="${n1(sunX + 6)}" cy="${n1(sunY - 5)}" r="${n1(L.sun.r * .4)}"
        fill="${L.sky[1]}" opacity=".92"/>` : ''}
      ${clouds}

      <!-- far treeline, washed out by the air between here and there -->
      <g filter="url(#far${id})" opacity=".92">${farTrees.join('')}</g>

      <!-- ONE continuous piece of ground, from the hedge to your feet. Everything
           else — beds, paths, the tree — sits on this, so the plot reads as a
           single place rather than a stack of stripes. -->
      <rect x="0" y="${SKY + 14}" width="${W}" height="${HH - SKY - 14}" fill="url(#lawn${id})"/>
      ${turfDetail({ x: -20, y: SKY + 16, w: W + 40, h: HH - SKY - 16, id, L, seed: 404,
                     detail: o.detail })}

      <!-- the hedge along the back of the plot -->
      <g filter="url(#haze${id})">${hedge.join('')}</g>

      <!-- the tree, standing on the lawn behind the beds -->
      <g transform="translate(${n1(W * (L.dir > 0 ? .15 : .85))},${SKY + 88}) scale(1.15)">
        ${tree({ pct, L, id, seed: 4242 })}
      </g>

      <!-- beds, back to front -->
      ${bedSVG[0]}${plantSVG[0]}
      ${bedSVG[1]}${plantSVG[1]}
      ${bedSVG[2]}${plantSVG[2]}
      ${prop}

      ${motes.join('')}
      ${flutter.join('')}

      <!-- your own feet: grass right at the front, out of focus -->
      ${grassStrip({ x: -20, y: HH - 44, w: W + 40, h: 52, id, L, seed: 909, blur: true, tall: true })}

      <!-- light and air over the top of everything -->
      <rect x="0" y="0" width="${W}" height="${HH}" fill="url(#warm${id})" style="mix-blend-mode:screen"/>
      <rect x="0" y="0" width="${W}" height="${HH}" fill="url(#vig${id})"/>
    </svg>`;
  }

  /* ==========================================================================
     Small standalone pieces — one tree, or one plant — for use inside cards
     and lists, drawn from exactly the same parts as the big scene.
     ========================================================================== */
  function miniDefs(L, id) {
    const leafBase = '#3E6B2E';
    const tint = (c, amt) => mix(c, L.leafTint, L.leafTintAmt * (amt == null ? 1 : amt));
    const cols = { a: tint(shade(leafBase, .12)), b: tint(shade(leafBase, -.22)), c: tint(shade(leafBase, .32)) };
    return `<defs>
      ${Object.keys(cols).map(k => `
        <linearGradient id="lf${k}${id}" x1="${L.dir > 0 ? 0 : 1}" y1="1" x2="${L.dir > 0 ? 1 : 0}" y2="0">
          <stop offset="0%" stop-color="${shade(cols[k], -.26)}"/>
          <stop offset="52%" stop-color="${cols[k]}"/>
          <stop offset="100%" stop-color="${shade(cols[k], .24)}"/>
        </linearGradient>`).join('')}
      <linearGradient id="bark${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${shade(mix('#54402A', L.warm, .18), L.dir > 0 ? -.3 : .18)}"/>
        <stop offset="52%" stop-color="${mix('#54402A', L.warm, .18)}"/>
        <stop offset="100%" stop-color="${shade(mix('#54402A', L.warm, .18), L.dir > 0 ? .18 : -.3)}"/>
      </linearGradient>
      <linearGradient id="st${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${shade(tint('#4E7A34'), L.dir > 0 ? -.24 : .2)}"/>
        <stop offset="100%" stop-color="${shade(tint('#4E7A34'), L.dir > 0 ? .2 : -.24)}"/>
      </linearGradient>
      <linearGradient id="pt${id}" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="${tint('#CE7F1D', .8)}"/>
        <stop offset="58%" stop-color="${tint('#EDAE3B', .8)}"/>
        <stop offset="100%" stop-color="${tint('#FBDC85', .8)}"/>
      </linearGradient>
      <radialGradient id="fr${id}" cx="34%" cy="28%">
        <stop offset="0%" stop-color="${tint('#EA7050', .8)}"/>
        <stop offset="50%" stop-color="${tint('#C7342A', .8)}"/>
        <stop offset="100%" stop-color="${tint('#871D1A', .8)}"/>
      </radialGradient>
      <radialGradient id="seed${id}" cx="34%" cy="30%">
        <stop offset="0%" stop-color="#CBA872"/><stop offset="100%" stop-color="#6E5029"/>
      </radialGradient>
      <radialGradient id="seedh${id}" cx="38%" cy="34%">
        <stop offset="0%" stop-color="rgba(255,255,255,.3)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,.4)"/>
      </radialGradient>
      <filter id="soft${id}" x="-70%" y="-70%" width="240%" height="240%">
        <feGaussianBlur stdDeviation="3"/></filter>
      <filter id="leafy${id}" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.2" result="b"/>
        <feColorMatrix in="b" type="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 14 -5.6"/>
      </filter>
    </defs>`;
  }

  let uid = 0;
  const nid = () => 'm' + (++uid).toString(36);

  /** One tree on its own, for a card. */
  function treeSVG(o) {
    o = o || {};
    const pct = clamp(o.pct || 0, 0, 1);
    const key = o.stage || stageKeyFor(pct);
    const L = LIGHT[key] || LIGHT.day;
    const id = nid();
    const W2 = o.width || 180;
    /* the frame follows the tree, so a seedling isn't marooned in white space */
    const H2 = 44 + pct * 168;
    const vw = H2 * 2.1, vh = H2 * 1.55 + 34;
    return `<svg viewBox="${n1(-vw / 2)} ${n1(-(vh - 22))} ${n1(vw)} ${n1(vh)}" width="${W2}"
      xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Your tree"
      style="display:block;overflow:visible">
      ${miniDefs(L, id)}
      <ellipse cx="0" cy="8" rx="${n1(H2 * .62)}" ry="${n1(7 + H2 * .04)}" fill="${L.grass}" opacity=".26"/>
      ${tree({ pct, L, id, seed: o.seed || 4242 })}
    </svg>`;
  }

  /** One plant on its own, for a word list or a legend. */
  function sprig(o) {
    o = o || {};
    const box = clamp(o.box | 0, 0, 6);
    const key = o.stage || 'day';
    const L = LIGHT[key] || LIGHT.day;
    const id = nid();
    const species = o.species || (o.id ? speciesFor(o.id) : 'tomato');
    const H2 = (SPECIES[species] || SPECIES.tomato).H;
    const size = o.size || 34;
    return `<svg viewBox="-52 ${-H2 - 12} 104 ${H2 + 26}" height="${size}"
      xmlns="http://www.w3.org/2000/svg" role="img"
      aria-label="${esc(STAGE_NAME[box])}" style="display:block;overflow:visible">
      ${miniDefs(L, id)}
      ${plant({ species, box, seed: hash(o.id || species) , id, L })}
    </svg>`;
  }

  w.Garden = {
    scene, plant, tree, treeSVG, sprig, miniDefs, speciesFor, stageKeyFor, nextStage,
    LIGHT, SPECIES, STAGE_NAME, GROWTH, AT, ORDER, mix, shade, hash
  };
})(window);
