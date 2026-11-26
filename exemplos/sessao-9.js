// Sessão 9 (19:00–23:00): perguntas, votações e jogos pela ordem da apresentação.
// node exemplos/sessao-9.js  → cria exemplos/sessao-9.json (um só questionário, pronto a importar)
const fs = require('fs'), path = require('path');
const img = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'folha-encomenda.png')).toString('base64');
const poll = (text, options, time = 60) => ({ type: 'mc', poll: true, text, options, correct: [], time });
const mc = (text, options, c, explain, time = 60) => ({ type: 'mc', text, options, correct: [c], time, ...(explain ? { explain } : {}) });
const mf = (text, c, explain) => mc('Mito ou facto? ' + text, ['Mito', 'Facto'], c, explain, 30);
const forca = (answer, hint) => ({ type: 'hangman', text: hint, answer, maxWrong: 6, time: 120 });

const questions = [
  // 19:04 · votação de diagnóstico
  poll('Quando tem de somar uma lista de valores, no trabalho ou em casa, o que costuma fazer?',
    ['Uso a calculadora e escrevo o resultado', 'Uso a folha de cálculo, com fórmulas', 'Uso a folha de cálculo, mas escrevo os totais à mão', 'Peço a alguém, ou não faço']),
  // 19:14 · dinâmica
  poll('Onde é que uma folha de cálculo lhe poupava mais tempo?',
    ['No orçamento e nas despesas da casa', 'No stock, nas encomendas e nos preços', 'Nos horários, escalas e presenças', 'Nas faturas e contas de clientes']),
  // 19:20 · quiz
  mc("Na coluna das quantidades escreveu 40 · 10 un. · 500 · '1. Quanto dá a soma da coluna?", ['551', '540', '541', 'Dá erro'], 2,
    "541. O «10 un.» e o '1 são texto, por isso a soma ignora-os."),
  // 19:25 · mito ou facto
  mf('Escrever 62.5, com ponto, é igual a escrever 62,5.', 0, 'É mito: com o local em Portugal, o ponto pode dar texto ou até uma data.'),
  mf('Se tirar as casas decimais, o valor fica arredondado nas contas.', 0, 'É mito: só muda o aspeto; nas contas entra o valor guardado.'),
  mf('Ao arrastar «janeiro», a folha escreve fevereiro, março…', 1, 'É facto: a série continua sozinha.'),
  mf('No Excel, uma célula com #### perdeu os dados.', 0, 'É mito: a coluna é estreita; basta alargá-la (duplo clique na divisória).'),
  // 19:47 · quiz
  mc('Escreve =5+2*3 e carrega em Enter. O que aparece?', ['21', '11', '=5+2*3', '30'], 1, '11, porque a multiplicação vem antes da soma.'),
  // 19:56 · quiz
  mc('Em C2 está =B2*$F$1. Copia a fórmula para C3. O que fica em C3?', ['=B2*$F$1', '=B3*$F$2', '=B3*$F$1', '=B3*F1'], 2, 'O B2 acompanha a linha e o $F$1 fica preso.'),
  // 20:10 · jogo: adivinhar a palavra (forca, 6 erros)
  forca('Célula', 'O encontro de uma coluna com uma linha, como B3'),
  forca('Fórmula', 'Começa sempre com o sinal de igual'),
  forca('Cifrão', 'O símbolo que prende a coluna ou a linha'),
  forca('Intervalo', 'De reserva · Células seguidas, escritas com dois pontos, como C2:C6'),
  // 21:38 · quiz
  mc('B2 tem 1300 e F1 tem 1300. O que mostra =SE(B2>F1;"Atingido";"Abaixo")?', ['Atingido', 'Abaixo', 'Dá erro, porque são iguais', 'VERDADEIRO'], 1,
    'Abaixo: 1300 não é maior do que 1300. Para incluir o valor igual, usa-se >=.'),
  // 21:41 · dinâmica: o que está mal nesta folha? (4 problemas)
  { type: 'spot', text: 'O que está mal nesta folha? Encontre os 4 problemas.', image: img, time: 120,
    zones: JSON.parse(fs.readFileSync(path.join(__dirname, 'folha-encomenda-zonas.json'), 'utf8')),
    explain: '1) «30 un.» é texto e a conta dá #VALUE! (#VALOR! no Excel) · 2) «11.2», com ponto, não é lido como número em Portugal · 3) =SOMAR dá #NAME? (#NOME? no Excel): a função é SOMA · 4) #DIV/0!: a quantidade é 0 e a fórmula divide por ela' },
  // 21:46 · quiz
  mc('Em D2 está =B2*C2. Alguém apaga a coluna C inteira. O que passa a mostrar a célula?', ['#DIV/0!', '#REF!', '#NAME?', '0'], 1, '#REF!: a referência perdeu-se. Anula-se com Ctrl+Z.'),
  // 22:12 · quiz
  mc('A IA deu =IF(D2<E2,"Encomendar","OK"). No Excel em português, o que deve fazer?',
    ['Copiar e colar, porque a IA não erra', 'Pedir a versão em português: =SE(D2<E2;"Encomendar";"OK")', 'Desistir da fórmula', 'Trocar só as vírgulas por pontos'], 1,
    'Pede-se a versão em português e testa-se numa linha em que já se sabe a resposta.'),
  // 22:16 · jogo: batata quente por equipas
  { type: 'potato', text: '🥔 Batata quente por equipas', time: 30, fuseMin: 30, fuseMax: 50, pts: 100, penalty: 50,
    rounds: [{ theme: 'Sessão 9 · revisão', questions: [
      { q: 'Onde se fixa a primeira linha no Google Sheets?', keys: ['ver fixar', 'fixar'], a: 'Ver › Fixar › 1 linha. No Excel, é Ver › Fixar Painéis.' },
      { q: 'Como se escreve o intervalo que vai de A2 até A10?', keys: ['A2:A10'], a: 'A2:A10' },
      { q: 'Diga três funções da mesma família da SOMA.', keys: ['média máximo', 'média mínimo', 'média contar', 'máximo mínimo', 'máximo contar', 'mínimo contar'], a: 'MÉDIA, MÁXIMO, MÍNIMO e CONTAR.' },
      { q: 'Que tecla põe os cifrões numa referência?', keys: ['F4', 'tecla F4'], a: 'F4, com o cursor em cima da referência.' },
      { q: 'Complete: =SE(C2<D2;"Encomendar";___)', keys: ['"OK"', 'ok'], a: '"OK"' },
      { q: 'Em português, que sinal separa os argumentos de uma função?', keys: ['ponto e vírgula', ';'], a: 'O ponto e vírgula (;).' },
      { q: 'Desempate · O filtro apaga as linhas que não aparecem?', keys: ['não', 'esconde', 'saltam'], a: 'Não, só as esconde, e os números das linhas saltam.' },
    ] }] },
  // 22:54 · quiz final
  mc('A taxa de IVA está em H1. Que fórmula se pode copiar para todas as linhas?', ['=D2*(1+H1)', '=D2*(1+$H$1)', '=D2*1,23', '=D2*(1+H$2)'], 1,
    'A C também dá o resultado certo, mas tem a taxa escrita dentro da fórmula.', 60),
  mc('Uma célula mostra #DIV/0!. O que aconteceu?', ['A coluna é estreita', 'A fórmula divide por zero ou por uma célula vazia', 'O nome da função está errado', 'O ficheiro está corrompido'], 1, null, 60),
  // 22:59 · votação final
  poll('Como avalia a sessão de hoje?', ['Muito útil', 'Útil', 'Pouco útil']),
  { type: 'cloud', text: 'Que fórmula vai usar esta semana? (ex.: SOMA, SE, MÉDIA)', words: 2, time: 60, options: [], correct: [] },
];
fs.writeFileSync(path.join(__dirname, 'sessao-9.json'), JSON.stringify({ title: 'Sessão 9 · Folha de cálculo (19:00–23:00)', questions }, null, 2));
console.log('ok', questions.length);
