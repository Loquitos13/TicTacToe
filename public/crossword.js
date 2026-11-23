// Gerador de palavras cruzadas (usado no servidor e no editor do formador, para pré-visualizar).
// Recebe [{ word, clue }] e devolve a grelha: tamanho, posição/direção/número de cada palavra
// e as palavras que não foi possível cruzar. Determinístico: as mesmas palavras dão sempre a mesma grelha.
(function (root) {
  // só letras A-Z, sem acentos (Ç → C, Ã → A); "pós-venda" → "POSVENDA"
  const cwNorm = w => String(w || '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z]/g, '');

  function buildCrossword(entries) {
    const items = (entries || []).map((e, i) => ({ i, word: cwNorm(e.word), display: String(e.word || '').trim(), clue: String(e.clue || '').trim() }))
      .filter(x => x.word.length >= 2 && x.word.length <= 15);
    const order = items.slice().sort((a, b) => b.word.length - a.word.length || a.i - b.i);
    const grid = new Map();       // "r,c" → { ch, a: bool, d: bool }
    const key = (r, c) => r + ',' + c;
    const at = (r, c) => grid.get(key(r, c));
    const placed = [], unplaced = [];
    const step = dir => dir === 'a' ? [0, 1] : [1, 0];

    // devolve o nº de cruzamentos se a palavra cabe ali (sem encostar a outras), ou -1
    function fits(w, r, c, dir) {
      const [dr, dc] = step(dir), n = w.length;
      const before = at(r - dr, c - dc), after = at(r + dr * n, c + dc * n);
      if (before || after) return -1;
      let cross = 0;
      for (let k = 0; k < n; k++) {
        const rr = r + dr * k, cc = c + dc * k, cell = at(rr, cc);
        if (cell) {
          if (cell.ch !== w[k] || cell[dir]) return -1;   // letra diferente ou já há palavra nesta direção
          cross++;
        } else {
          // células ao lado (na perpendicular) têm de estar vazias, senão formavam palavras falsas
          const s1 = dir === 'a' ? at(rr - 1, cc) : at(rr, cc - 1), s2 = dir === 'a' ? at(rr + 1, cc) : at(rr, cc + 1);
          if (s1 || s2) return -1;
        }
      }
      return cross;
    }
    function put(it, r, c, dir) {
      const [dr, dc] = step(dir);
      for (let k = 0; k < it.word.length; k++) {
        const kk = key(r + dr * k, c + dc * k), cell = grid.get(kk) || { ch: it.word[k] };
        cell[dir] = true; grid.set(kk, cell);
      }
      placed.push({ ...it, r, c, dir });
    }
    function bbox(extra) {
      let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      const add = (r, c) => { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); };
      for (const k of grid.keys()) { const [r, c] = k.split(',').map(Number); add(r, c); }
      if (extra) { const [dr, dc] = step(extra.dir); add(extra.r, extra.c); add(extra.r + dr * (extra.len - 1), extra.c + dc * (extra.len - 1)); }
      return { r0, r1, c0, c1, area: (r1 - r0 + 1) * (c1 - c0 + 1), w: c1 - c0 + 1, h: r1 - r0 + 1 };
    }

    if (order.length) put(order[0], 0, 0, 'a');
    let pending = order.slice(1);
    for (let pass = 0; pass < 3 && pending.length; pass++) {
      const left = [];
      for (const it of pending) {
        let best = null;
        for (const p of placed) {
          const [pdr, pdc] = step(p.dir), dir = p.dir === 'a' ? 'd' : 'a';
          for (let a = 0; a < p.word.length; a++) for (let b = 0; b < it.word.length; b++) {
            if (p.word[a] !== it.word[b]) continue;
            const pr = p.r + pdr * a, pc = p.c + pdc * a;
            const r = dir === 'd' ? pr - b : pr, c = dir === 'a' ? pc - b : pc;
            const x = fits(it.word, r, c, dir); if (x < 1) continue;
            const bb = bbox({ r, c, dir, len: it.word.length });
            // mais cruzamentos; depois grelha mais pequena e mais "quadrada" (cabe melhor no telemóvel)
            const score = x * 1000 - bb.area - Math.abs(bb.w - bb.h) * 3;
            if (!best || score > best.score) best = { r, c, dir, score };
          }
        }
        if (best) put(it, best.r, best.c, best.dir); else left.push(it);
      }
      if (left.length === pending.length) { unplaced.push(...left); pending = []; } else pending = left;
    }
    unplaced.push(...pending);

    // coordenadas a partir de 0 e numeração (de cima para baixo, da esquerda para a direita)
    const bb = placed.length ? bbox() : { r0: 0, c0: 0, h: 0, w: 0 };
    placed.forEach(p => { p.r -= bb.r0; p.c -= bb.c0; });
    const starts = [...new Set(placed.map(p => p.r * 1000 + p.c))].sort((a, b) => a - b);
    placed.forEach(p => { p.n = starts.indexOf(p.r * 1000 + p.c) + 1; p.len = p.word.length; });
    placed.sort((a, b) => (a.dir === b.dir ? a.n - b.n : a.dir === 'a' ? -1 : 1));
    return { rows: bb.h, cols: bb.w, words: placed.map(p => ({ i: p.i, word: p.word, display: p.display, clue: p.clue, r: p.r, c: p.c, dir: p.dir, n: p.n, len: p.len })), unplaced: unplaced.map(u => u.display) };
  }
  // grelha como lista de células com letra (para desenhar): { "r,c": { ch, n } }
  function crosswordCells(cw) {
    const cells = {};
    for (const w of cw.words) for (let k = 0; k < w.len; k++) {
      const r = w.r + (w.dir === 'd' ? k : 0), c = w.c + (w.dir === 'a' ? k : 0), kk = r + ',' + c;
      cells[kk] = cells[kk] || { ch: w.word ? w.word[k] : '' };
      if (k === 0) cells[kk].n = w.n;
    }
    return cells;
  }
  const api = { buildCrossword, crosswordCells, cwNorm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
