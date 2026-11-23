// Tipos de pergunta: validação no editor, correção das respostas e textos para os resultados.
//  mc    — escolha múltipla (2 a 6 opções; uma ou mais corretas)
//  tf    — verdadeiro / falso
//  fill  — completar espaços: o texto tem [[palavra]] em cada espaço; o formando escolhe as
//          palavras de um banco (as certas + palavras extra que baralham)
//  open  — resposta livre (escrita). É SEMPRE validada pelo formador, uma a uma, nos resultados.
//          As "respostas modelo" (accepted) só servem de referência / sugestão
//  scale — escala de 1 a 5 (opinião): não tem resposta certa nem pontos
//  cloud — nuvem de palavras: cada formando escreve até 3 palavras; sem resposta certa nem pontos
//  rank  — ranking de opções: o formando ordena as opções. Com "ordered", a ordem do editor é a certa
//          (pontos por posição certa); sem ela é uma opinião (resultado = posição média de cada opção)
const TYPES = ['mc', 'tf', 'fill', 'open', 'scale', 'cloud', 'rank'];
const LETTERS = 'ABCDEF';
const norm = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const BLANK_RE = /\[\[([^\]]+?)\]\]/g;

function typeOf(q) { return TYPES.includes(q.type) ? q.type : 'mc'; }
// é uma pergunta com resposta certa? (a escala e a resposta livre sem respostas aceites não são)
// (a resposta livre só passa a contar depois de o formador a validar)
function isGraded(q) { const t = typeOf(q); return t === 'rank' ? !!q.ordered : t !== 'scale' && t !== 'open' && t !== 'cloud'; }
// ranking: ordem (baralhada mas sempre igual para a mesma pergunta) em que as opções aparecem,
// para não denunciar a ordem certa e para o projetor e os telemóveis mostrarem as mesmas letras
function rankOrder(q) {
  const n = (q.options || []).length, idx = [...Array(n).keys()];
  let h = 2166136261; for (const c of String(q.id || q.text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0, h / 4294967296);
  // no máximo 1/3 das opções fica no lugar certo (com 2 ou 3 opções, nenhuma)
  for (let k = 0; k < 40; k++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    if (n < 2 || idx.filter((v, i) => v === i).length <= Math.floor(n / 4)) break;
  }
  return idx;
}
// palavras da nuvem: limpa, tira repetidas e corta no máximo
function cloudWords(raw, max) {
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;\n]+/)).map(w => String(w ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean);
  const seen = new Set(), out = [];
  for (const w of list) { const k = norm(w); if (k && !seen.has(k)) { seen.add(k); out.push(w); } }
  return out.slice(0, max);
}
function blanksOf(text) { return [...String(text).matchAll(BLANK_RE)].map(m => m[1].trim()); }
// texto da pergunta para mostrar (os espaços aparecem como ____)
function displayText(q) { return typeOf(q) === 'fill' ? String(q.text).replace(BLANK_RE, '_____') : q.text; }
// banco de palavras de uma pergunta de completar (sem repetidos, ordenado de forma estável)
function wordBank(q) {
  const seen = new Set(), out = [];
  for (const w of [...(q.blanks || []), ...(q.options || [])]) { const k = norm(w); if (k && !seen.has(k)) { seen.add(k); out.push(w); } }
  return out.sort((a, b) => a.localeCompare(b, 'pt'));
}

// Limpa e valida uma pergunta vinda do editor. Devolve null se estiver incompleta.
function cleanQuestion(x, uid, savePhoto) {
  const type = TYPES.includes(x.type) ? x.type : 'mc';
  const base = {
    id: x.id || uid(), type, text: String(x.text || '').trim(),
    time: Math.max(5, Math.min(300, parseInt(x.time, 10) || 20)),
    image: x.image && String(x.image).startsWith('data:') ? savePhoto(x.image) : (x.image || null),
    options: [], correct: [],
  };
  if (!base.text) return null;
  if (type === 'mc') {
    base.options = (x.options || []).map(o => String(o).trim()).filter(Boolean).slice(0, 6);
    base.correct = (x.correct || []).map(Number).filter(i => i >= 0 && i < base.options.length);
    if (base.options.length < 2 || !base.correct.length) return null;
  } else if (type === 'tf') {
    base.options = ['Verdadeiro', 'Falso'];
    const c = Number((x.correct || [0])[0]); base.correct = [c === 1 ? 1 : 0];
  } else if (type === 'fill') {
    base.blanks = blanksOf(base.text);
    if (!base.blanks.length) return null;
    base.options = (x.options || []).map(o => String(o).trim()).filter(Boolean).slice(0, 12); // palavras extra
  } else if (type === 'open') {
    base.accepted = (x.accepted || []).map(a => String(a).trim()).filter(Boolean).slice(0, 20);
  } else if (type === 'scale') {
    base.scaleMin = String(x.scaleMin || '').trim().slice(0, 40);
    base.scaleMax = String(x.scaleMax || '').trim().slice(0, 40);
  } else if (type === 'cloud') {
    base.words = Math.max(1, Math.min(3, parseInt(x.words, 10) || 3));
  } else if (type === 'rank') {
    base.options = (x.options || []).map(o => String(o).trim()).filter(Boolean).slice(0, 6);
    base.ordered = !!x.ordered;
    if (base.options.length < 2) return null;
  }
  return base;
}

// Corrige uma resposta. raw: número (mc/tf/scale), lista de palavras (fill) ou texto (open).
// Devolve { error } ou { entry: { option?, value?, correct, frac } } (frac = fração certa, 0..1).
function grade(q, raw) {
  const t = typeOf(q);
  if (t === 'mc' || t === 'tf') {
    const option = parseInt(raw, 10);
    if (!(option >= 0 && option < q.options.length)) return { error: 'Resposta inválida.' };
    const ok = q.correct.includes(option);
    return { entry: { option, correct: ok, frac: ok ? 1 : 0 } };
  }
  if (t === 'scale') {
    const v = parseInt(raw, 10);
    if (!(v >= 1 && v <= 5)) return { error: 'Resposta inválida.' };
    return { entry: { value: v, correct: null, frac: 0 } };
  }
  if (t === 'fill') {
    if (!Array.isArray(raw) || raw.length !== q.blanks.length) return { error: 'Preenche todos os espaços.' };
    const bank = new Set(wordBank(q).map(norm));
    const value = raw.map(w => String(w ?? '').slice(0, 60));
    if (value.some(w => !bank.has(norm(w)))) return { error: 'Resposta inválida.' };
    const right = value.filter((w, i) => norm(w) === norm(q.blanks[i])).length;
    return { entry: { value, correct: right === q.blanks.length, frac: right / q.blanks.length, right } };
  }
  if (t === 'cloud') {
    const value = cloudWords(raw, q.words || 3);
    if (!value.length) return { error: 'Escreve pelo menos uma palavra.' };
    return { entry: { value, correct: null, frac: 0 } };
  }
  if (t === 'rank') {
    const n = q.options.length;
    if (!Array.isArray(raw) || raw.length !== n) return { error: 'Ordena todas as opções.' };
    const value = raw.map(v => parseInt(v, 10));
    if (new Set(value).size !== n || value.some(v => !(v >= 0 && v < n))) return { error: 'Resposta inválida.' };
    if (!q.ordered) return { entry: { value, correct: null, frac: 0 } };
    const right = value.filter((v, pos) => v === pos).length;
    return { entry: { value, correct: right === n, frac: right / n, right } };
  }
  if (t === 'open') {
    const value = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!value) return { error: 'Escreve a tua resposta.' };
    // fica por validar; se coincidir com uma resposta modelo, fica marcada como sugestão
    const suggest = (q.accepted || []).length ? q.accepted.some(a => norm(a) === norm(value)) : null;
    return { entry: { value, correct: null, frac: 0, suggest } };
  }
  return { error: 'Resposta inválida.' };
}

// Textos para a grelha / Excel
function answerText(q, a) {
  if (!a) return '';
  const t = typeOf(q);
  if (t === 'mc' || t === 'tf') return `${LETTERS[a.option]}) ${q.options[a.option]}`;
  if (t === 'fill') return (a.value || []).join(' | ');
  if (t === 'cloud') return (a.value || []).join(', ');
  if (t === 'rank') return (a.value || []).map((k, pos) => `${pos + 1}. ${q.options[k]}`).join(' | ');
  return String(a.value ?? '');
}
function answerShort(q, a) {
  const t = typeOf(q);
  if (t === 'mc') return LETTERS[a.option];
  if (t === 'tf') return a.option === 0 ? 'V' : 'F';
  if (t === 'fill') return `${a.right ?? 0}/${q.blanks.length}`;
  if (t === 'scale') return String(a.value);
  if (t === 'rank') return q.ordered ? `${a.right ?? 0}/${q.options.length}` : '1º ' + String(q.options[(a.value || [])[0]] || '').slice(0, 14);
  if (t === 'cloud') { const j = (a.value || []).join(', '); return j.slice(0, 18) + (j.length > 18 ? '…' : ''); }
  return String(a.value || '').slice(0, 18) + (String(a.value || '').length > 18 ? '…' : '');
}
function correctText(q) {
  const t = typeOf(q);
  if (t === 'mc' || t === 'tf') return q.correct.map(i => `${LETTERS[i]}) ${q.options[i]}`).join(' | ');
  if (t === 'fill') return q.blanks.join(' | ');
  if (t === 'open') return (q.accepted || []).length ? 'Modelo: ' + q.accepted.join(' | ') + ' (validada pelo formador)' : '(resposta livre — validada pelo formador)';
  if (t === 'cloud') return '(nuvem de palavras — sem resposta certa)';
  if (t === 'rank') return q.ordered ? q.options.map((o, k) => `${k + 1}. ${o}`).join(' | ') : '(ranking de opinião — sem ordem certa)';
  return '(escala 1–5 — sem resposta certa)';
}
function correctShort(q) {
  const t = typeOf(q);
  if (t === 'mc') return q.correct.map(i => LETTERS[i]).join('/');
  if (t === 'tf') return q.correct[0] === 0 ? 'V' : 'F';
  if (t === 'fill') return q.blanks.join(', ');
  if (t === 'open') return (q.accepted || []).length ? q.accepted[0] + (q.accepted.length > 1 ? '…' : '') : 'livre';
  if (t === 'cloud') return 'nuvem';
  if (t === 'rank') return q.ordered ? 'ordem' : 'opinião';
  return '1–5';
}

// O que o telemóvel recebe da pergunta (nunca a resposta certa). hide = só no ecrã do formador.
function publicQuestion(q, hide) {
  const t = typeOf(q);
  const p = { type: t, time: q.time, text: hide ? '' : displayText(q), image: hide ? null : (q.image || null), hidden: !!hide };
  if (t === 'mc' || t === 'tf') p.options = hide ? q.options.map(() => '') : q.options;
  if (t === 'fill') { p.blanks = q.blanks.length; p.bank = wordBank(q); if (!hide) p.parts = String(q.text).split(BLANK_RE).filter((_, i) => i % 2 === 0); }
  if (t === 'scale') { p.scaleMin = q.scaleMin || ''; p.scaleMax = q.scaleMax || ''; }
  if (t === 'cloud') p.words = q.words || 3;
  // ranking: opções pela ordem baralhada; o telemóvel devolve os números originais (i)
  if (t === 'rank') p.ordered = !!q.ordered;
  if (t === 'rank') p.items = rankOrder(q).map((i, k) => ({ i, text: hide ? '' : q.options[i], letter: LETTERS[k] }));
  return p;
}
// a resposta certa, para mostrar ao formando quando chega a altura
function solutionOf(q) {
  const t = typeOf(q);
  if (t === 'mc' || t === 'tf') return { correct: q.correct };
  if (t === 'fill') return { blanks: q.blanks };
  if (t === 'open') return { accepted: q.accepted || [] };
  if (t === 'rank' && q.ordered) return { order: q.options };
  return {};
}

// Texto completo para as fichas (sem letras nem abreviaturas)
const fillSentence = (q, words) => { let k = 0; return String(q.text).replace(BLANK_RE, () => { const w = words[k++]; return w ? w : '_____'; }); };
function plainCorrect(q) {
  const t = typeOf(q);
  if (t === 'mc' || t === 'tf') return q.correct.map(i => q.options[i]).join(' / ');
  if (t === 'fill') return fillSentence(q, q.blanks);
  if (t === 'open') return (q.accepted || []).length ? q.accepted.join(' / ') : 'Sem resposta modelo (validada pelo formador)';
  if (t === 'rank' && q.ordered) return q.options.map((o, k) => `${k + 1}. ${o}`).join('; ');
  return '—';
}
function plainAnswer(q, a) {
  if (!a) return '';
  const t = typeOf(q);
  if (t === 'mc' || t === 'tf') return q.options[a.option];
  if (t === 'fill') return fillSentence(q, a.value || []);
  if (t === 'scale') { const lab = a.value === 1 ? q.scaleMin : a.value === 5 ? q.scaleMax : ''; return `${a.value} de 5${lab ? ' (' + lab + ')' : ''}`; }
  if (t === 'cloud') return (a.value || []).join(', ');
  if (t === 'rank') return (a.value || []).map((k, pos) => `${pos + 1}. ${q.options[k]}`).join('; ');
  return String(a.value ?? '');
}

module.exports = { rankOrder, cloudWords, plainCorrect, plainAnswer,  TYPES, typeOf, isGraded, blanksOf, displayText, wordBank, cleanQuestion, grade, answerText, answerShort, correctText, correctShort, publicQuestion, solutionOf, norm };
