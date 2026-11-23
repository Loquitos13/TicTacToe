// Fichas de respostas em Word (.docx), A4 na vertical: uma página (ou mais) por formando.
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, PageOrientation, BorderStyle } = require('docx');
const Q = require('./questions');

const LETTERS = 'ABCDEF';
const PAGE_W = 11906, MARGIN = 1021, USABLE = PAGE_W - 2 * MARGIN; // A4 em twips
const COLS = [5, 31, 23, 23, 11, 7].map(p => Math.round(USABLE * p / 100)); // Nº, Pergunta, Resposta correta, Resposta do formando, Resultado, Pontos
const FONT = 'Calibri';

function cell(text, opts = {}) {
  const runs = (Array.isArray(text) ? text : [{ text }]).map(r => new TextRun({ text: String(r.text ?? ''), bold: r.bold || opts.bold, italics: r.italics, color: r.color || opts.color, size: r.size || opts.size || 18, font: FONT, break: r.break }));
  return new TableCell({
    children: [new Paragraph({ children: runs, alignment: opts.align || AlignmentType.LEFT })],
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  });
}

// Ficha de um formando
function studentBlock(r, p, ctx) {
  const { joined, score, graded } = ctx;
  let ok = 0, n = 0, pend = 0;
  const rows = r.questions.map((q, i) => {
    const t = Q.typeOf(q), a = (r.answers[i] || {})[p.id], asked = r.asked.includes(i);
    if (graded(i)) { n++; if (a && a.correct === true) ok++; }
    if (a && t === 'open' && a.correct == null) pend++;
    let res, color;
    if (!asked) { res = 'Não feita'; color = '777777'; }
    else if (!a) { res = joined.has(p.id) ? 'Sem resposta' : 'Ausente'; color = '777777'; }
    else if (t === 'scale' || t === 'cloud' || (t === 'rank' && !q.ordered)) { res = 'Opinião'; color = '555555'; }
    else if (a.correct === true) { res = '✓ Certa'; color = '166534'; }
    else if (a.correct === false) { if ((t === 'fill' || t === 'rank') && a.right) { res = `${a.right}/${t === 'fill' ? q.blanks.length : q.options.length} certas`; color = '92400E'; } else { res = '✗ Errada'; color = '991B1B'; } }
    else { res = 'Por validar'; color = '854D0E'; }
    const qsub = t === 'mc' || t === 'tf' ? 'Opções: ' + q.options.join(' · ') : { fill: 'Completar espaços', open: 'Resposta livre', scale: 'Escala 1–5', cloud: 'Nuvem de palavras', rank: 'Ranking de opções' + (q.ordered ? ' (ordem certa)' : ' (opinião)') }[t];
    return new TableRow({ cantSplit: true, children: [
      cell(String(i + 1), { width: COLS[0], align: AlignmentType.CENTER }),
      cell([{ text: Q.displayText(q), bold: true }, { text: qsub, size: 15, color: '666666', break: 1 }], { width: COLS[1] }),
      cell(Q.plainCorrect(q), { width: COLS[2] }),
      cell(a ? Q.plainAnswer(q, a) : '', { width: COLS[3] }),
      cell(res, { width: COLS[4], color, bold: true }),
      cell(a ? String(a.points || 0) : '0', { width: COLS[5], align: AlignmentType.RIGHT }),
    ] });
  });
  const header = new TableRow({ tableHeader: true, children: ['Nº', 'Pergunta', 'Resposta correta', 'Resposta do formando', 'Resultado', 'Pontos']
    .map((h, k) => cell(h, { width: COLS[k], bold: true, fill: 'EDE9FE', align: k === 5 ? AlignmentType.RIGHT : k === 0 ? AlignmentType.CENTER : AlignmentType.LEFT })) });
  const meta = [r.courseName ? `Curso: ${r.courseName}` : null, `Questionário: ${r.quizTitle}`, `Data: ${new Date(r.startedAt).toLocaleDateString('pt-PT')}`].filter(Boolean).join('   ·   ');
  return [
    new Paragraph({ children: [new TextRun({ text: 'Ficha de respostas', bold: true, size: 32, font: FONT, color: '4C1D95' })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: meta, size: 18, font: FONT, color: '555555' })], spacing: { after: 160 } }),
    new Paragraph({ children: [new TextRun({ text: p.name, bold: true, size: 28, font: FONT })], spacing: { after: 60 } }),
    new Paragraph({ children: [
      new TextRun({ text: `${ok} de ${n} certas${n ? ` (${Math.round(ok / n * 100)}%)` : ''}`, bold: true, size: 20, font: FONT }),
      new TextRun({ text: `   ·   ${score[p.id] ?? 0} pontos`, size: 20, font: FONT }),
      ...(pend ? [new TextRun({ text: `   ·   ${pend} resposta(s) livre(s) por validar`, size: 20, font: FONT, color: '854D0E' })] : []),
    ], spacing: { after: 200 } }),
    new Table({ rows: [header, ...rows], width: { size: USABLE, type: WidthType.DXA }, columnWidths: COLS,
      borders: { top: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E5E5E5' }, insideVertical: { style: BorderStyle.NONE } } }),
  ];
}

async function buildDocx(r, studentId) {
  const people = new Map();
  r.roster.forEach(s => people.set(s.id, { id: s.id, name: s.name }));
  r.players.forEach(p => { if (!people.has(p.studentId)) people.set(p.studentId, { id: p.studentId, name: p.name }); });
  const joined = new Set(r.players.map(p => p.studentId));
  const score = Object.fromEntries(r.players.map(p => [p.studentId, p.score]));
  const graded = i => r.asked.includes(i) && (Q.isGraded(r.questions[i]) || Object.values(r.answers[i] || {}).some(a => a.correct != null));
  let list = [...people.values()].filter(p => joined.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  if (studentId) list = list.filter(p => p.id === studentId);
  const ctx = { joined, score, graded };
  const doc = new Document({
    creator: 'Quiz', title: `Fichas de respostas — ${r.quizTitle}`,
    styles: { default: { document: { run: { font: FONT } } } },
    // cada formando numa secção nova = começa numa página nova; A4 na vertical
    sections: list.map(p => ({
      properties: { page: { size: { orientation: PageOrientation.PORTRAIT, width: PAGE_W, height: 16838 }, margin: { top: 1134, bottom: 1134, left: MARGIN, right: MARGIN } } },
      children: studentBlock(r, p, ctx),
    })),
  });
  return { buffer: await Packer.toBuffer(doc), count: list.length, name: list.length === 1 ? list[0].name : null };
}

module.exports = { buildDocx };

// ---------- Lista de soluções de um questionário (todas as perguntas com a resposta correta destacada) ----------
const GREEN = '166534', GREEN_BG = 'DCFCE7';
function run(text, o = {}) { return new TextRun({ text: String(text ?? ''), font: FONT, size: o.size || 21, bold: o.bold, color: o.color, italics: o.italics, shading: o.bg ? { type: ShadingType.CLEAR, color: 'auto', fill: o.bg } : undefined, break: o.break }); }
function para(runs, o = {}) { return new Paragraph({ children: runs, spacing: { after: o.after ?? 60, before: o.before }, indent: o.indent ? { left: o.indent } : undefined, keepNext: o.keepNext }); }

function keyBlock(q, i) {
  const t = Q.typeOf(q), out = [];
  const label = { mc: 'Escolha múltipla', tf: 'Verdadeiro / Falso', fill: 'Completar espaços', open: 'Resposta livre', scale: 'Escala 1–5', cloud: 'Nuvem de palavras', rank: 'Ranking de opções' }[t];
  out.push(para([run(`${i + 1}. `, { bold: true, size: 23 }), run(Q.displayText(q), { bold: true, size: 23 })], { before: 200, after: 40, keepNext: true }));
  out.push(para([run(`${label} · ${q.time} s`, { size: 17, color: '777777' })], { after: 80, keepNext: true }));
  if (t === 'mc' || t === 'tf') {
    q.options.forEach((o, k) => {
      const ok = q.correct.includes(k);
      out.push(para([run(`${LETTERS[k]})  `, { bold: true, color: ok ? GREEN : '444444' }), run(o, { bold: ok, color: ok ? GREEN : '222222', bg: ok ? GREEN_BG : undefined }), ...(ok ? [run('   ✓ correta', { bold: true, color: GREEN, size: 18 })] : [])], { indent: 360, after: 30 }));
    });
  } else if (t === 'fill') {
    const parts = String(q.text).split(/\[\[([^\]]+?)\]\]/g);
    out.push(para(parts.map((p, k) => k % 2 ? run(p.trim(), { bold: true, color: GREEN, bg: GREEN_BG }) : run(p)), { indent: 360 }));
    out.push(para([run('Palavras disponíveis: ', { size: 18, color: '777777' }), run(Q.wordBank(q).join(' · '), { size: 18, color: '555555' })], { indent: 360 }));
  } else if (t === 'open') {
    if ((q.accepted || []).length) out.push(para([run('Resposta de referência: ', { bold: true, color: GREEN }), run(q.accepted.join(' / '), { bold: true, color: GREEN, bg: GREEN_BG })], { indent: 360 }));
    else out.push(para([run('⚠ Sem resposta de referência — edita a pergunta para a acrescentar.', { bold: true, color: '991B1B' })], { indent: 360 }));
    out.push(para([run('Validada pelo formador, resposta a resposta.', { size: 17, color: '777777', italics: true })], { indent: 360 }));
  } else if (t === 'cloud') {
    out.push(para([run(`Cada formando escreve até ${q.words || 3} palavra(s). Nuvem de palavras: não tem resposta certa.`, { size: 18, color: '555555', italics: true })], { indent: 360 }));
  } else if (t === 'rank') {
    if (q.ordered) {
      out.push(para([run('Ordem correta:', { bold: true, color: GREEN })], { indent: 360, after: 30 }));
      q.options.forEach((o, k) => out.push(para([run(`${k + 1}.  `, { bold: true, color: GREEN }), run(o, { bold: true, color: GREEN, bg: GREEN_BG })], { indent: 540, after: 20 })));
    } else {
      q.options.forEach(o => out.push(para([run('•  '), run(o)], { indent: 540, after: 20 })));
      out.push(para([run('Ranking de opinião: não tem ordem certa (resultado = posição média de cada opção).', { size: 17, color: '777777', italics: true })], { indent: 360 }));
    }
  } else {
    out.push(para([1, 2, 3, 4, 5].map(n => run(`  ${n}  `, { bold: true, bg: 'EDE9FE' })).flatMap((r, k) => k ? [run('  '), r] : [r]), { indent: 360 }));
    if (q.scaleMin || q.scaleMax) out.push(para([run(`1 = ${q.scaleMin || '—'}     ·     5 = ${q.scaleMax || '—'}`, { size: 18, color: '555555' })], { indent: 360 }));
    out.push(para([run('Escala de opinião: não tem resposta certa.', { size: 17, color: '777777', italics: true })], { indent: 360 }));
  }
  return out;
}
async function buildKeyDocx(quiz, courseName) {
  const doc = new Document({
    creator: 'Quiz', title: `Soluções — ${quiz.title}`, styles: { default: { document: { run: { font: FONT } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.PORTRAIT, width: PAGE_W, height: 16838 }, margin: { top: 1134, bottom: 1134, left: MARGIN, right: MARGIN } } },
      children: [
        para([run('Lista de soluções', { bold: true, size: 32, color: '4C1D95' })], { after: 60 }),
        para([run([courseName ? `Curso: ${courseName}` : null, `Questionário: ${quiz.title}`, `${quiz.questions.length} perguntas`].filter(Boolean).join('   ·   '), { size: 18, color: '555555' })], { after: 120 }),
        para([run('A resposta correta está destacada a verde.', { size: 18, italics: true, color: '555555' })], { after: 120 }),
        ...quiz.questions.flatMap(keyBlock),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
module.exports.buildKeyDocx = buildKeyDocx;
