/* ==========================================================================
   AraBuzz — puzzles.js
   Crossword and word-search builders. Both run on the device, and both are
   seeded, so the same words produce a genuinely different puzzle every time.
   ========================================================================== */
(function (w) {
  'use strict';

  /* ------------------------------------------------------- seeded random  */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }
  function shuffled(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const strip = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');

  /* ======================================================================
     CROSSWORD
     ====================================================================== */
  function crossword(entries, seed) {
    // entries: [{word, clue, id}]
    const rand = rng(seed || 12345);
    const items = entries
      .map(e => ({ ...e, letters: strip(e.word) }))
      .filter(e => e.letters.length >= 3 && e.letters.length <= 18);

    if (!items.length) return null;

    // Longest first, but jiggle the order so the layout differs run to run.
    items.sort((a, b) => b.letters.length - a.letters.length);
    const head = items.slice(0, 2);
    const tail = shuffled(items.slice(2), rand);
    const ordered = head.concat(tail);

    const grid = new Map();                    // "r,c" -> letter
    const placed = [];
    const key = (r, c) => r + ',' + c;
    const at = (r, c) => grid.get(key(r, c)) || null;
    const box = { minR: 0, maxR: 0, minC: 0, maxC: 0 };
    // Cells already running in each direction. Without this, a word that is a
    // prefix of another ("BRAIN" inside "BRAINSTEM") can be laid straight on top
    // of it — two clues, one set of squares, same number. Not a crossword.
    const lanes = { across: new Set(), down: new Set() };

    function fits(letters, r, c, dr, dc) {
      let crossings = 0;
      const lane = dr === 0 ? 'across' : 'down';
      // cell immediately before and after must be free
      if (at(r - dr, c - dc)) return -1;
      if (at(r + dr * letters.length, c + dc * letters.length)) return -1;

      for (let i = 0; i < letters.length; i++) {
        const rr = r + dr * i, cc = c + dc * i;
        if (lanes[lane].has(key(rr, cc))) return -1;      // would sit on another word
        const cur = at(rr, cc);
        if (cur) {
          if (cur !== letters[i]) return -1;
          crossings++;
        } else {
          // perpendicular neighbours must be empty, or we create a stray word
          if (dr === 0) { if (at(rr - 1, cc) || at(rr + 1, cc)) return -1; }
          else          { if (at(rr, cc - 1) || at(rr, cc + 1)) return -1; }
        }
      }
      return crossings;
    }

    function put(item, r, c, dr, dc) {
      const lane = dr === 0 ? 'across' : 'down';
      for (let i = 0; i < item.letters.length; i++) {
        grid.set(key(r + dr * i, c + dc * i), item.letters[i]);
        lanes[lane].add(key(r + dr * i, c + dc * i));
      }
      const eR = r + dr * (item.letters.length - 1);
      const eC = c + dc * (item.letters.length - 1);
      box.minR = Math.min(box.minR, r, eR); box.maxR = Math.max(box.maxR, r, eR);
      box.minC = Math.min(box.minC, c, eC); box.maxC = Math.max(box.maxC, c, eC);
      placed.push({ ...item, r, c, dir: dr === 0 ? 'across' : 'down' });
    }

    /** How much bigger — and how much less square — does the puzzle get? */
    function growth(r, c, dr, dc, len) {
      const eR = r + dr * (len - 1), eC = c + dc * (len - 1);
      const minR = Math.min(box.minR, r, eR), maxR = Math.max(box.maxR, r, eR);
      const minC = Math.min(box.minC, c, eC), maxC = Math.max(box.maxC, c, eC);
      const h = maxR - minR + 1, wd = maxC - minC + 1;
      const area = h * wd;
      const nowArea = (box.maxR - box.minR + 1) * (box.maxC - box.minC + 1);
      const lopsided = Math.abs(h - wd);
      return (area - nowArea) + lopsided * 1.5;
    }

    // first word across, at origin
    put(ordered[0], 0, 0, 0, 1);

    for (let n = 1; n < ordered.length; n++) {
      const item = ordered[n];
      let best = null;

      for (const p of placed) {
        for (let pi = 0; pi < p.letters.length; pi++) {
          for (let wi = 0; wi < item.letters.length; wi++) {
            if (p.letters[pi] !== item.letters[wi]) continue;
            // place perpendicular to p
            const dr = p.dir === 'across' ? 1 : 0;
            const dc = p.dir === 'across' ? 0 : 1;
            const anchorR = p.r + (p.dir === 'across' ? 0 : pi);
            const anchorC = p.c + (p.dir === 'across' ? pi : 0);
            const r = anchorR - dr * wi;
            const c = anchorC - dc * wi;
            const score = fits(item.letters, r, c, dr, dc);
            if (score < 1) continue;
            // more crossings is good; a bigger, more lopsided grid is bad
            const total = score * 26 - growth(r, c, dr, dc, item.letters.length) + rand() * 3;
            if (!best || total > best.total) best = { total, r, c, dr, dc };
          }
        }
      }
      if (best) put(item, best.r, best.c, best.dr, best.dc);
    }

    if (placed.length < 2) return null;

    // normalise to a 0-based grid
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    grid.forEach((_, k) => {
      const [r, c] = k.split(',').map(Number);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    });
    const rows = maxR - minR + 1, cols = maxC - minC + 1;
    const cells = Array.from({ length: rows }, () => new Array(cols).fill(null));
    grid.forEach((v, k) => {
      const [r, c] = k.split(',').map(Number);
      cells[r - minR][c - minC] = { letter: v, num: 0 };
    });

    const entriesOut = placed.map(p => ({
      id: p.id, word: p.word, clue: p.clue, letters: p.letters,
      row: p.r - minR, col: p.c - minC, dir: p.dir, num: 0
    }));

    // number the starts, reading order
    let num = 0;
    const starts = entriesOut.slice().sort((a, b) => a.row - b.row || a.col - b.col);
    const seen = new Map();
    starts.forEach(e => {
      const k = e.row + ',' + e.col;
      if (seen.has(k)) { e.num = seen.get(k); }
      else { num++; seen.set(k, num); e.num = num; cells[e.row][e.col].num = num; }
    });

    return {
      rows, cols, cells,
      across: entriesOut.filter(e => e.dir === 'across').sort((a, b) => a.num - b.num),
      down:   entriesOut.filter(e => e.dir === 'down').sort((a, b) => a.num - b.num),
      entries: entriesOut,
      unplaced: ordered.filter(o => !placed.some(p => p.id === o.id))
    };
  }

  /* ======================================================================
     WORD SEARCH
     ====================================================================== */
  const DIRS = [
    [0, 1], [1, 0], [1, 1], [1, -1],
    [0, -1], [-1, 0], [-1, -1], [-1, 1]
  ];

  function wordsearch(words, seed, opts) {
    const rand = rng(seed || 999);
    const o = Object.assign({ maxSize: 14, backwards: true }, opts);
    const list = words
      .map(x => ({ id: x.id, word: x.word, letters: strip(x.word) }))
      .filter(x => x.letters.length >= 3)
      .sort((a, b) => b.letters.length - a.letters.length);

    const longest = list.length ? list[0].letters.length : 6;
    const size = Math.max(9, Math.min(o.maxSize, longest + 3));
    const grid = Array.from({ length: size }, () => new Array(size).fill(''));
    const dirs = o.backwards ? DIRS : DIRS.slice(0, 4);
    const found = [];

    list.forEach(item => {
      const L = item.letters;
      let done = false;
      for (let tries = 0; tries < 260 && !done; tries++) {
        const [dr, dc] = dirs[Math.floor(rand() * dirs.length)];
        const r0 = Math.floor(rand() * size), c0 = Math.floor(rand() * size);
        const rEnd = r0 + dr * (L.length - 1), cEnd = c0 + dc * (L.length - 1);
        if (rEnd < 0 || rEnd >= size || cEnd < 0 || cEnd >= size) continue;
        let ok = true;
        for (let i = 0; i < L.length; i++) {
          const cur = grid[r0 + dr * i][c0 + dc * i];
          if (cur && cur !== L[i]) { ok = false; break; }
        }
        if (!ok) continue;
        const cellList = [];
        for (let i = 0; i < L.length; i++) {
          grid[r0 + dr * i][c0 + dc * i] = L[i];
          cellList.push([r0 + dr * i, c0 + dc * i]);
        }
        found.push({ id: item.id, word: item.word, letters: L, cells: cellList });
        done = true;
      }
    });

    // fill the gaps — biased towards letters already in play so the puzzle
    // doesn't give itself away
    const pool = found.map(f => f.letters).join('') || 'ETAOINSRHLDCUMFPGWYBVKXJQZ';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!grid[r][c]) {
          grid[r][c] = rand() < 0.55
            ? pool[Math.floor(rand() * pool.length)]
            : 'ABCDEFGHIJKLMNOPRSTUVWY'[Math.floor(rand() * 23)];
        }
      }
    }

    return { size, grid, words: found, missed: list.filter(x => !found.some(f => f.id === x.id)) };
  }

  /** Tries a handful of layouts and keeps the one that places the most words
   *  in the smallest, squarest grid. Still seeded, so it stays reproducible. */
  function bestCrossword(entries, seed, tries) {
    let best = null;
    const n = tries || 12;
    for (let i = 0; i < n; i++) {
      const g = crossword(entries, (seed || 1) * 7919 + i * 104729);
      if (!g) continue;
      const area = g.rows * g.cols;
      const lopsided = Math.abs(g.rows - g.cols);
      const score = g.entries.length * 1000 - area - lopsided * 6;
      if (!best || score > best.score) best = { score, grid: g };
      if (g.unplaced.length === 0 && lopsided <= 4) break;
    }
    return best ? best.grid : null;
  }

  w.Puzzles = { crossword, bestCrossword, wordsearch, rng, shuffled, strip };
})(window);
