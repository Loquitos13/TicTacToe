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
