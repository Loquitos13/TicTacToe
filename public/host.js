let PW = sessionStorage.getItem('aq_tok') || '';
let socket = null, S = null; // estado do servidor
let students = [], quizzes = [], courses = [], joinUrl = '';
const courseName = id => (courses.find(c => c.id === id) || {}).name || '—';
const reloadCQ = async () => { [courses, quizzes] = await Promise.all([api('GET', '/api/courses'), api('GET', '/api/quizzes')]); };
let tab = 'game';

const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'x-host-token': PW }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { sessionStorage.removeItem('aq_tok'); location.reload(); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};

$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const pw = $('#pw').value;
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }).then(r => r.json());
  if (!r.ok) { $('#login .card').classList.remove('shake'); void $('#login .card').offsetWidth; $('#login .card').classList.add('shake'); return toast(r.error || 'Palavra-passe errada'); }
  PW = r.token; sessionStorage.setItem('aq_tok', PW); start();  // a palavra-passe não fica guardada: só o token da sessão
};
if (PW) start();

async function start() {
  $('#login').classList.add('hidden'); $('#main').classList.remove('hidden');
  muteButton();
  [students, quizzes, courses] = await Promise.all([api('GET', '/api/students'), api('GET', '/api/quizzes'), api('GET', '/api/courses')]);
  const info = await api('GET', '/api/joininfo');
  // o túnel da Cloudflare (npm run online) ganha sempre; um endereço trycloudflare antigo guardado já não serve
  const saved = localStorage.getItem('aq_joinurl') || '';
  joinUrl = info.tunnel || (/trycloudflare\.com/.test(saved) ? '' : saved) || info.suggestions[0];
  window._joinSuggestions = info.suggestions;
  socket = io({ auth: { role: 'host', token: PW } });
  socket.on('auth_error', () => { sessionStorage.removeItem('aq_tok'); location.reload(); });
  socket.on('disconnect', () => document.body.classList.add('offline'));
  socket.on('connect', () => document.body.classList.remove('offline'));
  socket.on('state', st => { const prev = S; S = st.session; onState(prev); });
  socket.on('toast', m => toast(m));
  // o túnel ficou pronto depois de a página abrir: o QR code passa a usar o endereço da internet
  socket.on('tunnel', u => { joinUrl = u; window._joinSuggestions = [u, ...window._joinSuggestions.filter(x => x !== u)]; toast('🌍 Online: o QR code já usa ' + u, 5000); if (S && S.phase === 'lobby') renderGame(true); });
  $$('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  document.addEventListener('keydown', e => {
    if (tab !== 'game' || !S || e.repeat || S.phase === 'exam' || document.querySelector('.dlg') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
  });
}

function showTab(t) {
  tab = t;
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  ['game', 'students', 'quizzes', 'results', 'feedback'].forEach(x => $('#tab-' + x).classList.toggle('hidden', x !== t));
  if (t === 'students') renderStudents();
  if (t === 'quizzes') renderQuizzes();
  if (t === 'results') renderResultsList();
  if (t === 'feedback') { fbView = { kind: 'list' }; renderFeedback(); }
  if (t === 'game') renderGame(true);
}

/* =================== JOGO =================== */
let lastPhaseKey = '', tickTimer = null, lastControls = '';
function next() { Sound.init(); if (!socket.connected) return toast('Sem ligação ao servidor — espera que volte.'); socket.emit('host:next', lastPhaseKey); }
const timed = () => S && S.settings.mode !== 'manual'; // por tempo ou automático
const isAuto = () => S && S.settings.mode === 'auto';
const isExamMode = () => S && S.settings.mode === 'exam';
const pollOn = () => S && S.settings.showPoll !== false;
const hiddenReveal = () => S && (S.settings.revealMode || 'each') !== 'each';
// neste dispositivo, mostrar as respostas corretas? (o projetor fica sem elas; o portátil/telemóvel do formador com elas)
let seeAnswers = false; try { seeAnswers = localStorage.getItem('aq_see_answers') === '1'; } catch {}
const showCorrectHere = () => !hiddenReveal() || seeAnswers;
const connectedN = () => S.players.filter(p => p.connected).length;

function onState(prev) {
  const key = S ? S.phase + ':' + S.qIndex : 'none';
  const changed = key !== lastPhaseKey;
  lastPhaseKey = key;
  if (changed) phaseSound(prev);
  if (!S || S.phase !== 'end') showAnswersList = false;
  if (tab === 'game') renderGame(changed);
  runAutoInfo();
}

function phaseSound(prev) {
  clearInterval(tickTimer);
  if (!S) return Sound.stopMusic();
  const ph = S.phase;
  if (ph === 'lobby') Sound.music('lobby');
  if (ph === 'exam') { Sound.play('whoosh'); Sound.music('think'); }
  if (ph === 'ready') { Sound.stopMusic(); [0, 1000, 2000].forEach(t => setTimeout(() => S && S.phase === 'ready' && Sound.play('tock'), t)); }
  if (ph === 'question') {
    Sound.play('whoosh'); Sound.music('think');
    if (timed()) {
      const end = Date.now() + S.remainingMs;
      tickTimer = setInterval(() => { const r = Math.ceil((end - Date.now()) / 1000); if (r <= 5 && r > 0) Sound.play(r <= 3 ? 'tock' : 'tick'); }, 1000);
    }
  }
  if (ph === 'closed') { Sound.stopMusic(0.8); Sound.play('softEnd'); }
  if (ph === 'reveal') { Sound.stopMusic(); Sound.play(showCorrectHere() ? 'revealCorrect' : 'pop'); }
  if (ph === 'leaderboard') {
    // aplausos ao entrar o pódio; quando acabam começa a música de festa (em loop até à próxima pergunta)
    Sound.stopMusic(); Sound.play('cheer', CHEER_S);
    setTimeout(() => S && S.phase === 'leaderboard' && Confetti.burst(120), 1600);
    setTimeout(() => S && S.phase === 'leaderboard' && Sound.music('party'), CHEER_S * 1000 + 150);
  }
  if (ph === 'end') {
    Sound.stopMusic();
    if (!S.settings.finalPodium) { Sound.play('fanfare'); Confetti.burst(200); return; }
    Sound.play('drumroll', FINAL_FIRST_AT - .2);
    setTimeout(() => { if (S && S.phase === 'end') { Sound.play('fanfare'); Sound.play('cheer', CHEER_S + 0.6); Confetti.burst(300); setTimeout(() => S && S.phase === 'end' && Sound.music('party'), (CHEER_S + 0.6) * 1000 + 150); } }, FINAL_FIRST_AT * 1000);
  }
}

// modo automático: mostra quanto falta para avançar sozinho
let autoTick = null;
function runAutoInfo() {
  clearInterval(autoTick);
  const el = () => $('#autoInfo');
  if (!S || !isAuto() || S.settings.paused || !S.autoMs) { if (el()) el().textContent = S && isAuto() && S.settings.paused ? '⏸ Em pausa' : ''; return; }
  const end = Date.now() + S.autoMs;
  const f = () => { const r = Math.max(0, Math.ceil((end - Date.now()) / 1000)); if (el()) el().textContent = r ? `⏱ avança em ${r}s ·` : ''; if (!r) clearInterval(autoTick); };
  f(); autoTick = setInterval(f, 250);
}

function renderGame(full) {
  const el = $('#tab-game');
  if (!S) return full ? renderSetup(el) : undefined;
  if (!full) return updateLive();
  const ph = S.phase;
  let html = `<div id="stage"><div class="stage-top"><span>${S.courseName ? '🎓 ' + esc(S.courseName) + ' · ' : ''}📝 ${esc(S.quizTitle)}</span>
    <span>${isExamMode() ? '⏳ Tempo total' : isAuto() ? '🤖 Automático' : timed() ? '⏱ Por tempo' : '🎮 Manual'} · ${ph === 'lobby' ? 'Sala aberta' : ph === 'end' ? 'Final' : ph === 'exam' ? `${S.total} perguntas` : `Pergunta ${S.qIndex + 1} / ${S.total}`}</span></div>`;
  if (ph === 'lobby') html += lobbyHtml();
  if (ph === 'ready') html += readyHtml();
  if (ph === 'exam') html += examHtml();
  if (ph === 'question') html += questionHtml();
  const firstPoll = ph === 'closed' && !closedShown.has(S.id + ':' + S.qIndex);
  if (ph === 'closed') { html += resultsHtml(false, firstPoll); closedShown.add(S.id + ':' + S.qIndex); }
  if (ph === 'reveal') html += showCorrectHere() ? resultsHtml(true) + (hiddenReveal() ? `<p class="center private-note">👁 Só neste ecrã: os formandos não veem a resposta correta.</p>` : '') : hiddenRevealHtml();
  if (ph === 'leaderboard') html += S.settings.teams ? `<div class="big-msg slide-up" style="font-size:2.4em;margin:0">🏆 Equipas</div>` + teamPodiumHtml(false)
    : `<div class="big-msg slide-up" style="font-size:2.4em;margin:0">🏆 Top 5</div>` + podiumHtml(S.ranking.slice(0, 5), false);
  if (ph === 'end') html += (showAnswersList ? answersListHtml() : endHtml());
  lastControls = controlsHtml();
  html += `</div>` + lastControls;
  el.innerHTML = html;
  $$('#tab-game .cloud').forEach(c => { c.dataset.sig = JSON.stringify(S.cloud || []); renderCloud(c, S.cloud); });
  bindGame();
  if (ph === 'question' && timed()) runRing();
  if (ph === 'ready') runReady();
  if (ph === 'exam') runExamClock();
  const tu = $('.timeup'); if (tu) tu.addEventListener('animationend', () => tu.classList.add('hidden'));
  // sondagem: as barras e as percentagens sobem de 0% até ao valor (com som); na resposta correta já aparecem cheias
  if (ph === 'closed' && firstPoll && pollOn()) growPoll(timed() ? 1700 : 700);
  else if (ph === 'closed' || ph === 'reveal') $$('.opt .fill').forEach(f => { f.style.transition = 'none'; f.style.width = f.dataset.w; });
}

// o QR code leva o código único desta sessão
const sessionUrl = () => joinUrl.replace(/\/$/, '') + '/?c=' + encodeURIComponent(S.code);
const phonesNote = () => S.settings.hideOnPhones ? `<div class="phones-note">📱 As perguntas só aparecem <b>neste ecrã</b> — mantém-no projetado. Os formandos respondem no telemóvel com A, B, C, D.</div>` : '';
function lobbyHtml() {
  return phonesNote() + `<div class="lobby">
    <div class="qrbox slide-up">
      <div style="font-size:1.3em;font-weight:600">Entra com o telemóvel 📱</div>
      <img src="/api/qr?url=${encodeURIComponent(sessionUrl())}" alt="QR code">
      <div class="url">${esc(joinUrl.replace(/^https?:\/\//, ''))}</div>
      <div class="code-label">Código da sessão</div>
      <div class="code-big">${esc(S.code)}</div>
      <details class="noprint" style="margin-top:10px;text-align:left"><summary class="muted" style="cursor:pointer">Mudar endereço</summary>
        <div class="list" style="margin-top:8px">
          <select id="urlSel">${window._joinSuggestions.map(u => `<option ${u === joinUrl ? 'selected' : ''}>${esc(u)}</option>`).join('')}<option value="">Outro…</option></select>
          <input type="url" id="urlIn" value="${esc(joinUrl)}" placeholder="https://o-teu-endereco-publico">
          <button class="btn small primary" id="urlSave">Usar este endereço</button>
        </div></details>
    </div>
    <div>
      <div class="row"><div class="count-big" id="joinCount">${connectedN()}</div><div style="font-size:1.3em">${S.settings.anonymous ? `participantes<br>anónimos já entraram` : `de <span id="rosterN">${S.roster.length}</span> alunos<br>já entraram`}</div></div>
      ${S.settings.teams ? `<div class="row noprint" style="margin-top:14px"><button class="btn small" id="btnShuffleTeams">🔀 Baralhar equipas</button><span class="muted" style="color:#ddd">Toca num formando para o mudar de equipa.</span></div>
        <div class="teams-lobby ${S.roster.length > 20 ? 'many' : ''}" id="teamsLobby">${teamsLobbyHtml()}</div>` : `<div class="joined ${S.roster.length > 20 ? 'many' : ''}" id="joined" style="margin-top:20px">${joinedHtml()}</div>`}
    </div></div>`;
}
// sala de espera com equipas: uma coluna por equipa; quem ainda não entrou fica por baixo
function teamsLobbyHtml() {
  const cols = (S.teamList || []).map(t => {
    const ps = S.players.filter(p => p.team === t.id);
    return `<div class="tl-col" style="--tc:${t.color}"><div class="tl-head">${t.emoji} ${esc(t.name)} <small>${ps.length}</small></div>
      ${ps.map(p => { const st = S.roster.find(r => r.id === p.studentId) || p; return `<button class="tl-p ${p.connected ? '' : 'off'}" data-move="${esc(p.studentId)}" title="Mudar de equipa">${avatar(st, 'sm')}<span>${esc(st.short || st.name)}</span></button>`; }).join('') || '<div class="tl-empty">—</div>'}</div>`;
  }).join('');
  const missing = S.roster.filter(r => !S.players.some(p => p.studentId === r.id));
  return `<div class="tl-cols">${cols}</div>${missing.length ? `<p class="tl-missing">Ainda não entraram: ${missing.map(r => esc(r.short || r.name)).join(', ')}</p>` : ''}`;
}
function joinedHtml() {
  const joined = new Map(S.players.map(p => [p.studentId, p]));
  if (S.settings.anonymous) return S.roster.map(s => { const p = joined.get(s.id);
    return `<div class="p ${p && p.connected ? 'pop-in' : 'off'}" data-id="${s.id}" data-photo=""><span class="avatar lg" style="background:#334155">🕶️</span><span>${esc(s.short || 'Anónimo')}</span></div>`; }).join('');
  return S.roster.map(s => {
    const p = joined.get(s.id);
    return `<div class="p ${p && p.connected ? 'pop-in' : 'off'}" data-id="${s.id}" data-photo="${esc(s.photo || '')}">${avatar(s, 'lg')}<span title="${esc(s.name)}">${esc(s.short || s.name)}</span></div>`;
  }).join('');
}

// ---------- modo tempo total: relógio e progresso de cada formando ----------
function examHtml() {
  return `<div class="exam-top"><div class="exam-clock" id="examClock">--:--</div>
      <div class="exam-sub">para responder a todas as ${S.total} perguntas · cada um ao seu ritmo</div></div>
    <div class="exam-stats" id="examStats">${examStatsHtml()}</div>
    <div class="exam-grid" id="examGrid">${examGridHtml()}</div>`;
}
function examStatsHtml() {
  const pr = Object.values(S.examProgress || {}), done = pr.filter(x => x.submitted).length;
  return `<span>👥 ${S.players.length} a responder</span><span>📨 ${done} entregaram</span>`;
}
function examGridHtml() {
  const byId = new Map(S.roster.map(r => [r.id, r]));
  return S.players.map(p => {
    const pr = (S.examProgress || {})[p.studentId] || { answered: 0 }, st = byId.get(p.studentId) || p;
    const pct = Math.round(pr.answered / S.total * 100);
    return `<div class="ex-card ${pr.submitted ? 'done' : ''} ${p.connected ? '' : 'off'}">${avatar(st)}
      <div class="ex-info"><b>${esc(st.short || p.name)}</b><div class="ex-bar"><div style="width:${pct}%"></div></div>
      <small>${pr.submitted ? '📨 Entregou' : `${pr.answered} / ${S.total}`}</small></div></div>`;
  }).join('') || '<p class="center">À espera dos formandos…</p>';
}
let examClockTimer, examWarned = false;
function runExamClock() {
  clearInterval(examClockTimer);
  const end = Date.now() + S.remainingMs;
  const f = () => {
    const el = $('#examClock'); if (!el) return clearInterval(examClockTimer);
    const r = Math.max(0, end - Date.now()), m = Math.floor(r / 60000), sec = Math.floor(r / 1000) % 60;
    el.textContent = `${m}:${String(sec).padStart(2, '0')}`;
    el.classList.toggle('hurry', r < 60000);
    if (r < 60000 && r > 0 && !examWarned) { examWarned = true; Sound.play('gong'); }
    if (r >= 60000) examWarned = false;
    if (r <= 10000 && r > 0 && sec !== f.last) { f.last = sec; Sound.play('tick'); }
  };
  f(); examClockTimer = setInterval(f, 250);
}

function readyHtml() {
  return `<div class="ready-wrap"><div class="ready-label slide-up">Pergunta ${S.qIndex + 1} de ${S.total} · prepara-te!</div>
    <div class="question-title pop-in ${lenCls(S.question.text)}" style="margin:20px 0">${esc(qTitle(S.question))}</div>
    <div class="ready-n" id="readyN">3</div></div>`;
}
let readyRaf;
function runReady() {
  cancelAnimationFrame(readyRaf);
  const end = performance.now() + S.remainingMs; let last = null;
  const f = () => {
    const el = $('#readyN'); if (!el) return;
    const n = Math.max(1, Math.ceil((end - performance.now()) / 1000));
    if (n !== last) { last = n; el.textContent = n; el.classList.remove('pop-in'); void el.offsetWidth; el.classList.add('pop-in'); }
    if (end > performance.now()) readyRaf = requestAnimationFrame(f);
  };
  f();
}

function questionHtml() {
  const q = S.question, n = S.answeredIds.length, of = connectedN();
  const left = timed()
    ? `<div class="ring" id="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,.2)" stroke-width="10" fill="none"/>
       <circle id="ringC" cx="50" cy="50" r="44" stroke="#ffd93d" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="0"/></svg>
       <div class="n" id="ringN">${Math.ceil(S.remainingMs / 1000)}</div></div>`
    : `<div class="live-pill"><span class="dot"></span> Pergunta aberta</div>`;
  return phonesNote() + `<div class="question-title slide-up ${qType(q) === 'fill' ? '' : lenCls(q.text)}">${qType(q) === 'fill' ? '✏️ Completa os espaços' : esc(q.text)}</div>
    ${q.image && qType(q) !== 'spot' ? `<img class="qimage" src="${esc(q.image)}">` : ''}
    <div class="qmid">${left}
      <div class="progress-wrap"><div class="progress"><div id="ansBar" style="width:${of ? n / of * 100 : 0}%"></div></div>
        <div id="allDone" class="all-done ${of && n >= of ? '' : 'hidden'}">✅ Todos responderam!</div></div>
      <div class="answered-box"><b id="ansN">${n}</b>respostas<br><small id="ansOf">de ${of}</small></div>
    </div>
    ${questionBodyHtml(q)}`;
}
// corpo da pergunta conforme o tipo
// textos compridos: letra mais pequena para caber tudo no ecrã projetado
const lenCls = t => { const n = String(t || '').length; return n > 220 ? 'xlong' : n > 120 ? 'long' : ''; };
function questionBodyHtml(q) {
  const t = qType(q);
  if (t === 'fill') return `<div class="fill-sentence pop-in">${sentenceHtml(fillPartsOf(q.text), i => `<span class="blank">${i + 1}</span>`)}</div>
    <div class="bank">${bankOf(q).map((w, i) => `<span class="chip-w pop-in" style="animation-delay:${i * 60}ms">${esc(w)}</span>`).join('')}</div>`;
  if (t === 'open') return `<div class="open-hint pop-in">✍️ Resposta livre — cada formando escreve a sua resposta no telemóvel</div>`;
  if (t === 'scale') return scaleRowHtml(q);
  if (t === 'scramble') { const tiles = scrambleTilesOf(q);
    return `<div class="scr-board">${tiles.map((ch, i) => `<span class="scr-tile pop-in" style="animation-delay:${i * 70}ms">${esc(ch)}</span>`).join('')}</div>
      <div class="scr-slots">${scrambleShapeOf(q).map(n => `<span class="scr-word">${'<i></i>'.repeat(n)}</span>`).join('')}</div>
      <p class="cloud-hint">🔤 Forma a palavra no telemóvel, tocando nas letras pela ordem</p>`; }
  if (t === 'cross') return crossStageHtml(q, false);
  if (t === 'number') return `<div class="num-stage pop-in"><span>${esc(fmtN(q.min))}</span><div class="num-track"><i></i></div><span>${esc(fmtN(q.max))}</span></div>
    <p class="cloud-hint">🔢 Escolhe um número de ${esc(fmtN(q.min))} a ${esc(fmtN(q.max))} no telemóvel — em cheio ganha tudo, perto ainda ganha alguns pontos</p>`;
  if (t === 'match') return matchStageHtml(q, false);
  if (t === 'spot') return `${spotStageHtml(q, false)}<p class="cloud-hint">🎯 Toca no sítio certo da imagem, no telemóvel</p>`;
  if (t === 'guess') return `<div class="scr-board">${Array.from({ length: cwNorm(q.answer).length }, (_, i) => `<span class="scr-tile gq pop-in" style="animation-delay:${i * 60}ms">?</span>`).join('')}</div>
    <p class="cloud-hint">🟩 letra no sítio certo · 🟧 existe noutro sítio · 🟥 não existe — ${q.maxTries || 6} tentativas</p>
    <div class="gb-wrap" id="guessBoards">${guessBoardsHtml()}</div>`;
  if (t === 'cloud') return `<div class="cloud-hint">☁️ Cada formando escreve até ${q.words || 3} palavra${(q.words || 3) > 1 ? 's' : ''} no telemóvel — a nuvem cresce em direto</div><div class="cloud" id="liveCloud"></div>`;
  if (t === 'rank') return `<div class="cloud-hint">🔢 Ordena no telemóvel: toca nas opções pela ordem, da 1ª à última${q.ordered ? '' : ' (não há ordem certa: é a tua opinião)'}</div>
    <div class="opts rank-opts ${q.options.some(o => String(o).length > 60) ? 'long' : ''}">${(S.rankOrder || q.options.map((_, i) => i)).map((i, k) => `<div class="opt opt-${k} pop-in" style="animation-delay:${k * 90}ms"><span class="letter">${LETTERS[k]}</span><span class="txt">${esc(q.options[i])}</span></div>`).join('')}</div>`;
  return `<div class="opts ${q.options.some(o => String(o).length > 60) ? 'long' : ''}">${q.options.map((o, i) => `<div class="opt opt-${i} pop-in" style="animation-delay:${i * 90}ms"><span class="letter">${LETTERS[i]}</span><span class="txt">${esc(o)}</span></div>`).join('')}</div>`;
}
const fmtN = n => Number(n).toLocaleString('pt-PT');
// correspondência no projetor: itens numerados à esquerda, opções baralhadas (com letra) à direita
function matchStageHtml(q, showSol) {
  const order = S.matchOrder || q.pairs.map((_, i) => i), st = S.matchStats || [], total = S.answeredIds.length;
  const letterOf = i => LETTERS[order.indexOf(i)];
  return `<div class="match-stage"><div class="match-col">${q.pairs.map((p, i) => `<div class="opt match-left pop-in" style="animation-delay:${i * 80}ms"><span class="letter">${i + 1}</span><span class="txt">${esc(p.left)}</span>
      ${showSol ? `<span class="cnt" style="font-size:.6em">→ ${letterOf(i)}${total ? ` · ${st[i] || 0}/${total} ✓` : ''}</span>` : ''}</div>`).join('')}</div>
    <div class="match-col">${order.map((i, k) => `<div class="opt opt-${k % 6} pop-in" style="animation-delay:${k * 80 + 200}ms"><span class="letter">${LETTERS[k]}</span><span class="txt">${esc(q.pairs[i].right)}</span></div>`).join('')}</div></div>`;
}
// encontrar na imagem no projetor: a imagem; nos resultados, os toques da turma e (com solução) a zona certa
function spotStageHtml(q, showSol, hits) {
  const pc = x => (x * 100).toFixed(1) + '%', z = q.zone;
  return `<div class="spot-stage"><img src="${esc(q.image || '')}" alt="">
    ${showSol && z ? `<div class="spot-zone" style="left:${pc(z.x)};top:${pc(z.y)};width:${pc(z.w)};height:${pc(z.h)}"></div>` : ''}
    ${(hits || []).map(([x, y, ok], k) => `<i class="spot-dot pop-in ${showSol ? (ok ? 'ok' : 'bad') : ''}" style="left:${pc(x)};top:${pc(y)};animation-delay:${Math.min(k, 40) * 30}ms"></i>`).join('')}</div>`;
}
// nuvem de palavras espalhada: a palavra mais escrita fica ao centro e maior; as outras procuram lugar
// numa espiral à volta (cada uma parte numa direção diferente). Quando uma palavra é repetida cresce,
// e as outras deslizam para lhe dar espaço (animação de posição e tamanho).
const CLOUD_COLORS = ['#ffd93d', '#7dd3fc', '#f9a8d4', '#86efac', '#fdba74', '#c4b5fd', '#ffffff', '#5eead4'];
const hashOf = k => { let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function renderCloud(el, list) {
  list = list || [];
  if (!list.length) { el.innerHTML = '<p class="cloud-empty">À espera das primeiras palavras<span class="dots"></span></p>'; return; }
  const empty = $('.cloud-empty', el); if (empty) empty.remove();
  const max = list[0].count, min = list[list.length - 1].count;
  const base = Math.max(13, Math.min(el.clientWidth / 30, el.clientHeight / 14));
  // 1 pessoa → tamanho base; a mais escrita → até 4,5× maior
  const size = c => base * (max === min ? (list.length === 1 ? 3.5 : 1.8) : 1 + (c - min) / (max - min) * 3.5);
  const spans = list.map(w => {
    const k = qnorm(w.text);
    let sp = el.querySelector(`.cw[data-k="${CSS.escape(k)}"]`);
    if (!sp) { sp = document.createElement('span'); sp.className = 'cw fresh'; sp.dataset.k = k; sp.style.color = CLOUD_COLORS[hashOf(k) % CLOUD_COLORS.length]; el.appendChild(sp); setTimeout(() => sp.classList.remove('fresh'), 900); }
    sp.innerHTML = esc(w.text) + (w.count > 1 ? `<sup>${w.count}</sup>` : '');
    sp.title = `${w.count} pessoa${w.count > 1 ? 's' : ''}`;
    sp.dataset.fs = size(w.count);
    return sp;
  });
  const keep = new Set(spans);
  $$('.cw', el).forEach(sp => { if (!keep.has(sp)) sp.remove(); });
  layoutCloud(el, spans);
}
function layoutCloud(el, spans) {
  const W = el.clientWidth, H = el.clientHeight, pad = 6;
  // medidor escondido: mede o tamanho final de cada palavra (sem esperar pela animação)
  let m = $('.cw-measure', el); if (!m) { m = document.createElement('span'); m.className = 'cw cw-measure'; el.appendChild(m); }
  for (let scale = 1; scale > 0.25; scale *= 0.88) {
    const placed = [], out = []; let ok = true;
    for (const [idx, sp] of spans.entries()) {
      m.innerHTML = sp.innerHTML; m.style.fontSize = sp.dataset.fs * scale + 'px';
      const w = m.offsetWidth, h = m.offsetHeight;
      const a0 = (hashOf(sp.dataset.k) % 628) / 100;            // cada palavra parte numa direção
      let found = null;
      for (let t = 0; t < 900; t++) {
        const ang = a0 + t * 0.32, r = idx === 0 ? 0 : 3 + t * 1.15;
        const x = W / 2 + r * Math.cos(ang) * (W / H) * 0.9 - w / 2, y = H / 2 + r * Math.sin(ang) - h / 2;
        if (x < 0 || y < 0 || x + w > W || y + h > H) { if (idx === 0) break; continue; }
        if (placed.every(b => x + w + pad <= b.x || b.x + b.w + pad <= x || y + h + pad <= b.y || b.y + b.h + pad <= y)) { found = { x, y, w, h }; break; }
      }
      if (!found) { ok = false; break; }
      placed.push(found); out.push([sp, found, sp.dataset.fs * scale]);
    }
    if (ok || scale * 0.88 <= 0.25) {
      out.forEach(([sp, b, fs]) => { sp.style.left = b.x + 'px'; sp.style.top = b.y + 'px'; sp.style.fontSize = fs + 'px'; });
      return;
    }
  }
}
window.addEventListener('resize', () => $$('#tab-game .cloud').forEach(c => S && renderCloud(c, S.cloud)));
// letras baralhadas: calculadas da mesma maneira que no servidor, para o projetor mostrar as mesmas que os telemóveis
function scrambleTilesOf(q) {
  const letters = [...String(q.answer || '').toUpperCase()].filter(ch => /\p{L}/u.test(ch));
  let h = 2166136261; for (const c of String(q.id || q.answer)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0, h / 4294967296);
  const out = letters.slice();
  for (let k = 0; k < 20; k++) { for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } if (out.join('') !== letters.join('') || new Set(letters).size < 2) break; }
  return out;
}
const scrambleShapeOf = q => String(q.answer || '').trim().split(/\s+/).map(w => [...w].filter(ch => /\p{L}/u.test(ch)).length).filter(Boolean);
// palavras cruzadas no projetor: grelha + pistas (com a solução, se for altura)
function crossStageHtml(q, showSol) {
  const cw = q.cross, sol = {};
  if (showSol) cw.words.forEach(w => crossCellsOf(w).forEach((k, i) => sol[k] = w.word[i]));
  const clues = dir => cw.words.filter(w => w.dir === dir).map(w => {
    const k = cw.words.indexOf(w), st = S.crossStats ? S.crossStats[k] : null, tot = S.answeredIds.length;
    return `<li><b>${w.n}.</b> ${esc(w.clue)} <small>(${w.len})</small>${showSol ? ` <span class="cw-sol">${esc(w.display.toUpperCase())}</span>` : ''}${st != null && pollOn() && S.phase !== 'question' ? ` <span class="cw-st">${st}/${tot}</span>` : ''}</li>`; }).join('');
  return `<div class="cw-stage">${crossGridHtml(cw, sol, showSol ? Object.fromEntries(Object.keys(sol).map(k => [k, 'ok'])) : {}, 'big')}
    <div class="cw-clues">${cw.words.some(w => w.dir === 'a') ? `<h4>➡ Horizontais</h4><ul>${clues('a')}</ul>` : ''}${cw.words.some(w => w.dir === 'd') ? `<h4>⬇ Verticais</h4><ul>${clues('d')}</ul>` : ''}</div></div>`;
}
// adivinha a palavra: o quadro de cada um, só com as cores (sem letras)
function guessBoardsHtml() {
  const bs = S.guessBoards || [];
  if (!bs.length) return '<p class="cloud-empty" style="font-size:1.2em">À espera das primeiras tentativas<span class="dots"></span></p>';
  const byId = new Map(S.roster.map(r => [r.id, r]));
  return bs.map(b => { const st = byId.get(b.studentId) || { name: '?' };
    return `<div class="gb ${b.solved ? 'solved' : b.done ? 'out' : ''}">${b.colors.map(row => `<div class="gb-row">${row.map(c => `<i class="${c}"></i>`).join('')}</div>`).join('')}
      <div class="gb-name">${b.solved ? '🎉 ' : b.done ? '😵 ' : ''}${esc(st.short || st.name)}</div></div>`; }).join('');
}
function scaleRowHtml(q) {
  return `<div class="scale-row">${[1, 2, 3, 4, 5].map((n, i) => `<div class="scale-box opt-${i} pop-in" style="animation-delay:${i * 80}ms">${n}</div>`).join('')}</div>
    ${q.scaleMin || q.scaleMax ? `<div class="scale-labels"><span>1 = ${esc(q.scaleMin || '')}</span><span>5 = ${esc(q.scaleMax || '')}</span></div>` : ''}`;
}

// withAnswer=false → sondagem (só quantos escolheram cada opção); true → destaca a correta
// passo "resposta correta" num ecrã projetado quando as respostas não são mostradas à turma
function hiddenRevealHtml() {
  const atEnd = !!S.settings.revealEnd;
  return resultsHtml(false).replace(/<div class="big-msg[^>]*>📊 Sondagem[\s\S]*?<\/div>/, '').replace('<div class="timeup">⏰ Tempo esgotado!</div>', '') +
    `<p class="center" style="font-size:1.5em;font-weight:600;margin-top:4px">${atEnd ? '🤫 As respostas corretas vão ser mostradas no fim!' : '📨 Respostas registadas.'}</p>`;
}
// fim do quiz no modo "só no fim": lista de todas as perguntas com a resposta correta
function answersListHtml() {
  return `<div class="big-msg slide-up" style="font-size:2.2em;margin:0 0 8px">✅ As respostas corretas</div><div class="answers-list">${S.allQuestions.map((q, i) => `
    <div class="al-item slide-up" style="animation-delay:${Math.min(i, 12) * 80}ms"><div class="al-q">${i + 1}. ${esc(qTitle(q))}</div>
    <div class="al-a">${['mc', 'tf'].includes(qType(q)) ? q.correct.map(k => `<div><span class="letter" style="background:var(--${'abcdef'[k]})">${LETTERS[k]}</span> ${esc(q.options[k])}</div>`).join('') : `<div>${esc(solutionText(q))}</div>`}</div></div>`).join('')}</div>`;
}
let showAnswersList = false;
const closedShown = new Set();
const POLL_MS = 1600;
function growPoll(delay) {
  setTimeout(() => {
    if (!S || S.phase !== 'closed') return;
    Sound.play('pollRise', POLL_MS / 1000);
    $$('.opt .fill').forEach(f => { f.style.transition = `width ${POLL_MS}ms cubic-bezier(.25,.8,.3,1)`; f.style.width = f.dataset.w; });
    const els = $$('.opt .num'), pcs = $$('.opt .pc'), t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / POLL_MS), e = 1 - Math.pow(1 - k, 3);
      els.forEach(el => el.textContent = Math.round(+el.dataset.n * e));
      pcs.forEach(el => el.textContent = Math.round(+el.dataset.p * e) + '%');
      if (k < 1) requestAnimationFrame(step);
      else $$('.opt .cnt').forEach(c => { c.classList.remove('pop-in'); void c.offsetWidth; c.classList.add('pop-in'); });
    };
    step();
  }, delay);
}
function resultsHtml(withAnswer, animate = false) {
  const t = qType(S.question);
  if (t === 'fill' || t === 'open' || t === 'cloud' || t === 'rank' || t === 'scramble' || t === 'cross' || t === 'guess' || t === 'number' || t === 'match' || t === 'spot') return resultsOtherHtml(withAnswer, animate);
  // escala: as 5 "opções" são os valores 1..5 e não há resposta certa
  const q = t === 'scale' ? { ...S.question, options: ['1', '2', '3', '4', '5'], correct: [] } : S.question;
  const total = S.answeredIds.length, max = Math.max(1, ...S.counts);
  const byId = new Map(S.roster.map(s => [s.id, s]));
  const pct = c => total ? Math.round(c / total * 100) : 0;
  const privateMark = !withAnswer && hiddenReveal() && seeAnswers;
  const poll = pollOn(), who = poll && S.settings.showWho;
  return `${withAnswer ? '' : poll ? `<div class="big-msg slide-up" style="font-size:2em;margin:0 0 4px">📊 Sondagem <small style="font-size:.5em;opacity:.8">· respostas fechadas</small></div>` : `<div class="big-msg slide-up" style="font-size:2em;margin:0 0 4px">🔒 Respostas fechadas</div>`}
    ${!withAnswer && timed() && !closedShown.has(S.id + ':' + S.qIndex) ? `<div class="timeup">⏰ Tempo esgotado!</div>` : ''}
    <div class="question-title" style="font-size:clamp(1.3em,2.6vw,2.2em);margin-top:6px">${esc(q.text)}</div>
    ${t === 'scale' && (q.scaleMin || q.scaleMax) ? `<div class="scale-labels" style="margin-top:0">${'<span>1 = ' + esc(q.scaleMin || '') + '</span><span>5 = ' + esc(q.scaleMax || '') + '</span>'}</div>` : ''}
    <div class="opts ${q.options.some(o => String(o).length > 60) ? 'long' : ''}" style="margin-top:10px">${q.options.map((o, i) => {
      const right = q.correct.includes(i);
      return `<div class="opt opt-${i} ${withAnswer && t !== 'scale' ? (right ? 'right' : 'dim') : 'slide-up'} ${privateMark && right ? 'right-private' : ''} ${who ? 'has-who' : ''}" style="animation-delay:${withAnswer ? 0 : i * 100}ms">
        ${poll ? `<div class="fill" data-w="${pct(S.counts[i])}%"></div>` : ''}
        <span class="letter">${t === 'scale' ? '★' : LETTERS[i]}</span><span class="txt">${esc(o)}</span>
        ${(withAnswer || privateMark) && right ? '<span class="tick">✔</span>' : ''}${poll ? `<span class="cnt"><span class="num" data-n="${S.counts[i]}">${animate ? 0 : S.counts[i]}</span> <small class="pc" data-p="${pct(S.counts[i])}" style="font-size:.55em;opacity:.85">${animate ? 0 : pct(S.counts[i])}%</small></span>` : ''}
        ${who ? `<div class="who">${S.whoByOption[i].map(id => avatar(byId.get(id) || { name: '?' }, 'sm')).join('')}</div>` : ''}
      </div>`;
    }).join('')}</div>
    ${privateMark ? `<p class="center private-note">👁 Só neste ecrã: ✔ marca a resposta correta. Os formandos não a veem.</p>` : ''}
    <p class="center" style="font-size:1.3em;margin-top:22px">${t === 'scale' && poll && S.scaleAvg != null ? `⭐ Média ${S.scaleAvg.toFixed(1).replace('.', ',')} · ` : ''}${withAnswer && poll && t !== 'scale' ? `✅ ${q.correct.reduce((a, i) => a + S.counts[i], 0)} acertaram · ` : ''}${total} responderam · ${S.players.length - total} sem resposta</p>`;
}
// completar espaços e resposta livre
function resultsOtherHtml(withAnswer, animate) {
  const q = S.question, t = qType(q), total = S.answeredIds.length, poll = pollOn();
  const showSol = withAnswer || (hiddenReveal() && seeAnswers);
  const pct = c => total ? Math.round(c / total * 100) : 0;
  let body = '';
  if (t === 'fill') {
    const blanks = fillBlanksOf(q.text);
    body = `<div class="fill-sentence">${sentenceHtml(fillPartsOf(q.text), i => showSol ? `<span class="blank ok">${esc(blanks[i])}</span>` : `<span class="blank">${i + 1}</span>`)}</div>`;
    if (poll) body += `<div class="opts" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${(S.fillStats || []).map((f, i) => `
      <div class="opt opt-${i % 6} slide-up" style="animation-delay:${i * 100}ms"><div class="fill" data-w="${pct(f.right)}%"></div>
        <span class="letter">${i + 1}</span><span class="txt">${showSol ? esc(f.word) : 'Espaço ' + (i + 1)}</span>
        <span class="cnt"><span class="num" data-n="${f.right}">${animate ? 0 : f.right}</span> <small class="pc" data-p="${pct(f.right)}" style="font-size:.55em;opacity:.85">${animate ? 0 : pct(f.right)}%</small></span></div>`).join('')}</div>
      <p class="center" style="opacity:.85;margin:6px 0 0">Quantos acertaram em cada espaço</p>`;
  } else if (t === 'cloud') {
    body = `<div class="cloud big"></div>`;
  } else if (t === 'scramble') {
    body = showSol ? `<div class="scr-board">${[...String(q.answer).toUpperCase()].map((ch, i) => ch === ' ' ? '<span class="scr-gap"></span>' : `<span class="scr-tile ok pop-in" style="animation-delay:${i * 60}ms">${esc(ch)}</span>`).join('')}</div>`
      : `<div class="scr-board">${scrambleTilesOf(q).map(ch => `<span class="scr-tile">${esc(ch)}</span>`).join('')}</div>`;
    if (poll) body += `<div class="open-list">${(S.attempts || []).map((a, i) => `<span class="open-ans slide-up ${showSol ? (a.correct ? 'ok' : 'bad') : ''}" style="animation-delay:${Math.min(i, 20) * 50}ms">${esc(a.text)}${a.count > 1 ? ` <b>×${a.count}</b>` : ''}</span>`).join('') || '<p class="center">Ainda sem respostas.</p>'}</div>`;
  } else if (t === 'cross') {
    body = crossStageHtml(q, showSol);
  } else if (t === 'guess') {
    const word = cwNorm(q.answer), dist = S.guessDist || [], mx = Math.max(1, ...dist);
    body = `<div class="scr-board">${[...word].map((ch, i) => `<span class="scr-tile ${showSol ? 'ok pop-in' : 'gq'}" style="animation-delay:${i * 80}ms">${showSol ? esc(ch) : '?'}</span>`).join('')}</div>`;
    if (poll) body += `<div class="gd">${dist.map((n, k) => `<div class="gd-row"><span>${k + 1}ª</span><div class="gd-bar"><div class="fill" data-w="${Math.round(n / mx * 100)}%" style="width:${Math.round(n / mx * 100)}%"></div><b>${n}</b></div></div>`).join('')}</div>
      <p class="center" style="opacity:.85;margin:4px 0 8px">Em que tentativa acertaram</p><div class="gb-wrap">${guessBoardsHtml()}</div>`;
  } else if (t === 'number') {
    const ns = S.numberStats || { counts: [], avg: null, exact: 0 }, mx = Math.max(1, ...ns.counts.map(c => c[1])), st = q.step || 1;
    // intervalo curto: mostra o eixo todo (também os números que ninguém escolheu)
    let cols = ns.counts;
    if ((q.max - q.min) / st <= 30) { const m = new Map(ns.counts); cols = []; for (let v = q.min; v <= q.max + 1e-9; v += st) { const k = Math.round(v * 1e6) / 1e6; cols.push([k, m.get(k) || 0]); } }
    body = !total ? '<p class="center">Ainda sem respostas.</p>' : `<div class="num-hist">${cols.map(([v, c], k) => `<div class="num-col slide-up ${showSol && v === q.answer ? 'right' : ''}" style="animation-delay:${Math.min(k, 20) * 50}ms">
        <b>${c || ''}</b><div class="num-bar" style="height:${Math.round(c / mx * 100)}%"></div><span>${esc(fmtN(v))}</span></div>`).join('')}</div>
      <p class="center" style="opacity:.9;margin:6px 0 0">Média da turma: <b>${ns.avg == null ? '—' : esc(fmtN(Math.round(ns.avg * 10) / 10))}</b></p>`;
    if (showSol) body = `<div class="accepted">✅ Resposta certa: <b style="font-size:1.4em">${esc(fmtN(q.answer))}</b></div>` + body;
  } else if (t === 'match') {
    body = matchStageHtml(q, showSol);
    if (showSol) body += `<div class="accepted">✅ ${q.pairs.map(p => `${esc(p.left)} → <b>${esc(p.right)}</b>`).join(' · ')}</div>`;
  } else if (t === 'spot') {
    body = spotStageHtml(q, showSol, poll || showSol ? S.spotHits : []);
  } else if (t === 'rank') {
    // posição média: quanto mais perto de 1, mais vezes ficou nos primeiros lugares
    const n = q.options.length, st = (S.rankStats || []).filter(x => x.avg != null).sort((a, b) => a.avg - b.avg);
    body = !total ? '<p class="center">Ainda sem respostas.</p>' : `<div class="rank-res">${st.map((x, k) => {
      const w = Math.round((n - x.avg) / (n - 1 || 1) * 100), ok = showSol && q.ordered ? x.i === k : null;
      return `<div class="rank-row slide-up" style="animation-delay:${k * 110}ms"><span class="rank-pos">${k + 1}º</span>
        <div class="opt opt-${x.i % 6} ${ok === true ? 'right' : ''}"><div class="fill" data-w="${w}%"></div><span class="txt">${esc(x.text)}</span>
          <span class="cnt" style="font-size:.7em">média ${x.avg.toFixed(1).replace('.', ',')}º${x.first ? ` · ${x.first}× em 1º` : ''}</span>
          ${ok === true ? '<span class="tick">✔</span>' : ok === false ? `<span class="rank-good">certa: ${x.i + 1}º</span>` : ''}</div></div>`; }).join('')}</div>`;
    if (showSol && q.ordered) body += `<div class="accepted">✅ Ordem certa: <b>${q.options.map((o, k) => `${k + 1}. ${esc(o)}`).join(' · ')}</b></div>`;
    body += `<p class="center" style="opacity:.85;margin:6px 0 0">Ordenado pela posição média que a turma deu a cada opção</p>`;
  } else {
    if (showSol && (q.accepted || []).length) body += `<div class="accepted">💡 Resposta modelo: <b>${q.accepted.map(esc).join(' · ')}</b></div>`;
    if (poll) body += `<div class="open-list">${(S.openAnswers || []).map((a, i) => `<span class="open-ans slide-up ${showSol && a.correct === true ? 'ok' : showSol && a.correct === false ? 'bad' : ''}" style="animation-delay:${Math.min(i, 20) * 50}ms">${esc(a.text)}${a.count > 1 ? ` <b>×${a.count}</b>` : ''}</span>`).join('') || '<p class="center">Ainda sem respostas.</p>'}</div>`;
    else body += `<div class="open-hint">✍️ Respostas livres recebidas</div>`;
    body += `<p class="center" style="opacity:.85">✍️ As respostas livres são validadas por ti, uma a uma, nos resultados.</p>`;
  }
  return `${withAnswer ? '' : `<div class="big-msg slide-up" style="font-size:2em;margin:0 0 4px">${poll ? '📊 Sondagem' : '🔒 Respostas fechadas'} <small style="font-size:.5em;opacity:.8">· respostas fechadas</small></div>`}
    ${!withAnswer && timed() && !closedShown.has(S.id + ':' + S.qIndex) ? `<div class="timeup">⏰ Tempo esgotado!</div>` : ''}
    <div class="question-title" style="font-size:clamp(1.3em,2.6vw,2.2em);margin-top:6px">${t === 'fill' ? '✏️ Completa os espaços' : esc(q.text)}</div>
    ${body}
    ${!withAnswer && hiddenReveal() && seeAnswers ? `<p class="center private-note">👁 Só neste ecrã: a solução está visível. Os formandos não a veem.</p>` : ''}
    <p class="center" style="font-size:1.3em;margin-top:16px">${withAnswer && t === 'fill' ? `✅ ${Object.keys(S.lastPoints || {}).filter(id => (S.lastPoints[id] || 0) > 0).length} com pelo menos uma certa · ` : ''}${showSol && t === 'rank' && q.ordered ? `✅ ${S.rankPerfect || 0} acertaram a ordem toda · ` : ''}${t === 'guess' ? `🟩 ${S.guessSolved || 0} adivinharam · ` : ''}${showSol && t === 'scramble' ? `✅ ${(S.attempts || []).filter(a => a.correct).reduce((n, a) => n + a.count, 0)} acertaram · ` : ''}${showSol && t === 'cross' ? `✅ ${Object.values(S.lastPoints || {}).filter(v => v > 0).length} com pelo menos uma palavra certa · ` : ''}${showSol && t === 'number' ? `🎯 ${(S.numberStats || {}).exact || 0} em cheio · ` : ''}${showSol && t === 'spot' ? `🎯 ${(S.spotHits || []).filter(h => h[2]).length} acertaram · ` : ''}${showSol && t === 'match' ? `✅ ${Object.values(S.lastPoints || {}).filter(v => v > 0).length} com pelo menos uma ligação certa · ` : ''}${total} responderam · ${S.players.length - total} sem resposta</p>`;
}

// ----- Pódio com bonecos a dançar -----
const CHEER_S = 2.6; // duração dos aplausos do pódio (s)
const FINAL_FIRST_AT = 4.2; // segundos até aparecer o 1º lugar no pódio final
function podiumHtml(top, final) {
  const order = [3, 1, 0, 2, 4]; // 4º 2º 1º 3º 5º
  const heights = final ? [210, 165, 130, 95, 70] : [170, 140, 118, 100, 88];
  const colors = ['#ffd93d', '#e5e7eb', '#f4a261', '#7dd3fc', '#c4b5fd'];
  const moves = ['jump', 'disco', 'wave', 'sway', 'robot'];
  const gap = final ? 0.9 : 0.25;
  // aparecem do 5º para o 1º
  const delayOf = i => final ? (i === 0 ? FINAL_FIRST_AT : (top.length - 1 - i) * gap + 0.3) : (top.length - 1 - i) * gap + 0.2;
  return `<div class="podium5 ${final ? 'final' : ''}">${order.filter(i => top[i]).map(i => {
    const p = top[i], d = delayOf(i), plus = S.lastPoints[p.studentId];
    return `<div class="pcol" style="--d:${d}s">
      <div class="pts-bubble">${final ? p.score + ' pts' : plus ? '+' + plus : '+0'}</div>
      ${dancer(p, moves[i], colors[i], i === 0)}
      <div class="pstep" style="height:${heights[i]}px;background:${colors[i]}"><span class="place">${i + 1}º</span>
        <span class="pname" title="${esc(p.name)}">${esc(p.short || p.name)}</span>${final ? '' : `<span class="pscore">${p.score} pts</span>`}</div>
    </div>`;
  }).join('')}</div>`;
}

// pódio das equipas: mascote a dançar com as cores da equipa, degrau pela posição e os membros por baixo
function teamPodiumHtml(final) {
  const ts = S.teams || [], n = ts.length;
  if (!n) return '<p class="center">Sem equipas com jogadores.</p>';
  const order = [5, 3, 1, 0, 2, 4].filter(i => i < n);              // 1º ao centro
  const moves = ['jump', 'disco', 'wave', 'sway', 'robot', 'wave'];
  const maxH = final ? 240 : 190, minH = final ? 120 : 112;
  const delayOf = i => final ? (i === 0 ? FINAL_FIRST_AT : (n - 1 - i) * 0.9 + 0.3) : (n - 1 - i) * 0.25 + 0.2;
  return `<div class="tpod ${final ? 'final' : ''}">${order.map(i => {
    const t = ts[i], h = n === 1 ? maxH : Math.round(maxH - (maxH - minH) * i / (n - 1)), d = delayOf(i);
    return `<div class="tcol" style="--d:${d}s;--tc:${t.color}">
      <div class="pts-bubble">${final ? t.score + ' pts' : '+' + (t.plus || 0)}</div>
      <div class="dancer m-${moves[i]}" style="--body:${t.color}"><div class="dz">${i === 0 ? '<div class="crown">👑</div>' : ''}
        <div class="arm l"></div><div class="arm r"></div><div class="leg l"></div><div class="leg r"></div><div class="torso"></div>
        <div class="head"><span class="avatar" style="background:${t.color};font-size:1.5em">${t.emoji}</span></div></div></div>
      <div class="tstep" style="height:${h}px"><span class="place">${i + 1}º</span><span class="tname">Equipa ${esc(t.name)}</span>${final ? '' : `<span class="pscore">${t.score} pts</span>`}</div>
      <div class="tmembers">${t.members.map(m => avatar(m, 'sm')).join('')}</div>
    </div>`;
  }).join('')}</div><p class="center tpod-note">Pontos da equipa = média dos pontos dos seus membros</p>`;
}
function endHtml() {
  if (!S.settings.finalPodium) return `<div class="big-msg slide-up">🎉 Fim do quiz!</div><p class="center" style="font-size:1.4em">Obrigado a todos pela participação! 💜</p>`;
  if (S.settings.teams) return `<div class="big-msg slide-up" style="font-size:2.6em;margin:0">🎉 Equipa vencedora! 🏆</div>` + teamPodiumHtml(true);
  return `<div class="big-msg slide-up" style="font-size:2.6em;margin:0">🎉 Fim do quiz! 🏆</div>` + podiumHtml(S.ranking.slice(0, 5), true);
}

function controlsHtml() {
  const ph = S.phase, last = S.qIndex + 1 >= S.total;
  const label = {
    lobby: '▶ Começar quiz', ready: '⏩ Abrir já', exam: '🏁 Terminar agora', question: timed() ? '⏹ Terminar tempo' : '⏹ Fechar respostas',
    closed: hiddenReveal() ? (last ? '🏁 Resultados finais' : '➡ Próxima pergunta') : '✅ Mostrar resposta correta',
    reveal: S.settings.rankEach && (qGraded(S.question) || qType(S.question) === 'open') ? '🏆 Ranking' : (last ? '🏁 Resultados finais' : '➡ Próxima pergunta'),
    leaderboard: last ? '🏁 Resultados finais' : '➡ Próxima pergunta',
  }[ph];
  const allIn = ph === 'question' && connectedN() && S.answeredIds.length >= connectedN();
  return `<div class="controls noprint">
    ${ph === 'exam' ? `<button class="btn small ghost" id="btnExtend">＋1 min</button>` : ''}
    ${isAuto() && ph !== 'end' && ph !== 'lobby' ? `<button class="btn small ghost" id="btnPause">${S.settings.paused ? '▶ Retomar' : '⏸ Pausar'}</button>` : ''}
    <div class="info"><b id="autoInfo" style="color:#ffd93d"></b> <span id="ctlInfo">${ph === 'end' ? 'Sessão terminada — as respostas estão guardadas.' : `${connectedN()} ligados · espaço/→ avança`}</span></div>
    ${hiddenReveal() && !isExamMode() ? `<label class="switch" title="Só neste dispositivo. Deixa desligado no ecrã projetado."><input type="checkbox" id="setSee" ${seeAnswers ? 'checked' : ''}> 👁 Ver respostas corretas</label>` : ''}
    ${ph === 'end' && S.settings.revealEnd ? `<button class="btn small ${showAnswersList ? 'primary' : 'ghost'}" id="btnAnswers">${showAnswersList ? '🏆 Voltar ao pódio' : '📋 Mostrar respostas corretas'}</button>` : ''}
    ${isExamMode() ? '' : `<label class="switch" title="Mostrar quantos escolheram cada opção"><input type="checkbox" id="setPoll" ${pollOn() ? 'checked' : ''}> Sondagem</label>`}
    ${pollOn() && !S.settings.anonymous ? `<label class="switch" title="Mostrar no ecrã as fotos de quem escolheu cada opção"><input type="checkbox" id="setWho" ${S.settings.showWho ? 'checked' : ''}> Quem respondeu</label>` : ''}
    ${S.settings.noRanking || hiddenReveal() ? '' : `<label class="switch" title="Mostrar o pódio Top 5 depois de cada pergunta"><input type="checkbox" id="setRank" ${S.settings.rankEach ? 'checked' : ''}> Ranking por pergunta</label>`}
    <button class="btn small ghost" id="btnPlayers">👥 Alunos</button>
    <button class="btn small ghost" id="btnFs">⛶ Ecrã inteiro</button>
    ${ph !== 'end' && ph !== 'exam' ? `<button class="btn small danger" id="btnEnd">Terminar</button>` : ''}
    ${ph === 'end' ? `<button class="btn primary" id="btnGrid">📊 Ver grelha de resultados</button><button class="btn small ghost" id="btnClose">Fechar sessão</button>` : `<button class="btn primary ${allIn ? 'pulse' : ''}" id="btnNext">${label}</button>`}
  </div>`;
}

function bindTeamsLobby() {
  $$('[data-move]').forEach(b => b.onclick = () => socket.emit('host:moveTeam', b.dataset.move));
}
function bindGame() {
  const sh = $('#btnShuffleTeams'); if (sh) sh.onclick = () => { socket.emit('host:shuffleTeams'); Sound.play('whoosh'); };
  if ($('#teamsLobby')) bindTeamsLobby();
  const on = (id, fn) => { const e = $('#' + id); if (e) e.onclick = fn; };
  on('btnNext', () => { if (S.phase === 'exam' && !confirm('Terminar agora? As respostas dadas até aqui ficam entregues.')) return; next(); });
  on('btnExtend', () => socket.emit('host:extend', 1));
  on('btnEnd', () => confirm('Terminar o quiz agora? As perguntas que faltam ficam como "não feitas".') && socket.emit('host:end'));
  on('btnClose', () => confirm('Fechar a sessão? (os resultados ficam guardados em Resultados)') && socket.emit('host:close'));
  on('btnGrid', () => { showTab('results'); openResult(S.id); });
  on('btnFs', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  on('btnPlayers', playersDialog);
  on('btnAnswers', () => { showAnswersList = !showAnswersList; if (showAnswersList) Sound.play('revealCorrect'); renderGame(true); });
  const ss = $('#setSee'); if (ss) ss.onchange = e => { seeAnswers = e.target.checked; try { localStorage.setItem('aq_see_answers', seeAnswers ? '1' : '0'); } catch {} renderGame(true); };
  const sw = $('#setWho'); if (sw) sw.onchange = e => socket.emit('host:settings', { showWho: e.target.checked });
  const sp = $('#setPoll'); if (sp) sp.onchange = e => socket.emit('host:settings', { showPoll: e.target.checked });
  const sr = $('#setRank'); if (sr) sr.onchange = e => socket.emit('host:settings', { rankEach: e.target.checked });
  on('btnPause', () => socket.emit('host:settings', { paused: !S.settings.paused }));
  const sel = $('#urlSel');
  if (sel) {
    sel.onchange = () => { if (sel.value) $('#urlIn').value = sel.value; else $('#urlIn').focus(); };
    $('#urlSave').onclick = () => { let u = $('#urlIn').value.trim().replace(/\/$/, ''); if (!u) return toast('Escreve o endereço'); if (!/^https?:\/\//i.test(u)) u = 'http://' + u; joinUrl = u; localStorage.setItem('aq_joinurl', joinUrl); renderGame(true); };
  }
}

let ringRaf;
function runRing() {
  cancelAnimationFrame(ringRaf);
  const end = performance.now() + S.remainingMs, total = S.question.time * 1000;
  const f = () => {
    const c = $('#ringC'), n = $('#ringN'); if (!c) return;
    const r = Math.max(0, end - performance.now());
    c.style.strokeDashoffset = 276.5 * (1 - r / total);
    n.textContent = Math.ceil(r / 1000);
    $('#ring').classList.toggle('hurry', r < 5500);
    if (r > 0) ringRaf = requestAnimationFrame(f);
  };
  f();
}

// atualizações sem redesenhar tudo (ex.: alguém respondeu / entrou)
function updateLive() {
  if (S.phase === 'exam') {
    const g = $('#examGrid'); if (g) g.innerHTML = examGridHtml();
    const st = $('#examStats'); if (st) st.innerHTML = examStatsHtml();
    runExamClock(); // o formador pode ter acrescentado tempo
  }
  if (S.phase === 'lobby' && S.settings.teams) {
    $('#joinCount') && ($('#joinCount').textContent = connectedN());
    const tl = $('#teamsLobby'), html = teamsLobbyHtml();
    if (tl && tl.dataset.sig !== html) { const grew = S.players.length > +(tl.dataset.n || 0); tl.dataset.sig = html; tl.dataset.n = S.players.length; tl.innerHTML = html; bindTeamsLobby(); if (grew) Sound.play('pop'); }
  }
  if (S.phase === 'lobby' && !S.settings.teams) {
    const on = new Set(S.players.filter(p => p.connected).map(p => p.studentId));
    $('#joinCount') && ($('#joinCount').textContent = on.size);
    // entrou alguém que não estava na turma (participante extra): acrescenta o cartão
    const jn = $('#joined');
    if (jn && jn.children.length !== S.roster.length) {
      const have = new Set($$('#joined .p').map(d => d.dataset.id));
      const tmp = document.createElement('div'); tmp.innerHTML = joinedHtml();
      [...tmp.children].forEach(d => { if (!have.has(d.dataset.id)) { d.classList.add('off'); jn.appendChild(d); } });
      $('#rosterN') && ($('#rosterN').textContent = S.roster.length);
    }
    // um formando tirou fotografia: troca as iniciais pela foto, com animação
    S.roster.forEach(st => {
      const d = $(`#joined .p[data-id="${CSS.escape(st.id)}"]`);
      if (d && st.photo && d.dataset.photo !== st.photo) {
        d.dataset.photo = st.photo;
        const img = document.createElement('div'); img.innerHTML = avatar(st, 'lg pop-in');
        d.querySelector('.avatar').replaceWith(img.firstElementChild); Sound.play('pop');
      }
    });
    $$('#joined .p').forEach(d => {
      const isOn = on.has(d.dataset.id);
      if (isOn && d.classList.contains('off')) { d.classList.remove('off'); d.classList.remove('pop-in'); void d.offsetWidth; d.classList.add('pop-in'); Sound.play('pop'); }
      if (!isOn) d.classList.add('off');
    });
  }
  if (S.phase === 'question') {
    const n = $('#ansN'), cnt = S.answeredIds.length, of = connectedN();
    if (n && n.textContent != cnt) { n.textContent = cnt; n.classList.remove('pop-in'); void n.offsetWidth; n.classList.add('pop-in'); Sound.play('pop'); }
    const o = $('#ansOf'); if (o) o.textContent = 'de ' + of;
    const bar = $('#ansBar'); if (bar) bar.style.width = (of ? Math.min(100, cnt / of * 100) : 0) + '%';
    const done = $('#allDone'); if (done) { const was = !done.classList.contains('hidden'); const now = of && cnt >= of; done.classList.toggle('hidden', !now); if (now && !was) Sound.play('softEnd'); }
    const gbx = $('#guessBoards'); if (gbx) { const h = guessBoardsHtml(); if (gbx.dataset.sig !== h) { gbx.dataset.sig = h; gbx.innerHTML = h; } }
    const lc = $('#liveCloud');
    if (lc) { const sig = JSON.stringify(S.cloud || []); if (lc.dataset.sig !== sig) { lc.dataset.sig = sig; renderCloud(lc, S.cloud); } }
  }
  // redesenha só a barra de controlos (mantém as animações do palco)
  const old = $('.controls');
  // só redesenha a barra de botões se ela mudou (redesenhar a meio de um clique fazia-o "perder-se")
  const ctl = controlsHtml();
  if (old && ctl !== lastControls) { lastControls = ctl; const tmp = document.createElement('div'); tmp.innerHTML = ctl; old.replaceWith(tmp.firstElementChild); bindGame(); runAutoInfo(); }
  const wantWho = pollOn() && S.settings.showWho, hasWho = !!$('.opt.has-who'), hasPoll = !!$('.opt .fill');
  if ((S.phase === 'closed' || S.phase === 'reveal') && $('.opt') && (wantWho !== hasWho || pollOn() !== hasPoll)) {
    // mudou a opção "sondagem" ou "quem respondeu": redesenha os resultados sem animação
    const st = $('#stage'); const top = st.firstElementChild.outerHTML;
    st.innerHTML = top + (S.phase === 'reveal' && !showCorrectHere() ? hiddenRevealHtml() : resultsHtml(S.phase === 'reveal'));
    $$('.opt .fill').forEach(f => { f.style.transition = 'none'; f.style.width = f.dataset.w; });
  }
}

function playersDialog() {
  const d = document.createElement('div');
  d.className = 'dlg'; d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100;display:grid;place-items:center;padding:16px';
  const joined = new Map(S.players.map(p => [p.studentId, p]));
  d.innerHTML = `<div class="card" style="width:min(560px,100%);max-height:85vh;overflow:auto"><h2>Alunos na sessão</h2>
    <p class="muted">Se um aluno mudou de telemóvel, carrega em <b>Libertar nome</b> e dá-lhe o código de reentrada que aparece: só com esse código ele volta ao seu lugar (com as respostas já dadas).</p>
    <div class="list">${S.roster.map(s => { const p = joined.get(s.id); return `<div class="item">${avatar(s)}<div class="grow"><b>${esc(s.name)}</b><br>
      <small class="muted">${!p ? 'Ainda não entrou' : p.connected ? '🟢 Ligado' : '⚪ Desligado'}${p ? ' · ' + p.score + ' pts' : ''}</small></div>
      ${p ? `<button class="btn small" data-rel="${s.id}">Libertar nome</button>` : ''}</div>`; }).join('')}</div>
    <form id="addLate" class="row" style="margin-top:14px"><input type="text" id="lateName" class="grow" placeholder="Nome completo de um formando que não está na lista" maxlength="80">
      <button class="btn small primary">+ Acrescentar</button></form>
    <p style="text-align:right"><button class="btn primary" id="closeDlg">Fechar</button></p></div>`;
  document.body.appendChild(d);
  d.onclick = e => { if (e.target === d || e.target.id === 'closeDlg') d.remove(); };
  $('#addLate', d).onsubmit = e => {
    e.preventDefault();
    socket.emit('host:addStudent', $('#lateName', d).value, res => {
      if (!res || res.error) return toast((res && res.error) || 'Erro', 4500);
      toast('Formando acrescentado: já pode entrar com o nome completo'); d.remove(); playersDialog();
    });
  };
  $$('[data-rel]', d).forEach(b => b.onclick = () => socket.emit('host:release', b.dataset.rel, res => {
    if (!res || res.error) return toast((res && res.error) || 'Erro');
    b.outerHTML = `<div style="text-align:center"><small class="muted">Código de reentrada</small><br><b style="font-size:1.6em;letter-spacing:.15em">${esc(res.rejoin)}</b></div>`;
  }));
}

function renderSetup(el) {
  const qz = quizzes.filter(q => q.questions.length);
  const withQ = courses.filter(c => qz.some(q => q.courseId === c.id));
  let selCourse = null; try { selCourse = localStorage.getItem('aq_course'); } catch {}
  if (!withQ.find(c => c.id === selCourse)) selCourse = withQ[0] && withQ[0].id;
  el.innerHTML = `<div class="wrap"><div class="grid2">
    <div class="card slide-up">
      <h2>🚀 Nova sessão</h2>
      ${!qz.length ? '<p>Cria primeiro um questionário no separador <b>Questionários</b>.</p>' : ''}
      <div class="list">
        <label>Curso</label>
        <select id="sCourse">${withQ.map(c => `<option value="${c.id}" ${c.id === selCourse ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <label>Questionário</label>
        <select id="sQuiz"></select>
        <p class="anon-note" id="anonNote" hidden>🕶️ <b>Questionário anónimo:</b> os formandos entram só com o QR code, sem nome nem fotografia, e os resultados ficam por "Anónimo #código". Não há ranking nem pódio.</p>
        <label>Como avançam as perguntas? <small class="muted">(aplica-se a todo o quiz)</small></label>
        <div class="modes">
          <label class="mode"><input type="radio" name="sMode" value="manual" checked><span><b>🎮 Manual</b><small>Tu abres cada pergunta e decides quando fechar. Depois mostras a sondagem, a resposta correta e o ranking ao teu ritmo.</small></span></label>
          <label class="mode"><input type="radio" name="sMode" value="timed"><span><b>⏱ Por tempo</b><small>Cada pergunta tem tempo limite. Quando chega a 0 (ou todos respondem) deixa de aceitar respostas e passa sozinha para a sondagem. Depois avanças tu para a resposta correta.</small></span></label>
          <label class="mode"><input type="radio" name="sMode" value="auto"><span><b>🤖 Totalmente automático</b><small>Tudo por tempo: respostas, sondagem, resposta correta, ranking e passagem para a pergunta seguinte, até ao pódio final. Só carregas em "Começar". Podes pausar ou avançar quando quiseres.</small></span></label>
          <label class="mode"><input type="radio" name="sMode" value="exam"><span><b>⏳ Tempo total (cada um ao seu ritmo)</b><small>Cada formando recebe todas as perguntas no telemóvel e responde ao seu ritmo: pode andar para a frente e para trás e mudar respostas até entregar. Quando o tempo total acaba, tudo é entregue automaticamente.</small></span></label>
        </div>
        <div class="times" id="examRow" hidden>
          <label>⏳ Tempo total para responder a todas as perguntas <span class="num-in"><input type="number" id="tTotal" min="1" max="300" value="10"> min</span></label>
          <small class="muted">Sem sondagem, resposta correta nem ranking entre perguntas; cada resposta certa vale 1000 pontos (sem pontos por rapidez).</small>
        </div>
        <div class="times" id="timeRow" hidden>
          <label>⏱ Tempo para responder
            <select id="sTime"><option value="0">O definido em cada pergunta</option>${[10, 15, 20, 30, 45, 60, 90, 120].map(t => `<option value="${t}">${t} s (todas)</option>`).join('')}</select></label>
          <div id="autoRow" class="times-grid" hidden>
            <label>📊 Sondagem <span class="num-in"><input type="number" id="tPoll" min="2" max="120" value="5"> s</span></label>
            <label>✅ Resposta correta <span class="num-in"><input type="number" id="tReveal" min="2" max="120" value="6"> s</span></label>
            <label id="tBoardL">🏆 Ranking <span class="num-in"><input type="number" id="tBoard" min="2" max="120" value="8"> s</span></label>
          </div>
        </div>
        <label>✅ Respostas corretas para os formandos</label>
        <label class="switch"><input type="checkbox" id="sRevEach" checked> Mostrar a resposta correta depois de cada pergunta</label>
        <label class="switch"><input type="checkbox" id="sRevEnd"> Mostrar todas as respostas corretas no fim</label>
        <p class="muted" id="revealNote" hidden style="margin:-2px 0 0">Tu continuas a ver tudo: a resposta correta de cada pergunta (no teu ecrã, se ligares "👁 Ver respostas corretas") e a grelha de resultados. Os telemóveis não mostram certo/errado nem pontuação durante o quiz, e não há ranking depois de cada pergunta.</p>
        <label>🏆 Ranking</label>
        <select id="sRanking">
          <option value="each">Depois de cada pergunta (Top 5) e pódio final</option>
          <option value="end">Só o pódio final</option>
          <option value="none">Sem ranking (ninguém vê posições nem pódio)</option>
        </select>
        <div class="row teams-opt"><label class="switch" style="padding:0"><input type="checkbox" id="sTeams"> 👥 <b>Jogar em equipas</b></label>
          <select id="sTeamsN" disabled>${[2, 3, 4, 5, 6].map(n => `<option value="${n}">${n} equipas</option>`).join('')}</select></div>
        <p class="muted" id="teamsNote" hidden style="margin:-2px 0 0">Cada formando entra na equipa com menos gente (podes baralhar ou mudar alguém na sala de espera). Cada um responde no seu telemóvel; a pontuação da equipa é a <b>média</b> dos pontos dos membros, por isso é justo mesmo com equipas de tamanhos diferentes. O ranking e o pódio passam a ser por equipas.</p>
        <label class="switch"><input type="checkbox" id="sHide"> 📱 Esconder as perguntas nos telemóveis (só aparecem no teu ecrã)</label>
        <p class="muted" id="hideNote" hidden style="margin:-2px 0 0">O teu ecrã passa a ser o único sítio com as perguntas e as opções: tem de estar projetado ou visível para todos. Os formandos só veem os botões A, B, C, D, o que torna inúteis as capturas de ecrã. Não se aplica ao modo "Tempo total".</p>
        <label class="switch"><input type="checkbox" id="sPoll" checked> 📊 Mostrar a sondagem (quantos escolheram cada opção) depois de cada pergunta</label>
        <label class="switch"><input type="checkbox" id="sWho"> Mostrar no ecrã quem respondeu o quê (fotos em cada opção)</label>
        <label class="switch"><input type="checkbox" id="sSpeed" checked> Pontos extra por responder depressa</label>
        <label class="switch"><input type="checkbox" id="sShuffle"> Baralhar a ordem das perguntas</label>
        <p class="muted" style="margin:4px 0">Independentemente destas opções, a grelha final regista sempre quem respondeu o quê.</p>
        <button class="btn primary" id="sGo" ${!qz.length ? 'disabled' : ''}>Abrir sala 🎉</button>
        <p class="key-warn" id="goHint" hidden></p>
      </div>
    </div>
    <div class="card slide-up" style="animation-delay:.1s">
      <h2>👥 Turma (${students.length})</h2>
      <label class="switch" id="openJoinL"><input type="checkbox" id="sOpen" checked> 🙋 <span><b>Deixar entrar quem não está na lista</b> — escreve o nome no telemóvel e pode tirar a fotografia. Alunos registados que não marcaste também entram (com a fotografia deles).</span></label>
      ${!students.length ? '<p class="muted">Ainda não há alunos registados: os formandos entram escrevendo o nome. Se quiseres, regista-os antes (com fotografia) no separador <b>Alunos</b>.</p>' : `
      <div class="row" style="margin-bottom:8px"><button class="btn small" id="allOn">Todos</button><button class="btn small" id="allOff">Nenhum</button><span class="muted">Desmarca quem não participa nesta sessão.</span></div>
      <div class="chips">${students.map(s => `<label class="chip"><input type="checkbox" class="sStu" value="${s.id}" checked>${avatar(s, 'sm')}${esc(s.name)}</label>`).join('')}</div>`}
    </div></div></div>`;
  const go = $('#sGo');
  const fillQuiz = () => {
    const cid = $('#sCourse').value; try { localStorage.setItem('aq_course', cid); } catch {}
    $('#sQuiz').innerHTML = qz.filter(q => q.courseId === cid).map(q => `<option value="${q.id}">${q.anonymous ? '🕶️ ' : ''}${esc(q.title)} (${q.questions.length} perguntas)</option>`).join('');
    syncAnon();
  };
  // questionário anónimo: sem ranking, sem "quem respondeu" e sem escolher formandos
  const syncAnon = () => {
    const qq = qz.find(x => x.id === $('#sQuiz').value), anon = !!(qq && qq.anonymous);
    $('#anonNote').hidden = !anon;
    $('#sRanking').disabled = anon; if (anon) $('#sRanking').value = 'none';
    // explica porque é que "Abrir sala" está desligado (o questionário anónimo não precisa de alunos)
    const why = !qz.length ? 'Para abrir a sala, cria (ou importa) primeiro um questionário no separador 📝 Questionários.'
      : !qq ? 'Este curso ainda não tem questionários: escolhe outro curso ou importa um no separador 📝 Questionários.'
      : !anon && !$('#sOpen').checked && !$$('.sStu').some(c => c.checked) ? 'Marca pelo menos um aluno da turma, ou liga "Deixar entrar quem não está na lista".' : '';
    $('#openJoinL').hidden = anon;
    go.disabled = !!why; $('#goHint').hidden = !why; $('#goHint').textContent = why;
    $('#sWho').disabled = anon; if (anon) $('#sWho').checked = false;
    const turma = $('.chips'); if (turma) turma.style.opacity = anon ? .35 : 1;
  };
  $('#sQuiz').onchange = () => { syncAnon(); syncSetup(); };
  fillQuiz();
  $('#sCourse').onchange = fillQuiz;
  const syncSetup = () => {
    const m = $('[name=sMode]:checked').value;
    $('#timeRow').hidden = m === 'manual' || m === 'exam'; $('#autoRow').hidden = m !== 'auto'; $('#examRow').hidden = m !== 'exam';
    // ao seu ritmo não há passos por pergunta
    const ex = m === 'exam';
    $('#sHide').disabled = ex; if (ex) $('#sHide').checked = false;
    $('#hideNote').hidden = !$('#sHide').checked;
    ['#sRevEach', '#sPoll', '#sSpeed'].forEach(id => { $(id).disabled = ex; if (ex) $(id).checked = false; });
    if (!ex && $('#sRevEach').dataset.wasEx) { $('#sRevEach').checked = $('#sPoll').checked = $('#sSpeed').checked = true; }
    $('#sRevEach').dataset.wasEx = ex ? '1' : '';
    const rv = $('#sRevEach').checked ? 'each' : 'hidden', eachOpt = $('#sRanking option[value=each]');
    eachOpt.disabled = rv !== 'each';
    if (rv !== 'each' && $('#sRanking').value === 'each') $('#sRanking').value = 'end';
    $('#revealNote').hidden = rv === 'each';
    $('#tBoardL').hidden = $('#sRanking').value !== 'each';
    // equipas: precisam de ranking e não existem no questionário anónimo
    const qq = qz.find(x => x.id === $('#sQuiz').value), noTeams = $('#sRanking').value === 'none' || !!(qq && qq.anonymous);
    $('#sTeams').disabled = noTeams; if (noTeams) $('#sTeams').checked = false;
    $('#sTeamsN').disabled = !$('#sTeams').checked; $('#teamsNote').hidden = !$('#sTeams').checked;
  };
  $('#sRevEach').onchange = syncSetup; $('#sHide').onchange = syncSetup; $('#sTeams').onchange = syncSetup;
  $$('[name=sMode]').forEach(r => r.onchange = syncSetup); $('#sRanking').onchange = syncSetup; syncSetup();
  if ($('#allOn')) { $('#allOn').onclick = () => { $$('.sStu').forEach(c => c.checked = true); syncAnon(); }; $('#allOff').onclick = () => { $$('.sStu').forEach(c => c.checked = false); syncAnon(); }; }
  $('#sOpen').onchange = syncAnon; $$('.sStu').forEach(c => c.onchange = syncAnon);
  go.onclick = () => {
    const ids = $$('.sStu').filter(c => c.checked).map(c => c.value);
    const anonQ = (qz.find(x => x.id === $('#sQuiz').value) || {}).anonymous;
    if (!ids.length && !anonQ && !$('#sOpen').checked) return toast('Escolhe pelo menos um aluno');
    go.disabled = true; Sound.init();
    socket.emit('host:start', { quizId: $('#sQuiz').value, studentIds: ids, settings: { mode: $('[name=sMode]:checked').value, fixedTime: +$('#sTime').value, revealMode: $('#sRevEach').checked ? 'each' : ($('#sRevEnd').checked ? 'end' : 'never'), revealEnd: $('#sRevEnd').checked,
      rankEach: $('#sRanking').value === 'each', finalPodium: $('#sRanking').value !== 'none', noRanking: $('#sRanking').value === 'none',
      autoTimes: { poll: +$('#tPoll').value, reveal: +$('#tReveal').value, board: +$('#tBoard').value }, showPoll: $('#sPoll').checked, hideOnPhones: $('#sHide').checked, examMinutes: +$('#tTotal').value, showWho: $('#sWho').checked, speedPoints: $('#sSpeed').checked, shuffle: $('#sShuffle').checked,
      teams: $('#sTeams').checked ? +$('#sTeamsN').value : 0, openJoin: $('#sOpen').checked } });
  };
}

/* =================== ALUNOS =================== */
function skippedToast(added) {
  const sk = (added[0] && added[0].skipped) || [];
  toast(`${added.length} alunos adicionados` + (sk.length ? ` · ignorados por já existirem: ${sk.join(', ')} (acrescenta um apelido para distinguir)` : ''), sk.length ? 7000 : 2500);
}
function renderStudents() {
  const el = $('#tab-students');
  el.innerHTML = `<div class="grid2">
    <div class="card">
      <h2>➕ Adicionar aluno</h2>
      <form id="addStu" class="list">
        <div class="row"><div id="prev">${avatar({ name: '?' }, 'lg')}</div>
          <label class="btn small">📷 Foto<input type="file" accept="image/*,.heic,.heif" id="stuPhoto" hidden></label></div>
        <input type="text" id="stuName" placeholder="Nome do aluno" required>
        <button class="btn primary">Adicionar</button>
      </form>
      <hr style="border:0;border-top:1px solid #eee;margin:20px 0">
      <h3 style="margin:0 0 6px">📁 Adicionar vários de uma vez</h3>
      <p class="muted" style="margin-top:0">Escolhe várias fotos — o nome de cada ficheiro passa a ser o nome do aluno (ex.: <i>Ana Silva.jpg</i>). Podes corrigir os nomes antes de guardar.</p>
      <label class="btn small">Escolher fotos<input type="file" accept="image/*,.heic,.heif" multiple id="bulk" hidden></label>
      <div id="bulkList" class="list" style="margin-top:10px"></div>
      <h3 style="margin:20px 0 6px">📋 Ou colar lista de nomes</h3>
      <textarea id="names" rows="4" style="width:100%" placeholder="Um nome por linha (podes juntar as fotos depois)"></textarea>
      <button class="btn small" id="addNames" style="margin-top:6px">Adicionar nomes</button>
    </div>
    <div class="card">
      <h2>👥 Turma (${students.length})</h2>
      <div class="list" id="stuList">${students.map(s => `<div class="item" data-id="${s.id}">${avatar(s)}
        <input type="text" value="${esc(s.name)}" class="grow stuEdit" style="min-width:0">
        <label class="btn small" title="Mudar foto">📷<input type="file" accept="image/*,.heic,.heif" class="stuNewPhoto" hidden></label>
        <button class="btn small danger stuDel" title="Remover">✕</button></div>`).join('') || '<p class="muted">Sem alunos ainda.</p>'}</div>
    </div></div>`;
  let photo = null;
  $('#stuPhoto').onchange = async e => { const f = e.target.files[0]; if (!f) return; photo = await resizeImage(f); $('#prev').innerHTML = `<img class="avatar lg" src="${photo}">`; };
  $('#addStu').onsubmit = async e => {
    e.preventDefault();
    try {
      const added = await api('POST', '/api/students', { name: $('#stuName').value, photo });
      students = await api('GET', '/api/students'); toast('Adicionado: ' + added[0].name); renderStudents(); $('#stuName').focus();
    } catch (err) { toast(err.message, 5000); }
  };
  $('#addNames').onclick = async () => {
    const list = $('#names').value.split('\n').map(s => s.trim()).filter(Boolean).map(name => ({ name }));
    if (!list.length) return;
    try { const added = await api('POST', '/api/students', list); skippedToast(added); } catch (err) { toast(err.message, 5000); }
    students = await api('GET', '/api/students'); renderStudents();
  };
  $('#bulk').onchange = async e => {
    const files = [...e.target.files]; const items = [];
    for (const f of files) items.push({ name: f.name.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim(), photo: await resizeImage(f) });
    $('#bulkList').innerHTML = items.map((it, i) => `<div class="item"><img class="avatar" src="${it.photo}"><input type="text" class="grow bulkName" data-i="${i}" value="${esc(it.name)}"></div>`).join('') +
      `<button class="btn primary" id="bulkSave">Guardar ${items.length} alunos</button>`;
    $('#bulkSave').onclick = async () => {
      $$('.bulkName').forEach(inp => items[inp.dataset.i].name = inp.value);
      try { const added = await api('POST', '/api/students', items); skippedToast(added); } catch (err) { toast(err.message, 5000); }
      students = await api('GET', '/api/students'); renderStudents();
    };
  };
  $$('#stuList .item').forEach(row => {
    const id = row.dataset.id;
    $('.stuEdit', row).onchange = async e => {
      try { await api('PUT', '/api/students/' + id, { name: e.target.value }); toast('Guardado'); } catch (err) { toast(err.message, 5000); }
      students = await api('GET', '/api/students'); renderStudents();
    };
    $('.stuNewPhoto', row).onchange = async e => { const f = e.target.files[0]; if (!f) return; await api('PUT', '/api/students/' + id, { photo: await resizeImage(f) }); students = await api('GET', '/api/students'); renderStudents(); };
    $('.stuDel', row).onclick = async () => { if (!confirm('Remover este aluno?')) return; await api('DELETE', '/api/students/' + id); students = await api('GET', '/api/students'); renderStudents(); };
  });
}

/* =================== QUESTIONÁRIOS =================== */
let editing = null;
function renderQuizzes() {
  const el = $('#tab-quizzes');
  if (editing) return renderEditor(el);
  el.innerHTML = `<div class="card"><div class="row"><h2 class="grow" style="margin:0">🎓 Cursos e questionários</h2>
    <form id="newCourse" class="row"><input type="text" id="courseName" placeholder="Nome do novo curso" required><button class="btn primary">+ Novo curso</button></form></div>
    ${!courses.length ? '<p class="muted">Cria primeiro um curso (ex.: "Técnico de Vendas", "Excel Avançado"). Depois adicionas os questionários desse curso.</p>' : ''}</div>
    ${courses.map(c => { const qs = quizzes.filter(q => q.courseId === c.id); return `<div class="card slide-up" style="margin-top:16px">
      <div class="row"><h3 class="grow" style="margin:0;font-size:1.3em">🎓 ${esc(c.name)} <small class="muted" style="font-weight:400">· ${qs.length} questionário${qs.length === 1 ? '' : 's'}</small></h3>
        <button class="btn small primary" data-newq="${c.id}">+ Questionário</button>
        <label class="btn small">Importar JSON<input type="file" accept=".json" data-imp="${c.id}" hidden></label>
        <button class="btn small" data-ren="${c.id}">✏️ Renomear</button><button class="btn small danger" data-cdel="${c.id}" title="Apagar curso">✕</button></div>
      <div class="list" style="margin-top:12px">${qs.map(q => `<div class="item"><div class="grow"><b>${esc(q.title)}</b>${q.anonymous ? ' <span class="tag none">🕶️ anónimo</span>' : ''}<br><small class="muted">${q.questions.length} perguntas</small></div>
        <button class="btn small" data-edit="${q.id}">Editar</button><button class="btn small" data-dup="${q.id}">Duplicar</button>
        <button class="btn small" data-key="${q.id}">📋 Soluções</button><button class="btn small" data-exp="${q.id}">Exportar</button><button class="btn small danger" data-del="${q.id}">✕</button></div>`).join('') || '<p class="muted" style="margin:0">Ainda sem questionários neste curso.</p>'}</div></div>`; }).join('')}`;
  const after = async () => { await reloadCQ(); renderQuizzes(); };
  $('#newCourse').onsubmit = async e => { e.preventDefault(); try { await api('POST', '/api/courses', { name: $('#courseName').value }); } catch (err) { return toast(err.message); } toast('Curso criado'); after(); };
  $$('[data-ren]').forEach(b => b.onclick = async () => { const n = prompt('Novo nome do curso:', courseName(b.dataset.ren)); if (n && n.trim()) { await api('PUT', '/api/courses/' + b.dataset.ren, { name: n }); after(); } });
  $$('[data-cdel]').forEach(b => b.onclick = async () => { if (!confirm('Apagar o curso "' + courseName(b.dataset.cdel) + '"?')) return; try { await api('DELETE', '/api/courses/' + b.dataset.cdel); after(); } catch (e) { toast(e.message, 4500); } });
  $$('[data-newq]').forEach(b => b.onclick = () => { editing = { courseId: b.dataset.newq, title: 'Novo questionário', questions: [blankQ()] }; renderQuizzes(); });
  $$('[data-edit]').forEach(b => b.onclick = () => { editing = JSON.parse(JSON.stringify(quizzes.find(q => q.id === b.dataset.edit))); renderQuizzes(); });
  $$('[data-dup]').forEach(b => b.onclick = async () => { const q = JSON.parse(JSON.stringify(quizzes.find(q => q.id === b.dataset.dup))); delete q.id; q.title += ' (cópia)'; q.questions.forEach(x => delete x.id); await api('POST', '/api/quizzes', q); after(); });
  $$('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Apagar este questionário?')) return; await api('DELETE', '/api/quizzes/' + b.dataset.del); after(); });
  $$('[data-key]').forEach(b => b.onclick = () => showAnswerKey(quizzes.find(q => q.id === b.dataset.key)));
  $$('[data-exp]').forEach(b => b.onclick = () => { const q = quizzes.find(q => q.id === b.dataset.exp); download(q.title + '.json', JSON.stringify(q, null, 2), 'application/json'); });
  $$('[data-imp]').forEach(inp => inp.onchange = async e => { try { const q = JSON.parse(await e.target.files[0].text()); delete q.id; q.courseId = inp.dataset.imp; await api('POST', '/api/quizzes', q); toast('Importado'); after(); } catch (err) { toast('Ficheiro inválido'); } });
}
// Lista de soluções: todas as perguntas com a resposta correta destacada (imprimir / PDF / Word)
function answerKeyItemHtml(q, i) {
  const t = qType(q);
  let body = '';
  if (t === 'mc' || t === 'tf') body = `<ol class="key-opts" type="A">${q.options.map((o, k) => `<li class="${q.correct.includes(k) ? 'key-ok' : ''}">${esc(o)}${q.correct.includes(k) ? ' <b>✓ correta</b>' : ''}</li>`).join('')}</ol>`;
  if (t === 'fill') body = `<p class="key-fill">${String(q.text).split(BLANK_RX).map((p, k) => k % 2 ? `<span class="key-ok">${esc(p.trim())}</span>` : esc(p)).join('')}</p>
    <p class="muted">Palavras disponíveis: ${bankOf(q).map(esc).join(' · ')}</p>`;
  if (t === 'open') body = (q.accepted || []).length ? `<p>Resposta de referência: <span class="key-ok">${q.accepted.map(esc).join(' / ')}</span></p><p class="muted">Validada pelo formador, resposta a resposta.</p>`
    : `<p class="key-warn">⚠ Sem resposta de referência — edita a pergunta para a acrescentar.</p>`;
  if (t === 'scale') body = `<div class="key-scale">${[1, 2, 3, 4, 5].map(n => `<span>${n}</span>`).join('')}</div>
    ${q.scaleMin || q.scaleMax ? `<p class="muted">1 = ${esc(q.scaleMin || '—')} · 5 = ${esc(q.scaleMax || '—')}</p>` : ''}<p class="muted">Escala de opinião: não tem resposta certa.</p>`;
  if (t === 'guess') body = `<p>Palavra secreta: <span class="key-ok">${esc(String(q.answer).toUpperCase())}</span> · ${cwNorm(q.answer).length} letras · ${q.maxTries || 6} tentativas</p><p class="muted">Cada letra fica verde (sítio certo), laranja (existe noutro sítio) ou vermelha (não existe). Pontos: tudo à 1ª tentativa, metade na última.</p>`;
  if (t === 'scramble') body = `<p>Palavra: <span class="key-ok">${esc(String(q.answer).toUpperCase())}</span></p><p class="muted">Os formandos veem as letras baralhadas: ${scrambleTilesOf(q).map(esc).join(' ')}</p>`;
  if (t === 'cross') body = `<div class="key-cross">${crossGridHtml(q.cross, Object.fromEntries(q.cross.words.flatMap(w => crossCellsOf(w).map((k, i) => [k, w.word[i]]))), {}, 'key')}
    <ol class="key-opts" style="list-style:none;padding-left:0">${q.cross.words.map(w => `<li>${w.n}${w.dir === 'a' ? '→' : '↓'} ${esc(w.clue)} — <span class="key-ok">${esc(w.display.toUpperCase())}</span></li>`).join('')}</ol></div>`;
  if (t === 'number') body = `<p>Resposta: <span class="key-ok">${esc(fmtN(q.answer))}</span> · intervalo de ${esc(fmtN(q.min))} a ${esc(fmtN(q.max))}</p><p class="muted">Em cheio dá todos os pontos; perto dá parte dos pontos.</p>`;
  if (t === 'match') body = `<ol class="key-opts">${q.pairs.map(p => `<li>${esc(p.left)} → <span class="key-ok">${esc(p.right)}</span></li>`).join('')}</ol><p class="muted">Os formandos veem as opções da direita baralhadas.</p>`;
  if (t === 'spot') body = `<div class="key-spot">${spotStageHtml(q, true)}</div><p class="muted">A zona certa está a verde.</p>`;
  if (t === 'cloud') body = `<p class="muted">Cada formando escreve até ${q.words || 3} palavra(s). Nuvem de palavras: não tem resposta certa.</p>`;
  if (t === 'rank') body = q.ordered ? `<ol class="key-opts">${q.options.map(o => `<li class="key-ok">${esc(o)}</li>`).join('')}</ol><p class="muted">Ordem certa (os formandos veem as opções baralhadas).</p>`
    : `<ul class="key-opts">${q.options.map(o => `<li>${esc(o)}</li>`).join('')}</ul><p class="muted">Ranking de opinião: não tem ordem certa.</p>`;
  return `<div class="key-item"><div class="key-q"><b>${i + 1}.</b> ${esc(qTitle(q))} <span class="tag none">${QTYPE_LABEL[t]} · ${q.time} s</span></div>${body}</div>`;
}
function showAnswerKey(quiz) {
  const el = $('#tab-quizzes');
  el.innerHTML = `<div class="card"><div class="row noprint"><button class="btn small" id="keyBack">← Questionários</button><span class="grow"></span>
      <button class="btn small" id="keyDocx">⬇ Word</button><button class="btn small primary js-print">🖨 Imprimir / guardar PDF</button></div>
    <h2 style="margin:14px 0 2px">📋 Lista de soluções</h2>
    <p class="muted" style="margin-top:0">🎓 ${esc(courseName(quiz.courseId))} · 📝 ${esc(quiz.title)} · ${quiz.questions.length} perguntas · a resposta correta está destacada a verde</p>
    ${quiz.questions.map(answerKeyItemHtml).join('')}</div>`;
  $('#keyBack').onclick = renderQuizzes;
  $('#keyDocx').onclick = () => downloadFile(`/api/quizzes/${encodeURIComponent(quiz.id)}/docx`, 'solucoes.docx');
  window.scrollTo(0, 0);
}
const blankQ = () => ({ type: 'mc', text: '', options: ['', '', '', ''], correct: [0], time: 20 });

function renderEditor(el) {
  const q = editing;
  el.innerHTML = `<div class="card">
    <div class="row"><label class="muted">🎓 Curso</label><select id="qCourse">${courses.map(c => `<option value="${c.id}" ${c.id === q.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <label class="switch anon-opt"><input type="checkbox" id="qAnon" ${q.anonymous ? 'checked' : ''}> 🕶️ <b>Respostas anónimas</b> — não se pede o nome nem a fotografia; ninguém (nem tu) sabe quem respondeu o quê. Sem ranking nem pódio.</label>
    <div class="row" style="margin-top:10px"><input type="text" id="qTitle" class="grow" value="${esc(q.title)}" style="font-size:1.3em;font-weight:600">
      <button class="btn ghost" id="cancelEd" style="color:var(--ink);background:#eee">Cancelar</button><button class="btn primary" id="saveEd">💾 Guardar</button></div>
    <details style="margin:14px 0"><summary style="cursor:pointer;font-weight:600">⚡ Importar perguntas de texto (rápido)</summary>
      <p class="muted">Uma pergunta por bloco, separados por linha em branco. Primeira linha = pergunta; opcional <code>[30s]</code> no fim para o tempo.</p>
      <ul class="muted" style="margin-top:0">
        <li><b>Escolha múltipla:</b> linhas seguintes = opções; marca a(s) correta(s) com <b>*</b>.</li>
        <li><b>Verdadeiro/Falso:</b> opções <code>*Verdadeiro</code> e <code>Falso</code> (ou o contrário).</li>
        <li><b>Completar espaços:</b> põe cada palavra certa entre <code>[[ ]]</code> na frase; na linha seguinte, palavras extra separadas por vírgulas (opcional).</li>
        <li><b>Resposta livre:</b> acaba a pergunta com <code>[livre]</code>; na linha seguinte, com <b>*</b>, a resposta de referência (obrigatória).</li>
        <li><b>Escala 1–5:</b> acaba a pergunta com <code>[escala]</code>; opcional <code>1=Nada</code> e <code>5=Muito</code> nas linhas seguintes.</li>
        <li><b>Adivinha a palavra:</b> a pista acaba com <code>[adivinha]</code>; na linha seguinte, a palavra secreta.</li>
        <li><b>Letras baralhadas:</b> a pergunta é a pista e acaba com <code>[letras]</code>; na linha seguinte, a palavra.</li>
        <li><b>Palavras cruzadas:</b> título acabado em <code>[cruzadas]</code>; depois uma linha por palavra: <code>palavra = pista</code>.</li>
        <li><b>Nuvem de palavras:</b> acaba a pergunta com <code>[nuvem]</code> (até 3 palavras) ou <code>[nuvem:1]</code> (só uma).</li>
        <li><b>Ranking:</b> acaba com <code>[ordenar]</code> e escreve as opções <b>pela ordem certa</b>; ou com <code>[ranking]</code> se for de opinião (sem ordem certa).</li>
      </ul>
      <textarea id="bulkQ" rows="10" style="width:100%" placeholder="Qual é a capital de Portugal? [20s]&#10;Porto&#10;*Lisboa&#10;Coimbra&#10;&#10;O sol é uma estrela.&#10;*Verdadeiro&#10;Falso&#10;&#10;A capital de Portugal é [[Lisboa]] e fica junto ao rio [[Tejo]].&#10;Porto, Douro, Mondego&#10;&#10;Dá um exemplo de escuta ativa. [livre]&#10;*Ouvir com atenção e mostrar que se percebeu&#10;&#10;Gostaste da formação? [escala]&#10;1=Nada&#10;5=Muito"></textarea>
      <button class="btn small" id="parseQ">Adicionar estas perguntas</button></details>
    <div id="qList">${q.questions.map((x, i) => qEditHtml(x, i)).join('')}</div>
    <button class="btn" id="addQ">+ Adicionar pergunta</button>
  </div>`;
  el.oninput = () => { if ($('#qTitle')) sync(); };   // o separador também mostra outras coisas (lista, soluções)
  const sync = () => {
    q.title = $('#qTitle').value; q.courseId = $('#qCourse').value; q.anonymous = $('#qAnon').checked;
    $$('.qedit').forEach((box, i) => {
      const x = q.questions[i], t = qType(x);
      x.type = t; x.text = $('.qText', box).value; x.time = +$('.qTime', box).value || 20;
      if (t === 'mc') { x.options = $$('.qOpt', box).map(o => o.value); x.correct = $$('.qCor', box).map((c, k) => c.checked ? k : -1).filter(k => k >= 0); }
      if (t === 'tf') { x.options = ['Verdadeiro', 'Falso']; x.correct = [$('.qTFc:checked', box) ? +$('.qTFc:checked', box).value : 0]; }
      if (t === 'fill') { x.options = $('.qExtra', box).value.split(',').map(w => w.trim()).filter(Boolean); x.correct = []; }
      if (t === 'open') { x.accepted = $('.qAcc', box).value.split(';').map(w => w.trim()).filter(Boolean); x.options = []; x.correct = []; }
      if (t === 'scale') { x.scaleMin = $('.qSmin', box).value; x.scaleMax = $('.qSmax', box).value; x.options = []; x.correct = []; }
      if (t === 'cloud') { x.words = +$('.qWords', box).value || 3; x.options = []; x.correct = []; }
      if (t === 'scramble') { x.answer = $('.qAnswer', box).value; x.options = []; x.correct = []; }
      if (t === 'guess') { x.answer = $('.qAnswer', box).value; x.maxTries = +$('.qTries', box).value || 6; x.options = []; x.correct = []; }
      if (t === 'cross') { x.entries = $$('.cw-row', box).map(r => ({ word: $('.cwWord', r).value, clue: $('.cwClue', r).value })); x.options = []; x.correct = []; }
      if (t === 'rank') { x.options = $$('.qOpt', box).map(o => o.value); x.ordered = $('.qOrdered', box).checked; x.correct = []; }
      if (t === 'number') { ['min', 'max', 'answer', 'step'].forEach(k => { const v = $('.qN-' + k, box).value; x[k] = v === '' ? null : Number(v.replace(',', '.')); }); x.options = []; x.correct = []; }
      if (t === 'match') { x.pairs = $$('.m-row', box).map(r => ({ left: $('.mL', r).value, right: $('.mR', r).value })); x.options = []; x.correct = []; }
      if (t === 'spot') { x.options = []; x.correct = []; }
    });
  };
  $('#cancelEd').onclick = () => { editing = null; renderQuizzes(); };
  $('#addQ').onclick = () => { sync(); q.questions.push(blankQ()); renderQuizzes(); $$('.qText').pop().focus(); };
  $('#parseQ').onclick = () => {
    sync();
    const blocks = $('#bulkQ').value.split(/\n\s*\n/).map(b => b.split('\n').map(l => l.trim()).filter(Boolean)).filter(b => b.length >= 1);
    let added = 0;
    for (const b of blocks) {
      let text = b[0], time = 20; const m = /\[(\d+)\s*s?\]\s*$/.exec(text); if (m) { time = +m[1]; text = text.replace(m[0], '').trim(); }
      const rest = b.slice(1);
      let x = null;
      if (/\[adivinha\]\s*$/i.test(text)) { x = { type: 'guess', text: text.replace(/\[adivinha\]\s*$/i, '').trim() || 'Adivinha a palavra', answer: (rest[0] || '').replace(/^\*\s*/, ''), maxTries: 6 }; time = Math.max(time, 120); }
      else if (/\[(baralhada|letras)\]\s*$/i.test(text)) x = { type: 'scramble', text: text.replace(/\[(baralhada|letras)\]\s*$/i, '').trim(), answer: (rest[0] || '').replace(/^\*\s*/, '') };
      else if (/\[cruzadas\]\s*$/i.test(text)) { x = { type: 'cross', text: text.replace(/\[cruzadas\]\s*$/i, '').trim(), entries: rest.map(l => { const m = /^(.+?)\s*[=:]\s*(.+)$/.exec(l); return m ? { word: m[1].replace(/^\*\s*/, '').trim(), clue: m[2].trim() } : null; }).filter(Boolean) }; time = Math.max(time, 120); }
      else if (/\[nuvem(?::\s*(\d))?\]\s*$/i.test(text)) { const w = /\[nuvem(?::\s*(\d))?\]/i.exec(text)[1]; x = { type: 'cloud', text: text.replace(/\[nuvem[^\]]*\]\s*$/i, '').trim(), words: +w || 3 }; }
      else if (/\[(ordenar|ranking)\]\s*$/i.test(text)) x = { type: 'rank', text: text.replace(/\[(ordenar|ranking)\]\s*$/i, '').trim(), options: rest.map(o => o.replace(/^\*\s*/, '')).slice(0, 6), ordered: /\[ordenar\]/i.test(text) };
      else if (/\[livre\]\s*$/i.test(text)) x = { type: 'open', text: text.replace(/\[livre\]\s*$/i, '').trim(), accepted: rest.filter(l => l.startsWith('*')).map(l => l.slice(1).trim()) };
      else if (/\[escala\]\s*$/i.test(text)) {
        const lab = n => ((rest.find(l => l.startsWith(n + '=')) || '').split('=')[1] || '').trim();
        x = { type: 'scale', text: text.replace(/\[escala\]\s*$/i, '').trim(), scaleMin: lab(1), scaleMax: lab(5) };
      } else if (fillBlanksOf(text).length) x = { type: 'fill', text, options: rest.join(',').split(',').map(w => w.trim()).filter(Boolean) };
      else if (rest.length === 2 && rest.every(o => /^\*?\s*(verdadeiro|falso)$/i.test(o))) {
        const c = rest.findIndex(o => o.startsWith('*')); const vIdx = rest.findIndex(o => /verdadeiro/i.test(o));
        x = { type: 'tf', text, options: ['Verdadeiro', 'Falso'], correct: [c >= 0 && rest[c] && /falso/i.test(rest[c]) ? 1 : 0] };
      } else if (rest.length >= 2) {
        const opts = rest.slice(0, 6); const correct = opts.map((o, i) => o.startsWith('*') ? i : -1).filter(i => i >= 0);
        x = { type: 'mc', text, options: opts.map(o => o.replace(/^\*\s*/, '')), correct: correct.length ? correct : [0] };
      }
      if (x) { q.questions.push({ options: [], correct: [], ...x, time }); added++; }
    }
    q.questions = q.questions.filter(x => x.text || (x.options || []).some(Boolean));
    toast(added + ' perguntas adicionadas'); renderQuizzes();
  };
  $('#saveEd').onclick = async () => {
    sync();
    for (const [i, x] of q.questions.entries()) {
      const t = qType(x);
      if (!x.text.trim()) return toast(`Pergunta ${i + 1}: falta o texto`);
      if (t === 'mc') {
        if (x.options.filter(o => o.trim()).length < 2) return toast(`Pergunta ${i + 1}: precisa de pelo menos 2 opções`);
        if (!x.correct.length || x.correct.some(k => !x.options[k] || !x.options[k].trim())) return toast(`Pergunta ${i + 1}: marca a resposta correta`);
      }
      if (t === 'guess' && (cwNorm(x.answer || '').length < 3 || cwNorm(x.answer || '').length > 12)) return toast(`Pergunta ${i + 1}: a palavra secreta tem de ter entre 3 e 12 letras`);
      if (t === 'scramble' && cwNorm(x.answer || '').length < 2) return toast(`Pergunta ${i + 1}: escreve a palavra a adivinhar (pelo menos 2 letras)`);
      if (t === 'cross') {
        const ok = (x.entries || []).filter(e => cwNorm(e.word).length >= 2);
        if (ok.some(e => !e.clue.trim())) return toast(`Pergunta ${i + 1}: falta a pista de uma palavra`);
        if (ok.length < 2) return toast(`Pergunta ${i + 1}: as palavras cruzadas precisam de pelo menos 2 palavras`);
        const cw = buildCrossword(ok); if (cw.unplaced.length) return toast(`Pergunta ${i + 1}: não consegui cruzar ${cw.unplaced.join(', ')}. Troca ou apaga essa palavra (precisa de ter letras em comum com as outras).`, 7000);
        x.entries = ok;
      }
      if (t === 'number') {
        if (x.min == null || x.max == null || !(x.min < x.max)) return toast(`Pergunta ${i + 1}: o mínimo tem de ser menor que o máximo`);
        if (x.answer == null || x.answer < x.min || x.answer > x.max) return toast(`Pergunta ${i + 1}: a resposta tem de estar entre ${x.min} e ${x.max}`);
      }
      if (t === 'match') {
        x.pairs = (x.pairs || []).filter(p => p.left.trim() || p.right.trim());
        if (x.pairs.some(p => !p.left.trim() || !p.right.trim())) return toast(`Pergunta ${i + 1}: cada par precisa dos dois lados preenchidos`);
        if (x.pairs.length < 2) return toast(`Pergunta ${i + 1}: a correspondência precisa de pelo menos 2 pares`);
      }
      if (t === 'spot' && !x.image) return toast(`Pergunta ${i + 1}: carrega a imagem (botão 🖼 Imagem)`);
      if (t === 'spot' && !(x.zone && x.zone.w >= 0.01 && x.zone.h >= 0.01)) return toast(`Pergunta ${i + 1}: marca a zona certa na imagem (arrasta por cima dela)`, 6000);
      if (t === 'rank' && x.options.filter(o => o.trim()).length < 2) return toast(`Pergunta ${i + 1}: o ranking precisa de pelo menos 2 opções`);
      if (t === 'open' && !(x.accepted || []).length) return toast(`Pergunta ${i + 1}: escreve a resposta de referência (é obrigatória nas respostas livres).`, 6000);
      if (t === 'fill' && !fillBlanksOf(x.text).length) return toast(`Pergunta ${i + 1}: põe as palavras certas entre [[ ]] na frase, ex.: A capital é [[Lisboa]].`, 6000);
    }
    // escolha múltipla: remove opções vazias e reajusta índices das corretas
    q.questions.filter(x => qType(x) === 'rank').forEach(x => { x.options = x.options.filter(o => o.trim()); });
    q.questions.filter(x => qType(x) === 'mc').forEach(x => { const map = []; const opts = []; x.options.forEach((o, k) => { if (o.trim()) { map[k] = opts.length; opts.push(o); } }); x.correct = x.correct.map(k => map[k]); x.options = opts; });
    let saved; try { saved = await api('POST', '/api/quizzes', q); } catch (e) { return toast('Não foi guardado: ' + e.message, 5000); }
    await reloadCQ(); editing = null; toast('Guardado: ' + saved.title); renderQuizzes();
  };
  $$('.qedit').forEach((box, i) => {
    $('.qDel', box).onclick = () => { sync(); q.questions.splice(i, 1); renderQuizzes(); };
    $('.qUp', box).onclick = () => { sync(); if (i > 0) { [q.questions[i - 1], q.questions[i]] = [q.questions[i], q.questions[i - 1]]; renderQuizzes(); } };
    const ao = $('.qAddOpt', box); if (ao) ao.onclick = () => { sync(); if (q.questions[i].options.length < 6) q.questions[i].options.push(''); renderQuizzes(); };
    const cwAdd = $('.cwAdd', box); if (cwAdd) cwAdd.onclick = () => { sync(); if (q.questions[i].entries.length < 15) q.questions[i].entries.push({ word: '', clue: '' }); renderQuizzes(); };
    $$('.cwDel', box).forEach(b => b.onclick = () => { sync(); q.questions[i].entries.splice(+b.dataset.k, 1); renderQuizzes(); });
    const cwPrev = () => { const pv = $('.cwPrev', box); if (!pv) return; const es = $$('.cw-row', box).map(r => ({ word: $('.cwWord', r).value, clue: $('.cwClue', r).value })).filter(e => cwNorm(e.word).length >= 2);
      const cw = buildCrossword(es);
      pv.innerHTML = cw.words.length ? crossGridHtml(cw, Object.fromEntries(cw.words.flatMap(w => crossCellsOf(w).map((k, j) => [k, w.word[j]]))), {}, 'mini') + (cw.unplaced.length ? `<p class="key-warn">⚠ Não cruza: ${cw.unplaced.map(esc).join(', ')} — troca ou apaga (precisa de letras em comum com as outras).</p>` : `<p class="muted">✅ ${cw.words.length} palavras cruzadas (${cw.rows}×${cw.cols})</p>`) : '<p class="muted">Escreve pelo menos 2 palavras para ver a grelha.</p>'; };
    $$('.cwWord', box).forEach(inp => inp.oninput = cwPrev); cwPrev();
    $$('.mAdd', box).forEach(b => b.onclick = () => { sync(); const x = q.questions[i]; if (x.pairs.length >= 6) return toast('No máximo 6 pares'); x.pairs.push({ left: '', right: '' }); renderQuizzes(); });
    $$('.mDel', box).forEach(b => b.onclick = () => { sync(); const x = q.questions[i]; if (x.pairs.length <= 2) return; x.pairs.splice(+b.dataset.k, 1); renderQuizzes(); });
    const sp = $('.spotEd', box);
    if (sp) {
      // arrastar por cima da imagem desenha a zona certa
      const img = $('img', sp), zEl = $('.spot-zone', sp);
      const fr = e => { const r = img.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
      const draw = z => { const pc = v => (v * 100).toFixed(1) + '%'; Object.assign(zEl.style, { display: z ? 'block' : 'none', left: pc(z ? z.x : 0), top: pc(z ? z.y : 0), width: pc(z ? z.w : 0), height: pc(z ? z.h : 0) }); };
      let a0 = null;
      sp.onpointerdown = e => { e.preventDefault(); a0 = fr(e); sp.setPointerCapture(e.pointerId); };
      sp.onpointermove = e => { if (!a0) return; const b = fr(e), r3 = v => Math.round(v * 1000) / 1000;
        q.questions[i].zone = { x: r3(Math.min(a0[0], b[0])), y: r3(Math.min(a0[1], b[1])), w: r3(Math.abs(a0[0] - b[0])), h: r3(Math.abs(a0[1] - b[1])) }; draw(q.questions[i].zone); };
      sp.onpointerup = () => { a0 = null; const z = q.questions[i].zone; $('.spotMsg', box).innerHTML = z && z.w >= 0.01 && z.h >= 0.01 ? '✅ Zona marcada. Arrasta outra vez para a mudar.' : '⚠ Zona muito pequena: arrasta um retângulo por cima do sítio certo.'; };
      draw(q.questions[i].zone);
    }
    $$('.qRankUp', box).forEach(b => b.onclick = () => { sync(); const o = q.questions[i].options, k = +b.dataset.k; if (k > 0) { [o[k - 1], o[k]] = [o[k], o[k - 1]]; renderQuizzes(); } });
    $('.qType', box).onchange = e => {
      sync(); const x = q.questions[i], t = e.target.value; x.type = t;
      if (t === 'tf') Object.assign(x, { options: ['Verdadeiro', 'Falso'], correct: [0] });
      if (t === 'mc' && (x.options || []).length < 2) Object.assign(x, { options: ['', '', '', ''], correct: [0] });
      if (t === 'fill') Object.assign(x, { options: [], correct: [] });
      if (t === 'cloud') Object.assign(x, { options: [], correct: [], words: x.words || 3 });
      if (t === 'scramble') Object.assign(x, { options: [], correct: [], answer: x.answer || '' });
      if (t === 'guess') Object.assign(x, { options: [], correct: [], answer: x.answer || '', maxTries: x.maxTries || 6, time: Math.max(x.time || 0, 120) });
      if (t === 'cross') Object.assign(x, { options: [], correct: [], entries: (x.entries || []).length ? x.entries : [{ word: '', clue: '' }, { word: '', clue: '' }, { word: '', clue: '' }], time: Math.max(x.time || 0, 120) });
      if (t === 'number') Object.assign(x, { options: [], correct: [], min: x.min ?? 0, max: x.max ?? 10, answer: x.answer != null && !isNaN(x.answer) ? x.answer : 5, step: x.step || 1 });
      if (t === 'match') Object.assign(x, { options: [], correct: [], pairs: (x.pairs || []).length ? x.pairs : [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }] });
      if (t === 'spot') Object.assign(x, { options: [], correct: [], zone: x.zone || null });
      if (t === 'rank') Object.assign(x, { options: (x.options || []).filter(o => o && o !== 'Verdadeiro' && o !== 'Falso').length >= 2 ? x.options.filter(o => o && o !== 'Verdadeiro' && o !== 'Falso') : ['', '', '', ''], correct: [], ordered: !!x.ordered });
      renderQuizzes();
    };
    const tx = $('.qText', box), pv = $('.fillPrev', box);
    if (pv) tx.oninput = () => { const b = fillBlanksOf(tx.value); pv.innerHTML = b.length ? `${b.length} espaço(s): ${b.map(w => `<b>${esc(w)}</b>`).join(', ')}` : '⚠ Ainda sem espaços: escreve a palavra certa entre [[ ]]'; };
    $('.qImg', box).onchange = async e => { const f = e.target.files[0]; if (!f) return; sync(); q.questions[i].image = await resizeImage(f, 900, false); renderQuizzes(); };
    const rm = $('.qImgDel', box); if (rm) rm.onclick = () => { sync(); q.questions[i].image = null; renderQuizzes(); };
    $$('.qOptDel', box).forEach(b => b.onclick = () => { sync(); const x = q.questions[i]; const k = +b.dataset.k; if (x.options.length <= 2) return; x.options.splice(k, 1); x.correct = x.correct.filter(c => c !== k).map(c => c > k ? c - 1 : c); if (!x.correct.length && qType(x) === 'mc') x.correct = [0]; renderQuizzes(); });
  });
}
function qEditHtml(x, i) {
  const t = qType(x);
  let body = '';
  if (t === 'mc') body = `${x.options.map((o, k) => `<div class="opt-row"><span class="letter" style="background:var(--${'abcdef'[k]})">${LETTERS[k]}</span><input type="text" class="qOpt" value="${esc(o)}" placeholder="Opção ${LETTERS[k]}">
      <label class="switch" title="Resposta correta"><input type="checkbox" class="qCor" ${x.correct.includes(k) ? 'checked' : ''}> correta</label>
      <button class="btn small qOptDel" data-k="${k}" title="Remover opção">−</button></div>`).join('')}
    <div class="row" style="margin-top:6px"><button class="btn small qAddOpt">+ Opção</button></div>`;
  if (t === 'tf') body = `<div class="row" style="margin-top:8px"><span class="muted">Resposta correta:</span>
      <label class="switch"><input type="radio" class="qTFc" name="tf${i}" value="0" ${(x.correct || [0])[0] !== 1 ? 'checked' : ''}> Verdadeiro</label>
      <label class="switch"><input type="radio" class="qTFc" name="tf${i}" value="1" ${(x.correct || [0])[0] === 1 ? 'checked' : ''}> Falso</label></div>`;
  if (t === 'fill') {
    const b = fillBlanksOf(x.text);
    body = `<p class="muted" style="margin:6px 0">Escreve a frase e põe cada palavra certa entre <b>[[ ]]</b>. Ex.: <code>A capital de Portugal é [[Lisboa]] e fica junto ao rio [[Tejo]].</code></p>
      <div class="muted fillPrev">${b.length ? `${b.length} espaço(s): ${b.map(w => `<b>${esc(w)}</b>`).join(', ')}` : '⚠ Ainda sem espaços: escreve a palavra certa entre [[ ]]'}</div>
      <label class="muted" style="display:block;margin-top:8px">Palavras extra para baralhar (separadas por vírgulas)</label>
      <input type="text" class="qExtra" style="width:100%" value="${esc((x.options || []).join(', '))}" placeholder="ex.: Porto, Douro, Mondego">`;
  }
  if (t === 'open') body = `<label class="muted" style="display:block;margin-top:8px"><b>Resposta de referência (obrigatória)</b> — se houver várias, separa-as por ponto e vírgula. Serve de referência na lista de soluções e quando validares; cada resposta livre é sempre validada por ti, uma a uma.</label>
      <input type="text" class="qAcc" style="width:100%" value="${esc((x.accepted || []).join('; '))}" placeholder="ex.: Lisboa; Lx">`;
  if (t === 'scale') body = `<div class="row" style="margin-top:8px"><label class="muted">1 =</label><input type="text" class="qSmin grow" value="${esc(x.scaleMin || '')}" placeholder="ex.: Nada">
      <label class="muted">5 =</label><input type="text" class="qSmax grow" value="${esc(x.scaleMax || '')}" placeholder="ex.: Muito"></div>
      <p class="muted" style="margin:6px 0 0">Escala de opinião: não tem resposta certa nem dá pontos.</p>`;
  if (t === 'guess') body = `<div class="row" style="margin-top:8px"><label class="muted"><b>Palavra secreta</b></label><input type="text" class="qAnswer grow" maxlength="20" value="${esc(x.answer || '')}" placeholder="ex.: Valor">
      <label class="muted">Tentativas <select class="qTries">${[3, 4, 5, 6, 7, 8].map(n => `<option ${(x.maxTries || 6) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <p class="muted" style="margin:6px 0 0">🟩 A pergunta é a <b>pista</b> (opcional, ex.: "Benefício que o cliente percebe"). Os formandos escrevem palavras com o mesmo nº de letras; cada letra fica <b style="color:#16a34a">verde</b> (sítio certo), <b style="color:#ea580c">laranja</b> (existe noutro sítio) ou <b style="color:#dc2626">vermelha</b> (não existe). 3 a 12 letras, uma só palavra; acentos não contam. Mais pontos com menos tentativas.</p>`;
  if (t === 'scramble') body = `<div class="row" style="margin-top:8px"><label class="muted"><b>Palavra a adivinhar</b></label><input type="text" class="qAnswer grow" maxlength="30" value="${esc(x.answer || '')}" placeholder="ex.: Cliente"></div>
      <p class="muted" style="margin:6px 0 0">🔤 A pergunta é a <b>pista</b> (ex.: "Quem compra o produto?"). Os formandos veem as letras baralhadas e tocam nelas pela ordem. Acentos e maiúsculas não contam. Pode ter duas palavras (ex.: "pós venda").</p>`;
  if (t === 'cross') body = `<p class="muted" style="margin:8px 0 4px">✏️ Escreve as palavras e as pistas — a grelha monta-se sozinha. A pergunta acima é o título (ex.: "Palavras cruzadas: técnicas de venda"). Pontos por cada palavra certa; acentos não contam.</p>
    ${(x.entries || []).map((e, k) => `<div class="opt-row cw-row"><span class="letter" style="background:var(--d)">${k + 1}</span><input type="text" class="cwWord" maxlength="15" value="${esc(e.word)}" placeholder="Palavra" style="width:150px"><input type="text" class="cwClue grow" maxlength="200" value="${esc(e.clue)}" placeholder="Pista"><button class="btn small cwDel" data-k="${k}" title="Remover">−</button></div>`).join('')}
    <div class="row" style="margin-top:6px"><button class="btn small cwAdd">+ Palavra</button></div><div class="cwPrev" style="margin-top:8px"></div>`;
  if (t === 'cloud') body = `<div class="row" style="margin-top:8px"><label class="muted">Cada formando escreve até
      <select class="qWords">${[1, 2, 3].map(n => `<option value="${n}" ${(x.words || 3) === n ? 'selected' : ''}>${n} palavra${n > 1 ? 's' : ''}</option>`).join('')}</select></label></div>
      <p class="muted" style="margin:6px 0 0">☁️ As palavras aparecem numa nuvem no teu ecrã, em direto; as mais repetidas ficam maiores. Não tem resposta certa nem dá pontos.</p>`;
  if (t === 'number') body = `<div class="row" style="margin-top:8px">${[['min', 'Mínimo'], ['max', 'Máximo'], ['answer', '<b>Resposta certa</b>'], ['step', 'Passo']].map(([k, l]) =>
      `<label class="muted">${l} <input type="number" class="qN-${k}" value="${esc(x[k] ?? '')}" step="any" style="width:90px"></label>`).join('')}</div>
      <p class="muted" style="margin:6px 0 0">🔢 Os formandos escolhem um número numa barra. Em cheio ganham tudo; perto ainda ganham parte dos pontos (menos quanto mais longe).</p>`;
  if (t === 'match') body = `<p class="muted" style="margin:8px 0 4px">🔗 Escreve cada par: item à esquerda e a opção certa à direita. Os formandos veem as opções da direita baralhadas. Pontos por cada ligação certa.</p>
    ${(x.pairs || []).map((p, k) => `<div class="opt-row m-row"><span class="letter" style="background:var(--${'abcdef'[k]})">${k + 1}</span><input type="text" class="mL grow" maxlength="150" value="${esc(p.left)}" placeholder="Item (ex.: .pdf)"><span>→</span><input type="text" class="mR grow" maxlength="150" value="${esc(p.right)}" placeholder="Opção certa"><button class="btn small mDel" data-k="${k}" title="Remover">−</button></div>`).join('')}
    <div class="row" style="margin-top:6px"><button class="btn small mAdd">+ Par</button></div>`;
  if (t === 'spot') body = x.image ? `<p class="muted" style="margin:8px 0 4px">🎯 <b>Arrasta por cima da imagem</b> para marcar a zona certa (retângulo verde). Os formandos tocam na imagem; acertam se tocarem dentro da zona.</p>
    <div class="spotEd"><img src="${esc(x.image)}" alt="" draggable="false"><div class="spot-zone"></div></div>
    <p class="muted spotMsg">${x.zone && x.zone.w >= 0.01 ? '✅ Zona marcada. Arrasta outra vez para a mudar.' : '⚠ Ainda falta marcar a zona.'}</p>`
    : `<p class="key-warn">🎯 Carrega a imagem (botão 🖼 Imagem, em baixo) e depois marca nela a zona certa.</p>`;
  if (t === 'rank') body = `<label class="switch" style="margin-top:8px"><input type="checkbox" class="qOrdered" ${x.ordered ? 'checked' : ''}> <b>Tem ordem certa</b> — escreve as opções pela ordem correta (1ª em cima); os formandos veem-nas baralhadas e ganham pontos por cada posição certa</label>
    ${(x.options || []).map((o, k) => `<div class="opt-row"><span class="letter" style="background:var(--${'abcdef'[k]})">${k + 1}º</span><input type="text" class="qOpt" value="${esc(o)}" placeholder="Opção ${k + 1}">
      <button class="btn small qRankUp" data-k="${k}" title="Subir" ${k ? '' : 'disabled'}>↑</button><button class="btn small qOptDel" data-k="${k}" title="Remover opção">−</button></div>`).join('')}
    <div class="row" style="margin-top:6px"><button class="btn small qAddOpt">+ Opção</button></div>
    <p class="muted" style="margin:6px 0 0">Sem "ordem certa" é uma opinião: no fim vês a ordem média da turma (ex.: prioridades, temas preferidos).</p>`;
  return `<div class="qedit"><div class="row"><b>Pergunta ${i + 1}</b>
    <select class="qType">${Object.entries(QTYPE_LABEL).map(([k, v]) => `<option value="${k}" ${k === t ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <span class="grow"></span>
    <label class="muted">⏱ <input type="number" class="qTime" value="${x.time}" min="5" max="300" style="width:80px"> s</label>
    <button class="btn small qUp" title="Subir">↑</button><button class="btn small danger qDel" title="Apagar">✕</button></div>
    <textarea class="qText" rows="2" style="width:100%;margin-top:8px" placeholder="${t === 'fill' ? 'A capital de Portugal é [[Lisboa]].' : 'Escreve a pergunta…'}">${esc(x.text)}</textarea>
    ${x.image ? `<div class="row">${t === 'spot' ? '' : `<img src="${esc(x.image)}" style="max-height:100px;border-radius:8px">`}<button class="btn small qImgDel">Remover imagem</button></div>` : ''}
    ${body}
    <div class="row" style="margin-top:6px"><label class="btn small">🖼 Imagem<input type="file" accept="image/*,.heic,.heif" class="qImg" hidden></label></div></div>`;
}
function download(name, content, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =================== RESULTADOS =================== */
let lastResult = null;

// ---------- Ficha de respostas individual (uma por formando; imprimível / PDF) ----------
function sheetHtml(p) {
  const { r, joined, score, asked, graded, ansText, cls } = lastResult;
  let ok = 0, n = 0, pend = 0;
  const rows = r.questions.map((q, i) => {
    const t = qType(q), a = (r.answers[i] || {})[p.id];
    if (graded(i)) { n++; if (a && a.correct === true) ok++; }
    if (a && t === 'open' && a.correct == null) pend++;
    const res = !asked.has(i) ? '<span class="tag none">não feita</span>' : !a ? `<span class="tag none">${joined.has(p.id) ? 'Sem resposta' : 'Ausente'}</span>`
      : !qGraded(q) && t !== 'open' ? '<span class="tag none">opinião</span>' : a.correct === true ? '<span class="tag ok">✓ Certa</span>' : a.correct === false ? ((t === 'fill' || t === 'rank' || t === 'cross' || t === 'match') && a.right ? `<span class="tag pend">${a.right}/${t === 'fill' ? fillBlanksOf(q.text).length : t === 'cross' ? q.cross.words.length : t === 'match' ? q.pairs.length : q.options.length}</span>` : t === 'number' && a.points > 0 ? '<span class="tag pend">≈ Perto</span>' : '<span class="tag bad">✗ Errada</span>') : '<span class="tag pend">❔ Por validar</span>';
    return `<tr><td>${i + 1}</td><td><b>${esc(qTitle(q))}</b><br><small class="muted">${QTYPE_LABEL[t]}${t === 'mc' || t === 'tf' ? ' · opções: ' + q.options.map(esc).join(' · ') : ''}</small></td>
      <td>${esc(plainCorrectOf(q))}</td><td>${a ? esc(plainAnswerOf(q, a)) : ''}</td><td>${res}</td><td class="num">${a ? (a.points || 0) : 0}</td></tr>`;
  }).join('');
  return `<div class="sheet">
    <div class="sheet-head">${avatar(p, 'lg')}<div class="grow"><div class="muted">${r.courseName ? '🎓 ' + esc(r.courseName) + ' · ' : ''}📝 ${esc(r.quizTitle)} · ${new Date(r.startedAt).toLocaleDateString('pt-PT')}</div>
      <h2 style="margin:2px 0">${esc(p.name)}</h2>
      <div><b>${ok}</b> de ${n} certas${n ? ` (${Math.round(ok / n * 100)}%)` : ''} · <b>${score[p.id] ?? 0}</b> pontos${pend ? ` · <span style="color:#854d0e">❔ ${pend} por validar</span>` : ''}</div></div></div>
    <table class="sheet-tbl"><thead><tr><th>Nº</th><th>Pergunta</th><th>Resposta correta</th><th>Resposta do formando</th><th>Resultado</th><th>Pontos</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}
async function downloadFile(url, fallback) {
  const res = await fetch(url, { headers: { 'x-host-token': PW } });
  if (!res.ok) return toast('Não foi possível descarregar');
  const name = (/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '') || [])[1] || fallback;
  const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function showSheets(people) {
  const el = $('#tab-results');
  el.innerHTML = `<div class="card"><div class="row noprint"><button class="btn small" id="backRes">← Voltar aos resultados</button><span class="grow"></span>
    <button class="btn small" id="sheetDocx">⬇ Word${people.length === 1 ? '' : ' (todas)'}</button>
    <button class="btn small primary js-print">🖨 Imprimir / guardar PDF</button></div>
    ${people.map(sheetHtml).join('<div class="page-break"></div>')}</div>`;
  $('#backRes').onclick = () => openResult(lastResult.r.id);
  $('#sheetDocx').onclick = () => downloadFile(`/api/results/${encodeURIComponent(lastResult.r.id)}/docx${people.length === 1 ? '?student=' + encodeURIComponent(people[0].id) : ''}`, 'fichas.docx');
  window.scrollTo(0, 0);
}

// ---------- Indício de uso de IA nas respostas livres (só para o formador; não entra na ficha) ----------
// Não é uma prova: junta sinais de comportamento (colar, sair da app, texto sem digitação) e do texto
// (expressões típicas de assistentes de IA, formatação, comprimento face à turma).
const AI_PHRASES = [
  [/\bem suma\b/, 'em suma'], [/\bem s[ií]ntese\b/, 'em síntese'], [/\bem conclus[aã]o\b/, 'em conclusão'], [/\b[eé] importante (salientar|referir|notar|destacar|sublinhar|ressaltar)/, 'é importante salientar/referir'],
  [/\bvale (a pena )?(ressaltar|salientar|destacar)/, 'vale a pena salientar'], [/\bdesempenha(m)? um papel\b/, 'desempenha um papel'], [/\b(crucial|fundamental|essencial) para\b/, 'crucial/fundamental para'],
  [/\bal[eé]m disso\b/, 'além disso'], [/\bpor outro lado\b/, 'por outro lado'], [/\bnesse sentido\b/, 'nesse sentido'], [/\bassim sendo\b/, 'assim sendo'],
  [/\b(de forma|de maneira) (eficaz|eficiente|significativa|abrangente)/, 'de forma eficaz/significativa'], [/\bhol[ií]stic/, 'holística'], [/\bmultifacetad/, 'multifacetado'],
  [/\b(fomentar|potenciar|otimizar|alavancar)\b/, 'fomentar/potenciar/otimizar'], [/\b(promover|garantir|assegurar) (um|uma|a|o) /, 'promover/garantir/assegurar…'],
  [/\btais como\b/, 'tais como'], [/\bcomo (um )?modelo de (linguagem|ia)\b/, 'como modelo de linguagem'], [/^(claro|certamente|com certeza)[!,.]/, 'começa com "Claro!/Certamente"'], [/\bespero que (isto|isso) (ajude|te ajude)/, 'espero que ajude'],
  [/\baqui est[aá]/, 'aqui está'], [/\bpontos[- ]chave\b/, 'pontos-chave'], [/\bpor fim\b/, 'por fim'],
];
function aiSignals(q, a, peers) {
  const txt = String(a.value || ''), low = txt.toLowerCase(), len = txt.length, m = a.meta || null;
  const why = []; let sc = 0;
  if (m && m.pasteSource) {
    const names = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', copilot: 'Copilot', perplexity: 'Perplexity', deepseek: 'DeepSeek' };
    if (names[m.pasteSource]) { sc += 60; why.push(`🧾 Metadados da colagem: o texto foi copiado do ${names[m.pasteSource]}`); }
    else { sc += 15; why.push('🧾 Metadados da colagem: texto copiado de uma página ou app com formatação (não foi escrito no telemóvel)'); }
  }
  if (m && m.invisible) { sc += 20; why.push(`👻 ${m.invisible} caractere(s) invisível(eis) / espaço(s) especial(ais) no texto — comuns em texto copiado de IA ou da web`); }
  if (m) {
    const pastedShare = len ? Math.min(1, m.pasted / len) : 0;
    if (m.pasted && pastedShare >= 0.5) { sc += 45; why.push(`📋 Colou texto (${m.pasted} de ${len} caracteres)`); }
    else if (m.pasted >= 15) { sc += 20; why.push(`📋 Colou parte do texto (${m.pasted} caracteres)`); }
    if (m.hidden >= 2) { sc += 25; why.push(`↗️ Saiu da app ${m.hidden} vezes enquanto respondia`); }
    else if (m.hidden === 1) { sc += 15; why.push('↗️ Saiu da app enquanto respondia'); }
    if (!m.pasted && len >= 40 && m.keys < len * 0.4) { sc += 20; why.push(`⌨️ Só ${m.keys} de ${len} caracteres foram digitados (texto inserido de outra forma: colado, ditado ou sugestão do teclado)`); }
    const cps = m.typingMs ? (m.keys / (m.typingMs / 1000)) : 0;
    if (cps > 9 && m.keys > 60) { sc += 10; why.push(`⚡ Escrita muito rápida (${cps.toFixed(0)} caracteres/s)`); }
  } else why.push('ℹ️ Sem dados de escrita (resposta de uma versão anterior da app)');
  const lens = peers.map(p => String(p.value || '').length).sort((x, y) => x - y), med = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
  if (lens.length >= 3 && len > 120 && len > med * 2.5) { sc += 15; why.push(`📏 Muito mais longa que a da turma (${len} vs. mediana ${med} caracteres)`); }
  const hits = AI_PHRASES.filter(([rx]) => rx.test(low)).map(([, l]) => l);
  if (hits.length) { sc += Math.min(24, hits.length * 8); why.push(`🗣️ Expressões típicas de IA: ${hits.slice(0, 5).map(h => '“' + h + '”').join(', ')}`); }
  // travessão (—) e meia-risca (–): quase nunca escritos à mão num telemóvel. O hífen (-) não conta,
  // nem a unir palavras ("guarda-chuva", "dá-me") nem solto.
  // o hífen solto entre espaços (" - ") é usado como meia-risca e também conta; o hífen a unir palavras não
  const em = (txt.match(/\u2014/g) || []).length, en = (txt.match(/\u2013/g) || []).length, loose = (txt.match(/\S[ \t]+-[ \t]+(?=\S)/g) || []).length;
  if (em || en || loose) {
    sc += em + en + loose >= 2 ? 15 : 10;
    why.push(`➖ Usa ${[em ? `travessão (—) ×${em}` : '', en ? `meia-risca (–) ×${en}` : '', loose ? `hífen solto como meia-risca ( - ) ×${loose}` : ''].filter(Boolean).join(' e ')} (hífenes a unir palavras não contam)`);
  }
  const fmt = [];
  if (/(^|\n)\s*([-•*]|\d+[.)])\s/.test(txt)) fmt.push('lista com marcadores');
  if (/\*\*[^*]+\*\*/.test(txt)) fmt.push('negrito em markdown');
  if ((txt.match(/[;:]/g) || []).length >= 2) fmt.push('pontuação muito formal');
  if (fmt.length) { sc += Math.min(12, fmt.length * 6); why.push(`✒️ Formatação pouco comum num telemóvel: ${fmt.join(', ')}`); }
  sc = Math.min(100, sc);
  return { score: sc, level: sc >= 55 ? 'alto' : sc >= 25 ? 'medio' : 'baixo', why };
}
function aiBadge(sig, big) {
  const label = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo' }[sig.level];
  return `<span class="ai-badge ai-${sig.level} ${big ? 'big' : ''}" title="Indício de uso de IA (não é prova): ${esc(sig.why.join(' · ') || 'sem sinais')}">🤖 ${label} ${sig.score}%</span>`;
}
const aiPanel = sig => `<div class="ai-panel ai-${sig.level}"><div>${aiBadge(sig, true)} <b>Indício de uso de IA</b> <small class="muted">— só tu vês isto; não é uma prova</small></div>
  ${sig.why.length ? `<ul>${sig.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="muted" style="margin:6px 0 0">Sem sinais relevantes.</p>'}</div>`;

// ---------- Validar respostas livres, uma a uma ----------
async function openValidator(id, reviewAll) {
  const r = await api('GET', '/api/results/' + id);
  const names = new Map([...r.roster.map(s => [s.id, s]), ...r.players.map(p => [p.studentId, { id: p.studentId, name: p.name, photo: p.photo }])]);
  const items = [];
  r.questions.forEach((q, i) => { if (qType(q) !== 'open') return; Object.entries(r.answers[i] || {}).forEach(([sid, a]) => { if (reviewAll || a.correct == null) items.push({ i, sid, q, a }); }); });
  items.sort((x, y) => x.i - y.i || (names.get(x.sid)?.name || '').localeCompare(names.get(y.sid)?.name || '', 'pt'));
  let k = 0, busy = false;
  const el = $('#tab-results');
  const draw = () => {
    if (!items.length || k >= items.length) {
      const left = r.questions.reduce((n, q, i) => n + (qType(q) === 'open' ? Object.values(r.answers[i] || {}).filter(a => a.correct == null).length : 0), 0);
      el.innerHTML = `<div class="card center"><div style="font-size:60px">${left ? '❔' : '✅'}</div><h2>${left ? `Faltam ${left} resposta(s) por validar (saltaste-as)` : items.length ? 'Todas as respostas livres foram validadas' : 'Não há respostas livres por validar'}</h2>
        <button class="btn primary" id="vBack">Voltar aos resultados</button></div>`;
      $('#vBack').onclick = () => openResult(id); return;
    }
    const it = items[k], p = names.get(it.sid) || { name: '?' };
    el.innerHTML = `<div class="card validator">
      <div class="row"><button class="btn small" id="vBack">← Resultados</button><span class="grow"></span><b>${k + 1} de ${items.length}</b></div>
      <div class="vbar"><div style="width:${k / items.length * 100}%"></div></div>
      <div class="muted" style="margin-top:12px">Pergunta ${it.i + 1}</div>
      <h2 style="margin:4px 0 10px">${esc(it.q.text)}</h2>
      ${(it.q.accepted || []).length ? `<div class="v-model">💡 Resposta modelo: <b>${it.q.accepted.map(esc).join(' · ')}</b>${it.a.suggest === true ? ' <span class="tag ok">coincide com o modelo</span>' : ''}</div>` : ''}
      <div class="v-who">${avatar(p, 'sm')} <b>${esc(p.name)}</b> respondeu:</div>
      <div class="v-answer">${esc(it.a.value)}</div>
      ${aiPanel(aiSignals(it.q, it.a, Object.values(r.answers[it.i] || {})))}
      ${it.a.correct != null ? `<p class="muted center">Já validada como <b>${it.a.correct ? '✓ Certa' : '✗ Errada'}</b> — podes alterar.</p>` : ''}
      <div class="v-btns"><button class="btn danger" id="vNo">✗ Errada <small>(E)</small></button><button class="btn go" id="vYes">✓ Certa <small>(C)</small></button></div>
      <div class="row" style="justify-content:space-between;margin-top:12px"><button class="btn small" id="vPrev" ${k ? '' : 'disabled'}>← Anterior</button><button class="btn small" id="vSkip">Saltar →</button></div>
    </div>`;
    const setMark = async val => {
      if (busy) return; busy = true;
      try { await api('POST', `/api/results/${encodeURIComponent(id)}/mark`, { q: it.i, studentId: it.sid, correct: val }); } catch (e) { return toast(e.message); } finally { busy = false; }
      it.a.correct = val; Sound.play(val ? 'correct' : 'pop'); k++; draw();
    };
    $('#vYes').onclick = () => setMark(true); $('#vNo').onclick = () => setMark(false);
    $('#vPrev').onclick = () => { k = Math.max(0, k - 1); draw(); };
    $('#vSkip').onclick = () => { k++; draw(); };
    $('#vBack').onclick = () => { document.onkeydown = null; openResult(id); };
    document.onkeydown = e => { if (!$('.validator')) return (document.onkeydown = null); if (e.repeat) return; if (/^[cC]$/.test(e.key)) setMark(true); if (/^[eE]$/.test(e.key)) setMark(false); };
  };
  draw();
}

let resultsFilter = null;
// cada vista dos resultados tem um número: se entretanto foi pedida outra, esta já não se desenha
// (o botão "Ver grelha" pedia a lista e a grelha ao mesmo tempo e às vezes a lista tapava a grelha)
let resView = 0;
async function renderResultsList() {
  const el = $('#tab-results'), my = ++resView;
  const all = await api('GET', '/api/results');
  if (my !== resView) return;
  const cnames = [...new Set(all.map(r => r.courseName || ''))].sort((a, b) => a.localeCompare(b, 'pt'));
  const f = resultsFilter;
  const list = f == null ? all : all.filter(r => (r.courseName || '') === f);
  el.innerHTML = `<div class="card"><div class="row"><h2 class="grow" style="margin:0">📊 Sessões realizadas</h2>
    <label class="muted">Curso</label><select id="rFilter"><option value="__all">Todos os cursos</option>${cnames.map(n => `<option value="${esc(n)}" ${n === f ? 'selected' : ''}>${esc(n || 'Sem curso')}</option>`).join('')}</select></div>
    <div class="list" style="margin-top:14px">${list.map(r => `<div class="item"><div class="grow"><b>${r.courseName ? `<span class="muted" style="font-weight:500">🎓 ${esc(r.courseName)} ·</span> ` : ''}${esc(r.quizTitle)}</b><br>
    <small class="muted">${new Date(r.startedAt).toLocaleString('pt-PT')} · ${r.players} participantes${r.anonymous ? ' (🕶️ anónimo)' : ''} · ${r.questions} perguntas ${r.endedAt ? '' : '· <b>em curso / não terminada</b>'}</small></div>
    <button class="btn small primary" data-open="${r.id}">Ver grelha</button><button class="btn small danger" data-rm="${r.id}">✕</button></div>`).join('') || '<p class="muted">Ainda não há sessões.</p>'}</div></div>`;
  $('#rFilter').onchange = e => { resultsFilter = e.target.value === '__all' ? null : e.target.value; renderResultsList(); };
  $$('[data-open]').forEach(b => b.onclick = () => openResult(b.dataset.open));
  $$('[data-rm]').forEach(b => b.onclick = async () => { if (!confirm('Apagar definitivamente os resultados desta sessão?')) return; try { await api('DELETE', '/api/results/' + b.dataset.rm); } catch (e) { toast(e.message); } renderResultsList(); });
}

async function openResult(id) {
  const my = ++resView;
  const r = await api('GET', '/api/results/' + id);
  if (my !== resView) return;
  const el = $('#tab-results');
  const people = new Map(); r.roster.forEach(s => people.set(s.id, s)); r.players.forEach(p => { if (!people.has(p.studentId)) people.set(p.studentId, { id: p.studentId, name: p.name, photo: p.photo }); });
  const list = [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  const joined = new Set(r.players.map(p => p.studentId));
  const score = Object.fromEntries(r.players.map(p => [p.studentId, p.score]));
  const asked = new Set(r.asked);
  // só contam para "certas" as perguntas com resposta certa (escala e resposta livre por avaliar não contam)
  const graded = i => { const q = r.questions[i], t = qType(q); return t === 'open' ? Object.values(r.answers[i] || {}).some(a => a.correct != null) : qGraded(q); };
  const nAsked = r.asked.filter(graded).length;
  const stats = list.map(p => { let ok = 0; r.questions.forEach((q, i) => { const a = (r.answers[i] || {})[p.id]; if (a && a.correct === true) ok++; }); return ok; });
  const ansText = (q, a) => { const t = qType(q); return t === 'mc' || t === 'tf' ? `${LETTERS[a.option]}) ${q.options[a.option]}` : t === 'fill' ? (a.value || []).join(' · ') : t === 'cloud' || t === 'rank' || t === 'cross' || t === 'guess' || t === 'match' || t === 'spot' ? plainAnswerOf(q, a) : t === 'scramble' ? String(a.value || '').toUpperCase() : String(a.value ?? ''); };
  const ansShort = (q, a) => { const t = qType(q); return t === 'number' ? String(a.value) : t === 'match' ? `${a.right ?? 0}/${q.pairs.length}` : t === 'spot' ? (a.correct ? '🎯 zona' : '✗ fora') : t === 'mc' ? LETTERS[a.option] : t === 'tf' ? (a.option === 0 ? 'V' : 'F') : t === 'fill' ? `${a.right ?? 0}/${fillBlanksOf(q.text).length}` : t === 'scale' ? '★' + a.value : t === 'cross' ? `${a.right ?? 0}/${q.cross.words.length}` : t === 'guess' ? (a.correct ? `${a.tries}ª tent.` : `✗ ${(a.value || []).length}`) : t === 'scramble' ? String(a.value || '').toUpperCase().slice(0, 14) : t === 'rank' ? (q.ordered ? `${a.right ?? 0}/${q.options.length}` : '1º ' + String(q.options[(a.value || [])[0]] || '').slice(0, 12)) : t === 'cloud' ? '☁ ' + (a.value || []).join(', ').slice(0, 14) : (String(a.value).length > 14 ? String(a.value).slice(0, 14) + '…' : String(a.value)); };
  const corShort = q => { const t = qType(q); return t === 'number' ? String(q.answer) : t === 'match' ? q.pairs.length + ' pares' : t === 'spot' ? 'zona' : t === 'mc' ? q.correct.map(k => LETTERS[k]).join('/') : t === 'tf' ? (q.correct[0] === 0 ? 'V' : 'F') : t === 'fill' ? fillBlanksOf(q.text).join(', ') : t === 'open' ? 'livre' : t === 'cloud' ? 'nuvem' : t === 'scramble' || t === 'guess' ? String(q.answer).toUpperCase().slice(0, 14) : t === 'cross' ? q.cross.words.length + ' palavras' : t === 'rank' ? (q.ordered ? 'ordem' : 'opinião') : '1–5'; };
  const cls = a => a.correct === true ? 'ok' : a.correct === false ? 'bad' : 'pend';
  const mark = a => a.correct === true ? ' ✓' : a.correct === false ? ' ✗' : '';
  const cell = (p, q, i) => {
    if (!asked.has(i)) return `<td class="none">—</td>`;
    const a = (r.answers[i] || {})[p.id];
    if (!a) return `<td class="none">${joined.has(p.id) ? 'sem resp.' : 'ausente'}</td>`;
    const pend = qType(q) === 'open' && a.correct == null;
    return `<td class="${!qGraded(q) && qType(q) !== 'open' ? '' : cls(a)}" title="${esc(ansText(q, a))} · ${(a.timeMs / 1000).toFixed(1)}s">${esc(ansShort(q, a))}${mark(a)}${pend ? ' ❔' : ''}</td>`;
  };
  const pending = r.questions.reduce((n, q, i) => n + (qType(q) === 'open' ? Object.values(r.answers[i] || {}).filter(a => a.correct == null).length : 0), 0);
  const openTotal = r.questions.reduce((n, q, i) => n + (qType(q) === 'open' ? Object.values(r.answers[i] || {}).length : 0), 0);
  lastResult = { r, list, joined, score, asked, graded, ansText, cls, mark };
  const avg = list.length && nAsked ? Math.round(stats.reduce((a, b) => a + b, 0) / (list.length * nAsked) * 100) : 0;
  el.innerHTML = `<div class="card">
    <div class="row noprint"><button class="btn small" id="back">← Voltar</button><span class="grow"></span>
      <button class="btn small" data-csv="grelha">⬇ Excel (grelha)</button>
      <button class="btn small" data-csv="detalhado">⬇ Excel (detalhado)</button>
      <button class="btn small primary js-print">🖨 Imprimir / PDF</button></div>
    ${r.courseName ? `<div class="muted" style="margin-top:14px;font-weight:600">🎓 ${esc(r.courseName)}</div>` : ''}
    <h2 style="margin:${r.courseName ? 2 : 14}px 0 4px">${esc(r.quizTitle)}</h2>
    <p class="muted" style="margin-top:0">${new Date(r.startedAt).toLocaleString('pt-PT')} · ${list.length} alunos · ${nAsked} de ${r.questions.length} perguntas feitas · média de acerto ${avg}% ${r.endedAt ? '' : '· <b>sessão em curso</b>'}</p>
    ${openTotal ? `<div class="pend-note row"><span class="grow">${pending ? `❔ Há <b>${pending}</b> resposta(s) livre(s) por validar.` : `✅ Todas as ${openTotal} respostas livres estão validadas.`}</span>
      <button class="btn small primary noprint" id="btnValidate">✍️ ${pending ? 'Validar respostas livres' : 'Rever validações'}</button></div>` : ''}
    <div class="row noprint" style="margin:8px 0"><span class="muted grow">📄 Ficha individual: carrega no nome de um formando.</span><button class="btn small" id="btnAllDocx">⬇ Word: fichas de todos</button><button class="btn small" id="btnAllSheets">🖨 Fichas de todos (uma por página)</button></div>
    ${r.teams && r.teams.length ? `<h3>👥 Equipas</h3><div class="res-teams">${r.teams.map((t, k) => `<div class="res-team" style="--tc:${t.color}"><b>${k + 1}º ${t.emoji} Equipa ${esc(t.name)}</b> · ${t.score} pts (média)<br><small>${t.members.map(m => esc(m.name)).join(', ')}</small></div>`).join('')}</div>` : ''}
    <h3>Grelha: quem respondeu o quê</h3>
    <div class="tbl-wrap"><table class="res"><thead>
      <tr><th>Aluno</th>${r.questions.map((q, i) => `<th title="${esc(q.text)}">P${i + 1}</th>`).join('')}<th>Certas</th><th>%</th><th>Pontos</th></tr>
      <tr><th>Resposta correta</th>${r.questions.map(q => `<th style="color:var(--ok)" title="${esc(QTYPE_LABEL[qType(q)])}">${esc(corShort(q))}</th>`).join('')}<th></th><th></th><th></th></tr></thead>
      <tbody>${list.map((p, j) => `<tr><td><a href="#" class="sheet-link" data-sheet="${esc(p.id)}" title="Abrir a ficha de respostas">📄 ${esc(p.name)}</a>${r.teams ? (t => t ? ` <span title="Equipa ${esc(t.name)}">${t.emoji}</span>` : '')((r.teams || []).find(t => t.id === ((r.players.find(x => x.studentId === p.id) || {}).team))) : ''}${p.homonym ? ' <small style="color:#b45309">⚠ nome repetido</small>' : (p.extra || p.guest) ? ' <small class="muted">(extra)</small>' : ''}</td>${r.questions.map((q, i) => cell(p, q, i)).join('')}
        <td><b>${stats[j]}</b>/${nAsked}</td><td>${nAsked ? Math.round(stats[j] / nAsked * 100) : 0}%</td><td>${score[p.id] ?? 0}</td></tr>`).join('')}</tbody></table></div>
    <h3 style="margin-top:28px">Detalhe por pergunta</h3>
    ${r.questions.map((q, i) => {
      const ans = r.answers[i] || {};
      const t = qType(q);
      return `<div class="qdetail"><h4>P${i + 1}. ${esc(qTitle(q))} <span class="tag none">${QTYPE_LABEL[t]}</span> ${asked.has(i) ? '' : '<span class="tag none">não feita</span>'}</h4>
        ${t === 'mc' || t === 'tf' ? `<div class="muted" style="margin-bottom:6px">${q.options.map((o, k) => `${LETTERS[k]}) ${esc(o)}`).join(' · ')}</div>` : ''}
        ${t === 'fill' ? `<div class="muted" style="margin-bottom:6px">Palavras: ${bankOf(q).map(esc).join(', ')}</div>` : ''}
        ${t === 'scale' ? `<div class="muted" style="margin-bottom:6px">1 = ${esc(q.scaleMin || '')} · 5 = ${esc(q.scaleMax || '')}</div>` : ''}
        <div style="margin-bottom:8px"><span class="tag ${qGraded(q) ? 'ok' : 'none'}">${qGraded(q) ? 'Resposta correta: ' : ''}${esc(solutionText(q))}</span></div>
        ${asked.has(i) ? list.map(p => { const a = ans[p.id]; return `<div class="ans-row">${avatar(p, 'sm')}<span style="min-width:200px">${esc(p.name)}</span>
          ${a ? `<span class="tag ${!qGraded(q) && t !== 'open' ? 'none' : cls(a)}">${esc(ansText(q, a))}${mark(a)}${t === 'fill' ? ` (${a.right ?? 0}/${fillBlanksOf(q.text).length})` : t === 'rank' && q.ordered ? ` (${a.right ?? 0}/${q.options.length} no lugar certo)` : t === 'cross' ? ` (${a.right ?? 0}/${q.cross.words.length} palavras)` : t === 'match' ? ` (${a.right ?? 0}/${q.pairs.length} ligações)` : ''}</span>
            ${t === 'open' ? `<span class="noprint">${aiBadge(aiSignals(q, a, Object.values(ans)))}</span>` : ''}
            ${t === 'open' ? `<span class="markers noprint"><button class="btn small ${a.correct === true ? 'go' : ''}" data-mark="1" data-q="${i}" data-s="${esc(p.id)}">✓ Certa</button><button class="btn small ${a.correct === false ? 'danger' : ''}" data-mark="0" data-q="${i}" data-s="${esc(p.id)}">✗ Errada</button></span>` : ''}
            <small class="muted">${(a.timeMs / 1000).toFixed(1)} s</small>` : `<span class="tag none">${joined.has(p.id) ? 'Sem resposta' : 'Ausente'}</span>`}</div>`; }).join('') : ''}
      </div>`;
    }).join('')}
  </div>`;
  $('#back').onclick = renderResultsList;
  const bv = $('#btnValidate'); if (bv) bv.onclick = () => openValidator(r.id, !pending);
  $('#btnAllSheets').onclick = () => showSheets(list.filter(p => joined.has(p.id)));
  $('#btnAllDocx').onclick = () => downloadFile(`/api/results/${encodeURIComponent(r.id)}/docx`, 'fichas.docx');
  $$('[data-sheet]').forEach(a => a.onclick = e => { e.preventDefault(); showSheets([list.find(p => p.id === a.dataset.sheet)]); });
  // avaliar respostas livres (clicar outra vez no mesmo botão volta a "por avaliar")
  $$('[data-mark]').forEach(b => b.onclick = async () => {
    const a = (r.answers[b.dataset.q] || {})[b.dataset.s], want = b.dataset.mark === '1';
    const val = a && a.correct === want ? null : want;
    try { await api('POST', `/api/results/${encodeURIComponent(r.id)}/mark`, { q: +b.dataset.q, studentId: b.dataset.s, correct: val }); } catch (e) { return toast(e.message); }
    const y = window.scrollY; await openResult(r.id); window.scrollTo(0, y);
  });
  // descarrega com a palavra-passe no cabeçalho (nunca no endereço)
  $$('[data-csv]').forEach(b => b.onclick = async () => {
    const res = await fetch(`/api/results/${encodeURIComponent(r.id)}/csv?type=${b.dataset.csv}`, { headers: { 'x-host-token': PW } });
    if (!res.ok) return toast('Não foi possível descarregar');
    const name = (/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '') || [])[1] || 'resultados.csv';
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}
