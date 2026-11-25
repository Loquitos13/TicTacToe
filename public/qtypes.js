// Ajudas partilhadas (formador e formandos) para os tipos de pergunta.
const QTYPE_LABEL = { mc: 'Escolha múltipla', tf: 'Verdadeiro / Falso', fill: 'Completar espaços', open: 'Resposta livre', scale: 'Escala (1–5 ou 1–10)', cloud: '☁️ Nuvem de palavras', rank: '🔢 Ranking de opções', scramble: '🔤 Letras baralhadas', cross: '✏️ Palavras cruzadas', guess: '🟩 Adivinha a palavra', potato: '🥔 Batata quente (jogo em grupo)', number: '🔢 Adivinhar um número', match: '🔗 Correspondência', spot: '🎯 Encontrar na imagem' };
const qType = q => (q && ['mc', 'tf', 'fill', 'open', 'scale', 'cloud', 'rank', 'scramble', 'cross', 'guess', 'number', 'match', 'spot', 'potato'].includes(q.type)) ? q.type : 'mc';
// tem resposta certa? (ranking só quando tem ordem certa)
const qGraded = q => { const t = qType(q); return t === 'rank' ? !!q.ordered : t === 'mc' && q && q.poll ? false : !['scale', 'open', 'cloud'].includes(t); };
// encontrar na imagem: uma ou várias zonas certas (as perguntas antigas tinham só "zone")
const zonesOfQ = q => Array.isArray(q.zones) && q.zones.length ? q.zones : q.zone ? [q.zone] : [];
// nº de problemas a encontrar (várias zonas com o mesmo "g" valem por um) e o nº de cada zona
const spotNumOf = q => { const seen = new Map(); return zonesOfQ(q).map((z, k) => { const g = z.g != null ? 'g' + z.g : 'z' + k; if (!seen.has(g)) seen.set(g, seen.size + 1); return seen.get(g); }); };
const spotCountQ = q => new Set(spotNumOf(q)).size;
// Nota de 0 a 20: média das perguntas com resposta certa (as meio certas contam a parte certa; certa = inteira).
// Não contam: opiniões, votações, respostas livres por validar e jogos ao vivo (batata quente).
function finalGradeOf(questions, answers, asked, sid) {
  const idx = asked.filter(i => { const q = questions[i]; if (!q || qType(q) === 'potato') return false; return qGraded(q) || Object.values(answers[i] || {}).some(a => a.correct != null); });
  if (!idx.length) return null;
  const sum = idx.reduce((s, i) => { const a = (answers[i] || {})[sid]; if (!a) return s; return s + (a.correct === true ? 1 : typeof a.frac === 'number' ? Math.max(0, Math.min(1, a.frac)) : 0); }, 0);
  return Math.round(sum / idx.length * 200) / 10;
}
const fmtGrade = g => g == null ? '—' : String(g).replace('.', ',');
const BLANK_RX = /\[\[([^\]]+?)\]\]/g;
// partes de texto entre os espaços: "A capital é [[Lisboa]]." → ["A capital é ", "."]
const fillPartsOf = text => String(text || '').split(BLANK_RX).filter((_, i) => i % 2 === 0);
const fillBlanksOf = text => [...String(text || '').matchAll(BLANK_RX)].map(m => m[1].trim());
const qnorm = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// frase com os espaços: slot(i) devolve o HTML de cada espaço
function sentenceHtml(parts, slot) {
  return parts.map((p, i) => esc(p) + (i < parts.length - 1 ? slot(i) : '')).join('');
}
// banco de palavras (as certas + as extra), sem repetidos e por ordem alfabética
function bankOf(q) {
  const seen = new Set(), out = [];
  for (const w of [...fillBlanksOf(q.text), ...(q.options || [])]) { const k = qnorm(w); if (k && !seen.has(k)) { seen.add(k); out.push(w); } }
  return out.sort((a, b) => a.localeCompare(b, 'pt'));
}
// texto da pergunta para títulos (espaços como ____)
const qTitle = q => qType(q) === 'fill' ? String(q.text).replace(BLANK_RX, '_____') : q.text;
// resposta certa em texto curto, para listas
function solutionText(q) {
  const t = qType(q);
  if (t === 'potato') return (q.rounds || []).map(r => `${r.theme}: ${(Array.isArray(r.words) ? r.words : []).join(', ')}`).join(' | ');
  if (t === 'mc' && q.poll) return 'Votação (sem resposta certa)';
  if (t === 'mc' || t === 'tf') return (q.correct || []).map(k => `${LETTERS[k]}) ${q.options[k]}`).join(' | ');
  if (t === 'fill') return fillBlanksOf(q.text).join(' · ');
  if (t === 'open') return (q.accepted || []).length ? 'Modelo: ' + q.accepted.join(' · ') + ' (validada pelo formador)' : 'Resposta livre (validada pelo formador)';
  if (t === 'cloud') return 'Nuvem de palavras (sem resposta certa)';
  if (t === 'scramble' || t === 'guess') return String(q.answer || '').toUpperCase();
  if (t === 'number') return String(q.answer);
  if (t === 'match') return (q.pairs || []).map(p => `${p.left} → ${p.right}`).join(' · ');
  if (t === 'spot') return spotCountQ(q) > 1 ? `As ${spotCountQ(q)} zonas marcadas na imagem` : 'A zona marcada na imagem';
  if (t === 'cross') return ((q.cross || {}).words || []).map(w => `${w.n}${w.dir === 'a' ? '→' : '↓'} ${w.display}`).join(' · ');
  if (t === 'rank') return q.ordered ? 'Ordem: ' + q.options.map((o, k) => `${k + 1}. ${o}`).join(' · ') : 'Ranking de opinião (sem ordem certa)';
  return `Escala 1–${q.scaleTo === 10 ? 10 : 5} (sem resposta certa)`;
}

// texto completo para as fichas (sem letras nem abreviaturas)
const fillSentenceOf = (q, words) => { let k = 0; return String(q.text).replace(BLANK_RX, () => words[k++] || '_____'); };
function plainCorrectOf(q) {
  const t = qType(q);
  if (t === 'potato') return (q.rounds || []).map(r => `${r.theme}: ${(Array.isArray(r.words) ? r.words : []).join(', ')}`).join(' | ');
  if (t === 'mc' && q.poll) return 'Votação (sem resposta certa)';
  if (t === 'mc' || t === 'tf') return q.correct.map(i => q.options[i]).join(' / ');
  if (t === 'fill') return fillSentenceOf(q, fillBlanksOf(q.text));
  if (t === 'open') return (q.accepted || []).length ? q.accepted.join(' / ') : 'Sem resposta modelo (validada pelo formador)';
  if (t === 'rank' && q.ordered) return q.options.map((o, k) => `${k + 1}. ${o}`).join('; ');
  if (t === 'scramble' || t === 'guess') return String(q.answer || '').toUpperCase();
  if (t === 'number') return String(q.answer);
  if (t === 'match') return (q.pairs || []).map(p => `${p.left} → ${p.right}`).join('; ');
  if (t === 'spot') return spotCountQ(q) > 1 ? `As ${spotCountQ(q)} zonas marcadas na imagem` : 'A zona marcada na imagem';
  if (t === 'cross') return ((q.cross || {}).words || []).map(w => `${w.n} ${w.dir === 'a' ? 'horizontal' : 'vertical'}: ${w.display}`).join('; ');
  return '—';
}
function plainAnswerOf(q, a) {
  if (!a) return '';
  const t = qType(q);
  if (t === 'potato') return `Palavras: ${(a.value || []).join(', ') || '—'} · ${a.points || 0} pontos${a.booms ? ` · rebentou ${a.booms}×` : ''}`;
  if (t === 'mc' || t === 'tf') return q.options[a.option];
  if (t === 'fill') return fillSentenceOf(q, a.value || []);
  if (t === 'scale') { const N = q.scaleTo === 10 ? 10 : 5, lab = a.value === 1 ? q.scaleMin : a.value === N ? q.scaleMax : ''; return `${a.value} de ${N}${lab ? ' (' + lab + ')' : ''}`; }
  if (t === 'cloud') return (a.value || []).join(', ');
  if (t === 'rank') return (a.value || []).map((k, pos) => `${pos + 1}. ${q.options[k]}`).join('; ');
  if (t === 'scramble') return String(a.value || '').toUpperCase();
  if (t === 'number') return String(a.value) + (a.correct ? '' : ` (a resposta era ${q.answer})`);
  if (t === 'match') return (q.pairs || []).map((p, i) => `${p.left} → ${((q.pairs || [])[(a.value || [])[i]] || {}).right || '—'}${(a.value || [])[i] === i ? ' ✓' : ' ✗'}`).join('; ');
  if (t === 'spot') return spotCountQ(q) > 1 ? `Encontrou ${a.right || 0} de ${spotCountQ(q)}` : a.correct ? 'Tocou na zona certa' : 'Tocou fora da zona certa';
  if (t === 'guess') return `Tentativas: ${(a.value || []).join(', ')}${a.correct ? ` — acertou à ${a.tries}ª` : ' — não acertou'}`;
  if (t === 'cross') return ((q.cross || {}).words || []).map((w, k) => `${w.n} ${w.dir === 'a' ? 'horizontal' : 'vertical'}: ${(a.value || [])[k] || '(em branco)'}${(a.value || [])[k] === w.word ? ' ✓' : ' ✗'}`).join('; ');
  return String(a.value ?? '');
}

// Palavras cruzadas: desenha a grelha. letters = { "r,c": "A" } (o que mostrar em cada casa);
// mark = { "r,c": 'ok' | 'bad' | 'on' } para pintar casas. Precisa de crossword.js (crosswordCells).
function crossGridHtml(cw, letters = {}, mark = {}, cls = '') {
  const cells = crosswordCells(cw);
  let html = `<div class="cw-grid ${cls}" style="--cols:${cw.cols};--rows:${cw.rows}">`;
  for (let r = 0; r < cw.rows; r++) for (let c = 0; c < cw.cols; c++) {
    const k = r + ',' + c, cell = cells[k];
    html += cell ? `<div class="cw-cell ${mark[k] || ''}" data-rc="${k}">${cell.n ? `<sup>${cell.n}</sup>` : ''}<span>${esc(letters[k] || '')}</span></div>` : '<div class="cw-x"></div>';
  }
  return html + '</div>';
}
// letras de cada casa a partir das palavras escritas (lista pela ordem de cw.words)
function crossLetters(cw, values) {
  const out = {};
  cw.words.forEach((w, k) => { const v = (values || [])[k] || ''; for (let i = 0; i < w.len; i++) { const ch = v[i]; if (ch) out[(w.r + (w.dir === 'd' ? i : 0)) + ',' + (w.c + (w.dir === 'a' ? i : 0))] = ch; } });
  return out;
}
const crossCellsOf = (w) => Array.from({ length: w.len }, (_, i) => (w.r + (w.dir === 'd' ? i : 0)) + ',' + (w.c + (w.dir === 'a' ? i : 0)));
