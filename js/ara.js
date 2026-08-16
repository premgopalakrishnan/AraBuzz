/* ==========================================================================
   AraBuzz — ara.js
   Ara the macaw. She is the reward system: she grows, gains colour and
   collects things as the child levels up. Drawn as SVG so she is razor sharp
   on any screen and weighs nothing.
   ========================================================================== */
(function (w) {
  'use strict';

  /* Eight visible stages. A child should be able to see the difference
     between stage 3 and stage 4 across the room. */
  const STAGES = [
    { at: 1,  name: 'Chick',        body: '#F3D9A4', wing: '#E8C87A', crest: 1, tail: 0, size: .74, blurb: 'A tiny chick, just out of the egg.' },
    { at: 3,  name: 'Fledgling',    body: '#F2C874', wing: '#E0AE4C', crest: 2, tail: 1, size: .80, blurb: 'Her first proper feathers.' },
    { at: 5,  name: 'Sunwing',      body: '#EDB552', wing: '#D89A32', crest: 3, tail: 2, size: .86, blurb: 'Gold coming through on the wings.' },
    { at: 8,  name: 'Skydancer',    body: '#E8A33D', wing: '#5B8FA8', crest: 3, tail: 3, size: .91, blurb: 'Blue flight feathers at last.' },
    { at: 12, name: 'Bluecrest',    body: '#E8A33D', wing: '#2E6E8E', crest: 4, tail: 4, size: .96, blurb: 'A real blue-and-gold macaw.' },
    { at: 17, name: 'Emerald',      body: '#E8A33D', wing: '#2E6E8E', crest: 4, tail: 5, size: 1.0, blurb: 'Emerald edges on every feather.' },
    { at: 23, name: 'Stormrider',   body: '#EDAF4B', wing: '#24597A', crest: 5, tail: 6, size: 1.05, blurb: 'She can fly in any weather now.' },
    { at: 30, name: 'Grand Macaw',  body: '#F0B85E', wing: '#1F4E6B', crest: 5, tail: 7, size: 1.1, blurb: 'The full, magnificent Ara.' }
  ];

  const ITEMS = [
    { at: 4,  id: 'scarf',   name: 'Stripy scarf' },
    { at: 7,  id: 'cap',     name: 'Explorer cap' },
    { at: 10, name: 'Reading glasses', id: 'specs' },
    { at: 14, id: 'medal',   name: 'Gold medal' },
    { at: 19, id: 'crown',   name: 'Little crown' },
    { at: 26, id: 'cape',    name: 'Hero cape' }
  ];

  function stageFor(level) {
    let s = STAGES[0];
    STAGES.forEach(x => { if (level >= x.at) s = x; });
    return s;
  }
  function stageIndex(level) {
    let i = 0;
    STAGES.forEach((x, n) => { if (level >= x.at) i = n; });
    return i;
  }
  function itemsFor(level) { return ITEMS.filter(i => level >= i.at); }
  function nextStage(level) { return STAGES.find(s => s.at > level) || null; }

  const MOOD = {
    idle:      { eye: 'open',  brow: 0,   mouth: 'closed' },
    happy:     { eye: 'happy', brow: -2,  mouth: 'open'   },
    celebrate: { eye: 'happy', brow: -3,  mouth: 'wide'   },
    think:     { eye: 'side',  brow: 2,   mouth: 'closed' },
    sad:       { eye: 'sad',   brow: 4,   mouth: 'small'  },
    sleep:     { eye: 'shut',  brow: 0,   mouth: 'closed' }
  };

  /**
   * Renders Ara.
   * @param {object} o {level, mood, width, item (force show), plain}
   */
  function svg(o) {
    o = o || {};
    const level = o.level || 1;
    const st = stageFor(level);
    const mood = MOOD[o.mood] || MOOD.idle;
    const items = itemsFor(level).map(i => i.id);
    const scale = st.size;
    const width = o.width || 190;
    const uid = 'a' + Math.random().toString(36).slice(2, 7);

    const crestFeathers = [];
    const angles = [-34, -14, 4, 22, 40];
    for (let i = 0; i < st.crest; i++) {
      const a = angles[i] != null ? angles[i] : 0;
      const len = 44 + (i % 2 ? 10 : 0);
      crestFeathers.push(
        `<g transform="translate(90,62) rotate(${a})">
           <path d="M0 0 C -8 -${len * 0.5} -5 -${len} 0 -${len + 9} C 5 -${len} 8 -${len * 0.5} 0 0 Z"
                 fill="url(#cr${uid})"/>
         </g>`);
    }

    const tailFeathers = [];
    for (let i = 0; i < st.tail; i++) {
      const a = -8 + i * 9;
      tailFeathers.push(
        `<g transform="translate(50,150) rotate(${a})">
           <path d="M0 0 C -6 26 -4 52 0 66 C 4 52 6 26 0 0 Z" fill="${i % 2 ? st.wing : st.body}" opacity="${0.75 + i * 0.03}"/>
         </g>`);
    }

    let eyes = '';
    if (mood.eye === 'shut' || mood.eye === 'happy') {
      eyes = `<path d="M96 100 q9 ${mood.eye === 'happy' ? -10 : 8} 18 0" stroke="#22333B" stroke-width="4.2" fill="none" stroke-linecap="round"/>`;
    } else if (mood.eye === 'sad') {
      eyes = `<circle cx="105" cy="103" r="7.4" fill="#22333B"/>
              <circle cx="107.4" cy="100.4" r="2.6" fill="#fff"/>
              <path d="M96 92 q9 4 18 0" stroke="#22333B" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    } else if (mood.eye === 'side') {
      eyes = `<circle cx="109" cy="101" r="7.4" fill="#22333B"/>
              <circle cx="111.4" cy="98.4" r="2.6" fill="#fff"/>`;
    } else {
      eyes = `<circle cx="105" cy="100" r="7.6" fill="#22333B"/>
              <circle cx="107.8" cy="97.2" r="2.8" fill="#fff"/>`;
    }

    const mouth = mood.mouth === 'wide'
      ? `<path d="M141 122 q10 16 22 4" stroke="#8E3B26" stroke-width="3" fill="none" stroke-linecap="round"/>`
      : mood.mouth === 'open'
      ? `<path d="M143 120 q8 9 17 3" stroke="#8E3B26" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
      : '';

    const acc = [];
    if (items.includes('scarf') || o.item === 'scarf')
      acc.push(`<path d="M56 158 q34 20 70 4 l4 16 q-38 18 -78 -2 Z" fill="#E07A5F"/>
                <path d="M60 163 q32 18 66 3" stroke="#FAF7F2" stroke-width="4" fill="none" opacity=".55"/>`);
    if (items.includes('cap') || o.item === 'cap')
      acc.push(`<path d="M56 60 q30 -30 62 -6 l2 8 q-34 -14 -62 4 Z" fill="#6B9080"/>
                <path d="M116 60 q22 2 26 12 l-26 -4 Z" fill="#4E7264"/>`);
    if (items.includes('specs') || o.item === 'specs')
      acc.push(`<g fill="none" stroke="#4A5C64" stroke-width="3.4">
                  <circle cx="105" cy="100" r="16"/><path d="M121 98 h12"/>
                </g>`);
    if (items.includes('medal') || o.item === 'medal')
      acc.push(`<g><path d="M92 150 l10 22 M112 150 l-10 22" stroke="#9B8AA6" stroke-width="4"/>
                <circle cx="102" cy="180" r="12" fill="#E8A33D" stroke="#C9832A" stroke-width="3"/>
                <text x="102" y="185" font-size="12" text-anchor="middle" fill="#8A5C10" font-family="sans-serif" font-weight="bold">1</text></g>`);
    if (items.includes('crown') || o.item === 'crown')
      acc.push(`<path d="M64 46 l8 -22 12 14 12 -20 12 20 12 -14 8 22 Z" fill="#F0C24E" stroke="#C9832A" stroke-width="2.5" stroke-linejoin="round"/>`);
    if (items.includes('cape') || o.item === 'cape')
      acc.push(`<path d="M46 120 q-26 46 -8 84 q40 12 72 -2 q-24 -40 -20 -84 Z" fill="#9B8AA6" opacity=".85"/>`);

    return `
<svg viewBox="0 0 220 240" width="${width}" style="overflow:visible" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bd${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFF0CE"/><stop offset="55%" stop-color="${st.body}"/><stop offset="100%" stop-color="#C9832A"/>
    </linearGradient>
    <linearGradient id="wg${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${st.wing}"/><stop offset="100%" stop-color="#1F4E6B"/>
    </linearGradient>
    <linearGradient id="cr${uid}" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#5A8474"/><stop offset="100%" stop-color="#9AC9B1"/>
    </linearGradient>
    <linearGradient id="bk${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F2A184"/><stop offset="60%" stop-color="#E07A5F"/><stop offset="100%" stop-color="#B75439"/>
    </linearGradient>
  </defs>
  <g transform="translate(110,130) scale(${scale}) translate(-110,-130)">
    ${o.plain ? '' : `<ellipse cx="104" cy="222" rx="${44 * scale}" ry="8" fill="#22333B" opacity=".10"/>`}
    ${tailFeathers.join('')}
    ${crestFeathers.join('')}
    <!-- body -->
    <ellipse cx="98" cy="158" rx="46" ry="50" fill="url(#bd${uid})"/>
    <!-- wing -->
    <path d="M60 132 C 36 146 34 186 58 200 C 72 190 78 160 74 136 Z" fill="url(#wg${uid})"/>
    <path d="M62 146 C 50 156 48 180 60 190" stroke="#fff" stroke-width="2.6" fill="none" opacity=".26"/>
    ${acc.filter(a => a.indexOf('120 q-26') > 0).join('')}
    <!-- head -->
    <ellipse cx="100" cy="98" rx="44" ry="44" fill="url(#bd${uid})"/>
    <!-- beak -->
    <path d="M126 76 C 158 70 180 92 176 116 C 173 138 158 154 142 156 C 152 132 150 98 126 76 Z" fill="url(#bk${uid})" stroke="#A8523A" stroke-width="1.6"/>
    <path d="M142 156 C 152 160 150 178 136 178 C 124 178 118 170 121 161 Z" fill="#8E3B26"/>
    <path d="M136 84 C 160 88 172 102 170 118" stroke="#fff" stroke-width="3" fill="none" opacity=".33" stroke-linecap="round"/>
    <ellipse cx="132" cy="88" rx="3.4" ry="2.6" fill="#8E3F2C" opacity=".45"/>
    <!-- eye patch -->
    <ellipse cx="103" cy="100" rx="19" ry="19.5" fill="#FDFBF7"/>
    <g stroke="#CBB9A4" stroke-width="1.4" stroke-linecap="round" opacity=".65">
      <path d="M92 92 h20"/><path d="M89 100 h24"/><path d="M91 108 h21"/>
    </g>
    ${eyes}
    ${mouth}
    <ellipse cx="70" cy="116" rx="11" ry="8" fill="#E07A5F" opacity=".26"/>
    <!-- feet -->
    <path d="M86 204 l-4 12 M98 206 l0 12 M110 204 l4 12" stroke="#C9832A" stroke-width="5" stroke-linecap="round"/>
    ${acc.filter(a => a.indexOf('120 q-26') < 0).join('')}
  </g>
</svg>`;
  }

  /* ---------------------------------------------------------- what she says */
  const LINES = {
    welcome: [
      'Ready when you are!', 'Let us get some words!', 'I have been waiting for you.',
      'Today feels like a good word day.', 'Shall we?'
    ],
    right: [
      'Yes! Exactly that.', 'Perfect spelling!', 'You had that one.', 'Nailed it!',
      'Spot on.', 'That is the one!', 'Beautiful.', 'Straight in!'
    ],
    wrong: [
      'So close — look again.', 'Nearly! Check the middle.', 'Good try, let us look at it.',
      'Almost had it.', 'That was a tricky one.'
    ],
    streak: [
      'Three in a row!', 'You are on fire!', 'Do not stop now!', 'Look at you go!'
    ],
    end: [
      'Great session.', 'That was good work.', 'Come back tomorrow and I will be here.',
      'Your brain did some real lifting there.'
    ],
    levelup: [
      'Look at me! New feathers!', 'I grew! That was you.', 'Whoa — I feel different.'
    ]
  };

  function say(kind) {
    const list = LINES[kind] || LINES.welcome;
    return list[Math.floor(Math.random() * list.length)];
  }

  w.Ara = { svg, STAGES, ITEMS, stageFor, stageIndex, nextStage, itemsFor, say, LINES };
})(window);
