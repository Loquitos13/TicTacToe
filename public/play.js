// Volume baixo nos telemóveis: o formador não controla o som dos dispositivos dos alunos
Sound.setVolume(0.2);
muteButton();
const app = $('#app');
// código da sessão: vem no QR code (?c=XXXXXX) ou é escrito à mão
const CODE = (new URLSearchParams(location.search).get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const socket = io({ auth: { role: 'player', code: CODE } });
function send(ev, ...args) {
  const cb = args.pop();
  if (!socket.connected) return cb({ error: 'Sem ligação. Verifica a rede e tenta outra vez.' });
  socket.timeout(8000).emit(ev, ...args, (err, res) => cb(err ? { error: 'O servidor não respondeu. Tenta outra vez.' } : (res || {})));
}
let roster = null, state = null, lastKey = '', timerRaf = null;
let joinStep = { kind: 'form' }; // form | notFound | rejoin
let typed = '';
const stored = () => { try { return JSON.parse(localStorage.getItem('aq_me') || 'null'); } catch { return null; } };
const store = v => { try { v ? localStorage.setItem('aq_me', JSON.stringify(v)) : localStorage.removeItem('aq_me'); } catch {} };

socket.on('connect', () => { state = null; });
socket.on('roster', r => {
  roster = r;
  const me = stored();
  if (r.session && me && me.sessionId === r.session.id && !state) return reclaim(me);
  if (!state) render();
});
socket.on('state', s => { Sound.setForcedOff(!!(s.session && s.session.settings && s.session.settings.phoneSound === false)); if (!s.session) { state = null; roster = { session: null }; stopCamera(); render(); return; } state = s; render(); });
socket.on('reload', () => { state = null; joinStep = { kind: 'form' }; store(null); });
socket.on('released', why => { state = null; store(null); joinStep = { kind: 'form' }; toast(why === 'moved' ? 'Entraste com o teu nome noutro separador ou telemóvel: continua lá.' : 'O formador libertou o teu lugar. Para voltar, usa o código de reentrada que ele te der.', 6000); render(); });
// o servidor pergunta se este telemóvel ainda está cá (alguém está a tentar entrar com o mesmo nome)
// (só responde se a app estiver à vista: um separador esquecido em segundo plano não prende o nome)
socket.on('alive', ack => { if (typeof ack === 'function' && document.visibilityState === 'visible') ack(true); });

function joined(res) {
  if (res.error) {
    // no formulário do nome, a explicação fica escrita por baixo do campo (não desaparece)
    if (joinStep.kind === 'form' && !(state && state.me)) { joinStep = { kind: 'form', msg: res.error }; lastKey = ''; render(); setTimeout(() => { const n = $('#nm'); if (n) { n.focus(); n.select(); } }, 60); return; }
    toast(res.error, 5000); lastKey = ''; render(); return;
  }
  store({ sessionId: res.sessionId, studentId: res.studentId, token: res.token });
  joinStep = { kind: 'form' };
  Sound.play('pop');
}
// mesmo dispositivo: volta a entrar sozinho com o token guardado
function reclaim(me) {
  socket.emit('player:claim', { studentId: me.studentId, token: me.token }, res => { if (res.error) { store(null); render(); } else joined(res); });
}
function join() {
  Sound.init();
  send('player:join', { name: typed }, res => {
    if (res.notFound) { joinStep = { kind: 'notFound' }; return render(); }
    joined(res);
  });
}

const logo = () => `<div class="logo">🎯 <span>Quiz</span></div>
  <p class="center" style="margin:4px 0 0;opacity:.9">${roster.session.courseName ? esc(roster.session.courseName) + ' · ' : ''}${esc(roster.session.quizTitle)}</p>`;

function codeForm(msg) {
  return set('code' + msg, `<div class="logo">🎯 <span>Quiz</span></div>
    <form class="middle" id="codeForm" autocomplete="off"><div class="big-emoji">🔑</div>
      <h1 style="font-size:1.5em">Código da sessão</h1>
      <p>${msg}</p>
      <input class="search code-in" id="cd" maxlength="6" placeholder="ex.: K7P4QX" autocapitalize="characters" enterkeyhint="go" required>
      <button class="btn primary" style="width:100%;font-size:1.15em">Continuar</button></form>`, () => {
    $('#codeForm').onsubmit = e => { e.preventDefault(); const c = $('#cd').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c) location.search = '?c=' + c; };
  });
}

function render() {
  cancelAnimationFrame(timerRaf);
  if (state && state.session) return renderGame();
  if (!CODE) return codeForm('Lê o QR code no ecrã do formador ou escreve o código que aparece por baixo dele.');
  if (!roster) return;
  if (!roster.session) {
    if (roster.badCode) return codeForm(`O código <b>${esc(CODE)}</b> não corresponde a nenhuma sessão aberta. Lê de novo o QR code ou confirma o código.`);
    return set('wait', `<div class="logo">🎯 <span>Quiz</span></div>
      <div class="middle"><div class="big-emoji wiggle">🎮</div><h1>Quase lá!</h1><p>À espera que o formador abra a sessão<span class="dots"></span></p></div>`);
  }
  if (joinStep.kind === 'notFound') {
    return set('nf' + typed, logo() + `<div class="middle"><div class="big-emoji">🤔</div>
      <h1 style="font-size:1.4em">Não encontrámos “${esc(typed)}” na lista da turma</h1>
      <p>Escreve o teu <b>nome completo</b>, tal como está na inscrição.<br>Se estiver certo, fala com o formador.</p>
      <button class="btn primary" id="retry">✏️ Corrigir o nome</button></div>`, () => {
      $('#retry').onclick = () => { joinStep = { kind: 'form' }; render(); };
    });
  }
  if (joinStep.kind === 'rejoin') {
    return set('rejoin', logo() + `<form class="middle" id="rjForm" autocomplete="off"><div class="big-emoji">🔢</div>
      <h1 style="font-size:1.4em">Código de reentrada</h1><p>O formador vê-o no ecrã dele quando liberta o teu nome.</p>
      <input class="search code-in" id="rjc" inputmode="numeric" maxlength="6" placeholder="000000" required>
      <button class="btn primary" style="width:100%">Voltar ao meu lugar</button>
      <button type="button" class="btn ghost" id="retry">← Voltar</button></form>`, () => {
      $('#rjForm').onsubmit = e => { e.preventDefault(); send('player:rejoin', { rejoin: $('#rjc').value }, joined); };
      $('#retry').onclick = () => { joinStep = { kind: 'form' }; render(); };
    });
  }
  if (roster.session.anonymous) {
    // questionário anónimo: não se pede o nome
    return set('anon', logo() + `<div class="middle"><div class="big-emoji wiggle">🕶️</div>
      <h1 style="font-size:1.6em">Questionário anónimo</h1>
      <p>Não precisas de dizer quem és: as tuas respostas não ficam associadas ao teu nome — nem o formador sabe quem respondeu o quê.</p>
      <button class="btn primary" id="anonGo" style="width:100%;font-size:1.15em">Entrar 🚀</button></div>`, () => {
      $('#anonGo').onclick = () => { Sound.init(); send('player:join', { name: '' }, joined); };
    });
  }
  set('form' + (joinStep.msg || ''), logo() + `<form class="middle" id="joinForm" autocomplete="off">
      ${joinStep.msg ? '' : '<div class="big-emoji wiggle">👋</div>'}
      <h1 style="font-size:1.6em">Escreve o teu nome completo</h1>
      <input class="search" id="nm" name="nome" placeholder="Nome completo" maxlength="80" autocapitalize="words" enterkeyhint="go" required value="${esc(typed)}">
      ${joinStep.msg ? `<p class="join-err" role="alert">⚠️ ${esc(joinStep.msg)}</p>` : ''}
      <button class="btn primary" style="width:100%;font-size:1.15em">Entrar 🚀</button>
      <button type="button" class="btn ghost" id="rj" style="font-size:.9em">Mudei de telemóvel: tenho um código de reentrada</button>
    </form>`, () => {
    const nm = $('#nm');
    nm.oninput = () => typed = nm.value;
    $('#joinForm').onsubmit = e => { e.preventDefault(); typed = nm.value.trim(); if (typed) join(); };
    $('#rj').onclick = () => { joinStep = { kind: 'rejoin' }; render(); };
    setTimeout(() => nm.focus(), 50);
  });
}

// só redesenha quando algo muda (evita cintilar)
function set(key, html, bind) {
  if (key === lastKey) return;
  lastKey = key; app.innerHTML = html; bind && bind();
}

function header() {
  const m = state.me;
  if (state.session.settings.anonymous) return `<div class="bar"><span class="avatar sm" style="background:#334155">🕶</span><span class="name">Anónimo</span>${m.score == null ? '' : `<span class="score" id="score">${m.score} pts</span>`}</div>`;
  return `<div class="bar">${avatar(m, 'sm')}<span class="name">${esc(m.name)}</span>${m.team ? `<span class="team-chip" style="--tc:${m.team.color}" title="Equipa ${esc(m.team.name)}">${m.team.emoji}</span>` : ''}${m.score == null ? '' : `<span class="score" id="score">${m.score} pts</span>`}</div>`;
}
// cartão da equipa (sala de espera, ranking e fim)
function teamCard(big, lobby) {
  const m = state.me, t = m.team; if (!t) return '';
  const pos = m.teamPosition && !lobby ? `<div style="font-size:${big ? 1.5 : 1.2}em;margin-top:4px">${m.teamPosition <= 3 ? ['🥇', '🥈', '🥉'][m.teamPosition - 1] : '🏅'} <b>${m.teamPosition}º</b> lugar de ${m.teamOf}${m.teamScore != null ? ` · ${m.teamScore} pts` : ''}</div>` : '';
  return `<div class="team-card pop-in" style="--tc:${t.color}"><div class="team-name">${t.emoji} Equipa ${esc(t.name)}</div>
    ${lobby ? `<div class="team-mates">${m.teammates && m.teammates.length ? 'com ' + m.teammates.map(esc).join(', ') : 'Por agora estás sozinho(a) nesta equipa'}</div>` : ''}${pos}</div>`;
}

let prevPhase = '';
function renderGame() {
  renderGameInner();
  const sc = $('#score'); if (sc && state.me.score != null) sc.textContent = state.me.score + ' pts';
}
function renderGameInner() {
  const s = state.session, ph = s.phase;
  const pk = ph + s.qIndex;
  const changed = pk !== prevPhase; prevPhase = pk;
  if (ph === 'lobby' && needPhotoStep()) return renderPhotoStep();
  if (ph === 'exam') { stopCamera(); return renderExam(); }
  clearInterval(exClock);
  if (ph !== 'lobby') stopCamera();
  if (ph === 'lobby') {
    if (s.settings.anonymous) return set('lobby-anon', header() + `<div class="middle"><div class="big-emoji bounce">🕶️</div><h1>Estás dentro! 🎉</h1>
      <p>Participas de forma <b>anónima</b>.<br>Olha para o ecrã do formador — o questionário vai começar<span class="dots"></span></p></div>`);
    return set('lobby' + state.me.studentId + (state.me.photo || '') + JSON.stringify([state.me.team, state.me.teammates]), header() + `<div class="middle">${avatar(state.me, 'xl bounce')}<h1>Olá, ${esc(state.me.name.split(' ')[0])}! 🎉</h1>${teamCard(true, true)}<p>Estás dentro. Olha para o ecrã do formador.<br>O jogo vai começar<span class="dots"></span></p>
      <button class="btn ghost" id="notMe" style="margin-top:10px">Não sou ${esc(state.me.name)}</button></div>`, () => {
      $('#notMe').onclick = () => send('player:leave', res => {
        if (res && res.error) return toast(res.error, 4500);
        store(null); state = null; joinStep = { kind: 'form' }; typed = ''; lastKey = ''; render();
      });
    });
  }
  const timedMode = s.settings.mode !== 'manual'; // por tempo ou totalmente automático
  const showRank = s.settings.rankEach;
  if (ph === 'ready') {
    set('ready' + s.qIndex, header() + qmeta() + `<div class="middle"><h1 class="slide-up">Prepara-te! 🧠</h1>
      ${state.question.hidden ? onScreenNote : `<div class="qtext pop-in" style="width:100%">${esc(state.question.text)}</div>`}
      <div class="ready-n" id="rn">3</div></div>`);
    const end = performance.now() + state.remainingMs;
    const tick = () => { const el = $('#rn'); if (!el) return; el.textContent = Math.max(1, Math.ceil((end - performance.now()) / 1000)); if (end > performance.now()) timerRaf = requestAnimationFrame(tick); };
    tick();
    return;
  }
  if (ph === 'question') {
    const q = state.question;
    if (q.type === 'potato') return renderPotato(s);
    if (state.answered && q.type === 'hangman') {
      const h = state.hang || { wrong: 0, mask: '' };
      return set('sent' + s.qIndex, header() + qmeta() + `<div class="middle"><div class="hm-wrap">${hangmanSvg(h.wrong, q.maxWrong, h.solved)}</div>
        <h1>${h.solved ? `Acertaste${h.wrong ? ` com ${h.wrong} erro${h.wrong > 1 ? 's' : ''}` : ' sem erros'}! 🎉` : 'Não foi desta…'}</h1>${hangWordHtml(h.mask)}
        <p>${h.solved ? 'Boa! Aguarda pelos outros' : 'Olha para o ecrã: a palavra vai ser revelada'}<span class="dots"></span></p></div>`);
    }
    if (state.answered && (q.type === 'guess')) {
      const g = state.guess || { tries: [] };
      return set('sent' + s.qIndex, header() + qmeta() + `<div class="middle"><div class="big-emoji pop-in">${g.solved ? '🎉' : '😵'}</div>
        <h1>${g.solved ? `Acertaste à ${g.tries.length}ª!` : 'Não foi desta…'}</h1>${guessBoardHtml(q, g.tries, '', false, g.tries.length - 1)}
        <p>${g.solved ? 'Boa! Aguarda pelos outros' : 'Olha para o ecrã: a palavra vai ser revelada'}<span class="dots"></span></p></div>`);
    }
    if (state.answered) {
      const revealLater = (s.settings.revealMode || 'each') !== 'each';
      const t = q.type || 'mc', mineV = t === 'mc' || t === 'tf' ? state.myOption : state.myValue;
      return set('sent' + s.qIndex, header() + qmeta() + `<div class="middle"><div class="big-emoji pop-in">${revealLater || isOpinion(q) ? '✅' : '🤞'}</div><h1>Resposta enviada!</h1>
        ${t === 'mc' || t === 'tf' ? `<div class="ans opt-${state.myOption}" style="min-height:auto;width:100%"><span class="letter">${LETTERS[state.myOption]}</span>${esc(q.options[state.myOption] || '')}</div>` : `<div class="correct-box" style="width:100%">${answerSummary(q, mineV)}</div>`}
        <p>${revealLater || isOpinion(q) || t === 'open' ? 'Aguarda a próxima pergunta' : 'Vamos ver se acertaste'}<span class="dots"></span></p></div>`);
    }
    const w = answerWidget(q, null, false), t = q.type || 'mc';
    const hint = { mc: '👆 Escolhe a tua resposta', tf: '👆 Verdadeiro ou falso?', scale: '👆 Escolhe de 1 a 5', fill: '✏️ Completa os espaços', open: '✍️ Escreve a tua resposta',
      cloud: `☁️ Escreve até ${q.words || 3} palavra${(q.words || 3) > 1 ? 's' : ''}`, rank: '🔢 Toca nas opções pela ordem: 1º, 2º, 3º…', scramble: '🔤 Toca nas letras pela ordem para formar a palavra', guess: `🟩 Adivinha a palavra de ${q.len} letras`, hangman: '🪢 Escolhe letras — cada erro e o boneco perde uma peça!', cross: '✏️ Toca numa pista (ou numa casa) e escreve a palavra', number: '🔢 Escolhe o número', match: '🔗 Para cada item, toca na letra certa', spot: (q.spots || 1) > 1 ? `🎯 Encontra os ${q.spots} sítios na imagem` : '🎯 Toca no sítio certo da imagem' }[t];
    set('q' + s.qIndex, header() + qmeta() + `${q.hidden ? onScreenNote : t === 'fill' && q.parts ? '' : `<div class="qtext slide-up">${esc(q.text)}</div>`}${q.image && t !== 'spot' ? `<img class="qimg" src="${esc(q.image)}">` : ''}
      ${timedMode ? '<div class="timebar"><div id="tb"></div></div>' : `<p class="center" style="margin:10px 0;opacity:.85">${hint}</p>`}
      ${w.html}`, () => {
      w.bind((value, btn, meta) => {
        $$('#app button').forEach(x => x.disabled = true);
        send('player:answer', { value, meta }, res => {
          if (res && res.error) { toast(res.error); $$('#app button').forEach(x => x.disabled = false); return; }
          Sound.play('sent'); navigator.vibrate && navigator.vibrate(40);
          state.answered = true; if (t === 'mc' || t === 'tf') state.myOption = value; else state.myValue = value; render();
        });
      });
    });
    if (!timedMode) return;
    const end = performance.now() + state.remainingMs, total = q.time * 1000;
    const tick = () => { const tb = $('#tb'); if (!tb) return; const r = Math.max(0, end - performance.now()); tb.style.transform = `scaleX(${r / total})`; if (r > 0) timerRaf = requestAnimationFrame(tick); };
    tick();
    return;
  }
  // batata quente: no fim do jogo mostra como ficaram os grupos (o ranking vem a seguir, como nas outras perguntas)
  if ((ph === 'closed' || ph === 'reveal') && state.question && state.question.type === 'potato' && state.potato) {
    const P = state.potato, me = P.myGroup || {};
    return set('potend' + s.qIndex + ph, header() + qmeta() + `<div class="middle"><div class="big-emoji pop-in">🥔</div><h1>Fim da batata quente!</h1>
      <div class="pot-scores">${P.groups.map((g, i) => `<div class="${g.id === me.id ? 'me' : ''}"><span>${i + 1}.º ${g.emoji} ${esc(g.name)}</span><b>${g.score} pts</b></div>`).join('')}</div>
      <p>Aguarda<span class="dots"></span></p></div>`);
  }
  if (ph === 'closed') {
    if (!lastKey.startsWith('closed' + s.qIndex)) Sound.play('softEnd');
    return set('closed' + s.qIndex + state.answered, header() + qmeta() + `<div class="middle"><div class="big-emoji wiggle">${timedMode ? '⏰' : '🔒'}</div><h1>${timedMode ? 'Tempo esgotado!' : 'Respostas fechadas!'}</h1>
      <p>${state.answered ? 'A tua resposta foi registada ✅' : 'Não respondeste a tempo 😬'}<br>${s.settings.showPoll === false ? 'Aguarda' : '📊 Olha para o ecrã: vem aí a sondagem'}<span class="dots"></span></p></div>`);
  }
  if ((ph === 'reveal' || ph === 'leaderboard') && (s.settings.revealMode || 'each') !== 'each') {
    const atEnd = !!s.settings.revealEnd;
    return set('rv-hidden' + s.qIndex, header() + qmeta() + `<div class="middle"><div class="result none pop-in">
      <div class="big-emoji">${state.answered ? '📨' : '😴'}</div>
      <h2>${state.answered ? 'Resposta registada' : 'Sem resposta'}</h2>
      ${state.answered ? `<div class="correct-box">A tua resposta: ${state.myOption != null ? optLabel(state.question.options, state.myOption) : answerSummary(state.question, state.myValue)}</div>` : ''}
      <p style="margin-top:12px">${atEnd ? 'As respostas corretas são mostradas no fim do quiz. 🤫' : 'Nesta avaliação as respostas corretas não são mostradas.'}</p>
      </div><p>Aguarda a próxima pergunta<span class="dots"></span></p></div>`);
  }
  if (ph === 'leaderboard' && (state.board || []).length) {
    // ecrã próprio do ranking: a lista de toda a gente, com o boneco do formando a dançar na sua linha
    const m = state.me, mine = state.board.find(r => r.me) || {};
    set('lb' + s.qIndex + JSON.stringify(state.board.map(r => [r.pos, r.score])), header() + qmeta() + `<div class="lb-wrap">
      <h1 class="slide-up" style="margin:4px 0">🏆 Classificação</h1>
      ${m.team ? teamCard(false) : ''}
      <p class="lb-me-sum pop-in">Estás em <b>${ordinal(mine.pos)}</b> lugar${mine.score != null ? ` com <b>${mine.score}</b> pontos` : ''}${m.of ? ` · ${m.of} participantes` : ''}</p>
      ${boardHtml(true)}</div>`, () => { const me = $('.lb-row.me'); if (me) me.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
    return;
  }
  if ((ph === 'reveal' || ph === 'leaderboard') && state.answered && (state.graded === false || state.wasCorrect == null)) {
    // escala (opinião) ou resposta livre por avaliar: não há certo/errado agora
    const q = state.question, sc = isOpinion(q);
    set('rev-neutral' + s.qIndex + ph, header() + qmeta() + `<div class="middle"><div class="result none pop-in">
      <div class="big-emoji">${q.type === 'cloud' ? '☁️' : q.type === 'rank' ? '🔢' : sc ? '⭐' : '📝'}</div><h2>${sc ? 'Obrigado pela tua opinião!' : 'Resposta registada'}</h2>
      <div class="correct-box">${answerSummary(q, state.myValue)}</div>
      ${sc ? '' : '<p style="margin-top:10px">O formador vai avaliar a tua resposta.</p>'}</div>${ph === 'leaderboard' ? rankBox() : ''}</div>`);
    return;
  }
  if (ph === 'reveal' || ph === 'leaderboard') {
    const q = state.question, t = q.type || 'mc';
    const cls = !state.answered ? 'none' : state.wasCorrect ? 'ok' : ((t === 'fill' || t === 'rank' || t === 'cross' || t === 'match' || t === 'spot') && state.right) || (t === 'number' && state.points > 0) ? 'part' : 'bad';
    const sol = state.solution || {};
    const solHtml = t === 'fill' ? `Palavras certas:<br>${(sol.blanks || []).map((w, i) => `${i + 1}. ${esc(w)}`).join('<br>')}`
      : t === 'open' ? `Resposta modelo:<br>${(sol.accepted || []).map(esc).join(' · ')}`
      : t === 'rank' ? `Ordem certa:<br>${(sol.order || []).map((o, k) => `${k + 1}. ${esc(o)}`).join('<br>')}`
      : t === 'number' ? `A resposta era:<br><b style="font-size:1.6em">${esc(String(sol.answer))}</b>${state.answered ? `<br><small>Escolheste ${esc(String(state.myValue))}</small>` : ''}`
      : t === 'match' ? `Ligações certas:<br>${(sol.pairs || []).map(p => `${esc(p.left)} → <b>${esc(p.right)}</b>`).join('<br>')}`
      : t === 'spot' ? `${(sol.zones || []).length > 1 ? 'Os sítios certos estão marcados' : 'A zona certa está marcada'} a verde:${spotHtml(q, state.myValue, sol.zones)}`
      : t === 'hangman' ? `A palavra era:<br><b style="font-size:1.4em;letter-spacing:.08em">${esc(String(sol.answer || '').toUpperCase())}</b>`
      : t === 'guess' ? `A palavra era:<br><b style="font-size:1.4em;letter-spacing:.08em">${esc(String(sol.answer || '').toUpperCase())}</b>`
      : t === 'scramble' ? `A palavra era:<br><b style="font-size:1.4em;letter-spacing:.08em">${esc(String(sol.answer || '').toUpperCase())}</b>`
      : t === 'cross' ? `Solução:<br>${(sol.words || []).map((w, k) => `${w.n}${w.dir === 'a' ? '→' : '↓'} ${esc(w.display.toUpperCase())} ${(state.myValue || [])[k] === w.word ? '✓' : '✗'}`).join('<br>')}`
      : `Resposta correta:<br>${(state.correct || []).map(i => optLabel(q.options, i)).join('<br>')}`;
    const key = 'rev' + s.qIndex + ph;
    const isNew = !lastKey.startsWith('rev' + s.qIndex);
    set(key, header() + qmeta() + `<div class="middle"><div class="result ${cls} ${isNew ? (state.wasCorrect ? 'pop-in' : 'shake') : ''}">
      <div class="big-emoji">${!state.answered ? '😴' : state.wasCorrect ? '🎉' : '😅'}</div>
      <h2>${!state.answered ? 'Sem resposta' : state.wasCorrect ? 'Certo!' : t === 'fill' && state.right ? `${state.right} de ${q.blanks} certas` : t === 'rank' && state.right ? `${state.right} de ${q.items.length} no lugar certo` : t === 'cross' && state.right ? `${state.right} de ${q.cross.words.length} palavras certas` : t === 'match' && state.right ? `${state.right} de ${q.lefts.length} ligações certas` : t === 'spot' && state.right ? `Encontraste ${state.right} de ${q.spots}` : t === 'number' && state.points > 0 ? 'Quase!' : 'Errado'}</h2>
      ${state.points ? `<div style="font-size:1.5em;font-weight:700">+${state.points} pontos</div>` : ''}
      ${!state.wasCorrect ? `<div class="correct-box">${solHtml}</div>` : ''}
      ${sol.explain ? `<p class="explain">💡 ${esc(sol.explain)}</p>` : ''}
      </div>${ph === 'leaderboard' ? rankBox() : ''}</div>`);
    if (isNew) { Sound.play(state.wasCorrect ? 'correct' : 'wrong'); if (state.wasCorrect) Confetti.burst(80); navigator.vibrate && navigator.vibrate(state.wasCorrect ? [40, 60, 40] : 200); }
    return;
  }
  if (ph === 'end') {
    const m = { ...state.me };
    // sem perguntas com resposta certa (ex.: inquérito de satisfação) não faz sentido mostrar pontos
    if (state.gradedTotal === 0) { m.score = null; m.position = null; }
    const isNew = !lastKey.startsWith('end');
    const podium = s.settings.finalPodium && m.position != null && m.position <= 5;
    set('end' + JSON.stringify([m.score, m.position, m.correct, m.teamPosition, (state.review || []).map(r => r.ok)]), header() + `<div class="middle">${podium ? `<div class="pop-in">${dancer(m, ['jump', 'disco', 'wave', 'sway', 'robot'][m.position - 1], ['#ffd93d', '#e5e7eb', '#f4a261', '#7dd3fc', '#c4b5fd'][m.position - 1], m.position === 1)}</div>` : s.settings.anonymous ? '<div class="big-emoji pop-in">🕶️</div>' : avatar(m, 'xl pop-in')}<h1>Terminou! 🏁</h1>
      ${m.score != null || m.position != null || state.grade != null ? `<div class="card" style="width:100%">
        ${m.score != null ? `<div style="font-size:2.4em;font-weight:700">${m.score} pts</div><div class="muted">${m.correct} de ${state.gradedTotal ?? s.total} respostas certas</div>` : ''}
        ${state.grade != null ? `<div class="grade-box pop-in">Nota<br><b class="${state.gradeScale === 'q' ? 'qual' : ''}">${String(state.grade).replace('.', ',')}${state.gradeScale === 100 ? '%' : ''}</b>${state.gradeScale === 20 ? '<small> / 20</small>' : ''}</div>` : ''}
        ${m.position != null && (s.settings.finalPodium || showRank) ? `<div style="font-size:1.4em;margin-top:8px">${m.position <= 3 ? ['🥇', '🥈', '🥉'][m.position - 1] : '🏅'} ${m.position}º lugar</div>` : ''}</div>` : ''}
      ${m.team && m.teamPosition ? teamCard(true) : ''}
      ${(state.board || []).length && m.position != null ? `<h2 style="margin:10px 0 0">🏆 Classificação final</h2>${boardHtml(false)}` : ''}
      ${state.review ? `<h2 style="margin:10px 0 0">As respostas corretas</h2><div class="review">${state.review.map((r, i) => `
        <div class="rv-item ${r.mine == null ? 'none' : r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'none'}"><div class="rv-q">${r.text ? `${i + 1}. ${esc(r.text)}` : `Pergunta ${i + 1}`}</div>
          <div class="rv-a">${r.type === 'scale' ? '⭐ Escala de opinião' : r.type === 'cloud' ? '☁️ Nuvem de palavras' : r.type === 'number' ? '✅ ' + esc(String(r.solution.answer)) : r.type === 'match' ? '✅ ' + (r.solution.pairs || []).map(p => `${esc(p.left)} → ${esc(p.right)}`).join(' · ') : r.type === 'spot' ? '🎯 ' + ((r.solution.zones || []).length > 1 ? `${r.solution.zones.length} zonas marcadas na imagem` : 'Zona marcada na imagem') : r.type === 'scramble' || r.type === 'guess' || r.type === 'hangman' ? '✅ ' + esc(String(r.solution.answer || '').toUpperCase()) : r.type === 'cross' ? '✅ ' + (r.solution.words || []).map(w => `${w.n}${w.dir === 'a' ? '→' : '↓'} ${esc(w.display.toUpperCase())}`).join(' · ') : r.type === 'rank' ? ((r.solution.order || []).length ? '✅ ' + r.solution.order.map((o, k) => `${k + 1}. ${esc(o)}`).join(' · ') : '🔢 Ranking de opinião') : r.type === 'fill' ? '✅ ' + (r.solution.blanks || []).map(esc).join(' · ') : r.type === 'open' ? '📝 Validada pelo formador' + ((r.solution.accepted || []).length ? ' · modelo: ' + r.solution.accepted.map(esc).join(' · ') : '') : '✅ ' + r.correct.map(k => optLabel(r.options, k)).join(' | ')}</div>
          <div class="rv-m">${r.mine == null ? 'Não respondeste' : `A tua: ${r.type === 'mc' || r.type === 'tf' || !r.type ? optLabel(r.options, r.mine) : esc(r.mineText || '')} ${r.ok === true ? '✓' : r.ok === false ? '✗' : ''}`}</div></div>`).join('')}</div>` : ''}
      ${(!state.review || !state.review.some(r => r.graded || r.ok != null)) && m.score == null ? `<div class="result none" style="margin-top:6px"><div class="big-emoji">📨</div><h2>Respostas enviadas!</h2>
        <p>Respondeste a ${state.answeredCount ?? 0} de ${s.total} perguntas. As tuas respostas foram registadas.</p></div>` : ''}
      <p>Obrigado por participares! 💜</p></div>`);
    if (isNew) { Sound.play('fanfare'); Confetti.burst(200); }
  }
}
const ordinal = n => n + '.º';
// lista da classificação; dance = o formando aparece como boneco a dançar na sua linha
function boardHtml(dance) {
  return `<div class="lb-list">${state.board.map((r, i) => `<div class="lb-row ${r.me ? 'me' : ''} slide-up" style="animation-delay:${Math.min(i, 15) * 40}ms">
    <span class="lb-pos">${r.pos <= 3 ? ['🥇', '🥈', '🥉'][r.pos - 1] + ' ' : ''}${ordinal(r.pos)}</span>
    ${r.me && dance ? `<div class="lb-dancer">${dancer({ ...state.me, photo: r.photo || state.me.photo }, r.pos === 1 ? 'jump' : 'disco', '#7c3aed', r.pos === 1)}</div>` : avatar(r, 'sm')}
    <span class="lb-name">${esc(r.name)}${r.me ? ' <small>(tu)</small>' : ''}</span>
    ${r.score != null ? `<span class="lb-pts">${r.score} pts</span>` : ''}</div>`).join('')}</div>`;
}
function rankBox() {
  const m = state.me;
  if (m.team) return teamCard(false) + (m.position ? `<p style="margin:6px 0 0;opacity:.85">Tu: ${m.position}º lugar de ${m.of}</p>` : '');
  return m.position <= 5
    ? `<div class="pop-in" style="display:flex;align-items:center;gap:12px">${dancer(m, 'wave', '#ffd93d', m.position === 1)}<p style="font-size:1.3em;margin:0">Estás no <b>Top 5</b>!<br><b style="font-size:1.6em">${m.position}º</b> lugar 🎉</p></div>`
    : `<p style="font-size:1.2em">Estás em <b>${m.position}º</b> lugar de ${m.of}</p>`;
}
// ---------- Fotografia opcional (depois do nome, antes da sala de espera) ----------
let photo = { step: 'ask', data: null, stream: null, fallback: false };
const photoKey = () => 'aq_photo_' + state.session.id + '_' + state.me.studentId;
function needPhotoStep() {
  if (state.session.settings.anonymous) return false; // anónimo: sem fotografia
  if (state.me.photo) return false;            // já tem fotografia (do formador ou tirada agora)
  try { if (localStorage.getItem(photoKey())) return false; } catch {}
  return photo.step !== 'done';
}
function photoDone() { stopCamera(); photo.step = 'done'; try { localStorage.setItem(photoKey(), '1'); } catch {} lastKey = ''; render(); }
function stopCamera() { if (photo.stream) { photo.stream.getTracks().forEach(t => t.stop()); photo.stream = null; } }

async function startCamera() {
  photo.step = 'camera'; photo.fallback = false; lastKey = ''; render();
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('sem câmara');
    photo.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
    const v = $('#cam'); if (!v) return stopCamera();
    v.srcObject = photo.stream; await v.play().catch(() => {});
    $('#shoot').disabled = false;
  } catch (e) {
    // sem permissão ou ligação sem HTTPS: usa a câmara do telemóvel através do seletor de ficheiros
    photo.fallback = true; lastKey = ''; render();
  }
}
function capture() {
  const v = $('#cam'); if (!v || !v.videoWidth) return;
  const size = 360, m = Math.min(v.videoWidth, v.videoHeight);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.translate(size, 0); g.scale(-1, 1); // igual ao que a pessoa vê (espelho)
  g.drawImage(v, (v.videoWidth - m) / 2, (v.videoHeight - m) / 2, m, m, 0, 0, size, size);
  photo.data = c.toDataURL('image/jpeg', 0.85);
  stopCamera(); Sound.play('sent'); photo.step = 'preview'; lastKey = ''; render();
}
// escolher uma fotografia guardada no telemóvel/computador (galeria / ficheiros)
const galleryBtn = (id, label, cls = 'btn ghost') => `<label class="${cls}" style="text-align:center;${cls === 'btn' ? 'width:100%' : ''}">${label}<input type="file" accept="image/*,.heic,.heif" id="${id}" hidden></label>`;
function bindFile(id) {
  const inp = $('#' + id); if (!inp) return;
  inp.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { photo.data = await resizeImage(f, 360); }
    catch { e.target.value = ''; return toast('Não foi possível abrir esta imagem. Experimenta outra fotografia.', 4500); }
    stopCamera(); photo.step = 'preview'; lastKey = ''; render();
  };
}
function renderPhotoStep() {
  const name = esc(state.me.name.split(' ')[0]);
  if (photo.step === 'ask') {
    return set('ph-ask', header() + `<div class="middle">
      <div class="ph-demo">${dancer(state.me, 'wave', '#ffd93d')}</div>
      <h1 style="font-size:1.5em">Olá, ${name}! Queres pôr a tua fotografia?</h1>
      <p>Assim o teu boneco aparece com a tua cara em vez das iniciais. É opcional e só é usada nesta sessão.</p>
      <button class="btn primary" id="phYes" style="width:100%">📷 Tirar fotografia</button>
      ${galleryBtn('phGal', '📁 Escolher da galeria', 'btn')}
      <button class="btn ghost" id="phNo">Agora não</button></div>`, () => {
      $('#phYes').onclick = () => { Sound.init(); startCamera(); };
      bindFile('phGal');
      $('#phNo').onclick = photoDone;
    });
  }
  if (photo.step === 'camera') {
    if (photo.fallback) {
      return set('ph-fb', header() + `<div class="middle"><div class="big-emoji">📷</div>
        <h1 style="font-size:1.4em">Abre a câmara do telemóvel</h1>
        <p>Não foi possível usar a câmara dentro da página. Toca no botão para tirar a fotografia com a câmara do telemóvel.</p>
        <label class="btn primary" style="width:100%;text-align:center">📸 Abrir câmara<input type="file" accept="image/*,.heic,.heif" capture="user" id="phFile" hidden></label>
        ${galleryBtn('phGal', '📁 Escolher da galeria', 'btn')}
        <button class="btn ghost" id="phNo">Continuar sem fotografia</button></div>`, () => {
        bindFile('phFile'); bindFile('phGal');
        $('#phNo').onclick = photoDone;
      });
    }
    return set('ph-cam', header() + `<div class="middle">
      <h1 style="font-size:1.3em">Centra a cara no círculo</h1>
      <div class="cam-frame"><video id="cam" playsinline muted autoplay></video><div class="cam-ring"></div></div>
      <button class="btn primary shoot" id="shoot" disabled>📸 Tirar</button>
      ${galleryBtn('phGal', '📁 Escolher da galeria')}
      <button class="btn ghost" id="phNo">Continuar sem fotografia</button></div>`, () => {
      $('#shoot').onclick = capture;
      bindFile('phGal');
      $('#phNo').onclick = photoDone;
    });
  }
  if (photo.step === 'preview') {
    return set('ph-prev' + photo.data.length, header() + `<div class="middle">
      <h1 style="font-size:1.4em">Assim vais aparecer</h1>
      <div class="prev-row">
        <img class="prev-circle pop-in" src="${photo.data}" alt="A tua fotografia">
        <div class="retake-col">
          <button class="btn ghost retake" id="phAgain">🔄<br>Repetir</button>
          ${galleryBtn('phGal', '📁<br>Galeria', 'btn ghost retake')}
        </div>
      </div>
      <div class="ph-demo small">${dancer({ name: state.me.name, photo: photo.data }, 'disco', '#7dd3fc')}</div>
      <button class="btn primary" id="phUse" style="width:100%">✅ Usar esta fotografia</button>
      <button class="btn ghost" id="phNo">Não quero fotografia</button></div>`, () => {
      $('#phAgain').onclick = startCamera;
      bindFile('phGal');
      $('#phNo').onclick = () => { photo.data = null; photoDone(); };
      $('#phUse').onclick = () => {
        $('#phUse').disabled = true;
        send('player:photo', photo.data, res => {
          if (res && res.error) { $('#phUse').disabled = false; return toast(res.error, 4000); }
          Sound.play('pop'); photoDone();
        });
      };
    });
  }
}

// ---------- Modo tempo total: todas as perguntas, ao seu ritmo ----------
let exIdx = 0, exConfirm = false, exClock = null, exWarned = false;
function exClockStart() {
  clearInterval(exClock);
  const end = performance.now() + state.exam.remainingMs;
  const f = () => {
    const el = $('#exClock'); if (!el) return;
    const r = Math.max(0, end - performance.now()), m = Math.floor(r / 60000), sec = Math.floor(r / 1000) % 60;
    el.textContent = `⏳ ${m}:${String(sec).padStart(2, '0')}`;
    el.classList.toggle('hurry', r < 60000);
    if (r < 60000 && r > 0 && !exWarned) { exWarned = true; toast('Falta menos de 1 minuto! ⏰', 3500); Sound.play('tock'); navigator.vibrate && navigator.vibrate(200); }
  };
  f(); exClock = setInterval(f, 250);
}
// rascunho da pergunta aberta no exame: também se guarda quando o aluno sai da app (iPhone pode recarregar a página)
let examFlush = null;
document.addEventListener('visibilitychange', () => { if (document.hidden && examFlush && state && state.session.phase === 'exam') examFlush(); });
function renderExam() {
  const ex = state.exam, n = ex.questions.length, done = Object.keys(ex.mine).length;
  const top = `<div class="ex-top"><span id="exClock" class="ex-clock">⏳</span><span>${done}/${n} respondidas</span></div>`;
  if (ex.submitted) {
    set('ex-sent', header() + top + `<div class="middle"><div class="big-emoji pop-in">📨</div><h1>Entregue!</h1>
      <p>Respondeste a ${done} de ${n} perguntas.<br>Aguarda que o tempo acabe ou que o formador termine<span class="dots"></span></p></div>`);
    return exClockStart();
  }
  if (exConfirm) {
    const missing = ex.questions.map((_, i) => i).filter(i => ex.mine[i] == null);
    set('ex-confirm' + done, header() + top + `<div class="middle"><div class="big-emoji">📨</div><h1 style="font-size:1.5em">Entregar as respostas?</h1>
      <p>Respondeste a <b>${done} de ${n}</b> perguntas.${missing.length ? '<br>Ainda não respondeste a:' : ''}</p>
      ${missing.length ? `<div class="ex-chips">${missing.map(i => `<button class="ex-chip" data-go="${i}">${i + 1}</button>`).join('')}</div>` : ''}
      <p style="opacity:.85">Depois de entregar já não podes mudar as respostas.</p>
      <button class="btn primary" id="exSubmit" style="width:100%">✅ Entregar</button>
      <button class="btn ghost" id="exBack">← Voltar às perguntas</button></div>`, () => {
      $$('[data-go]').forEach(b => b.onclick = () => { exIdx = +b.dataset.go; exConfirm = false; render(); });
      $('#exBack').onclick = () => { exConfirm = false; render(); };
      $('#exSubmit').onclick = () => send('player:submit', res => { if (res && res.error) return toast(res.error); Sound.play('fanfare'); });
    });
    return exClockStart();
  }
  exIdx = Math.max(0, Math.min(n - 1, exIdx));
  const q = ex.questions[exIdx], mine = ex.mine[exIdx], exW = answerWidget(q, mine, true);
  set('ex' + exIdx + JSON.stringify(ex.mine), header() + top + `
    <div class="ex-chips">${ex.questions.map((_, i) => `<button class="ex-chip ${ex.mine[i] != null ? 'done' : ''} ${i === exIdx ? 'cur' : ''}" data-go="${i}">${i + 1}</button>`).join('')}</div>
    <div class="qmeta"><span>Pergunta ${exIdx + 1} de ${n}</span><span>${mine != null ? '✅ respondida' : ''}</span></div>
    ${(q.type === 'fill' && q.parts) ? '' : `<div class="qtext">${esc(q.text)}</div>`}${q.image && q.type !== 'spot' ? `<img class="qimg" src="${esc(q.image)}">` : ''}
    ${exW.html}
    <div class="ex-nav"><button class="btn ghost" id="exPrev" ${exIdx === 0 ? 'disabled' : ''}>← Anterior</button>
      ${exIdx < n - 1 ? `<button class="btn ghost" id="exNext">Seguinte →</button>` : `<button class="btn primary" id="exEnd">Rever e entregar ✅</button>`}</div>
    ${exIdx < n - 1 ? `<button class="btn ghost ex-submit-link" id="exEnd">Entregar</button>` : ''}`, () => {
    const flush = examFlush = () => {
      const d = exW.draft && exW.draft(), at = exIdx;
      if (d == null || JSON.stringify(d) === JSON.stringify(state.exam.mine[at])) return;
      send('player:examAnswer', { q: at, value: d }, res => { if (!res.error) state.exam.mine[at] = d; });
    };
    $$('[data-go]').forEach(b => b.onclick = () => { flush(); exIdx = +b.dataset.go; render(); });
    $('#exPrev').onclick = () => { flush(); exIdx--; render(); };
    const nx = $('#exNext'); if (nx) nx.onclick = () => { flush(); exIdx++; render(); };
    $$('#exEnd').forEach(b => b.onclick = () => { flush(); exConfirm = true; render(); });
    exW.bind((opt, btn, meta) => {
      const at = exIdx;
      send('player:examAnswer', { q: at, value: opt, meta }, res => {
        if (res && res.error) return toast(res.error, 3500);
        Sound.play('sent'); navigator.vibrate && navigator.vibrate(30);
        state.exam.mine[at] = opt;
        // passa sozinho para a próxima pergunta ainda sem resposta
        const nextFree = state.exam.questions.findIndex((_, i) => i > at && state.exam.mine[i] == null);
        if (nextFree >= 0) setTimeout(() => { if (exIdx === at) { exIdx = nextFree; render(); } }, 350);
        render();
      });
    });
  });
  exClockStart();
}

const isOpinion = q => { const t = (q && q.type) || 'mc'; return t === 'scale' || t === 'cloud' || (t === 'rank' && !q.ordered) || (t === 'mc' && !!q.poll); };
const optLabel = (opts, i) => opts && opts[i] ? `${LETTERS[i]}) ${esc(opts[i])}` : LETTERS[i];
const onScreenNote = `<div class="on-screen pop-in">👀 A pergunta e as opções estão no <b>ecrã do formador</b>.<br>Responde aqui com a letra.</div>`;

// Origem do texto colado, pelos metadados da área de transferência (versão HTML que acompanha o texto).
// Só guarda o nome da origem; o HTML em si nunca é enviado.
function pasteOrigin(html) {
  if (!html) return null;
  const h = html.toLowerCase();
  if (/data-start="\d+"[^>]*data-end="\d+"/.test(h) || h.includes('chatgpt') || h.includes('data-message-author-role') || h.includes('markdown prose')) return 'chatgpt';
  if (h.includes('gemini') || h.includes('model-response') || h.includes('markdown-main-panel')) return 'gemini';
  if (h.includes('claude.ai') || h.includes('font-claude') || h.includes('standard-markdown')) return 'claude';
  if (h.includes('copilot') || h.includes('cib-serp') || h.includes('ac-textblock')) return 'copilot';
  if (h.includes('perplexity')) return 'perplexity';
  if (h.includes('deepseek')) return 'deepseek';
  return 'formatado'; // copiado de uma página / app com formatação
}
// quantas vezes o formando saiu da app (mudou de separador/app) — usado nos sinais das respostas livres
let hiddenCount = 0;
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenCount++; });
// Desenha a forma de responder conforme o tipo. cur = resposta atual (modo tempo total).
// Devolve { html, bind(onAnswer) }; onAnswer(valor) recebe o índice, o número, as palavras ou o texto.
function answerWidget(q, cur, exam) {
  const t = q.type || 'mc';
  if (t === 'scale') return {
    html: `<div class="scale-btns ${q.scaleTo === 10 ? 'ten' : ''}">${Array.from({ length: q.scaleTo === 10 ? 10 : 5 }, (_, i) => i + 1).map((n, i) => `<button class="ans opt-${i} pop-in ${cur === n ? 'sel' : cur != null ? 'unsel' : ''}" style="animation-delay:${i * 60}ms" data-v="${n}">${n}</button>`).join('')}</div>
      ${q.scaleMin || q.scaleMax ? `<div class="scale-labels"><span>1 = ${esc(q.scaleMin)}</span><span>${q.scaleTo === 10 ? 10 : 5} = ${esc(q.scaleMax)}</span></div>` : ''}`,
    bind: on => $$('.scale-btns .ans').forEach(b => b.onclick = () => on(+b.dataset.v, b)),
  };
  if (t === 'cloud') {
    const n = q.words || 3, vals = Array.isArray(cur) ? cur : [];
    return {
      draft: () => { const w = $$('.cloud-w').map(x => x.value.trim()).filter(Boolean); return w.length ? w : null; },
      html: `<div class="cloud-in">${Array.from({ length: n }, (_, i) => `<input class="search cloud-w" maxlength="30" autocomplete="off" autocapitalize="none" enterkeyhint="${i < n - 1 ? 'next' : 'send'}" placeholder="${n > 1 ? `Palavra ${i + 1}${i ? ' (opcional)' : ''}` : 'A tua palavra'}" value="${esc(vals[i] || '')}">`).join('')}</div>
        <button class="btn primary" id="cloudSend" style="width:100%;margin-top:4px">${exam ? '💾 Guardar resposta' : '☁️ Enviar'}</button>`,
      bind: on => {
        const ins = $$('.cloud-w');
        ins.forEach((el, i) => el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (ins[i + 1]) ins[i + 1].focus(); else $('#cloudSend').click(); } });
        $('#cloudSend').onclick = () => { const w = ins.map(x => x.value.trim()).filter(Boolean); if (!w.length) return toast('Escreve pelo menos uma palavra.'); on(w, $('#cloudSend')); };
      },
    };
  }
  if (t === 'guess') {
    // adivinha a palavra: cada tentativa vai ao servidor, que devolve as cores (a palavra não está no telemóvel)
    const g0 = exam ? ((state.exam.guess || {})[exIdx] || { tries: [] }) : (state.guess || { tries: [] });
    let tries = g0.tries.slice(), done = !!g0.done, solved = !!g0.solved, typed = '', busy = false;
    const L = q.len, at = exam ? exIdx : null;
    const keyState = () => { const st = {}, rk = { r: 1, y: 2, g: 3 }; tries.forEach(tr => [...tr.word].forEach((ch, i) => { const c = tr.colors[i]; if (!st[ch] || rk[c] > rk[st[ch]]) st[ch] = c; })); return st; };
    const msg = () => done ? (solved ? `🎉 Acertaste à ${tries.length}ª tentativa!` : '😵 Acabaram as tentativas') : `Tentativa ${tries.length + 1} de ${q.maxTries}`;
    const kb = () => { const st = keyState();
      return ['QWERTYUIOP', 'ASDFGHJKL', '⏎ZXCVBNM⌫'].map(row => `<div class="kb-row">${[...row].map(k => {
        const label = k === '⏎' ? 'OK' : k, cls = k === '⏎' ? 'wide go' : k === '⌫' ? 'wide' : (st[k] || '');
        return `<button class="kb-k ${cls}" data-k="${k}" ${done ? 'disabled' : ''}>${label}</button>`; }).join('')}</div>`).join(''); };
    return {
      html: `<div id="gw">${guessBoardHtml(q, tries, typed, !done)}</div><p class="gw-msg" id="gwMsg">${msg()}</p><div class="kb" id="kb">${kb()}</div>`,
      bind: () => {
        let flipRow = -1;   // linha a animar (só a que acabou de ser enviada, uma vez)
        const paint = () => { const b = $('#gw'); if (!b) return; b.innerHTML = guessBoardHtml(q, tries, typed, !done, flipRow); flipRow = -1; $('#kb').innerHTML = kb(); $('#gwMsg').textContent = msg(); bindKeys(); };
        const tryWord = () => {
          if (typed.length < L) { const row = $('#gw .gw-row.cur'); if (row) { row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake'); } return toast(`A palavra tem ${L} letras`); }
          busy = true;
          send('player:guess', { q: at, word: typed }, res => {
            busy = false;
            if (!res || res.error) return toast((res && res.error) || 'Erro', 3500);
            tries.push({ word: typed, colors: res.colors }); typed = ''; done = res.done; solved = res.solved; flipRow = tries.length - 1;
            Sound.play(res.solved ? 'correct' : res.done ? 'wrong' : 'pop'); navigator.vibrate && navigator.vibrate(res.solved ? [40, 60, 40] : 30);
            if (res.solved) Confetti.burst(80);
            paint();
            if (!done) return;
            if (exam) {
              state.exam.mine[at] = tries.map(x => x.word); (state.exam.guess ||= {})[at] = { tries, done, solved };
              setTimeout(() => { if (exIdx !== at) return; const nf = state.exam.questions.findIndex((_, i) => i > at && state.exam.mine[i] == null); if (nf >= 0) exIdx = nf; render(); }, 1600);
            } else { state.guess = { tries, done, solved }; setTimeout(() => { state.answered = true; render(); }, 1600); }
          });
        };
        const press = k => { if (done || busy) return; if (k === '⌫') typed = typed.slice(0, -1); else if (k === '⏎') return tryWord(); else if (typed.length < L) typed += k; paint(); };
        const bindKeys = () => $$('#kb .kb-k').forEach(b => b.onclick = () => press(b.dataset.k));
        bindKeys();
        // teclado físico (computador / teclado bluetooth)
        if (window._gwKey) document.removeEventListener('keydown', window._gwKey);
        window._gwKey = e => { if (!$('#gw') || e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key === 'Enter' ? '⏎' : e.key === 'Backspace' ? '⌫' : cwNorm(e.key); if (k.length === 1 || k === '⏎' || k === '⌫') { e.preventDefault(); press(k); } };
        document.addEventListener('keydown', window._gwKey);
      },
    };
  }
  if (t === 'hangman') {
    // forca: cada letra vai ao servidor (a palavra não está no telemóvel); a cada erro o boneco perde uma peça
    const h0 = exam ? ((state.exam.hang || {})[exIdx] || null) : state.hang;
    const at = exam ? exIdx : null, max = q.maxWrong || 7;
    let letters = h0 ? h0.letters.slice() : [], wrong = h0 ? h0.wrong : 0, mask = h0 ? h0.mask : (q.shape || []).map(n => '_'.repeat(n)).join(' ');
    let done = !!(h0 && h0.done), solved = !!(h0 && h0.solved), busy = false, fresh = null, reveal = '';
    const msg = () => done ? (solved ? `🎉 Acertaste${wrong ? ` com ${wrong} erro${wrong > 1 ? 's' : ''}` : ' sem erros'}!` : `😵 Era «${reveal || '…'}»`) : `Erros: ${wrong} de ${max}`;
    const kb = () => ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'].map(row => `<div class="kb-row">${[...row].map(k => {
      const used = letters.includes(k), hit = used && mask.includes(k);
      return `<button class="kb-k ${used ? (hit ? 'g' : 'r') : ''}" data-k="${k}" ${used || done ? 'disabled' : ''}>${k}</button>`; }).join('')}</div>`).join('');
    const box = () => `<div class="hm-wrap">${hangmanSvg(wrong, max, solved, fresh)}</div>${hangWordHtml(mask)}<p class="gw-msg">${msg()}</p><div class="kb" id="hmKb">${kb()}</div>`;
    return {
      html: `<div id="hmBox">${box()}</div>`,
      bind: () => {
        const paint = () => { const b = $('#hmBox'); if (!b) return; b.innerHTML = box(); fresh = null; bindKeys(); };
        const press = k => {
          if (done || busy || letters.includes(k)) return;
          busy = true;
          send('player:hangman', { q: at, letter: k }, res => {
            busy = false;
            if (!res || res.error) return toast((res && res.error) || 'Erro', 3000);
            letters = res.letters; mask = res.mask; done = res.done; solved = res.solved; if (!res.hit) fresh = res.wrong; wrong = res.wrong; reveal = res.answer ? res.answer.toUpperCase() : reveal;
            Sound.play(res.solved ? 'correct' : res.done ? 'wrong' : res.hit ? 'pop' : 'softEnd'); navigator.vibrate && navigator.vibrate(res.hit ? 25 : [60, 40, 60]);
            if (res.solved) Confetti.burst(80);
            paint();
            if (!done) return;
            if (exam) {
              state.exam.mine[at] = letters; (state.exam.hang ||= {})[at] = { letters, wrong, mask, done, solved };
              setTimeout(() => { if (exIdx !== at) return; const nf = state.exam.questions.findIndex((_, i) => i > at && state.exam.mine[i] == null); if (nf >= 0) exIdx = nf; render(); }, 1800);
            } else { state.hang = { letters, wrong, mask, done, solved }; setTimeout(() => { state.answered = true; render(); }, 1800); }
          });
        };
        const bindKeys = () => $$('#hmKb .kb-k').forEach(b => b.onclick = () => press(b.dataset.k));
        bindKeys();
        if (window._hmKey) document.removeEventListener('keydown', window._hmKey);
        window._hmKey = e => { if (!$('#hmBox') || e.ctrlKey || e.metaKey || e.altKey) return; const k = cwNorm(e.key); if (k.length === 1 && /[A-Z]/.test(k)) { e.preventDefault(); press(k); } };
        document.addEventListener('keydown', window._hmKey);
      },
    };
  }
  if (t === 'scramble') {
    // toca nas letras pela ordem; tocar numa casa preenchida devolve a letra
    const tiles = q.tiles || [], shape = q.shape || [tiles.length], total = shape.reduce((a, b) => a + b, 0);
    let picked = [];   // índices das letras usadas, pela ordem
    if (typeof cur === 'string') { const want = [...cur.toUpperCase()].filter(ch => /\p{L}/u.test(ch)); const used = new Set(); want.forEach(ch => { const i = tiles.findIndex((x, k) => !used.has(k) && x === ch); if (i >= 0) { used.add(i); picked.push(i); } }); }
    const word = () => { let k = 0; return shape.map(n => picked.slice(k, k += n).map(i => tiles[i]).join('')).join(' '); };
    const html = () => { let k = 0;
      return `<div class="scr-slots">${shape.map(n => `<div class="scr-word">${Array.from({ length: n }, () => { const idx = k++, i = picked[idx]; return `<button class="scr-slot ${i != null ? 'on' : ''}" data-s="${idx}">${i != null ? esc(tiles[i]) : ''}</button>`; }).join('')}</div>`).join('')}</div>
        <div class="scr-tiles">${tiles.map((ch, i) => `<button class="scr-t ${picked.includes(i) ? 'used' : ''}" data-t="${i}" ${picked.includes(i) ? 'disabled' : ''}>${esc(ch)}</button>`).join('')}</div>`; };
    return {
      html: `<div id="scrBox">${html()}</div><div class="row" style="margin-top:12px;flex-wrap:nowrap"><button class="btn ghost" id="scrReset" style="flex:none">↺ Limpar</button>
        <button class="btn primary" id="scrSend" style="flex:1" ${picked.length === total ? '' : 'disabled'}>${exam ? '💾 Guardar' : '📨 Enviar'}</button></div>`,
      bind: on => {
        const refresh = () => { $('#scrBox').innerHTML = html(); bindIt(); $('#scrSend').disabled = picked.length !== total; };
        const bindIt = () => {
          $$('.scr-t').forEach(b => b.onclick = () => { if (picked.length >= total) return; picked.push(+b.dataset.t); Sound.play('pop'); refresh(); });
          $$('.scr-slot').forEach(b => b.onclick = () => { const k = +b.dataset.s; if (picked[k] != null) { picked.splice(k, 1); refresh(); } });
        };
        bindIt();
        $('#scrReset').onclick = () => { picked = []; refresh(); };
        $('#scrSend').onclick = () => on(word(), $('#scrSend'));
      },
    };
  }
  if (t === 'cross') {
    const cw = q.cross, vals = Array.isArray(cur) ? cur.map(v => v || '') : cw.words.map(() => '');
    let active = vals.findIndex(v => !v); if (active < 0) active = 0;
    const gridHtml = () => { const m = {}; crossCellsOf(cw.words[active]).forEach(k => m[k] = 'on'); return crossGridHtml(cw, crossLetters(cw, vals), m, 'phone'); };
    const cluesHtml = () => cw.words.map((w, k) => `<div class="cw-q ${k === active ? 'on' : ''} ${vals[k].length === w.len ? 'done' : ''}" data-k="${k}">
      <div class="cw-q-t"><b>${w.n}${w.dir === 'a' ? ' ➡' : ' ⬇'}</b> ${w.clue ? esc(w.clue) : 'Pista no ecrã do formador'} <small>(${w.len} letras)</small></div>
      <input class="cw-in" data-k="${k}" maxlength="${w.len}" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next" value="${esc(vals[k])}" placeholder="${'·'.repeat(w.len)}"></div>`).join('');
    return {
      draft: () => vals.some(Boolean) ? vals.slice() : null,
      html: `<div class="cw-wrap" id="cwGrid" style="--cols:${cw.cols}">${gridHtml()}</div><div class="cw-list">${cluesHtml()}</div>
        <button class="btn primary" id="cwSend" style="width:100%;margin-top:12px">${exam ? '💾 Guardar' : '📨 Enviar palavras'}</button>`,
      bind: on => {
        const paint = () => { $('#cwGrid').innerHTML = gridHtml(); $$('.cw-q').forEach(d => { const k = +d.dataset.k; d.classList.toggle('on', k === active); d.classList.toggle('done', vals[k].length === cw.words[k].len); }); bindGrid(); };
        const bindGrid = () => $$('#cwGrid .cw-cell').forEach(c => c.onclick = () => {
          // casa da grelha: vai para a palavra que passa por ela (se houver duas, alterna)
          const ws = cw.words.map((w, k) => crossCellsOf(w).includes(c.dataset.rc) ? k : -1).filter(k => k >= 0);
          const k = ws.length > 1 && ws.includes(active) ? ws[(ws.indexOf(active) + 1) % ws.length] : ws[0];
          if (k != null) { active = k; paint(); const inp = $(`.cw-in[data-k="${k}"]`); inp.focus(); }
        });
        $$('.cw-in').forEach(inp => {
          const k = +inp.dataset.k;
          inp.onfocus = () => { if (active !== k) { active = k; paint(); } };
          inp.oninput = () => {
            const v = cwNorm(inp.value).slice(0, cw.words[k].len);
            if (inp.value !== v) inp.value = v;
            vals[k] = v; paint();
            if (v.length === cw.words[k].len) { const nx = vals.findIndex((x, j) => j > k && x.length < cw.words[j].len); if (nx >= 0) $(`.cw-in[data-k="${nx}"]`).focus(); }
          };
          inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const nx = $(`.cw-in[data-k="${k + 1}"]`); if (nx) nx.focus(); else inp.blur(); } };
        });
        $$('.cw-q').forEach(d => d.onclick = e => { if (e.target.tagName !== 'INPUT') $(`.cw-in[data-k="${d.dataset.k}"]`).focus(); });
        bindGrid();
        $('#cwSend').onclick = () => {
          if (!vals.some(Boolean)) return toast('Escreve pelo menos uma palavra.');
          const miss = vals.filter((v, k) => v.length < cw.words[k].len).length;
          if (miss && !exam && !confirm(`Ainda há ${miss} palavra(s) por completar. Enviar assim?`)) return;
          on(vals.slice(), $('#cwSend'));
        };
      },
    };
  }
  if (t === 'number') {
    // adivinhar um número: barra + botões − / + (o número grande é o que vai ser enviado)
    const st = q.step || 1, dec = (String(st).split('.')[1] || '').length;
    // começa em "?" (o meio do intervalo pode ser a resposta certa): só dá para enviar depois de escolher
    let v = typeof cur === 'number' ? cur : null;
    const mid = Math.round(((q.min + q.max) / 2) / st) * st, fmt = x => x == null ? '?' : Number(x.toFixed(dec)).toLocaleString('pt-PT');
    return {
      draft: () => v,
      html: `<div class="num-box"><div class="num-val pop-in" id="numVal">${fmt(v)}</div>
        <div class="num-row"><button class="btn ghost num-pm" id="numMinus" aria-label="menos">−</button>
        <input type="range" id="numRange" class="${v == null ? 'unset' : ''}" min="${q.min}" max="${q.max}" step="${st}" value="${v ?? mid}" aria-label="número">
        <button class="btn ghost num-pm" id="numPlus" aria-label="mais">+</button></div>
        <div class="scale-labels"><span>${fmt(q.min)}</span><span>${fmt(q.max)}</span></div></div>
        <button class="btn primary" id="numSend" style="width:100%;margin-top:12px" ${v == null ? 'disabled' : ''}>${exam ? '💾 Guardar' : '📨 Enviar'}</button>`,
      bind: on => {
        const r = $('#numRange'), setV = x => { v = Math.min(q.max, Math.max(q.min, Number(x.toFixed(dec + 2)))); r.value = v; r.classList.remove('unset'); $('#numVal').textContent = fmt(v); $('#numSend').disabled = false; };
        r.oninput = () => setV(Number(r.value));
        $('#numMinus').onclick = () => { setV(v == null ? mid : v - st); Sound.play('pop'); };
        $('#numPlus').onclick = () => { setV(v == null ? mid : v + st); Sound.play('pop'); };
        $('#numSend').onclick = () => v != null && on(v, $('#numSend'));
      },
    };
  }
  if (t === 'match') {
    // correspondência: cada item da esquerda recebe uma letra da direita (uma letra não se repete)
    const lefts = q.lefts || [], rights = q.rights || [];
    const pick = Array.isArray(cur) ? cur.slice() : lefts.map(() => null);
    const html = () => `<div class="match-rights">${rights.map(r => `<div class="match-r opt-${r.k % 6} ${pick.includes(r.k) ? 'used' : ''}"><span class="letter">${r.letter}</span>${esc(r.text)}</div>`).join('')}</div>
      <div class="match-list">${lefts.map((l, i) => `<div class="match-row"><div class="match-l">${esc(l) || 'Item ' + (i + 1)}</div><div class="match-btns">${rights.map(r =>
        `<button class="match-b opt-${r.k % 6} ${pick[i] === r.k ? 'on' : ''}" data-i="${i}" data-k="${r.k}">${r.letter}</button>`).join('')}</div></div>`).join('')}</div>`;
    return {
      draft: () => pick.every(x => x == null) ? null : pick.slice(),
      html: `<div id="matchBox">${html()}</div><button class="btn primary" id="matchSend" style="width:100%;margin-top:12px" ${pick.every(x => x != null) ? '' : 'disabled'}>${exam ? '💾 Guardar' : '📨 Enviar ligações'}</button>`,
      bind: on => {
        const refresh = () => { $('#matchBox').innerHTML = html(); bindIt(); $('#matchSend').disabled = !pick.every(x => x != null); };
        const bindIt = () => $$('.match-b').forEach(b => b.onclick = () => {
          const i = +b.dataset.i, k = +b.dataset.k;
          if (pick[i] === k) pick[i] = null;
          else { const j = pick.indexOf(k); if (j >= 0) pick[j] = null; pick[i] = k; Sound.play('pop'); }
          // falta só um item e só sobra uma letra: liga sozinho
          const free = pick.map((x, n) => x == null ? n : -1).filter(n => n >= 0);
          if (free.length === 1) { const left = rights.find(r => !pick.includes(r.k)); if (left) pick[free[0]] = left.k; }
          refresh();
        });
        bindIt();
        $('#matchSend').onclick = () => on(pick.slice(), $('#matchSend'));
      },
    };
  }
  if (t === 'spot') {
    const n = q.spots || 1;
    let pts = Array.isArray(cur) ? cur.slice() : [];   // [x1, y1, x2, y2, …]
    const label = () => n > 1 ? `🎯 Confirmar (${pts.length / 2} de ${n})` : '🎯 Confirmar';
    return {
      draft: () => pts.length ? pts.slice() : null,
      html: `${n > 1 ? `<p class="center" style="margin:4px 0">Toca nos <b>${n}</b> sítios. Tocar num ponto tira-o.</p>` : ''}<div id="spotBox">${spotHtml(q, pts, null, true)}</div>
        <button class="btn primary" id="spotSend" style="width:100%;margin-top:12px" ${pts.length ? '' : 'disabled'}>${exam ? '💾 Guardar' : label()}</button>`,
      bind: on => {
        const bindIt = () => { const img = $('#spotBox img'); img.onclick = e => {
          const r = img.getBoundingClientRect();
          const [x, y] = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))].map(v => Math.round(v * 1000) / 1000);
          // perto de um ponto já marcado: tira-o; senão acrescenta (com um só sítio, troca)
          const near = []; for (let k = 0; k < pts.length; k += 2) if (Math.hypot((pts[k] - x) * r.width, (pts[k + 1] - y) * r.height) < 14) near.push(k);
          if (near.length) pts.splice(near[0], 2);
          else if (n === 1) pts = [x, y];
          else if (pts.length / 2 < n) pts.push(x, y);
          else return toast(`Já marcaste ${n} sítios: toca num ponto para o tirar.`);
          $('#spotBox').innerHTML = spotHtml(q, pts, null, true); bindIt();
          $('#spotSend').disabled = !pts.length; if (!exam) $('#spotSend').textContent = label();
          Sound.play('pop'); navigator.vibrate && navigator.vibrate(20);
        }; };
        bindIt();
        $('#spotSend').onclick = () => {
          if (!pts.length) return;
          if (!exam && pts.length / 2 < n && !confirm(`Só marcaste ${pts.length / 2} de ${n} sítios. Enviar assim?`)) return;
          on(pts.slice(), $('#spotSend'));
        };
      },
    };
  }
  if (t === 'rank') {
    // toca nas opções pela ordem; tocar numa já numerada tira-a (e as seguintes sobem)
    let order = Array.isArray(cur) ? cur.slice() : [];
    const items = q.items || [];
    const html = () => items.map((it, k) => { const pos = order.indexOf(it.i);
      return `<button class="rank-item opt-${k % 6} ${pos >= 0 ? 'on' : ''}" data-i="${it.i}"><span class="rank-n">${pos >= 0 ? pos + 1 + 'º' : ''}</span><span class="letter">${it.letter}</span><span class="rank-t">${esc(it.text)}</span></button>`; }).join('');
    return {
      html: `<div class="rank-list" id="rankList">${html()}</div>
        <div class="row" style="margin-top:10px;flex-wrap:nowrap"><button class="btn ghost" id="rankReset" style="flex:none">↺ Limpar</button>
        <button class="btn primary" id="rankSend" style="flex:1" ${order.length === items.length ? '' : 'disabled'}>${exam ? '💾 Guardar ordem' : '📨 Enviar ordem'}</button></div>`,
      bind: on => {
        const refresh = () => { $('#rankList').innerHTML = html(); bindItems(); $('#rankSend').disabled = order.length !== items.length; };
        const bindItems = () => $$('.rank-item').forEach(b => b.onclick = () => {
          const i = +b.dataset.i, pos = order.indexOf(i);
          if (pos >= 0) order.splice(pos, 1);
          else {
            order.push(i); Sound.play('pop');
            // falta só uma: entra sozinha em último
            if (order.length === items.length - 1) order.push(items.find(it => !order.includes(it.i)).i);
          }
          refresh();
        });
        bindItems();
        $('#rankReset').onclick = () => { order = []; refresh(); };
        $('#rankSend').onclick = () => on(order.slice(), $('#rankSend'));
      },
    };
  }
  if (t === 'open') return {
    draft: () => ($('#openIn') || {}).value?.trim() || null,
    html: `<textarea id="openIn" class="open-in" maxlength="300" rows="4" placeholder="Escreve a tua resposta…">${esc(typeof cur === 'string' ? cur : '')}</textarea>
      <button class="btn primary" id="openSend" style="width:100%;margin-top:10px">${exam ? '💾 Guardar resposta' : '📨 Enviar resposta'}</button>`,
    bind: on => {
      // sinais de escrita (só para o formador): quanto foi colado, quanto foi escrito e se saiu da app
      const ta = $('#openIn'), m = { pasted: 0, keys: 0, start: performance.now(), firstKey: null, hidden0: hiddenCount, source: null };
      ta.addEventListener('paste', e => {
        const cd = e.clipboardData || window.clipboardData; const t = cd?.getData('text') || '';
        m.pasted += t.length;
        let src = null; try { src = pasteOrigin(cd?.getData('text/html') || ''); } catch {}
        if (src && (!m.source || m.source === 'formatado')) m.source = src;
      });
      ta.addEventListener('beforeinput', e => {
        if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') return;
        if (/^insert/.test(e.inputType) && e.data) { m.keys += e.data.length; if (m.firstKey == null) m.firstKey = performance.now(); }
      });
      $('#openSend').onclick = () => {
        const v = $('#openIn').value.trim(); if (!v) return toast('Escreve a tua resposta.');
        const now = performance.now();
        on(v, $('#openSend'), { pasted: m.pasted, keys: m.keys, ms: Math.round(now - m.start), typingMs: m.firstKey == null ? 0 : Math.round(now - m.firstKey), hidden: hiddenCount - m.hidden0, pasteSource: m.source });
      };
    },
  };
  if (t === 'fill') {
    const n = q.blanks, vals = Array.isArray(cur) ? cur.slice() : Array(n).fill(null);
    const slot = i => `<button class="slot ${vals[i] ? 'filled' : ''}" data-b="${i}">${vals[i] ? esc(vals[i]) : (i + 1)}</button>`;
    return {
      html: `<div class="fill-phone">${q.parts ? sentenceHtml(q.parts, slot) : Array.from({ length: n }, (_, i) => `<div>Espaço ${i + 1}: ${slot(i)}</div>`).join('')}</div>
        <p class="center" style="margin:8px 0 6px;opacity:.85">Toca numa palavra para a pôr no próximo espaço; toca num espaço para o limpar.</p>
        <div class="wbank">${q.bank.map(w => `<button class="wchip" data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div>
        <button class="btn primary" id="fillSend" style="width:100%;margin-top:12px" ${vals.every(Boolean) ? '' : 'disabled'}>${exam ? '💾 Guardar resposta' : '📨 Enviar resposta'}</button>`,
      bind: on => {
        const refresh = () => { $$('.slot').forEach(sl => { const i = +sl.dataset.b; sl.textContent = vals[i] || (i + 1); sl.classList.toggle('filled', !!vals[i]); }); $('#fillSend').disabled = !vals.every(Boolean); };
        $$('.wchip').forEach(c => c.onclick = () => { const i = vals.findIndex(v => !v); if (i < 0) return toast('Todos os espaços estão preenchidos: toca num para o trocar.'); vals[i] = c.dataset.w; Sound.play('pop'); refresh(); });
        $$('.slot').forEach(sl => sl.onclick = () => { vals[+sl.dataset.b] = null; refresh(); });
        $('#fillSend').onclick = () => on(vals.slice(), $('#fillSend'));
      },
    };
  }
  // escolha múltipla / verdadeiro-falso
  return {
    html: `<div class="answers ${exam ? 'ex-answers' : ''} ${q.options.length === 2 ? 'n2' : ''} ${!q.hidden && q.options.some(o => String(o).length > 38) ? 'long' : ''} ${q.hidden ? 'letters-only' : ''}">${q.options.map((o, i) => `<button class="ans opt-${i} ${exam ? (cur === i ? 'sel' : cur != null ? 'unsel' : '') : 'pop-in'}" style="animation-delay:${i * 70}ms" data-i="${i}"><span class="letter">${LETTERS[i]}</span>${esc(o)}</button>`).join('')}</div>`,
    bind: on => $$('.answers .ans').forEach(b => b.onclick = () => on(+b.dataset.i, b)),
  };
}
// quadro do "adivinha a palavra": linhas já tentadas (com cores), a linha a escrever e as vazias
function guessBoardHtml(q, tries, typed, live, flipRow = -1) {
  const L = q.len, rows = [];
  for (let r = 0; r < q.maxTries; r++) {
    const tr = tries[r], cur = live && r === tries.length;
    if (!live && !tr) continue;
    rows.push(`<div class="gw-row ${cur ? 'cur' : ''}">${Array.from({ length: L }, (_, i) => {
      const ch = tr ? tr.word[i] : cur ? (typed[i] || '') : '';
      const flip = tr && r === flipRow;
      return `<span class="gw-c ${tr ? tr.colors[i] + (flip ? ' flip' : '') : ch ? 'typed' : ''}" style="${flip ? `animation-delay:${i * 90}ms` : ''}">${esc(ch)}</span>`; }).join('')}</div>`);
  }
  return `<div class="gw" style="--len:${L}">${rows.join('')}</div>`;
}
// imagem do "encontrar na imagem", com o ponto tocado e (na revelação) a zona certa
function spotHtml(q, pts, zones, live) {
  const pc = x => (x * 100).toFixed(1) + '%', P = []; pts = pts || [];
  for (let k = 0; k + 1 < pts.length; k += 2) P.push([pts[k], pts[k + 1]]);
  return `<div class="spot ${live ? 'live' : ''}"><img src="${esc(q.image || '')}" alt="imagem da pergunta" draggable="false">
    ${(zones || []).map(z => `<div class="spot-zone" style="left:${pc(z.x)};top:${pc(z.y)};width:${pc(z.w)};height:${pc(z.h)}"></div>`).join('')}
    ${P.map(([x, y], k) => `<div class="spot-pin pop-in" style="left:${pc(x)};top:${pc(y)}">${P.length > 1 || (q.spots || 1) > 1 ? k + 1 : ''}</div>`).join('')}</div>`;
}
// ---------- Batata quente ----------
let potLast = null, potEnd = 0, potTot = 1, potRaf = 0;
function renderPotato(s) {
  const P = state.potato;
  if (!P) return set('potwait' + s.qIndex, header() + qmeta() + `<div class="middle"><div class="big-emoji wiggle">🥔</div><h1>A preparar a batata…</h1></div>`);
  const sig = JSON.stringify([P.status, P.round, P.holder && P.holder.id, P.rep, P.isRep, P.mine, P.log.length, P.groups.map(g => g.score), P.question && P.question.n]);
  // sons e vibração quando a batata chega ao grupo, quando é a minha vez e quando rebenta
  if (potLast && potLast !== sig) {
    if (P.status === 'boom') { Sound.play('wrong'); navigator.vibrate && navigator.vibrate(400); }
    else if (P.isRep) { Sound.play('pop'); navigator.vibrate && navigator.vibrate([60, 40, 60]); }
    else if (P.mine) { navigator.vibrate && navigator.vibrate(40); }
  }
  potLast = sig;
  let body;
  if (P.status === 'between') body = `<div class="big-emoji pop-in">✅</div><h1>Secção concluída!</h1><p>Vem aí a próxima…</p>`;
  else if (P.status === 'boom') body = `<div class="big-emoji wiggle">💥</div><h1>Rebentou com ${esc(P.boom.name)}!</h1>
    <p>${P.myGroup && P.boom.id === P.myGroup.id ? `O teu grupo perde ${P.boom.penalty} pontos 😬` : 'Vem aí a próxima ronda…'}</p>`;
  else if (P.isRep) body = `<div class="pot-me pop-in">🥔 É a TUA vez!</div><p style="margin:4px 0 10px">${P.question ? 'Responde à pergunta e passa a batata — depressa!' : 'Escreve uma palavra sobre o tema e passa a batata — depressa!'}</p>
    <form id="potForm" class="pot-form"><input id="potIn" class="search" maxlength="60" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="send" placeholder="${P.question ? 'A tua resposta' : 'A tua palavra'}">
    <button class="btn primary">🔥 Passar</button></form><p id="potMsg" class="pot-msg"></p>`;
  else if (P.mine) body = `<div class="pot-me pop-in">🥔 A batata está com o teu grupo!</div><p>É a vez de <b>${esc(P.rep || '')}</b> — ajuda a pensar ${P.question ? 'na resposta' : 'numa palavra'}!</p>`;
  else body = `<div class="big-emoji">🥔</div><p style="font-size:1.15em">A batata está com <b style="color:${P.holder ? P.holder.color : '#fff'}">${P.holder ? esc(P.holder.name) : '—'}</b>${P.rep ? `<br><small>(vez de ${esc(P.rep)})</small>` : ''}</p>`;
  set('pot' + s.qIndex + sig, header() + qmeta() + `<div class="pot-wrap">
    <div class="pot-round">Ronda ${P.round} de ${P.rounds}${P.myGroup ? ` · ${P.myGroup.emoji} ${esc(P.myGroup.name)}` : ''}</div>
    ${P.question && P.status === 'running' ? `<div class="pot-theme pot-qq"><small>${esc(P.theme)} · pergunta ${P.question.n} de ${P.question.total}</small>${esc(P.question.text)}</div>` : `<div class="pot-theme">${esc(P.theme)}</div>`}
    ${P.status === 'running' ? '<div class="pot-fuse"><i id="potFuse"></i></div>' : ''}
    <div class="pot-body">${body}</div>
    ${P.last ? `<div class="pot-lastp">✅ «${esc(P.last.word)}»${P.last.a ? ` — ${esc(P.last.a)}` : ''}</div>` : ''}
    ${!P.question && P.log.some(l => l.word) ? `<div class="pot-log">${P.log.filter(l => l.word).map(l => `<span>${esc(l.word)}</span>`).join('')}</div>` : ''}</div>`, () => {
    const f = $('#potForm'); if (!f) return;
    const inp = $('#potIn'); inp.focus();
    f.onsubmit = e => {
      e.preventDefault(); const w = inp.value.trim(); if (!w) return;
      const b = $('#potForm button'); b.disabled = true;
      send('player:potato', w, res => {
        if (b.isConnected) b.disabled = false;
        if (!res || res.error) return toast((res && res.error) || 'Erro', 3000);
        if (res.ok) { Sound.play('correct'); toast(`+${res.pts} pontos! 🔥 A batata passou`, 2500); return; }
        Sound.play('softEnd'); inp.select();
        const m = $('#potMsg'); if (m) m.textContent = res.reason === 'used' ? 'Essa já foi dita! Tenta outra.' : 'Não foi aceite. Tenta outra palavra!';
      });
    };
  });
  // rastilho (a arder até a batata rebentar; nunca volta ao início quando a batata passa)
  potEnd = performance.now() + P.remainingMs; potTot = P.totalMs || 1;
  if (P.status === 'running' && !potRaf) {
    const tick = () => { const el = $('#potFuse'); if (!el) { potRaf = 0; return; } const r = Math.max(0, potEnd - performance.now()); el.style.transform = `scaleX(${r / potTot})`; potRaf = r > 0 ? requestAnimationFrame(tick) : 0; };
    potRaf = requestAnimationFrame(tick);
  }
}
// forca: a palavra com as letras descobertas (as outras em branco)
const hangWordHtml = mask => `<div class="hm-word">${String(mask || '').split(' ').map(w => `<span class="hm-w">${[...w].map(c => `<b class="${c === '_' ? '' : 'on'}">${c === '_' ? '' : esc(c)}</b>`).join('')}</span>`).join('')}</div>`;
// resumo da resposta dada, para mostrar depois de enviar
function answerSummary(q, v) {
  const t = q.type || 'mc';
  if (v == null) return '';
  if (t === 'scale') return `⭐ ${v} de ${q.scaleTo === 10 ? 10 : 5}`;
  if (t === 'fill') return (v || []).map(esc).join(' · ');
  if (t === 'open') return `“${esc(v)}”`;
  if (t === 'cloud') return '☁️ ' + (v || []).map(esc).join(' · ');
  if (t === 'scramble') return `<b style="font-size:1.4em;letter-spacing:.08em">${esc(String(v).toUpperCase())}</b>`;
  if (t === 'guess') return (v || []).map(esc).join(' → ');
  if (t === 'hangman') return 'Letras: ' + (v || []).map(esc).join(' ');
  if (t === 'number') return `<b style="font-size:1.6em">${esc(Number(v).toLocaleString('pt-PT'))}</b>`;
  if (t === 'match') return `<div style="text-align:left">${(q.lefts || []).map((l, i) => { const r = (q.rights || [])[(v || [])[i]]; return `${esc(l)} → ${r ? `<b>${r.letter}</b> ${esc(r.text)}` : '—'}`; }).join('<br>')}</div>`;
  if (t === 'spot') return `🎯 ${(q.spots || 1) > 1 ? `Marcaste ${(v || []).length / 2} de ${q.spots} sítios` : 'Tocaste na imagem'}${spotHtml(q, v, null)}`;
  if (t === 'cross') return `<div style="text-align:left">${q.cross.words.map((w, k) => `${w.n}${w.dir === 'a' ? '→' : '↓'} ${esc((v || [])[k] || '—')}`).join('<br>')}</div>`;
  if (t === 'rank') { const txt = i => { const it = (q.items || []).find(x => x.i === i); return it ? (it.text ? esc(it.text) : it.letter) : '?'; }; return `<div style="text-align:left">${(v || []).map((i, k) => `${k + 1}º ${txt(i)}`).join('<br>')}</div>`; }
  return optLabel(q.options, v);
}

function qmeta() { const s = state.session; return `<div class="qmeta"><span>Pergunta ${s.qIndex + 1} de ${s.total}</span><span>${esc(s.quizTitle)}</span></div>`; }
render();
