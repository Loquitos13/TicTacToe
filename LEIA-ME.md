# Quiz ao vivo 🎮 — quiz ao vivo para formações

O formador controla o ritmo no ecrã/projetor e os alunos respondem no telemóvel (entram pelo QR code).
No fim há uma **grelha com todas as perguntas, a resposta correta e o que cada aluno respondeu**, que podes exportar para Excel ou imprimir em PDF.

## 1. Instalar (uma vez)
Precisas do [Node.js](https://nodejs.org) (versão 18 ou mais recente). Na pasta do projeto:

```bash
npm install
```

## 2. Arrancar
```bash
npm start
```
**Palavra-passe do formador:** não há nenhuma por omissão. No primeiro arranque é gerada uma aleatória (ex.: `9a6e-zq85-5mgs`), que aparece no terminal e fica guardada em `data/palavra-passe-formador.txt`.
Para usares a tua (mínimo 8 caracteres):
```bash
HOST_PASSWORD=aMinhaPassSegura npm start
```
No Windows (PowerShell): `$env:HOST_PASSWORD="aMinhaPassSegura"; npm start`
No Windows (Linha de Comandos / cmd): `set HOST_PASSWORD=aMinhaPassSegura` e depois `npm start`

**Se o servidor fechar a meio** (janela fechada, portátil a dormir), volta a correr `npm start`: a sessão que estava a decorrer é retomada e os telemóveis voltam a entrar sozinhos. Uma pergunta que estava aberta fica fechada (avanças para a sondagem como sempre).
Se `data/db.json` ficar estragado (ex.: editado à mão com um erro), a app **não arranca** e diz porquê, em vez de o substituir — corrige-o ou repõe uma cópia.

Segurança:
- A palavra-passe nunca vai no endereço das páginas (só em cabeçalhos), por isso não fica no histórico do browser.
- As tentativas de palavra-passe de cada computador são vistas uma de cada vez, com 1,5 s de espera depois de cada erro (menos de 1 por segundo, mesmo atacando em paralelo). O teu computador nunca fica à espera por causa de outro, por isso ninguém te consegue bloquear.
- Um pedido forjado (de quem quer que seja) nunca deita o servidor abaixo: recebe "Pedido inválido".
- **Sessão do formador:** a palavra-passe só é enviada no login; depois o painel usa um código de sessão aleatório que expira em 12 horas (se o servidor reiniciar, voltas a escrever a palavra-passe).
- **Injeção de código (XSS):** além de todo o texto dos alunos aparecer só como texto, o browser só corre o código dos ficheiros da app (política de segurança de conteúdo); código injetado é recusado e nada pode ser enviado para outros sites. Imagens de perguntas só da própria app (as que carregas no editor).
- **Quem tenta esgotar o servidor:** cada computador tem limites de pedidos por segundo, de ligações abertas e de mensagens por ligação, folgados para uma turma inteira atrás do mesmo router. Corpos grandes só depois de confirmar o formador; pedidos deixados pendurados de propósito são fechados; fotografias têm de ser mesmo imagens. Testado: com um atacante a fazer 250 mil pedidos, 400 ligações, rajadas de mensagens e pedidos pendurados, uma turma de 30 continuou a responder em ~20 ms.
- **Ataques em grande escala (DDoS com milhares de computadores)** não se travam dentro de uma app: na rede da sala não há exposição à internet; pela internet, usa o túnel da Cloudflare, que absorve esse tipo de ataque antes de chegar ao teu computador.
- No Excel, respostas que começam por `=`, `+`, `-` ou `@` ficam como texto (não viram fórmulas).
- Os alunos nunca recebem a resposta correta, a pontuação, o nº de certas nem a posição da pergunta em curso antes de mostrares a resposta correta.

- **Formador:** http://localhost:3000/host.html
- **Alunos:** o endereço que aparece no QR code

## 3. Preparar
1. **👥 Alunos** — adiciona nome + fotografia (um a um, várias fotos de uma vez em que o nome do ficheiro passa a ser o nome, ou uma lista de nomes colada).
2. **📝 Questionários** — cria primeiro um **curso** (ex.: "Técnico de Vendas") e depois os questionários desse curso (cada curso pode ter vários, ex.: "Módulo 1", "Avaliação final"). Um questionário pode mudar de curso no editor; um curso só pode ser apagado quando já não tiver questionários.
   Cada pergunta tem um **tipo** (escolhe no topo da pergunta), tempo próprio e imagem opcional:
   | Tipo | Como se responde | Correção |
   |---|---|---|
   | **Escolha múltipla** | 2 a 6 opções (A–F) | uma ou mais corretas |
   | **Verdadeiro / Falso** | dois botões | marcas qual é a certa |
   | **Completar espaços** | a frase tem espaços; o formando toca nas palavras para os preencher | cada palavra certa entre `[[ ]]`, ex.: `A capital é [[Lisboa]].` + palavras extra para baralhar. Pontos proporcionais às palavras certas |
   | **Resposta livre** | escreve o texto | **validada sempre por ti, uma a uma**, nos resultados; tem de ter uma **resposta de referência** (obrigatória), que aparece na lista de soluções e quando validas |
   | **Escala 1–5** | botões 1 a 5 (com legenda opcional) | opinião: sem resposta certa nem pontos; mostra a média |
   | **☁️ Nuvem de palavras** | escreve 1 a 3 palavras (escolhes quantas) | a nuvem cresce **em direto** no projetor: as palavras ficam espalhadas à volta do centro, a mais escrita fica ao meio e cada palavra cresce (com animação) à medida que mais pessoas a escrevem (maiúsculas e acentos não contam: "Confiança" = "confianca"). Sem resposta certa nem pontos |
   | **🔢 Ranking de opções** | toca nas opções pela ordem (1º, 2º, 3º…); tocar numa numerada tira-a; a última entra sozinha | **com "ordem certa"**: escreves as opções pela ordem correta, os formandos veem-nas baralhadas e ganham pontos por cada posição certa (ex.: "3 de 5 no lugar certo"). **Sem ordem certa** é uma opinião (prioridades, temas preferidos): o projetor mostra a ordem média da turma |
   | **🔤 Letras baralhadas** | vê as letras baralhadas e toca nelas pela ordem para formar a palavra (tocar numa casa devolve a letra) | a pergunta é a **pista**; escreves a palavra (pode ter duas, ex.: "pós venda"). O projetor mostra as mesmas letras baralhadas. Acentos e maiúsculas não contam |
   | **✏️ Palavras cruzadas** | grelha + pistas: toca numa pista (ou numa casa) e escreve a palavra; as letras aparecem na grelha | escreves as **palavras e as pistas** e a grelha **monta-se sozinha** (pré-visualização no editor; avisa se alguma palavra não cruza). Pontos por cada palavra certa (ex.: "3 de 5"). No projetor aparece a grelha com as pistas e, na resposta, a grelha resolvida e quantos acertaram cada palavra |
   | **🟩 Adivinha a palavra** | escreve palavras com o mesmo nº de letras no teclado do jogo; cada letra fica **verde** (sítio certo), **laranja** (existe noutro sítio) ou **vermelha** (não existe) | escolhes a palavra secreta (3 a 12 letras) e o nº de tentativas (3 a 8). Mais pontos com menos tentativas (tudo à 1ª, metade na última). A palavra **nunca vai para o telemóvel**: cada tentativa é avaliada no servidor. No projetor vês o quadro de cada um só com as cores (sem letras) e, no fim, em que tentativa acertaram |
   | **🥔 Batata quente** (jogo em grupo) | só o **representante da vez** escreve uma palavra do tema (o representante roda pelos membros do grupo, de forma equilibrada); os colegas veem de quem é a vez e ajudam | escreves as **rondas**: um tema e as palavras aceites, separadas por vírgulas (acentos, maiúsculas e plural não contam; `a/b` são alternativas). Palavra aceite: o grupo ganha pontos (mais quanto mais tempo faltar para rebentar) e a batata passa ao grupo seguinte. O **rastilho nunca volta ao início**. Quando rebenta, o grupo que a tem perde pontos (nunca abaixo de 0) e começa a ronda seguinte. Palavras repetidas não contam; palavras boas que não estavam na lista aceitam-se no projetor (✔ Aceitar). Funciona com equipas (sem equipas, cada formando joga por si) e só com tempo por pergunta |
   | **🔢 Adivinhar um número** | escolhe um número numa barra (ou com − / +); começa em "?" para não dar a resposta de bandeja | defines mínimo, máximo, resposta e passo. Em cheio ganha tudo; perto ganha parte (menos quanto mais longe). No projetor vês quantos escolheram cada número e a média |
   | **🔗 Correspondência** | para cada item toca na letra da opção certa (cada letra só pode ser usada uma vez; o último liga-se sozinho) | escreves os pares (2 a 6): item → opção certa. As opções aparecem baralhadas e os pares certos **nunca vão para o telemóvel**. Pontos por cada ligação certa |
   | **🎯 Encontrar na imagem** | toca no sítio da imagem e confirma | carregas a imagem e **arrastas por cima dela** para marcar a zona certa (retângulo verde). A zona nunca vai para o telemóvel. No fim, o projetor mostra onde cada um tocou (verde = dentro, vermelho = fora) |

   Podes colar várias perguntas de uma vez em texto (uma por bloco, separadas por linha em branco):
   ```
   Qual é a capital de Portugal? [20s]
   Porto
   *Lisboa
   Coimbra

   O sol é uma estrela.
   *Verdadeiro
   Falso

   A capital de Portugal é [[Lisboa]] e fica junto ao rio [[Tejo]].
   Porto, Douro, Mondego

   Dá um exemplo de escuta ativa. [livre]
   *Ouvir com atenção e mostrar que se percebeu

   Diz uma cor da bandeira. [livre]
   *verde ou vermelho      (resposta de referência, obrigatória)

   Gostaste da formação? [escala]
   1=Nada
   5=Muito
   
   O que faz um bom vendedor? [nuvem]

   Ordena as etapas da venda [ordenar]
   Preparação
   Abordagem
   Fecho

   Que tema queres aprofundar? [ranking]
   Negociação
   Objeções
   Pós-venda

   Quem compra o produto? [letras]
   Cliente

   Palavras cruzadas: vendas [cruzadas]
   Cliente = Quem compra
   Fecho = Fim da venda
   Valor = Benefício percebido

   Benefício que o cliente percebe [adivinha]
   Valor
   ```

**🕶️ Questionário anónimo:** no editor, liga **Respostas anónimas** (ex.: inquéritos de satisfação). Ao abrir a sala aparece o aviso e não é preciso escolher formandos. Os formandos entram só com o QR code e carregam em **Entrar** — sem nome nem fotografia; cada telemóvel aparece como "Anónimo #código". A app não guarda nomes, fotos nem qualquer ligação à lista da turma, por isso ninguém (nem tu) sabe quem respondeu o quê. Não há ranking, pódio nem fotos de quem respondeu; a grelha, as fichas, o Excel, a validação das respostas livres e a lista de soluções funcionam por participante anónimo.

**📋 Lista de soluções:** em Questionários, o botão **📋 Soluções** de cada questionário mostra todas as perguntas com a resposta correta **destacada a verde**: todas as opções (a correta marcada), a frase completa nos espaços, a resposta de referência das respostas livres e a escala 1–5 com as legendas. Podes **imprimir / guardar PDF** ou descarregar em **Word** (A4 vertical).

**🙋 Alunos sem registo.** Não é obrigatório registar os alunos antes. Ao abrir a sala, a opção **"Deixar entrar quem não está na lista"** vem ligada.

Com ela ligada, pode abrir a sala sem alunos registados ou sem marcar ninguém. Quem entra:
- **Não está registado:** escreve o nome no telemóvel e pode tirar a fotografia.
- **Está registado mas não foi marcado:** entra com a ficha dele, incluindo a fotografia.
- **Nome já usado por outra pessoa:** é-lhe pedido o apelido.

Nos resultados, quem não estava marcado aparece como "(extra)". Se a desligar, só entram os alunos marcados.

**🔁 Voltar ao lugar sem código.** Se um formando fechar o browser, mudar de app ou abrir o QR code noutra aplicação, basta escrever outra vez o nome: volta ao seu lugar, com os pontos e as respostas. Isto só não acontece se o outro telemóvel ainda estiver com a app à vista; nesse caso aparece "já está ligado noutro dispositivo" e ninguém tira o lugar a quem está a jogar. O código de reentrada (👥 Alunos) continua disponível, também no diapositivo do PowerPoint.

**📱 QR code em todas as perguntas.** Durante as perguntas e os resultados aparece um QR code pequeno no canto, com o código da sessão, para quem saiu ou chegou atrasado. Liga-se e desliga-se no interruptor **QR** da barra de baixo, também no diapositivo.

> **Nomes parecidos.** Se na turma houver um "Rui" e um "Rui Santos", quem escreve "Rui Santos" entra sempre como Rui Santos (ganha o nome mais completo). Se alguém escrever só "Rui" (maiúsculas e acentos não contam) e já tiver entrado um Rui, o telemóvel explica, por baixo do campo, que já entrou um "Rui" e pede para escrever mais alguma coisa do nome (o apelido) — ou, se for o próprio e mudou de telemóvel, para pedir o código de reentrada.


**Votação:** numa escolha múltipla, liga **📊 Votação (sem resposta certa)** para diagnósticos e opiniões ("Como faz os títulos?"). Mostra os votos, não dá pontos e ninguém fica "errado".

**Explicação:** em cada pergunta com resposta certa há um campo **💡 Explicação** (opcional). Aparece com a resposta certa, no projetor e nos telemóveis. Por exemplo: "É mito: usa-se o espaçamento antes e depois do parágrafo."

**Encontrar vários sítios na imagem:** no "🎯 Encontrar na imagem", cada arrasto acrescenta uma zona (até 8 problemas). Os formandos tocam em tantos sítios quantos os problemas e ganham pontos por cada um encontrado ("3 de 5"). Tocar num ponto tira-o. Se o mesmo problema aparece em vários sítios (por exemplo, títulos feitos à mão), as zonas desse problema contam como um só; isso define-se no ficheiro JSON com `"g"` (veja o exemplo `exemplos/formatacao-votacoes-quizzes.json`).

**Exemplos prontos:** `exemplos/formatacao-votacoes-quizzes.json` (15 perguntas: votações, mito ou facto, os 5 problemas, quiz final) e `exemplos/formatar-documentos.json` (8 perguntas sobre formatação de documentos, com todos os tipos novos). Em ❓ Questionários → **Importar JSON** no curso que quiseres. A imagem da pergunta 3 é `exemplos/regulamento-ferias.png`, com a zona do parágrafo cinzento já marcada; para usar outra, edita a pergunta, remove a imagem, carrega a tua e marca a zona.

**Escala:** pode ser de **1 a 5** ou de **1 a 10** (escolhe-se na pergunta).

**🎓 Avaliação final:** ao abrir a sala, ligue **"🎓 Avaliação final"**. Depois escolha:
- **⏱ Tempo por pergunta:** passado o tempo de cada pergunta, já não se responde.
- **⏳ Tempo geral:** cada um ao seu ritmo; pode voltar atrás, rever e mudar as respostas até acabar o tempo.
- **Mostrar as respostas certas no fim** (ou não).
- **Mostrar a nota** a cada formando no fim (ou não), na escala que escolher:
  - **0 a 20 valores**;
  - **0 a 100 %**;
  - **qualitativa**: Insuficiente (menos de 50 %), Suficiente (50 a 69 %), Elevado (70 a 89 %) ou Excelente (90 % ou mais).

Durante a avaliação os telemóveis não mostram certo/errado. A nota é a média das perguntas com resposta certa: as meio certas contam a parte certa, e opiniões, votações e jogos ao vivo não contam. A grelha de resultados e o Excel têm sempre a coluna **Nota**. Pode juntar no mesmo questionário perguntas e jogos (cruzadas, adivinha, correspondência, encontrar na imagem, batata quente…). Exemplo pronto: `exemplos/avaliacao-final-formatacao.json`.

## 4. Durante a sessão
**🎮 Jogo**: escolhe o curso, o questionário e os alunos e clica em **Abrir sala**. Aparece o QR code.
Cada sala aberta tem um **código único** (ex.: `K7P4QX`), que vai dentro do QR code e aparece por baixo dele. Sem o código certo não se entra, e o código de uma sessão anterior deixa de funcionar.

Os alunos leem o QR e **escrevem o nome completo** (sem precisar de acentos nem maiúsculas). Quem é quem decide-o sempre o sistema, a partir da lista que tu registaste; o formando nunca escolhe.

Regra de identificação (nomes comparados sem maiúsculas nem acentos):
1. Usa o **primeiro nome**.
2. Se houver outro formando com o mesmo primeiro nome, usa **primeiro + último nome** (nos dois).
3. Se mesmo assim forem iguais, acrescenta **os nomes do meio**, um a um, até ficarem diferentes.

Exemplo com Ana Maria Silva, Ana Rita Silva, Ana Costa e João Gonçalves:

| Formando | Identificado por | Aceita | Não aceita |
|---|---|---|---|
| João Gonçalves | João | "joao goncalves", "João" | — |
| Ana Costa | Ana Costa | "ana costa" | "Ana" |
| Ana Maria Silva | Ana Maria Silva | "Ana Maria Silva" | "Ana Silva" |
| Ana Rita Silva | Ana Rita Silva | "ana rita silva" | "Ana Silva" |

- O nome que identifica cada formando é o que aparece nos cartões da sala e no pódio; a grelha e o Excel mostram sempre o nome completo.
- Se o nome já tiver entrado noutro telemóvel, a entrada é recusada (só volta com o código de reentrada que tu dás).
- Se o nome não estiver na lista, o formando é avisado para falar contigo: em **👥 Alunos** (barra de baixo) podes acrescentá-lo à sessão na hora.
- Na lista de alunos não é possível ter dois alunos com o mesmo nome completo.
- A lista da turma e as fotografias nunca são mostradas a quem entra.

**Fotografia (opcional, decide o formando):** depois de escrever o nome, quem ainda não tem fotografia vê "Queres pôr a tua fotografia?".
- **Tirar fotografia:** o telemóvel pede autorização para usar a câmara; a imagem aparece num quadro com um círculo para centrar a cara. Depois de tirar, aparece a foto num círculo (e no boneco) tal como vai ficar, com o botão **🔄 Repetir** ao lado. Pode **usar esta fotografia** ou **não querer fotografia**.
- **Escolher da galeria:** em qualquer passo pode, em vez disso, escolher uma fotografia já guardada no telemóvel ou no computador. Na pré-visualização tem, ao lado do círculo, **🔄 Repetir** (câmara) e **📁 Galeria** (escolher outra).
- **Agora não:** entra logo na sala de espera, com as iniciais.
- Aceita fotografias do iPhone (**HEIC/HEIF**), além de JPG, PNG, WebP e GIF; são convertidas na própria app (também nas fotos que tu adicionas na lista de alunos).
- A fotografia só é usada nesta sessão (não muda a ficha do aluno) e substitui logo as iniciais no teu ecrã.
- A câmara dentro da página só funciona em **https** (ex.: com o túnel `cloudflared`) ou em `localhost`. Numa ligação `http://` pela rede local, a app abre automaticamente a câmara do próprio telemóvel em alternativa.

Ao abrir a sala escolhes **como avançam as perguntas** (vale para o quiz inteiro):
- **🎮 Manual** — a pergunta fica aberta até tu carregares em `Fechar respostas`.
- **⏱ Por tempo** — cada pergunta tem tempo limite (o de cada pergunta ou um tempo igual para todas). Quando chega a 0 (ou todos respondem) deixa de aceitar respostas e passa sozinha para a sondagem.
- **🤖 Totalmente automático** — tudo por tempo: tempo para responder, sondagem, resposta correta e ranking (segundos configuráveis ao abrir a sala), passagem para a pergunta seguinte e pódio final. Só carregas em `Começar`. Durante o quiz tens **⏸ Pausar / ▶ Retomar**, e o botão amarelo avança logo se não quiseres esperar.

- **⏳ Tempo total (cada um ao seu ritmo)** — escolhes os minutos para o questionário inteiro. Cada formando recebe todas as perguntas no telemóvel: responde ao seu ritmo (passa sozinho para a próxima sem resposta), pode voltar atrás e mudar respostas, e no fim carrega em **Entregar** (vê quais ficaram por responder). Quando o tempo acaba, tudo fica entregue; se todos entregarem antes, termina logo. No projetor aparecem o relógio e o progresso de cada formando; tens **＋1 min** e **Terminar agora**. Neste modo não há sondagem, resposta correta nem ranking entre perguntas, e cada resposta certa vale 1000 pontos.

Escolhes, com duas opções independentes, se os formandos veem as respostas corretas:
- **Depois de cada pergunta** — cada um vê no telemóvel se acertou e qual era a correta. Se desligares, não há esse passo: depois da sondagem segue logo para a pergunta seguinte, e o telemóvel não mostra certo/errado nem pontuação durante o quiz.
- **Todas no fim** — no fim, cada formando vê a lista de todas as perguntas com a resposta correta e a sua, e tu tens o botão **📋 Mostrar respostas corretas** para as projetar. Se desligares, no fim o telemóvel mostra só "📨 Respostas enviadas!" e quantas perguntas respondeu.

Em qualquer caso **tu continuas a ver tudo**: liga **👁 Ver respostas corretas** na barra de baixo no teu portátil ou telemóvel (a opção correta fica marcada com ✔ na sondagem) (fica guardado só nesse dispositivo; deixa desligado no ecrã projetado) e tens sempre a grelha de resultados. Não há ranking depois de cada pergunta, porque mostraria quem acertou.
Dica: podes abrir o painel do formador ao mesmo tempo no projetor e no teu telemóvel.

**📱 Esconder as perguntas nos telemóveis** (opcional): a pergunta e as opções só aparecem no **teu ecrã**, que tem de estar projetado ou visível para todos. Nos telemóveis aparece "👀 A pergunta e as opções estão no ecrã do formador — responde aqui com a letra" e só os botões **A, B, C, D** (também no fim, a lista de respostas corretas mostra só as letras). O texto das perguntas nem sequer é enviado para os telemóveis, por isso as capturas de ecrã ficam sem conteúdo útil. No teu ecrã aparece o aviso "As perguntas só aparecem neste ecrã — mantém-no projetado". Não se aplica ao modo "Tempo total".

Escolhes se queres **mostrar a sondagem** (barras com quantos escolheram cada opção). Sem sondagem, quando as respostas fecham aparece só "🔒 Respostas fechadas" e quantos responderam; a resposta correta é destacada sem números. Podes ligar/desligar a sondagem a qualquer momento na barra de baixo.

E escolhes o **ranking**:
- **Depois de cada pergunta e pódio final** (Top 5 com bonecos a dançar);
- **Só o pódio final**;
- **Sem ranking** — não há Top 5 nem pódio, e os formandos não recebem a sua posição (só a pontuação e o nº de respostas certas).

**👥 Jogos em grupo (equipas):** ao abrir a sala liga **Jogar em equipas** e escolhe 2 a 6 equipas (Vermelha, Azul, Verde, Amarela, Roxa, Laranja).
- Cada formando entra na equipa com menos gente; o telemóvel mostra a cor da equipa e os colegas.
- Na sala de espera vês uma coluna por equipa: **🔀 Baralhar equipas** volta a distribuir toda a gente ao acaso (equilibrado) e **tocar num formando** muda-o para a equipa seguinte.
- Cada um responde no seu telemóvel. A pontuação da equipa é a **média** dos pontos dos membros, por isso é justo mesmo com equipas de tamanhos diferentes.
- O ranking entre perguntas e o pódio final passam a ser **por equipas** (mascotes com as cores da equipa a dançar e os membros por baixo). O telemóvel mostra o lugar da equipa e o seu.
- Nos resultados aparece o resumo das equipas, a equipa de cada formando na grelha e no Excel.
- Não existe com "Sem ranking" nem no questionário anónimo.

Depois de uma pergunta de **opinião** (escala, nuvem ou ranking sem ordem certa) não aparece o Top 5, porque ninguém ganha pontos: segue logo para a próxima pergunta.

Cada pergunta passa por estes passos (o botão amarelo, ou **espaço / →**, avança):
1. **Prepara-te 3-2-1** — a pergunta aparece no ecrã e nos telemóveis, ainda sem opções.
2. **Pergunta aberta** — os alunos respondem; vês quantos já responderam.
3. **📊 Sondagem** — quantas pessoas escolheram cada opção (ainda sem dizer qual é a certa).
4. **✅ Resposta correta** — só agora cada aluno vê no telemóvel se acertou e, se errou, qual era a correta.
5. **🏆 Ranking Top 5** (opcional) — pódio de 5 lugares com bonecos a dançar com a foto de cada aluno.

No fim aparece o **pódio final animado** (do 5º para o 1º, com rufar de tambores e confettis) e o botão `Ver grelha de resultados`.

Opções que podes ligar/desligar a qualquer momento:
- **Quem respondeu**: aparecem as fotografias dos alunos em cada opção (vem desligado, porque é uma avaliação).
- **Ranking por pergunta**: mostra (ou não) o pódio Top 5 depois de cada pergunta (não aparece se escolheste "Sem ranking").

Se um aluno se enganou no nome, pode carregar em **Não sou …** no ecrã de espera (só antes de responder à primeira pergunta).
Se um aluno mudou de telemóvel: **👥 Alunos** (na barra de baixo) → **Libertar nome**. Aparece um **código de reentrada** de 6 dígitos; o aluno escolhe "Mudei de telemóvel" e escreve-o. Só com esse código volta ao seu lugar (com as respostas já dadas), e cada código só serve uma vez. Se alguém tentar adivinhar códigos (muitas tentativas erradas), os códigos pendentes são anulados e recebes um aviso — gera outro.
Se um aluno fechar o browser sem querer, volta a abrir o link e entra automaticamente com o mesmo nome.

## 5. Resultados
**Validar respostas livres (uma a uma):** quando há respostas livres aparece "❔ Há N resposta(s) livre(s) por validar" e o botão **✍️ Validar respostas livres**. Abre um ecrã com uma resposta de cada vez — pergunta, resposta modelo (e se coincide com ela), nome do formando e a resposta — com **✗ Errada** / **✓ Certa** (ou as teclas **E** / **C**), **Anterior** e **Saltar**. A pontuação e a grelha atualizam-se a cada validação; depois podes **Rever validações**. A escala 1–5 e as respostas por validar não contam para a % de acerto.

**🤖 Indício de uso de IA (só para ti):** em cada resposta livre, no ecrã de validação e no detalhe por pergunta, aparece um indicador **Baixo / Médio / Alto** com os motivos. **Não é uma prova** — nenhum sistema consegue provar que um texto foi escrito por IA — serve só para te ajudar a decidir. Junta:
- **metadados da colagem**: quando o texto é colado, a área de transferência costuma trazer também uma versão HTML com marcas da origem — a app reconhece texto copiado do **ChatGPT, Gemini, Claude, Copilot, Perplexity ou DeepSeek**, ou de uma página/app com formatação (só guarda o nome da origem, nunca o conteúdo). Em alguns telemóveis a área de transferência só tem texto simples e este sinal não aparece;
- **caracteres invisíveis** e espaços especiais no texto (frequentes em texto copiado de IA ou da web);
- sinais de comportamento registados pelo telemóvel: texto **colado** (e quanto), **saída da app** durante a resposta, texto que apareceu **sem ser digitado** (colado, ditado ou sugestão do teclado) e escrita invulgarmente rápida;
- sinais do texto: **expressões típicas** de assistentes de IA ("em suma", "é importante salientar", "desempenha um papel crucial"…), **formatação** pouco comum num telemóvel (**travessão —, meia-risca – e hífen solto entre espaços " - "**, listas, negrito; os hífenes a unir palavras, como "guarda-chuva", não contam) e comprimento muito acima do resto da turma.
O indicador não aparece nas fichas, no Excel nem aos formandos.

**Ficha individual:** carrega no nome de um formando na grelha (📄) para ver a ficha dele com todas as perguntas, a resposta correta e a resposta dada **em texto completo** (o texto da opção, a frase completa nos espaços, o número e a legenda na escala), o resultado (✓ / ✗ / parcial / por validar) e os pontos, com o total de certas e a pontuação. **🖨 Imprimir / guardar PDF** imprime-a; **🖨 Fichas de todos** junta as fichas de todos os formandos, uma por página. **⬇ Word** descarrega as fichas em Word (.docx, A4 na vertical): na grelha, **⬇ Word: fichas de todos** (uma por página); dentro da ficha de um formando, **⬇ Word** só com a dele.
**📊 Resultados** (podes filtrar por curso) → **Ver grelha**:
- Grelha aluno × pergunta, com a linha da resposta correta, ✓/✗, total de certas, % e pontos.
- Detalhe por pergunta: pergunta, opções, resposta correta e a resposta de cada aluno (com o tempo que demorou).
- Os alunos que não entraram aparecem como "Ausente"; quem entrou mas não respondeu aparece como "Sem resposta".
- **⬇ Excel (grelha)** e **⬇ Excel (detalhado)** (ficheiros CSV que abrem no Excel) e **🖨 Imprimir / PDF**.

As respostas são gravadas no disco a cada resposta (`data/results/`), por isso nada se perde se o servidor for abaixo.
Os alunos, fotografias e questionários ficam em `data/`. **Faz cópia desta pasta** e apaga-a no fim da formação se não precisares dos dados pessoais (fotografias).

## 5b. Feedback anónimo da formação (separador 💬 Feedback)

Um formulário simples para avaliar a formação, **à parte dos quizzes**: sem tempo, sem jogo, sem ranking e **completamente anónimo**.

1. **💬 Feedback → + Novo (modelo de satisfação)** cria um questionário já preenchido (avaliação geral, utilidade, formador, duração, sala, ritmo, recomendação e dois comentários livres). Ajusta, apaga ou acrescenta perguntas e carrega em **Guardar**.
   - Tipos de pergunta: escala de 1 a 5 (com legenda para o 1 e o 5), verdadeiro/falso, escolher uma opção, escolher várias e resposta livre.
   - Cada pergunta pode ser obrigatória ou opcional.
2. **Abrir e mostrar QR**: os formandos leem o QR code (ou abrem o link / escrevem o código de 5 letras) e respondem ao seu ritmo, no telemóvel. A contagem de respostas sobe no teu ecrã em tempo real.
   - Se fecharem a página a meio, as respostas ficam guardadas no telemóvel até enviarem.
   - Depois de enviar, o telemóvel mostra "Já respondeste" (num telemóvel partilhado há um botão para outra pessoa responder).
3. **⏹ Fechar respostas** quando terminar. Podes voltar a abrir mais tarde.
4. **📊 Resultados**: média geral, média de cada escala com gráfico de 1 a 5, percentagens das opções e a lista de comentários. Exporta para **Excel (CSV)** ou **Imprimir / PDF**.

**Anonimato:** não se pede nome nem fotografia, e não se guarda IP, dispositivo nem hora de envio. As respostas e os comentários aparecem por ordem aleatória, para não dar para adivinhar quem respondeu pela ordem de chegada. Com menos de 3 respostas aparece um aviso, porque aí pode ser fácil adivinhar.

Depois de haver respostas, só podes corrigir os textos; para mudar perguntas usa **Duplicar** (assim os resultados nunca ficam misturados).

## 6. Pôr acessível pela internet
Se os alunos estiverem na mesma rede Wi-Fi do teu computador, o QR code já aponta para o endereço do computador nessa rede.

Para os alunos entrarem de qualquer rede (ex.: dados móveis), **arranca em modo online** — o túnel da Cloudflare liga-se sozinho e o endereço dele vai logo para o QR code:
```bash
npm run online
```
No Windows basta **duplo clique em `iniciar-online.bat`**. Este corre o script `iniciar-online.ps1`, que:
- verifica se há Node.js;
- instala o `cloudflared` sozinho, se faltar (com o winget ou, se não houver winget, descarregando-o da Cloudflare para a pasta `ferramentas\`);
- se a porta 3000 já estiver ocupada (o quiz aberto noutra janela), pergunta se a fecha;
- faz o `npm install` da primeira vez;
- liga o servidor e o túnel;
- abre o painel do formador.

Para desligar, fecha a janela.

Também podes abrir o `.ps1` diretamente: botão direito → **Executar com o PowerShell**. Com duplo clique, o Windows abre-o no Bloco de Notas; é por isso que existe o `.bat`.

Só da primeira vez, instala o `cloudflared` (gratuito, não precisa de conta):
```bash
winget install --id Cloudflare.cloudflared
```
O endereço `https://….trycloudflare.com` muda de cada vez que arrancas; a app trata disso (até um endereço antigo guardado é ignorado). Se o `cloudflared` não estiver instalado ou não houver internet, a app avisa e continua a funcionar na rede local.
A palavra-passe do formador fica em `data/palavra-passe-formador.txt` (gerada no 1.º arranque; podes trocá-la por uma tua, comprida).

### Endereço fixo no teu domínio (recomendado)
Se tens um domínio na Cloudflare, o quiz pode ficar sempre no mesmo endereço, por exemplo `https://quiz.oseudominio.pt`. É gratuito e não mexe no resto do domínio (o site ou as páginas que lá tens continuam iguais).

1. Duplo clique em **`configurar-dominio.bat`** (só uma vez):
   - pede o subdomínio;
   - abre o browser para autorizares a tua conta da Cloudflare;
   - cria o túnel `quiz-formacao` e o registo DNS do subdomínio.
2. A partir daí, o **`iniciar-online.bat`** usa sempre esse endereço. O QR code fica sempre igual, por isso podes imprimi-lo ou pô-lo num diapositivo.

**Alternativa, no painel da Cloudflare:**
1. Em **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, dá-lhe o nome `quiz-formacao`.
2. Em **Public hostname**, define:
   - Subdomain `quiz`;
   - Domain: o teu domínio;
   - Service: **HTTP** e `localhost:3000`.
3. Copia o token (ou o comando "cloudflared.exe service install …").
4. Corre o `configurar-dominio.bat` e escolhe a opção **2**.

Se o subdomínio já existir no DNS, o script avisa: apaga esse registo na Cloudflare ou escolhe outro nome. A configuração fica em `data/online.json`; apaga esse ficheiro para voltar ao endereço temporário.

## 7. Dentro do PowerPoint (suplemento)
Com o endereço fixo, o quiz pode ficar **dentro de um diapositivo**, como o Slido.

**Instalar:**
- **PowerPoint no Windows (Microsoft 365, 2016 ou mais recente):** o `iniciar-online.bat` instala o suplemento sozinho. Fecha e volta a abrir o PowerPoint da primeira vez.
- **PowerPoint na web:** no painel, em 🎮 Jogo → "📽 Usar dentro do PowerPoint", descarrega o ficheiro do suplemento. Carrega-o em **Inserir → Suplementos → Os meus suplementos → Carregar o meu suplemento**.

**Cada diapositivo do quiz tem um papel**, como no Slido:

| Papel | Na apresentação |
|---|---|
| 📱 **Entrada** | Abre a sala e mostra o QR code e quem já entrou. Põe-no no início, para os formandos entrarem logo. |
| ❓ **Pergunta** | Quando o diapositivo aparece, essa pergunta **começa sozinha**. Fechas, mostras a resposta e o ranking com o botão amarelo dentro do diapositivo. Depois passas ao diapositivo seguinte. |
| 🏆 **Pódio final** | Termina o quiz e mostra o pódio. |

**Preparar a apresentação:**
1. **Inserir → Suplementos → Os meus suplementos → Quiz ao vivo**, num diapositivo.
2. Carrega em **⚙ Escolher**: o questionário, o papel e, se for uma pergunta, qual.
   - Da primeira vez pede a palavra-passe para **autorizar este computador**. Fica autorizado 180 dias e os outros diapositivos já não pedem.
   - Na entrada escolhes também se as perguntas avançam à mão ou por tempo.
3. Repete para cada pergunta. O quiz ocupa só a caixa, por isso podes pôr o teu conteúdo à volta.

A editar a apresentação, o diapositivo mostra só uma pré-visualização (o texto da pergunta). Não abre nada nem pede palavra-passe.

**Durante a apresentação:**
- **Só manda o diapositivo que está à vista.** Ao configurar, cada diapositivo guarda o seu identificador do PowerPoint. O PowerPoint carrega todos os diapositivos com o quiz logo no início, mas só o que está a ser mostrado abre a sala ou começa a pergunta.
- **No diapositivo de entrada** vê-se sempre o QR code e quem entrou. Não tem botão de começar: quando todos tiverem entrado, avança no PowerPoint.
- **No diapositivo de uma pergunta**, o botão amarelo faz só os passos dessa pergunta: fechar → sondagem → resposta certa → ranking. No fim aparece "➡ Avança para o diapositivo seguinte".
- As setas e o espaço ficam para o PowerPoint.
- **Cada diapositivo fica ligado ao seu sítio quando carrega em ⚙ Mudar → Guardar nesse diapositivo.** A pré-visualização mostra "📍 Ligado ao diapositivo N". Se o número não for o do diapositivo, volte a guardar. Depois de copiar um diapositivo com o quiz, guarde a cópia também.
- **Se dois diapositivos estiverem ligados ao mesmo sítio**, nenhum começa sozinho e aparece um aviso.
- **Sem ligação ao diapositivo**, a pergunta não começa sozinha e aparece o botão **▶ Começar a pergunta N**.
- **Terminar, no diapositivo:** carregue duas vezes (o PowerPoint não mostra caixas de confirmação).
- **🔄 Recomeçar o quiz, no diapositivo de entrada:** se a sessão de um ensaio ficou a meio, este botão abre uma nova (dois cliques).
- **Os formandos entram pelo nome**, sem precisares de escolher alunos.
- **Voltar a um diapositivo de uma pergunta já feita** não a repete. Depois do pódio, só o diapositivo de entrada começa uma sessão nova.
- **Se uma pergunta não começar sozinha**, aparece no topo o botão **▶ Começar a pergunta N**.
- **Se estiver aberto outro quiz com respostas**, o diapositivo pergunta antes de o terminar.
- **O PowerPoint guarda o papel de cada diapositivo dentro do ficheiro .pptx.** Num computador ainda não autorizado, só pede a palavra-passe ao começar a apresentar.

## Som
Há dois interruptores de som, nas opções ao abrir a sala e na barra de baixo durante o quiz (também dentro do diapositivo do PowerPoint):
- **🔊 Som aqui:** música e efeitos só neste computador ou projetor. Fica memorizado neste computador.
- **📱 Som nos telemóveis:** liga ou desliga os sons de todos os formandos de uma vez, mesmo a meio do quiz.

A música e os efeitos são gerados pelo próprio browser (sem ficheiros nem direitos de autor). Liga o som do projetor; o botão 🔊 no canto liga/desliga.

O que se ouve em cada momento (no projetor):
- **Sala aberta**: música alegre de espera.
- **Prepara-te 3-2-1**: três toques de contagem.
- **Pergunta no ar**: música leve de "pensar" enquanto respondem (no modo por tempo, tic-tac nos últimos 5 segundos).
- **Tempo esgotado / todos responderam**: sininho suave (também no telemóvel dos alunos).
- **Sondagem**: notas a subir enquanto as barras e as percentagens crescem de 0% até ao valor final.
- **Resposta correta**: brilho + acorde; no telemóvel cada aluno ouve o som de certo ou errado.
- **Ranking Top 5**: aplausos e cornetas de festa, confettis e música de festa enquanto os bonecos dançam.
- **Pódio final**: rufar de tambores, fanfarra, aplausos e música de festa.

## Testes
`npm test` verifica as regras de correção de todos os tipos de pergunta (respostas forjadas, ranking, adivinha a palavra, cruzadas).
