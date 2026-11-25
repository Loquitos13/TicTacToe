// Conteúdo da sessão 9 (tema 13, Excel / Google Sheets) — usado para gerar os questionários de exemplo.
// node exemplos/excel-s9-dados.js  → cria os ficheiros excel-s9-*.json nesta pasta
const SEC = ['A folha por dentro', 'Fórmulas', 'Decidir, ordenar e filtrar'];

// Batata quente: pergunta · respostas aceites (alternativas) · explicação
const BATATA = [
  [ // Secção 1
    ['Como se chama o ficheiro de folha de cálculo, que pode ter várias folhas?', ['livro'], 'Livro. As folhas aparecem em separadores no fundo do ecrã.'],
    ['Qual é o endereço da célula da coluna C com a linha 4?', ['C4'], 'C4: primeiro a letra, depois o número.'],
    ['Como se escreve o intervalo que vai de A2 até A10?', ['A2:A10'], 'A2:A10, com dois pontos.'],
    ['Por defeito, para que lado encosta o texto? E os números e as datas?', ['esquerda direita'], 'O texto encosta à esquerda. Os números e as datas encostam à direita.'],
    ['Escreveu um número e ele ficou encostado à esquerda. Que sinal é esse?', ['texto'], 'A folha leu-o como texto, e ele não vai entrar nas contas.'],
    ['Alguém escreveu «40 un.» numa célula. A soma da coluna conta este valor?', ['não', 'texto'], 'Não, porque passou a texto. Na célula vai só o número, e a unidade vai para o título da coluna.'],
    ['Em Portugal, como se escreve sessenta e dois e meio numa célula?', ['62,5'], '62,5, com vírgula. Com ponto, pode ficar texto ou até virar data.'],
    ['A célula guarda 62,5, mas sem casas decimais mostra 63. Que valor entra nas contas?', ['62,5'], '62,5. O formato muda o aspeto, não o valor.'],
    ['Onde se escolhe o formato Moeda ou Percentagem no Google Sheets?', ['formatar número'], 'Formatar › Número.'],
    ['Escreve «janeiro» e arrasta o quadradinho azul para baixo. O que acontece?', ['fevereiro', 'série', 'continua'], 'A série continua: fevereiro, março, abril…'],
    ['Como se faz a série 1, 2, 3, 4…?', ['duas células', 'arrastar', 'arrasta', '1 e 2'], 'Escreve-se 1 e 2 em duas células, selecionam-se as duas e arrasta-se o quadradinho azul.'],
    ['Onde se fixa a primeira linha?', ['ver fixar', 'fixar painéis'], 'No Google Sheets, em Ver › Fixar › 1 linha. No Excel, em Ver › Fixar Painéis.'],
    ['No Excel, a célula mostra ####. Perdeu-se o número?', ['não', 'estreita', 'largura'], 'Não, a coluna é estreita demais. Um duplo clique na divisória entre as letras das colunas ajusta a largura.'],
    ['No Google Sheets, onde se confirma que a região é Portugal?', ['definições', 'local'], 'Ficheiro › Definições › Local.'],
  ],
  [ // Secção 2
    ['Por que sinal começa sempre uma fórmula?', ['=', 'igual'], 'Pelo sinal de igual (=).'],
    ['Quanto dá =5+2*3?', ['11', 'onze'], '11, porque a multiplicação faz-se antes da soma.'],
    ['Com 5, 2 e 3, como se escreve a fórmula para dar 21?', ['=(5+2)*3', '(5+2)*3'], '=(5+2)*3'],
    ['Que símbolo se usa para multiplicar? E para dividir?', ['asterisco barra', '* /', '*/', '* e /'], 'O asterisco (*) e a barra (/).'],
    ['Porque é melhor =B2*C2 do que =40*62,5?', ['atualiza', 'atualizam', 'muda', 'mudam'], 'Só a primeira se atualiza quando os valores mudam.'],
    ['Mudou o preço em C2. Tem de reescrever a fórmula do total?', ['não', 'sozinho'], 'Não, o total atualiza-se sozinho.'],
    ['Copia =B2*C2 de D2 para D3. Que fórmula fica em D3?', ['=B3*C3', 'B3*C3'], '=B3*C3. É a referência relativa.'],
    ['Qual é a fórmula que soma as células de D2 a D6?', ['=SOMA(D2:D6)', 'SOMA(D2:D6)'], '=SOMA(D2:D6)'],
    ['Diga três funções da família da SOMA.', ['média máximo', 'média mínimo', 'média contar', 'máximo mínimo', 'máximo contar', 'mínimo contar'], 'MÉDIA, MÁXIMO, MÍNIMO e CONTAR.'],
    ['Em português, que sinal separa os argumentos de uma função?', ['ponto e vírgula', ';'], 'O ponto e vírgula (;).'],
    ['A taxa de IVA está em H1. Copiou =D2*(1+H1) para baixo e o IVA desapareceu. Porquê?', ['$H$1', 'absoluta', 'vazia', 'H2'], 'A fórmula passou a apontar para H2, que está vazia. Era preciso escrever $H$1.'],
    ['O que faz o cifrão em $H$1?', ['prende', 'fixa', 'absoluta', 'bloqueia'], 'Prende a referência, que passa a ser absoluta.'],
    ['Que tecla põe os cifrões?', ['F4', 'tecla F4'], 'F4, com o cursor em cima da referência.'],
    ['Dê um exemplo de célula que deve ter referência absoluta.', ['taxa', 'objetivo', 'preço', 'IVA'], 'Uma taxa, um objetivo ou um preço fixo.'],
  ],
  [ // Secção 3
    ['Diga os seis comparadores.', ['> < >= <= = <>', '><>=<==<>', 'maior menor igual diferente'], '> < >= <= = <>'],
    ['Como se escreve «diferente»?', ['<>'], '<>'],
    ['O stock é 6 e o mínimo é 12. O que dá =6<12?', ['verdadeiro', 'true'], 'Verdadeiro. No Google Sheets aparece TRUE.'],
    ['Quantas partes tem a função SE e o que as separa?', ['três', '3', 'ponto e vírgula'], 'Três (o teste, o resultado se for verdadeiro e o resultado se for falso), separadas por ponto e vírgula.'],
    ['Complete: =SE(C2<D2;"Encomendar";___)', ['"OK"', 'ok'], '"OK"'],
    ['Porque é que «Encomendar» vai entre aspas?', ['texto'], 'Porque é texto.'],
    ['O stock de um artigo muda amanhã. É preciso voltar a comparar à mão?', ['não', 'sozinha'], 'Não, a palavra muda sozinha.'],
    ['O que quer dizer #DIV/0!?', ['divisão por zero', 'zero', 'vazia'], 'Divisão por zero ou por uma célula vazia.'],
    ['Escreveu =SOMAR(D2:D6) e apareceu #NAME? (#NOME? no Excel). Porquê?', ['mal escrito', 'nome errado', 'soma', 'aspas'], 'O nome da função está mal escrito: é SOMA. Este erro também aparece quando falta pôr aspas num texto.'],
    ['O que quer dizer #VALUE! (#VALOR! no Excel)?', ['texto'], 'A conta tem texto pelo meio.'],
    ['O que quer dizer #REF!?', ['apagada', 'apagou', 'apagaram', 'eliminada'], 'A fórmula apontava para uma célula que foi apagada.'],
    ['Selecionou só a coluna do stock e ordenou. O que correu mal?', ['nomes', 'errada', 'desalinhada', 'baralhou'], 'Os números mudaram de lugar e os nomes não, por isso a lista ficou errada.'],
    ['Para ordenar bem, o que se seleciona e que opção se marca?', ['tabela toda', 'cabeçalho'], 'Seleciona-se a tabela toda e marca-se «Dados com linha de cabeçalho».'],
    ['Onde se cria um filtro?', ['dados criar filtro', 'dados'], 'Dados › Criar um filtro.'],
    ['O filtro apaga linhas? Como se percebe?', ['não', 'esconde', 'saltam'], 'Não, só as esconde. Percebe-se porque os números das linhas saltam.'],
    ['O que fazer ao filtro antes de partilhar o ficheiro?', ['remover', 'remove', 'tirar', 'retirar'], 'Removê-lo, em Dados › Remover filtro.'],
  ],
];

// Adivinha a palavra / forca: palavra · dica (por secção)
const PALAVRAS = [
  [['Livro', 'O ficheiro da folha de cálculo, com várias folhas'], ['Célula', 'O encontro de uma coluna com uma linha, como B3'], ['Intervalo', 'Células seguidas, escritas com dois pontos, como C2:C6'],
   ['Vírgula', 'Em Portugal, separa as casas decimais'], ['Formato', 'Muda o aspeto do número, mas não o valor guardado'], ['Percentagem', 'Formato que mostra 0,23 como 23 %'],
   ['Moeda', 'Formato que mostra o símbolo do euro'], ['Preenchimento', 'Arrastar o quadradinho azul faz o … automático'], ['Fixar', 'Ver › ____ › 1 linha'], ['Cardinais', 'No Excel, aparecem quando a coluna é estreita demais (####)']],
  [['Fórmula', 'Começa sempre com o sinal de igual'], ['Asterisco', 'O operador da multiplicação'], ['Parênteses', 'Mudam a ordem das contas'], ['Referência', 'B2 numa fórmula, em vez de escrever o número'],
   ['Relativa', 'Referência que se ajusta sozinha ao copiar'], ['Absoluta', 'Referência presa, que não muda ao copiar'], ['Cifrão', 'O símbolo que prende a coluna ou a linha: $'],
   ['Soma', 'Função que adiciona os valores de um intervalo'], ['Média', 'Função que calcula o valor médio'], ['Máximo', 'Função que devolve o maior valor'], ['Mínimo', 'Função que devolve o menor valor'], ['Contar', 'Função que conta as células com números']],
  [['Comparador', 'Maior, menor, igual ou diferente'], ['Verdadeiro', 'O resultado de =6<12'], ['Falso', 'O resultado de =12<6'], ['Aspas', 'Envolvem o texto dentro de uma fórmula'],
   ['Encomendar', 'O que a função SE escreve quando o stock é menor do que o mínimo'], ['Ordenar', 'Dados › ________ intervalo'], ['Cabeçalho', 'A linha dos títulos, que não deve ir parar ao meio da lista'],
   ['Filtro', 'Mostra só as linhas que interessam, sem apagar nada'], ['Esconde', 'O filtro não apaga, só …']],
];

// Letras baralhadas: palavra · dica curta
const LETRAS = [
  ['Livro', 'Ficheiro com várias folhas'], ['Célula', 'Coluna com linha, como B3'], ['Intervalo', 'Escreve-se com dois pontos'], ['Vírgula', 'Separa as casas decimais'], ['Formato', 'Muda o aspeto, não o valor'],
  ['Percentagem', '0,23 aparece como 23 %'], ['Moeda', 'Formato com o símbolo do euro'], ['Preenchimento', 'O quadradinho azul continua a série'], ['Fixar', 'Ver › ____ › 1 linha'], ['Cardinais', '#### no Excel'],
  ['Fórmula', 'Começa com ='], ['Asterisco', 'Multiplicar'], ['Parênteses', 'Mudam a ordem das contas'], ['Referência', 'B2 em vez do número'], ['Relativa', 'Ajusta-se ao copiar'], ['Absoluta', 'Não muda ao copiar'],
  ['Cifrão', '$'], ['Soma', 'Adiciona um intervalo'], ['Média', 'O valor médio'], ['Máximo', 'O maior valor'], ['Mínimo', 'O menor valor'], ['Contar', 'Conta as células com números'],
  ['Comparador', '> < = <>'], ['Verdadeiro', '=6<12'], ['Falso', '=12<6'], ['Aspas', 'Envolvem o texto'], ['Encomendar', 'O que o SE escreve quando falta stock'], ['Ordenar', 'Dados › ________ intervalo'],
  ['Cabeçalho', 'A linha dos títulos'], ['Filtro', 'Mostra só o que interessa'], ['Esconde', 'O filtro não apaga, só…'],
];

// Palavras cruzadas (sem acentos nem cedilha), em duas grelhas para caberem bem no telemóvel
const CRUZADAS = [   // (ordem escolhida para a grelha ficar compacta: 10×11 e 9×12)
  ['Palavras cruzadas · A folha por dentro', [['Ordenar', 'Dados › ________ intervalo'], ['Celula', 'Encontro de uma coluna com uma linha, como B3'], ['Virgula', 'Em Portugal, separa as casas decimais'],
    ['Formato', 'Muda o aspeto do número, mas não o valor guardado'], ['Fixar', 'Ver › ____ › 1 linha'], ['Livro', 'O ficheiro da folha de cálculo, com várias folhas'], ['Intervalo', 'Conjunto de células seguidas, como C2:C6']]],
  ['Palavras cruzadas · Fórmulas e filtros', [['Cabecalho', 'A linha dos títulos, que não deve ir para o meio ao ordenar'], ['Media', 'Função que calcula o valor médio'], ['Soma', 'Função que adiciona os valores de um intervalo'],
    ['Formula', 'Começa sempre com o sinal de igual'], ['Cifrao', 'Prende a coluna ou a linha numa referência'], ['Filtro', 'Mostra só as linhas que interessam, sem apagar nada'],
    ['Asterisco', 'Operador da multiplicação'], ['Aspas', 'Envolvem o texto dentro de uma fórmula']]],
];

if (require.main === module) {
  const fs = require('fs'), path = require('path'), out = (f, o) => fs.writeFileSync(path.join(__dirname, f), JSON.stringify(o, null, 2));
  out('excel-s9-batata-quente.json', { title: 'Excel S9 · Batata quente', questions: [{
    type: 'potato', text: '🥔 Batata quente · Excel: respondam à pergunta e passem a batata!', time: 30, fuseMin: 45, fuseMax: 75, pts: 100, penalty: 50,
    rounds: BATATA.map((qs, k) => ({ theme: `Secção ${k + 1} · ${SEC[k]}`, questions: qs.map(([q, keys, a]) => ({ q, keys, a })) })) }] });
  out('excel-s9-adivinha.json', { title: 'Excel S9 · Adivinha a palavra', questions: PALAVRAS.flatMap((ws, k) => ws.map(([answer, hint]) => ({ type: 'guess', text: `${hint} (Secção ${k + 1})`, answer, maxTries: 6, time: 120 }))) });
  out('excel-s9-letras.json', { title: 'Excel S9 · Letras baralhadas', questions: LETRAS.map(([answer, hint]) => ({ type: 'scramble', text: hint, answer, time: 40 })) });
  out('excel-s9-cruzadas.json', { title: 'Excel S9 · Palavras cruzadas', questions: CRUZADAS.map(([text, ws]) => ({ type: 'cross', text, entries: ws.map(([word, clue]) => ({ word, clue })), time: 240 })) });
  if (process.argv.includes('--forca')) out('excel-s9-forca.json', { title: 'Excel S9 · Jogo da forca', questions: PALAVRAS.flatMap((ws, k) => ws.map(([answer, hint]) => ({ type: 'hangman', text: `${hint} (Secção ${k + 1})`, answer, maxWrong: 7, time: 120 }))) });
  console.log('ok');
}
module.exports = { SEC, BATATA, PALAVRAS, LETRAS, CRUZADAS };
