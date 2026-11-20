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
Para mudar a palavra-passe do formador (por omissão é `formador`):
```bash
HOST_PASSWORD=aMinhaPass npm start
```
No Windows (PowerShell): `$env:HOST_PASSWORD="aMinhaPass"; npm start`

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
Os alunos leem o QR, escolhem o seu nome/fotografia e confirmam.

Ao abrir a sala escolhes **como avançam as perguntas** (vale para o quiz inteiro):
- **🎮 Manual** — a pergunta fica aberta até tu carregares em `Fechar respostas`.
- **⏱ Por tempo** — cada pergunta tem tempo limite (o de cada pergunta ou um tempo igual para todas). Quando chega a 0 (ou todos respondem) deixa de aceitar respostas e passa sozinha para a sondagem.

Cada pergunta passa por estes passos (o botão amarelo, ou **espaço / →**, avança):
1. **Prepara-te 3-2-1** — a pergunta aparece no ecrã e nos telemóveis, ainda sem opções.
2. **Pergunta aberta** — os alunos respondem; vês quantos já responderam.
3. **📊 Sondagem** — quantas pessoas escolheram cada opção (ainda sem dizer qual é a certa).
4. **✅ Resposta correta** — só agora cada aluno vê no telemóvel se acertou e, se errou, qual era a correta.
5. **🏆 Ranking Top 5** (opcional) — pódio de 5 lugares com bonecos a dançar com a foto de cada aluno.

No fim aparece o **pódio final animado** (do 5º para o 1º, com rufar de tambores e confettis) e o botão `Ver grelha de resultados`.

Opções que podes ligar/desligar a qualquer momento:
- **Quem respondeu**: aparecem as fotografias dos alunos em cada opção (vem desligado, porque é uma avaliação).
- **Ranking por pergunta**: mostra (ou não) o pódio Top 5 depois de cada pergunta.

Se um aluno escolheu o nome errado ou mudou de telemóvel: **👥 Alunos** (na barra de baixo) → **Libertar nome**. As respostas já dadas mantêm-se.
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
