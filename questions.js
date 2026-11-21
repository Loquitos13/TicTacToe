// Tipos de pergunta: validação no editor, correção das respostas e textos para os resultados.
//  mc    — escolha múltipla (2 a 6 opções; uma ou mais corretas)
//  tf    — verdadeiro / falso
//  fill  — completar espaços: o texto tem [[palavra]] em cada espaço; o formando escolhe as
//          palavras de um banco (as certas + palavras extra que baralham)
//  open  — resposta livre (escrita). Se houver "respostas aceites", é corrigida sozinha;
//          senão fica "por avaliar" e o formador marca certa/errada nos resultados
//  scale — escala de 1 a 5 (opinião): não tem resposta certa nem pontos
const TYPES = ['mc', 'tf', 'fill', 'open', 'scale'];
const LETTERS = 'ABCDEF';
const norm = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const BLANK_RE = /\[\[([^\]]+?)\]\]/g;

function typeOf(q) { return TYPES.includes(q.type) ? q.type : 'mc'; }
// é uma pergunta com resposta certa? (a escala e a resposta livre sem respostas aceites não são)
function isGraded(q) { const t = typeOf(q); return t === 'scale' ? false : t === 'open' ? (q.accepted || []).length > 0 : true; }
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
  if (t === 'open') {
    const value = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!value) return { error: 'Escreve a tua resposta.' };
    if (!(q.accepted || []).length) return { entry: { value, correct: null, frac: 0 } }; // o formador avalia
    const ok = q.accepted.some(a => norm(a) === norm(value));
    return { entry: { value, correct: ok, frac: ok ? 1 : 0 } };
  }
  return { error: 'Resposta inválida.' };
}

// Textos para a grelha / Excel
function answerText(q, a) {
  if (!a) return '';
  const t = typeOf(q);
  if (t === 'mc' || t === 'tf') return `${LETTERS[a.option]}) ${q.options[a.option]}`;
  if (t === 'fill') return (a.value || []).join(' | ');
  return String(a.value ?? '');
}
function answerShort(q, a) {
  const t = typeOf(q);
  if (t === 'mc') return LETTERS[a.option];
  if (t === 'tf') return a.option === 0 ? 'V' : 'F';
  if (t === 'fill') return `${a.right ?? 0}/${q.blanks.length}`;
  if (t === 'scale') return String(a.value);
  return String(a.value || '').slice(0, 18) + (String(a.value || '').length > 18 ? '…' : '');
}
function correctText(q) {
  const t = typeOf(q);
  if (t === 'mc' || t === 'tf') return q.correct.map(i => `${LETTERS[i]}) ${q.options[i]}`).join(' | ');
  if (t === 'fill') return q.blanks.join(' | ');
  if (t === 'open') return (q.accepted || []).length ? q.accepted.join(' | ') : '(resposta livre — avaliada pelo formador)';
  return '(escala 1–5 — sem resposta certa)';
}
function correctShort(q) {
  const t = typeOf(q);
  if (t === 'mc') return q.correct.map(i => LETTERS[i]).join('/');
  if (t === 'tf') return q.correct[0] === 0 ? 'V' : 'F';
  if (t === 'fill') return q.blanks.join(', ');
  if (t === 'open') return (q.accepted || []).length ? q.accepted[0] + (q.accepted.length > 1 ? '…' : '') : 'livre';
  return '1–5';
}

// O que o telemóvel recebe da pergunta (nunca a resposta certa). hide = só no ecrã do formador.
function publicQuestion(q, hide) {
  const t = typeOf(q);
  const p = { type: t, time: q.time, text: hide ? '' : displayText(q), image: hide ? null : (q.image || null), hidden: !!hide };
  if (t === 'mc' || t === 'tf') p.options = hide ? q.options.map(() => '') : q.options;
  if (t === 'fill') { p.blanks = q.blanks.length; p.bank = wordBank(q); if (!hide) p.parts = String(q.text).split(BLANK_RE).filter((_, i) => i % 2 === 0); }
  if (t === 'scale') { p.scaleMin = q.scaleMin || ''; p.scaleMax = q.scaleMax || ''; }
  return p;
}
// a resposta certa, para mostrar ao formando quando chega a altura
function solutionOf(q) {
  const t = typeOf(q);
  if (t === 'mc' || t === 'tf') return { correct: q.correct };
  if (t === 'fill') return { blanks: q.blanks };
  if (t === 'open') return { accepted: q.accepted || [] };
  return {};
}

module.exports = { TYPES, typeOf, isGraded, blanksOf, displayText, wordBank, cleanQuestion, grade, answerText, answerShort, correctText, correctShort, publicQuestion, solutionOf, norm };
