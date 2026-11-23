// Ajudas partilhadas (formador e formandos) para os tipos de pergunta.
const QTYPE_LABEL = { mc: 'Escolha múltipla', tf: 'Verdadeiro / Falso', fill: 'Completar espaços', open: 'Resposta livre', scale: 'Escala 1–5', cloud: '☁️ Nuvem de palavras', rank: '🔢 Ranking de opções' };
const qType = q => (q && ['mc', 'tf', 'fill', 'open', 'scale', 'cloud', 'rank'].includes(q.type)) ? q.type : 'mc';
// tem resposta certa? (ranking só quando tem ordem certa)
const qGraded = q => { const t = qType(q); return t === 'rank' ? !!q.ordered : !['scale', 'open', 'cloud'].includes(t); };
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
  if (t === 'mc' || t === 'tf') return (q.correct || []).map(k => `${LETTERS[k]}) ${q.options[k]}`).join(' | ');
  if (t === 'fill') return fillBlanksOf(q.text).join(' · ');
  if (t === 'open') return (q.accepted || []).length ? 'Modelo: ' + q.accepted.join(' · ') + ' (validada pelo formador)' : 'Resposta livre (validada pelo formador)';
  if (t === 'cloud') return 'Nuvem de palavras (sem resposta certa)';
  if (t === 'rank') return q.ordered ? 'Ordem: ' + q.options.map((o, k) => `${k + 1}. ${o}`).join(' · ') : 'Ranking de opinião (sem ordem certa)';
  return 'Escala 1–5 (sem resposta certa)';
}

// texto completo para as fichas (sem letras nem abreviaturas)
const fillSentenceOf = (q, words) => { let k = 0; return String(q.text).replace(BLANK_RX, () => words[k++] || '_____'); };
function plainCorrectOf(q) {
  const t = qType(q);
  if (t === 'mc' || t === 'tf') return q.correct.map(i => q.options[i]).join(' / ');
  if (t === 'fill') return fillSentenceOf(q, fillBlanksOf(q.text));
  if (t === 'open') return (q.accepted || []).length ? q.accepted.join(' / ') : 'Sem resposta modelo (validada pelo formador)';
  if (t === 'rank' && q.ordered) return q.options.map((o, k) => `${k + 1}. ${o}`).join('; ');
  return '—';
}
function plainAnswerOf(q, a) {
  if (!a) return '';
  const t = qType(q);
  if (t === 'mc' || t === 'tf') return q.options[a.option];
  if (t === 'fill') return fillSentenceOf(q, a.value || []);
  if (t === 'scale') { const lab = a.value === 1 ? q.scaleMin : a.value === 5 ? q.scaleMax : ''; return `${a.value} de 5${lab ? ' (' + lab + ')' : ''}`; }
  if (t === 'cloud') return (a.value || []).join(', ');
  if (t === 'rank') return (a.value || []).map((k, pos) => `${pos + 1}. ${q.options[k]}`).join('; ');
  return String(a.value ?? '');
}
