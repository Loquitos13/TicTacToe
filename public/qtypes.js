// Ajudas partilhadas (formador e formandos) para os tipos de pergunta.
const QTYPE_LABEL = { mc: 'Escolha múltipla', tf: 'Verdadeiro / Falso', fill: 'Completar espaços', open: 'Resposta livre', scale: 'Escala 1–5' };
const qType = q => (q && ['mc', 'tf', 'fill', 'open', 'scale'].includes(q.type)) ? q.type : 'mc';
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
  return 'Escala 1–5 (sem resposta certa)';
}
