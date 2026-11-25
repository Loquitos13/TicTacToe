// Regras de correção (correm com: npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../questions');
const { buildCrossword } = require('../public/crossword');
let n = 0; const uid = () => 'q' + n++;
const make = x => Q.cleanQuestion(x, uid, () => null);

test('cada tipo recusa respostas inválidas sem rebentar', () => {
  const qs = [
    make({ type: 'mc', text: 'a', options: ['x', 'y'], correct: [1] }),
    make({ type: 'tf', text: 'a', correct: [0] }),
    make({ type: 'fill', text: 'A capital é [[Lisboa]].', options: ['Porto'] }),
    make({ type: 'open', text: 'a', accepted: ['b'] }),
    make({ type: 'scale', text: 'a' }),
    make({ type: 'cloud', text: 'a' }),
    make({ type: 'rank', text: 'a', options: ['1', '2', '3'], ordered: true }),
    make({ type: 'scramble', text: 'a', answer: 'Cliente' }),
    make({ type: 'cross', text: 'a', entries: [{ word: 'Cliente', clue: 'c' }, { word: 'Fecho', clue: 'f' }] }),
    make({ type: 'guess', text: 'a', answer: 'Valor' }),
  ];
  for (const q of qs) for (const bad of [undefined, null, {}, [], 'x'.repeat(5000), { toString: 1 }, [{ toString: 1 }], -1, 99])
    assert.doesNotThrow(() => Q.grade(q, bad), `${q.type} com ${JSON.stringify(bad)}`);
});

test('escolha múltipla e completar espaços', () => {
  const mc = make({ type: 'mc', text: 'a', options: ['x', 'y'], correct: [1] });
  assert.equal(Q.grade(mc, 1).entry.correct, true);
  assert.equal(Q.grade(mc, 0).entry.correct, false);
  const fill = make({ type: 'fill', text: 'A capital é [[Lisboa]].', options: ['Porto'] });
  assert.equal(Q.grade(fill, ['lisboa']).entry.correct, true);
  assert.ok(Q.grade(fill, ['Madrid']).error);
});

test('ranking: o telemóvel não consegue acertar às cegas e a ordem certa acerta', () => {
  const q = make({ type: 'rank', text: 'a', options: ['A', 'B', 'C', 'D'], ordered: true });
  const items = Q.publicQuestion(q, false).items;
  assert.equal(Q.grade(q, [0, 1, 2, 3]).entry.correct, false, 'a ordem do ecrã não pode ser a resposta');
  const right = ['A', 'B', 'C', 'D'].map(t => items.find(x => x.text === t).i);
  assert.equal(Q.grade(q, right).entry.correct, true);
  assert.deepEqual(Q.forPhone(q, Q.grade(q, right).entry.value), right, 'o telemóvel recebe a resposta na ordem em que a vê');
});

test('adivinha a palavra: cores com letras repetidas e palavra nunca enviada', () => {
  assert.equal(Q.guessColors('VALOR', 'LAVOR').join(''), 'ygygg');
  assert.equal(Q.guessColors('LUCRO', 'OLHOS').join(''), 'yyrrr');
  const q = make({ type: 'guess', text: 'pista', answer: 'Valor' });
  assert.ok(!JSON.stringify(Q.publicQuestion(q, false)).toUpperCase().includes('VALOR'));
});

test('letras baralhadas e cruzadas ignoram acentos e maiúsculas', () => {
  assert.equal(Q.grade(make({ type: 'scramble', text: 'a', answer: 'Pós venda' }), 'posvenda').entry.correct, true);
  const cw = buildCrossword([{ word: 'Negociação', clue: 'a' }, { word: 'Cliente', clue: 'b' }, { word: 'Fecho', clue: 'c' }]);
  assert.equal(cw.unplaced.length, 0);
  const q = make({ type: 'cross', text: 'a', entries: [{ word: 'Negociação', clue: 'a' }, { word: 'Cliente', clue: 'b' }, { word: 'Fecho', clue: 'c' }] });
  assert.equal(Q.grade(q, q.cross.words.map(w => w.display.toLowerCase())).entry.correct, true);
});

test('número, correspondência e encontrar na imagem', () => {
  const num = make({ type: 'number', text: 'a', min: 0, max: 10, answer: 5 });
  assert.equal(Q.grade(num, 5).entry.correct, true);
  assert.ok(Q.grade(num, 4).entry.frac > 0 && Q.grade(num, 4).entry.frac < 1, 'perto dá parte dos pontos');
  assert.ok(Q.grade(num, 11).error);
  const m = make({ type: 'match', text: 'a', pairs: [{ left: 'a', right: '1' }, { left: 'b', right: '2' }, { left: 'c', right: '3' }] });
  const pub = Q.publicQuestion(m, false);
  assert.ok(!JSON.stringify(pub).includes('pairs'), 'os pares certos não vão para o telemóvel');
  const shown = ['1', '2', '3'].map(t => pub.rights.find(r => r.text === t).k);
  assert.equal(Q.grade(m, shown).entry.correct, true);
  assert.deepEqual(Q.forPhone(m, Q.grade(m, shown).entry.value), shown);
  const sp = make({ type: 'spot', text: 'a', image: '/uploads/x.jpg', zone: { x: .1, y: .4, w: .8, h: .2 } });
  assert.ok(!JSON.stringify(Q.publicQuestion(sp, false)).includes('zone'), 'a zona não vai para o telemóvel');
  assert.equal(Q.grade(sp, [.5, .5]).entry.correct, true);
  assert.equal(Q.grade(sp, [.5, .1]).entry.correct, false);
  assert.ok(Q.grade(sp, ['x', 1]).error);
  assert.equal(make({ type: 'spot', text: 'a', image: 'https://fora.com/x.jpg', zone: { x: 0, y: 0, w: .5, h: .5 } }), null, 'imagem de fora é recusada');
});

test('votação, explicação e vários sítios na imagem', () => {
  const p = make({ type: 'mc', poll: true, text: 'Como faz os títulos?', options: ['a', 'b'] });
  assert.equal(Q.isGraded(p), false);
  assert.equal(Q.grade(p, 1).entry.correct, null, 'votação não tem certo nem errado');
  const m = make({ type: 'mc', text: 'x', options: ['Mito', 'Facto'], correct: [0], explain: 'porque sim' });
  assert.equal(Q.solutionOf(m).explain, 'porque sim');
  assert.ok(!JSON.stringify(Q.publicQuestion(m, false)).includes('porque sim'), 'a explicação só vai com a solução');
  const s = make({ type: 'spot', text: 'x', image: '/uploads/a.png', zones: [{ x: .1, y: .1, w: .1, h: .1, g: 1 }, { x: .1, y: .5, w: .1, h: .1, g: 1 }, { x: .6, y: .6, w: .1, h: .1 }] });
  assert.equal(Q.spotCount(s), 2, 'duas zonas do mesmo problema contam como um');
  assert.equal(Q.grade(s, [.15, .15, .15, .55]).entry.right, 1, 'tocar nas duas zonas do mesmo problema vale um');
  assert.equal(Q.grade(s, [.15, .55, .65, .65]).entry.correct, true);
  assert.ok(Q.grade(s, [.1, .1, .2, .2, .3, .3]).error, 'não pode tocar mais vezes do que há problemas');
});

test('batata quente, escala 1-10 e nota final', () => {
  const q = make({ type: 'potato', text: 'Batata', rounds: [{ theme: 'Atalhos', words: 'copiar/copia, colar, desfazer' }] });
  assert.ok(q && q.rounds[0].words.length === 3);
  assert.ok(!JSON.stringify(Q.publicQuestion(q, false)).includes('copiar'), 'as palavras aceites não vão para o telemóvel');
  assert.equal(Q.potatoCheck(q, 0, 'Cópia', []).ok, true, 'alternativa, sem acentos nem maiúsculas');
  assert.equal(Q.potatoCheck(q, 0, 'colares', []).ok, true, 'plural');
  assert.equal(Q.potatoCheck(q, 0, 'copiar', ['copiar']).reason, 'used', 'já dita');
  assert.equal(Q.potatoCheck(q, 0, 'imprimir', []).ok, false);
  const s = make({ type: 'scale', text: 'x', scaleTo: 10 });
  assert.equal(Q.grade(s, 10).entry.value, 10); assert.ok(Q.grade(s, 11).error);
  const qs = [make({ type: 'mc', text: 'a', options: ['x', 'y'], correct: [0] }), make({ type: 'fill', text: '[[a]] [[b]]' }), s, q];
  const ans = { 0: { u: { correct: true, frac: 1 } }, 1: { u: { correct: false, frac: 0.5 } }, 2: { u: { value: 3, correct: null } }, 3: { u: { points: 90, correct: true } } };
  assert.equal(Q.finalGrade(qs, ans, [0, 1, 2, 3], 'u'), 15, 'nota: (1 + 0,5) / 2 × 20; escala e batata não contam');
});
