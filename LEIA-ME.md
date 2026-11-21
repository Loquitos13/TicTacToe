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

Segurança:
- A palavra-passe nunca vai no endereço das páginas (só em cabeçalhos), por isso não fica no histórico do browser.
- Cada tentativa errada demora 1,5 s a responder, para travar quem tente adivinhar.
- Os alunos nunca recebem a resposta correta, a pontuação, o nº de certas nem a posição da pergunta em curso antes de mostrares a resposta correta.

- **Formador:** http://localhost:3000/host.html
- **Alunos:** o endereço que aparece no QR code

## 3. Preparar
1. **👥 Alunos** — adiciona nome + fotografia (um a um, várias fotos de uma vez em que o nome do ficheiro passa a ser o nome, ou uma lista de nomes colada).
2. **📝 Questionários** — cria primeiro um **curso** (ex.: "Técnico de Vendas") e depois os questionários desse curso (cada curso pode ter vários, ex.: "Módulo 1", "Avaliação final"). Um questionário pode mudar de curso no editor; um curso só pode ser apagado quando já não tiver questionários.
   Nas perguntas: 2 a 6 opções (2 a 6 opções, uma ou mais corretas, tempo por pergunta, imagem opcional).
   Podes colar várias perguntas de uma vez em texto, com a resposta correta marcada com `*`:
   ```
   Qual é a capital de Portugal? [20s]
   Porto
   *Lisboa
   Coimbra
   ```

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

Escolhes se queres **mostrar a sondagem** (barras com quantos escolheram cada opção). Sem sondagem, quando as respostas fecham aparece só "🔒 Respostas fechadas" e quantos responderam; a resposta correta é destacada sem números. Podes ligar/desligar a sondagem a qualquer momento na barra de baixo.

E escolhes o **ranking**:
- **Depois de cada pergunta e pódio final** (Top 5 com bonecos a dançar);
- **Só o pódio final**;
- **Sem ranking** — não há Top 5 nem pódio, e os formandos não recebem a sua posição (só a pontuação e o nº de respostas certas).

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
Se um aluno mudou de telemóvel: **👥 Alunos** (na barra de baixo) → **Libertar nome**. Aparece um **código de reentrada** de 4 dígitos; o aluno escolhe "Mudei de telemóvel" e escreve-o. Só com esse código volta ao seu lugar (com as respostas já dadas), e cada código só serve uma vez.
Se um aluno fechar o browser sem querer, volta a abrir o link e entra automaticamente com o mesmo nome.

## 5. Resultados
**📊 Resultados** (podes filtrar por curso) → **Ver grelha**:
- Grelha aluno × pergunta, com a linha da resposta correta, ✓/✗, total de certas, % e pontos.
- Detalhe por pergunta: pergunta, opções, resposta correta e a resposta de cada aluno (com o tempo que demorou).
- Os alunos que não entraram aparecem como "Ausente"; quem entrou mas não respondeu aparece como "Sem resposta".
- **⬇ Excel (grelha)** e **⬇ Excel (detalhado)** (ficheiros CSV que abrem no Excel) e **🖨 Imprimir / PDF**.

As respostas são gravadas no disco a cada resposta (`data/results/`), por isso nada se perde se o servidor for abaixo.
Os alunos, fotografias e questionários ficam em `data/`. **Faz cópia desta pasta** e apaga-a no fim da formação se não precisares dos dados pessoais (fotografias).

## 6. Pôr acessível pela internet
Se os alunos estiverem na mesma rede Wi-Fi do teu computador, basta usar o endereço "Na rede" que aparece ao arrancar.
Para outra rede (ex.: dados móveis), usa um túnel. Por exemplo, com o Cloudflare (gratuito, não precisa de conta):
```bash
cloudflared tunnel --url http://localhost:3000
```
Depois, no ecrã da sala, clica em **Mudar endereço** debaixo do QR code e cola o endereço `https://….trycloudflare.com` para o QR code apontar para lá.
(Alternativa: `ngrok http 3000`.) Também podes arrancar com `PUBLIC_URL=https://o-teu-endereco npm start`.

## Som
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
