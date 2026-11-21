// Quiz ao vivo — quiz ao vivo para formações
// Iniciar: node server.js   (porta 3000 por omissão)
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const Q = require('./questions'); // tipos de pergunta
const { buildDocx, buildKeyDocx } = require('./fichas-docx'); // fichas de respostas e lista de soluções em Word

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const RESULTS = path.join(DATA_DIR, 'results');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Palavra-passe do formador: HOST_PASSWORD, ou uma gerada aleatoriamente no 1º arranque
// (guardada em data/palavra-passe-formador.txt). Nunca há uma palavra-passe por omissão conhecida.
const PW_FILE = path.join(DATA_DIR, 'palavra-passe-formador.txt');
let HOST_PASSWORD = (process.env.HOST_PASSWORD || '').trim();
let PW_GENERATED = false;
if (!HOST_PASSWORD) {
  if (fs.existsSync(PW_FILE)) HOST_PASSWORD = fs.readFileSync(PW_FILE, 'utf8').trim();
  if (!HOST_PASSWORD) {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    HOST_PASSWORD = [0, 1, 2].map(() => Array.from(crypto.randomBytes(4), b => abc[b % abc.length]).join('')).join('-');
    fs.writeFileSync(PW_FILE, HOST_PASSWORD + '\n', { mode: 0o600 });
    PW_GENERATED = true;
  }
}
if (HOST_PASSWORD.length < 8) { console.error('HOST_PASSWORD tem de ter pelo menos 8 caracteres.'); process.exit(1); }

// comparação em tempo constante
function pwOk(given) {
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(HOST_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Tentativas erradas respondem com atraso (trava quem tenta adivinhar). Não há bloqueio,
// para que um aluno nunca consiga impedir o formador de entrar.
const FAIL_DELAY_MS = 1500;
const DB_FILE = path.join(DATA_DIR, 'db.json');
[UPLOADS, RESULTS].forEach(d => fs.mkdirSync(d, { recursive: true }));

const uid = (n = 8) => crypto.randomBytes(n).toString('hex').slice(0, n);

// ---------- Base de dados (ficheiro JSON) ----------
let db = { students: [], courses: [], quizzes: [] };
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { console.error('db.json inválido', e); }
}
db.students ||= []; db.quizzes ||= []; db.courses ||= [];
// migração: questionários antigos sem curso vão para "Geral"
if (db.quizzes.some(q => !q.courseId || !db.courses.find(c => c.id === q.courseId))) {
  let geral = db.courses.find(c => c.name === 'Geral');
  if (!geral) { geral = { id: uid(), name: 'Geral' }; db.courses.push(geral); }
  db.quizzes.forEach(q => { if (!q.courseId || !db.courses.find(c => c.id === q.courseId)) q.courseId = geral.id; });
}
function saveDb() {
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 2));
  fs.renameSync(DB_FILE + '.tmp', DB_FILE);
}
if (!db.quizzes.length && !db.courses.length) {
  const course = { id: uid(), name: 'Curso de exemplo' };
  db.courses.push(course);
  db.quizzes.push({
    id: uid(), courseId: course.id, title: 'Exemplo — Avaliação final',
    questions: [
      { id: uid(), text: 'Qual destes é um exemplo de comunicação assertiva?', options: ['Ficar calado para evitar conflito', 'Expressar a opinião com respeito pelo outro', 'Levantar a voz para ser ouvido', 'Ironizar a opinião do colega'], correct: [1], time: 20 },
      { id: uid(), text: 'O feedback deve ser dado, de preferência…', options: ['Em público e semanas depois', 'De forma específica e oportuna', 'Só quando há problemas', 'Por escrito e anónimo'], correct: [1], time: 20 },
      { id: uid(), text: 'Verdadeiro ou falso: a escuta ativa inclui parafrasear o que o outro disse.', options: ['Verdadeiro', 'Falso'], correct: [0], time: 15 },
    ],
  });
  saveDb();
}

// ---------- Sessão de jogo (memória + gravação em disco) ----------
let session = null; // apenas uma sessão ativa de cada vez
let timer = null;

function resultFile(id) { return path.join(RESULTS, id + '.json'); }
function persistSession() {
  if (!session) return;
  const out = {
    id: session.id, quizId: session.quizId, quizTitle: session.quizTitle, courseId: session.courseId, courseName: session.courseName,
    startedAt: session.startedAt, endedAt: session.endedAt || null,
    settings: session.settings,
    questions: session.questions,
    roster: session.roster,
    players: Object.values(session.players).map(p => ({ studentId: p.studentId, name: p.name, photo: p.photo, score: p.score, joinedAt: p.joinedAt })),
    code: session.code,
    submitted: session.submitted || null,
    answers: session.answers,
    asked: session.asked,
  };
  fs.writeFileSync(resultFile(session.id) + '.tmp', JSON.stringify(out, null, 2));
  fs.renameSync(resultFile(session.id) + '.tmp', resultFile(session.id));
}

function currentQ() { return session && session.qIndex >= 0 ? session.questions[session.qIndex] : null; }
function answersFor(i) { return (session.answers[i] ||= {}); }

function ranking() {
  return Object.values(session.players)
    .map(p => ({ studentId: p.studentId, name: p.name, short: p.short || p.name, photo: p.photo, score: p.score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function hostView() {
  if (!session) return { session: null };
  const q = currentQ();
  const ans = q ? answersFor(session.qIndex) : {};
  const qt = q ? Q.typeOf(q) : null;
  // escolha múltipla / V-F: por opção; escala: por valor 1..5
  const slots = !q ? [] : qt === 'scale' ? [1, 2, 3, 4, 5] : (qt === 'mc' || qt === 'tf') ? q.options.map((_, i) => i) : [];
  const pick = a => qt === 'scale' ? a.value : a.option;
  const counts = slots.map(v => Object.values(ans).filter(a => pick(a) === v).length);
  const whoByOption = slots.map(v => Object.entries(ans).filter(([, a]) => pick(a) === v).map(([sid]) => sid));
  const extra = {};
  if (qt === 'fill') extra.fillStats = q.blanks.map((w, b) => ({ word: w, right: Object.values(ans).filter(a => Q.norm((a.value || [])[b]) === Q.norm(w)).length }));
  if (qt === 'open') { const m = new Map(); Object.values(ans).forEach(a => { const k = Q.norm(a.value); const e = m.get(k) || { text: a.value, count: 0, correct: a.correct }; e.count++; m.set(k, e); }); extra.openAnswers = [...m.values()].sort((a, b) => b.count - a.count).slice(0, 40); }
  if (qt === 'scale') { const vals = Object.values(ans).map(a => a.value); extra.scaleAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; }
  const examProgress = isExam() ? Object.fromEntries(Object.values(session.players).map(p => [p.studentId, {
    answered: session.questions.filter((_, i) => (session.answers[i] || {})[p.studentId]).length,
    submitted: !!(session.submitted || {})[p.studentId],
  }])) : null;
  return {
    session: {
      examProgress,
      id: session.id, code: session.code, quizTitle: session.quizTitle, courseName: session.courseName, phase: session.phase, qIndex: session.qIndex,
      total: session.questions.length, settings: session.settings,
      question: q, remainingMs: session.deadline ? Math.max(0, session.deadline - Date.now()) : 0,
      autoMs: session.autoAt ? Math.max(0, session.autoAt - Date.now()) : 0,
      allQuestions: session.phase === 'end' ? session.asked.slice().sort((x, y) => x - y).map(i => session.questions[i]) : null,
      counts, whoByOption, answeredIds: Object.keys(ans), ...extra,
      players: Object.values(session.players).map(p => ({ studentId: p.studentId, name: p.name, photo: p.photo, score: p.score, connected: !!p.socketId })),
      roster: session.roster,
      ranking: ranking(),
      lastPoints: q ? Object.fromEntries(Object.entries(ans).map(([sid, a]) => [sid, a.points])) : {},
    },
  };
}

function playerView(p) {
  if (!session) return { session: null };
  const q = currentQ();
  const mine = q ? answersFor(session.qIndex)[p.studentId] : null;
  // Antes de a resposta correta ser mostrada, os números do aluno ignoram a pergunta atual;
  // caso contrário a pontuação, o nº de certas ou a posição denunciariam se acertou.
  const hideCurrent = ['ready', 'question', 'closed'].includes(session.phase);
  const curAns = hideCurrent && q ? answersFor(session.qIndex) : {};
  const scoreOf = x => x.score - ((curAns[x.studentId] || {}).points || 0);
  const rank = Object.values(session.players).map(x => ({ studentId: x.studentId, name: x.name, s: scoreOf(x) }))
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
  const pos = rank.findIndex(r => r.studentId === p.studentId) + 1;
  // Quando mostrar as respostas corretas aos formandos: 'each' (depois de cada pergunta),
  // 'end' (só no fim) ou 'never' (nunca). O formador vê sempre tudo.
  const rv = session.settings.revealMode || 'each', isEnd = session.phase === 'end';
  const revealEnd = !!session.settings.revealEnd; // lista de respostas corretas no fim (opcional)
  const showScore = rv === 'each' || (revealEnd && isEnd); // a pontuação denunciaria as respostas certas
  const showPos = !session.settings.noRanking && (rv === 'each' || isEnd);
  const v = {
    session: { id: session.id, quizTitle: session.quizTitle, courseName: session.courseName, phase: session.phase, qIndex: session.qIndex, total: session.questions.length, settings: session.settings },
    me: {
      studentId: p.studentId, name: p.name, photo: p.photo,
      // "sem ranking": ninguém recebe posições
      position: showPos ? pos : null, of: showPos ? rank.length : null,
      score: showScore ? scoreOf(p) : null,
      correct: showScore ? Object.entries(session.answers).filter(([i, a]) => !(hideCurrent && +i === session.qIndex) && a[p.studentId] && a[p.studentId].correct).length : null,
    },
    answered: !!mine, myOption: mine ? mine.option : null, myValue: mine ? mine.value : null,
  };
  if (session.phase === 'exam') {
    v.exam = {
      questions: session.questions.map(qq => Q.publicQuestion(qq, false)),
      mine: Object.fromEntries(session.questions.map((qq, i) => { const a = (session.answers[i] || {})[p.studentId]; return [i, a ? (a.option ?? a.value) : null]; }).filter(([, o]) => o != null)),
      remainingMs: Math.max(0, session.deadline - Date.now()),
      submitted: !!(session.submitted || {})[p.studentId],
    };
  }
  if (q && ['ready', 'question', 'closed', 'reveal', 'leaderboard'].includes(session.phase)) {
    // "esconder as perguntas nos telemóveis": só vão as letras; o texto está no ecrã do formador
    v.question = Q.publicQuestion(q, !!session.settings.hideOnPhones);
    v.remainingMs = session.deadline ? Math.max(0, session.deadline - Date.now()) : 0;
  }
  // no fim (modo "só no fim"): todas as perguntas, a resposta correta e a resposta do formando
  if (isEnd) v.answeredCount = session.asked.filter(i => (session.answers[i] || {})[p.studentId]).length;
  // perguntas que contam para "certas" (a escala e a resposta livre por avaliar não contam)
  if (isEnd) v.gradedTotal = session.asked.filter(i => Q.isGraded(session.questions[i]) || Object.values(session.answers[i] || {}).some(a => a.correct != null)).length;
  if (isEnd && revealEnd) {
    v.review = session.asked.map(i => {
      const qq = session.questions[i], a = (session.answers[i] || {})[p.studentId];
      const hide = !!session.settings.hideOnPhones, t = Q.typeOf(qq);
      return { type: t, text: hide ? '' : Q.displayText(qq), options: hide ? qq.options.map(() => '') : qq.options, correct: qq.correct, solution: Q.solutionOf(qq), graded: Q.isGraded(qq),
        mine: a ? (a.option ?? a.value) : null, ok: a ? a.correct : false, right: a ? a.right : null, mineText: a ? Q.answerText(qq, a) : null };
    });
  }
  if (q && rv === 'each' && ['reveal', 'leaderboard'].includes(session.phase)) {
    v.correct = q.correct;
    v.solution = Q.solutionOf(q);
    v.graded = Q.isGraded(q);
    v.wasCorrect = mine ? mine.correct : false; // null = por avaliar / sem resposta certa
    v.right = mine ? mine.right : null;
    v.points = mine ? mine.points : 0;
  }
  return v;
}

let io;
function broadcast() {
  io.to('hosts').emit('state', hostView());
  if (!session) { io.to('players').emit('state', { session: null }); return; }
  for (const p of Object.values(session.players)) if (p.socketId) io.to(p.socketId).emit('state', playerView(p));
  // quem ainda não entrou recebe só a informação da sessão (e só com o código certo)
  for (const id of io.sockets.adapter.rooms.get('lobby') || []) {
    const sk = io.sockets.sockets.get(id); if (sk) sk.emit('roster', rosterForPlayers(sk));
  }
}

function rosterForPlayers(sk) {
  if (!session) return { session: null };
  if (!codeOk(sk && sk.data.code)) return { session: null, badCode: !!(sk && sk.data.code) };
  // só a informação da sessão: a lista da turma (nomes e fotos) não é enviada a quem entra
  return { session: { id: session.id, quizTitle: session.quizTitle, courseName: session.courseName, phase: session.phase } };
}

// Nomes comparados sem acentos, maiúsculas ou espaços a mais ("joao goncalves" = "João Gonçalves").
// Só há correspondência com o nome COMPLETO; nunca por partes do nome.
// Nome que identifica cada formando na sessão (regra do formador):
//  1) o primeiro nome;
//  2) se houver outro formando com o mesmo primeiro nome: primeiro + último nome (nos dois);
//  3) se mesmo assim forem iguais: acrescenta os nomes do meio, um a um, até ficarem diferentes.
// Guarda em cada formando: short (nome a mostrar) e key (posições das palavras usadas).
function assignShortNames(list) {
  const toks = new Map(list.map(st => [st, String(st.name).trim().split(/\s+/)]));
  const ntoks = new Map(list.map(st => [st, norm(st.name).split(' ')]));
  const keyOf = (st, idx) => idx.map(i => ntoks.get(st)[i]).join(' ');
  const idxFor = (st, level) => {
    const n = ntoks.get(st).length, last = n - 1;
    if (level === 0 || n === 1) return [0];
    const mids = [];
    for (let i = 1; i < last && mids.length < level - 1; i++) mids.push(i);
    return [0, ...mids, last];
  };
  list.forEach(st => st._lvl = 0);
  for (let round = 0; round < 12; round++) {
    const groups = new Map();
    list.forEach(st => { const k = keyOf(st, idxFor(st, st._lvl)); groups.set(k, [...(groups.get(k) || []), st]); });
    let changed = false;
    for (const g of groups.values()) if (g.length > 1) g.forEach(st => { const n = ntoks.get(st).length; if (idxFor(st, st._lvl + 1).length > idxFor(st, st._lvl).length || (st._lvl === 0 && n > 1)) { st._lvl++; changed = true; } });
    if (!changed) break;
  }
  list.forEach(st => { const idx = idxFor(st, st._lvl); st.key = idx; st.short = idx.map(i => toks.get(st)[i]).join(' '); delete st._lvl; });
}
// O nome escrito pelo formando identifica-o se tiver as mesmas palavras que distinguem o seu nome
// (primeiro nome; e, se for preciso, último nome e nomes do meio).
function matchesStudent(st, typedTokens) {
  const nt = norm(st.name).split(' '), last = nt.length - 1, T = typedTokens;
  if (T[0] !== nt[0]) return false;
  for (const i of st.key || [0]) {
    if (i === 0) continue;
    if (i === last) { if (T[T.length - 1] !== nt[last] || T.length < 2) return false; }
    else if (!T.slice(1, -1).includes(nt[i])) return false;
  }
  return true;
}
const norm = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Código da sessão: 6 caracteres sem letras/números que se confundem (0/O, 1/I/L)
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() { return Array.from(crypto.randomBytes(6), b => CODE_ABC[b % CODE_ABC.length]).join(''); }
const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const codeOk = c => !!session && cleanCode(c) === session.code;

const READY_MS = 3000; // compasso de espera "Prepara-te! 3-2-1" antes de cada pergunta

// Modo totalmente automático: cada ecrã avança sozinho ao fim do seu tempo
let autoTimer = null;
const timedMode = () => session && session.settings.mode !== 'manual'; // 'timed' ou 'auto'
function scheduleAuto() {
  clearTimeout(autoTimer); autoTimer = null;
  if (!session) return;
  session.autoAt = null;
  if (session.settings.mode !== 'auto' || session.settings.paused) return;
  const t = session.settings.autoTimes || {};
  // sem sondagem, o ecrã "respostas fechadas" fica só 2 s
  const ms = { closed: session.settings.showPoll === false ? 2 : t.poll, reveal: t.reveal, leaderboard: t.board }[session.phase];
  if (!ms) return;
  session.autoAt = Date.now() + ms * 1000;
  autoTimer = setTimeout(() => { autoTimer = null; advance(); }, ms * 1000);
}

function closeQuestion() {
  if (!session || session.phase !== 'question') return;
  clearTimeout(timer); timer = null;
  // tempo esgotado / fechado pelo formador → já não aceita respostas e mostra a sondagem
  session.phase = 'closed';
  session.deadline = null;
  persistSession();
  scheduleAuto();
  broadcast();
}

function setPhase(ph) { session.phase = ph; persistSession(); scheduleAuto(); broadcast(); }

// Fluxo de cada pergunta: prepara-te → pergunta → sondagem → resposta correta → (ranking) → próxima
// Modo "tempo total": todas as perguntas ao mesmo tempo, cada formando ao seu ritmo, até acabar o tempo
const isExam = () => session && session.settings.mode === 'exam';
function startExam() {
  session.phase = 'exam';
  session.examStart = Date.now();
  session.deadline = Date.now() + session.settings.examMinutes * 60000;
  session.asked = session.questions.map((_, i) => i);
  session.questions.forEach((_, i) => answersFor(i));
  session.submitted = {};
  clearTimeout(timer); timer = setTimeout(endExam, session.deadline - Date.now() + 300);
  persistSession(); broadcast();
}
function endExam() {
  if (!session || session.phase !== 'exam') return;
  clearTimeout(timer); timer = null;
  session.deadline = null; session.endedAt = Date.now(); session.phase = 'end';
  persistSession(); broadcast();
}
// sinais de escrita das respostas livres (enviados pelo telemóvel; só o formador os vê)
function cleanMeta(m, prev) {
  if (!m || typeof m !== 'object') return prev || null;
  const n = (v, max) => Math.max(0, Math.min(max, parseInt(v, 10) || 0));
  const SOURCES = ['chatgpt', 'gemini', 'claude', 'copilot', 'perplexity', 'deepseek', 'formatado'];
  const cur = { pasted: n(m.pasted, 100000), keys: n(m.keys, 100000), ms: n(m.ms, 36e5), typingMs: n(m.typingMs, 36e5), hidden: n(m.hidden, 1000),
    pasteSource: SOURCES.includes(m.pasteSource) ? m.pasteSource : null };
  if (!prev) return cur; // ao corrigir a resposta (modo tempo total) os sinais acumulam
  const src = [cur.pasteSource, prev.pasteSource].find(x => x && x !== 'formatado') || cur.pasteSource || prev.pasteSource || null;
  return { pasted: prev.pasted + cur.pasted, keys: prev.keys + cur.keys, ms: prev.ms + cur.ms, typingMs: prev.typingMs + cur.typingMs, hidden: prev.hidden + cur.hidden, pasteSource: src };
}
// caracteres invisíveis / espaços especiais no texto original (antes de o limpar), comuns em texto copiado de IA
function invisibleCount(raw) { return (String(raw ?? '').match(/[\u200B\u200C\u200D\u2060\uFEFF\u00AD\u202F\u00A0\u2009\u200A]/g) || []).length;
}
function pointsFor(q, entry, timeMs, speed) {
  if (!entry.frac) return 0;
  const base = speed ? Math.round(1000 * (1 - Math.min(timeMs, q.time * 1000) / (q.time * 1000) / 2)) : 1000;
  return Math.round(base * entry.frac);
}
function examRecompute(p) { p.score = session.questions.reduce((t, _, i) => t + (((session.answers[i] || {})[p.studentId] || {}).points || 0), 0); }

function advance() {
  if (!session) return;
  const ph = session.phase;
  if (ph === 'lobby' && isExam()) return startExam();
  if (ph === 'exam') return endExam();
  if (ph === 'lobby') return startQuestion(0);
  if (ph === 'ready') return openQuestion();
  if (ph === 'question') return closeQuestion();
  // quando as respostas corretas não são mostradas aos formandos, depois da sondagem segue logo para a próxima
  const skipReveal = (session.settings.revealMode || 'each') !== 'each';
  if (ph === 'closed' && !skipReveal) return setPhase('reveal');
  if (ph === 'reveal' && session.settings.rankEach) return setPhase('leaderboard');
  if (ph === 'reveal' || ph === 'leaderboard' || (ph === 'closed' && skipReveal)) {
    if (session.qIndex + 1 < session.questions.length) return startQuestion(session.qIndex + 1);
    session.endedAt = Date.now();
    return setPhase('end');
  }
}

function startQuestion(i) {
  session.qIndex = i;
  session.phase = 'ready';
  session.deadline = Date.now() + READY_MS;
  if (!session.asked.includes(i)) session.asked.push(i);
  answersFor(i);
  clearTimeout(timer); clearTimeout(autoTimer); session.autoAt = null;
  timer = setTimeout(openQuestion, READY_MS);
  persistSession();
  broadcast();
}

function openQuestion() {
  if (!session || session.phase !== 'ready') return;
  const q = currentQ();
  clearTimeout(timer); timer = null;
  session.phase = 'question';
  session.questionStartedAt = Date.now();
  if (timedMode()) {
    // por tempo: quando chega a 0 deixa de aceitar respostas e passa sozinho para a sondagem
    session.deadline = Date.now() + q.time * 1000;
    timer = setTimeout(closeQuestion, q.time * 1000 + 300);
  } else {
    // manual: fica aberta até o formador fechar
    session.deadline = null;
  }
  persistSession();
  broadcast();
}

function allAnswered() {
  const ids = Object.values(session.players).filter(p => p.socketId).map(p => p.studentId);
  const ans = answersFor(session.qIndex);
  return ids.length > 0 && ids.every(id => ans[id]);
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// conversor de fotografias do iPhone (HEIC → JPEG), carregado só quando é preciso
app.get('/vendor/heic2any.min.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules/heic2any/dist/heic2any.min.js'), { maxAge: '7d' }));
app.use('/uploads', express.static(UPLOADS, { maxAge: '1h' }));
// mantém o código da sessão (?c=...) ao redirecionar
app.get('/', (req, res) => { const q = req.originalUrl.indexOf('?'); res.redirect('/play.html' + (q >= 0 ? req.originalUrl.slice(q) : '')); });
app.get('/formador', (req, res) => res.redirect('/host.html'));

// Só aceita a palavra-passe no cabeçalho (nunca no endereço, para não ficar no histórico)
function auth(req, res, next) {
  if (pwOk(req.get('x-host-password'))) return next();
  setTimeout(() => res.status(401).json({ error: 'Palavra-passe do formador inválida' }), FAIL_DELAY_MS);
}

app.post('/api/login', (req, res) => {
  const ok = pwOk(req.body && req.body.password);
  if (ok) return res.json({ ok });
  setTimeout(() => res.json({ ok }), FAIL_DELAY_MS);
});

// Alunos
app.get('/api/students', auth, (req, res) => res.json(db.students));
function savePhoto(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
  const name = uid(12) + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS, name), Buffer.from(m[2], 'base64'));
  return '/uploads/' + name;
}
app.post('/api/students', auth, (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [req.body];
  const added = [], skipped = [];
  for (const s of list) {
    const name = String(s.name || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    // nomes iguais na turma não são permitidos: o aluno entra pelo nome, não pode haver dúvida
    if (db.students.some(x => norm(x.name) === norm(name))) { skipped.push(name); continue; }
    const st = { id: uid(), name, photo: savePhoto(s.photo) };
    db.students.push(st); added.push(st);
  }
  db.students.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  saveDb();
  if (!added.length && skipped.length) return res.status(409).json({ error: `Já existe um aluno chamado "${skipped[0]}". Acrescenta um apelido para distinguir.` });
  res.json(added.map(a => ({ ...a, skipped })));
});
app.put('/api/students/:id', auth, (req, res) => {
  const st = db.students.find(s => s.id === req.params.id);
  if (!st) return res.status(404).end();
  if (req.body.name) {
    const name = String(req.body.name).trim().replace(/\s+/g, ' ');
    if (db.students.some(x => x !== st && norm(x.name) === norm(name))) return res.status(409).json({ error: `Já existe um aluno chamado "${name}". Acrescenta um apelido para distinguir.` });
    st.name = name;
  }
  if (req.body.photo) st.photo = savePhoto(req.body.photo) || st.photo;
  if (req.body.removePhoto) st.photo = null;
  saveDb(); res.json(st);
});
app.delete('/api/students/:id', auth, (req, res) => {
  db.students = db.students.filter(s => s.id !== req.params.id);
  saveDb(); res.json({ ok: true });
});

// Cursos
app.get('/api/courses', auth, (req, res) => res.json(db.courses));
app.post('/api/courses', auth, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Falta o nome do curso' });
  const c = { id: uid(), name }; db.courses.push(c);
  db.courses.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  saveDb(); res.json(c);
});
app.put('/api/courses/:id', auth, (req, res) => {
  const c = db.courses.find(c => c.id === req.params.id);
  if (!c) return res.status(404).end();
  const name = String(req.body.name || '').trim(); if (name) c.name = name;
  db.courses.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  saveDb(); res.json(c);
});
app.delete('/api/courses/:id', auth, (req, res) => {
  const n = db.quizzes.filter(q => q.courseId === req.params.id).length;
  if (n) return res.status(400).json({ error: `Este curso ainda tem ${n} questionário(s). Apaga-os ou muda-os de curso primeiro.` });
  db.courses = db.courses.filter(c => c.id !== req.params.id);
  saveDb(); res.json({ ok: true });
});

// Questionários
function cleanQuiz(q) {
  const courseId = db.courses.find(c => c.id === q.courseId) ? q.courseId : (db.courses[0] || {}).id;
  return {
    id: q.id || uid(), courseId, title: String(q.title || 'Sem título').trim(),
    questions: (q.questions || []).map(x => Q.cleanQuestion(x, uid, savePhoto)).filter(Boolean),
  };
}
app.get('/api/quizzes', auth, (req, res) => res.json(db.quizzes));
app.post('/api/quizzes', auth, (req, res) => {
  if (!db.courses.length) return res.status(400).json({ error: 'Cria primeiro um curso' });
  const q = cleanQuiz(req.body);
  const i = db.quizzes.findIndex(x => x.id === q.id);
  if (i >= 0) db.quizzes[i] = q; else db.quizzes.push(q);
  saveDb(); res.json(q);
});
// Lista de soluções em Word (todas as perguntas com a resposta correta destacada)
app.get('/api/quizzes/:id/docx', auth, async (req, res) => {
  const quiz = db.quizzes.find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).end();
  const course = (db.courses.find(c => c.id === quiz.courseId) || {}).name || '';
  const buf = await buildKeyDocx(quiz, course);
  const clean = t => String(t).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w\-]+/g, '_').slice(0, 60);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="Solucoes_${clean(quiz.title)}.docx"`);
  res.send(buf);
});
app.delete('/api/quizzes/:id', auth, (req, res) => {
  db.quizzes = db.quizzes.filter(q => q.id !== req.params.id);
  saveDb(); res.json({ ok: true });
});

// Resultados
app.get('/api/results', auth, (req, res) => {
  const files = fs.readdirSync(RESULTS).filter(f => f.endsWith('.json'));
  const list = files.map(f => {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8'));
      return { id: r.id, quizTitle: r.quizTitle, courseName: r.courseName || '', startedAt: r.startedAt, endedAt: r.endedAt, players: r.players.length, questions: r.questions.length };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt);
  res.json(list);
});
app.get('/api/results/:id', auth, (req, res) => {
  const f = resultFile(path.basename(req.params.id));
  if (!fs.existsSync(f)) return res.status(404).end();
  res.json(JSON.parse(fs.readFileSync(f, 'utf8')));
});
app.delete('/api/results/:id', auth, (req, res) => {
  const f = resultFile(path.basename(req.params.id));
  if (session && session.id === req.params.id) return res.status(400).json({ error: 'Sessão ativa' });
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
});

// CSV (Excel PT: separador ";" e BOM UTF-8)
const L = i => String.fromCharCode(65 + i);
function csvCell(v) { v = v == null ? '' : String(v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function toCsv(rows) { return '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'); }
function participants(r) {
  // todos os alunos da turma (incluindo quem não entrou) + quem entrou
  const map = new Map();
  r.roster.forEach(s => map.set(s.id, { id: s.id, name: s.name + (s.homonym ? ' [nome repetido]' : (s.extra || s.guest) ? ' (extra)' : '') }));
  r.players.forEach(p => { if (!map.has(p.studentId)) map.set(p.studentId, { id: p.studentId, name: p.name }); });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
}
const answerText = (q, a) => a == null ? '' : Q.answerText(q, a);
const correctText = q => Q.correctText(q);
const okText = (q, a) => Q.typeOf(q) === 'scale' ? '—' : a.correct === true ? 'Sim' : a.correct === false ? 'Não' : 'Por avaliar';

app.get('/api/results/:id/csv', auth, (req, res) => {
  const f = resultFile(path.basename(req.params.id));
  if (!fs.existsSync(f)) return res.status(404).end();
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const people = participants(r);
  const joined = new Set(r.players.map(p => p.studentId));
  const score = Object.fromEntries(r.players.map(p => [p.studentId, p.score]));
  let rows;
  if (req.query.type === 'grelha') {
    rows = [['Curso', r.courseName || ''], ['Questionário', r.quizTitle], ['Data', new Date(r.startedAt).toLocaleString('pt-PT')], []];
    rows.push(['Aluno', ...r.questions.map((q, i) => 'P' + (i + 1)), 'Certas', 'Perguntas avaliadas', '% acerto', 'Pontos']);
    rows.push(['RESPOSTA CORRETA', ...r.questions.map(q => Q.correctShort(q)), '', '', '', '']);
    // conta só as perguntas com resposta certa (a escala e a resposta livre por avaliar não contam)
    const gradedIdx = r.asked.filter(i => Q.isGraded(r.questions[i]) || Object.values(r.answers[i] || {}).some(a => a.correct != null));
    for (const p of people) {
      let ok = 0;
      const cells = r.questions.map((q, i) => {
        const a = (r.answers[i] || {})[p.id];
        if (!r.asked.includes(i)) return '(não feita)';
        if (!a) return joined.has(p.id) ? 'Sem resposta' : 'Ausente';
        if (a.correct === true) ok++;
        return Q.answerShort(q, a) + (a.correct === true ? ' ✓' : a.correct === false ? ' ✗' : Q.typeOf(q) === 'open' ? ' ?' : '');
      });
      const n = gradedIdx.length;
      rows.push([p.name, ...cells, ok, n, n ? Math.round(ok / n * 100) + '%' : '', score[p.id] ?? 0]);
    }
  } else {
    rows = [['Curso', 'Questionário', 'Nº', 'Pergunta', 'Opções', 'Resposta correta', 'Aluno', 'Resposta dada', 'Correta?', 'Tempo (s)', 'Pontos']];
    r.questions.forEach((q, i) => {
      const t = Q.typeOf(q);
      const opts = t === 'mc' || t === 'tf' ? q.options.map((o, k) => L(k) + ') ' + o).join(' | ') : t === 'fill' ? 'Palavras: ' + Q.wordBank(q).join(', ') : t === 'scale' ? 'Escala 1–5' : 'Resposta livre';
      for (const p of people) {
        const a = (r.answers[i] || {})[p.id];
        let given, ok = '';
        if (!r.asked.includes(i)) given = '(pergunta não feita)';
        else if (!a) given = joined.has(p.id) ? 'Sem resposta' : 'Ausente';
        else { given = answerText(q, a); ok = okText(q, a); }
        rows.push([r.courseName || '', r.quizTitle, i + 1, Q.displayText(q), opts, correctText(q), p.name, given, ok || (r.asked.includes(i) ? 'Não' : ''), a ? (a.timeMs / 1000).toFixed(1).replace('.', ',') : '', a ? a.points : 0]);
      }
    });
  }
  const safe = ((r.courseName ? r.courseName + '_' : '') + r.quizTitle).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w\-]+/g, '_').slice(0, 60);
  const date = new Date(r.startedAt).toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}_${date}_${req.query.type === 'grelha' ? 'grelha' : 'detalhado'}.csv"`);
  res.send(toCsv(rows));
});

// Fichas de respostas em Word (A4 vertical): todas (uma por formando) ou só de um formando (?student=ID)
app.get('/api/results/:id/docx', auth, async (req, res) => {
  const f = resultFile(path.basename(req.params.id));
  if (!fs.existsSync(f)) return res.status(404).end();
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const { buffer, count, name } = await buildDocx(r, req.query.student ? String(req.query.student) : null);
  if (!count) return res.status(404).json({ error: 'Sem formandos' });
  const clean = t => String(t).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w\-]+/g, '_').slice(0, 50);
  const file = `Fichas_${clean(r.quizTitle)}_${new Date(r.startedAt).toISOString().slice(0, 10)}${name ? '_' + clean(name) : ''}.docx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
  res.send(buffer);
});

// O formador marca uma resposta livre como certa / errada (ou volta a "por avaliar")
app.post('/api/results/:id/mark', auth, (req, res) => {
  const id = path.basename(req.params.id), f = resultFile(id);
  if (!fs.existsSync(f)) return res.status(404).end();
  const r = session && session.id === id ? null : JSON.parse(fs.readFileSync(f, 'utf8'));
  const src = r || session; // sessão a decorrer: altera em memória e grava
  const i = parseInt(req.body.q, 10), sid = String(req.body.studentId || ''), val = req.body.correct;
  const qq = src.questions[i], a = qq && (src.answers[i] || {})[sid];
  if (!a || Q.typeOf(qq) !== 'open') return res.status(400).json({ error: 'Resposta não encontrada' });
  const before = a.points || 0;
  a.correct = val === true ? true : val === false ? false : null;
  a.points = a.correct ? 1000 : 0; a.frac = a.correct ? 1 : 0; a.markedBy = 'formador';
  const players = r ? r.players : Object.values(session.players);
  const pl = players.find(x => x.studentId === sid); if (pl) pl.score = (pl.score || 0) - before + a.points;
  if (r) { fs.writeFileSync(f, JSON.stringify(r, null, 2)); } else { persistSession(); broadcast(); }
  res.json({ ok: true });
});

// QR code + endereço para os alunos
function lanIps() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}
app.get('/api/joininfo', auth, (req, res) => {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const suggestions = [];
  if (base) suggestions.push(base);
  suggestions.push(`${req.protocol}://${req.get('host')}`);
  lanIps().forEach(ip => suggestions.push(`http://${ip}:${PORT}`));
  res.json({ suggestions: [...new Set(suggestions)] });
});
app.get('/api/qr', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\//.test(url) || url.length > 300) return res.status(400).end();
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});

// ---------- Socket.IO ----------
const server = http.createServer(app);
io = new Server(server, { maxHttpBufferSize: 1e6 });

io.on('connection', socket => {
  const role = socket.handshake.auth && socket.handshake.auth.role;

  if (role === 'host') {
    if (!pwOk(socket.handshake.auth.password)) { setTimeout(() => { socket.emit('auth_error'); socket.disconnect(); }, FAIL_DELAY_MS); return; }
    socket.join('hosts');
    socket.emit('state', hostView());

    const guard = fn => (...args) => { try { fn(...args); } catch (e) { console.error(e); socket.emit('toast', 'Erro: ' + e.message); } };

    socket.on('host:start', guard(({ quizId, settings, studentIds }) => {
      if (session) persistSession();
      clearTimeout(timer); clearTimeout(autoTimer);
      const quiz = db.quizzes.find(q => q.id === quizId);
      if (!quiz || !quiz.questions.length) return socket.emit('toast', 'Questionário sem perguntas');
      let qs = JSON.parse(JSON.stringify(quiz.questions));
      if (settings && settings.shuffle) qs.sort(() => Math.random() - 0.5);
      // tempo igual para todas as perguntas (opcional, escolhido ao abrir a sala)
      settings = settings || {};
      if (!['manual', 'timed', 'auto', 'exam'].includes(settings.mode)) settings.mode = 'manual';
      const sec = (v, d) => Math.max(2, Math.min(120, parseInt(v, 10) || d));
      const at = settings.autoTimes || {};
      settings.autoTimes = { poll: sec(at.poll, 5), reveal: sec(at.reveal, 6), board: sec(at.board, 8) };
      settings.paused = false;
      if (!['manual', 'timed', 'auto', 'exam'].includes(settings.mode)) settings.mode = 'manual';
      settings.hideOnPhones = !!settings.hideOnPhones;
      if (settings.mode === 'exam') {
        settings.hideOnPhones = false; // ao seu ritmo, cada um precisa de ler as perguntas no telemóvel
        // ao seu ritmo: sem passos por pergunta (resposta correta, sondagem, ranking) nem pontos por rapidez
        settings.examMinutes = Math.max(1, Math.min(300, parseInt(settings.examMinutes, 10) || 10));
        settings.revealMode = 'never'; settings.rankEach = false; settings.showPoll = false; settings.speedPoints = false;
      }
      if (settings.noRanking) { settings.rankEach = false; settings.finalPodium = false; }
      if (!['each', 'end', 'never'].includes(settings.revealMode)) settings.revealMode = 'each';
      // duas opções independentes: depois de cada pergunta / todas no fim
      settings.revealEnd = settings.revealEnd === true || settings.revealMode === 'end';
      if (settings.revealMode !== 'each') settings.revealMode = settings.revealEnd ? 'end' : 'never';
      if (settings.mode === 'exam') settings.revealMode = settings.revealEnd ? 'end' : 'never';
      settings.showPoll = settings.showPoll !== false;
      if (settings.revealMode !== 'each') settings.rankEach = false;
      const fixed = parseInt(settings && settings.fixedTime, 10);
      if (fixed >= 5) qs.forEach(q => q.time = Math.min(300, fixed));
      const roster = db.students.filter(s => !studentIds || studentIds.includes(s.id)).map(s => ({ ...s }));
      assignShortNames(roster);
      session = {
        id: new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '_' + uid(4),
        code: newCode(), // código único da sessão (vai no QR code)
        quizId: quiz.id, quizTitle: quiz.title, courseId: quiz.courseId, courseName: (db.courses.find(c => c.id === quiz.courseId) || {}).name || '', startedAt: Date.now(),
        settings: { mode: 'manual', showWho: false, rankEach: true, finalPodium: true, speedPoints: true, ...settings },
        questions: qs, roster, phase: 'lobby', qIndex: -1, deadline: null,
        players: {}, answers: {}, asked: [],
      };
      persistSession();
      io.to('players').emit('reload');
      io.in('players').socketsJoin('lobby'); io.in('players').socketsLeave('players');
      broadcast();
    }));

    socket.on('host:settings', guard(s => {
      if (!session) return;
      delete s.mode; delete s.autoTimes; // o modo e os tempos ficam fixos durante toda a sessão
      delete s.noRanking; delete s.revealMode; delete s.revealEnd;
      if (session.settings.noRanking) { delete s.rankEach; delete s.finalPodium; }
      if (session.settings.revealMode !== 'each') delete s.rankEach;
      if ('showPoll' in s) s.showPoll = !!s.showPoll;
      Object.assign(session.settings, s);
      persistSession();
      if ('paused' in s || 'rankEach' in s) scheduleAuto();
      broadcast();
    }));

    socket.on('host:next', guard(advance));
    socket.on('host:extend', guard(min => {
      if (!session || session.phase !== 'exam') return;
      const add = Math.max(1, Math.min(30, parseInt(min, 10) || 1)) * 60000;
      session.deadline += add; session.settings.examMinutes += add / 60000;
      clearTimeout(timer); timer = setTimeout(endExam, session.deadline - Date.now() + 300);
      persistSession(); broadcast();
    }));
    socket.on('host:goto', guard(i => { if (session && session.questions[i]) startQuestion(i); }));
    socket.on('host:end', guard(() => {
      if (!session) return;
      clearTimeout(timer); clearTimeout(autoTimer); session.autoAt = null;
      session.phase = 'end'; session.endedAt = Date.now(); session.deadline = null;
      persistSession(); broadcast();
    }));
    socket.on('host:close', guard(() => {
      if (session) persistSession();
      clearTimeout(timer); clearTimeout(autoTimer); session = null;
      io.to('players').emit('state', { session: null });
      io.in('players').socketsJoin('lobby'); io.in('players').socketsLeave('players');
      broadcast();
    }));
    socket.on('host:addStudent', guard((name, cb) => {
      if (typeof cb !== 'function') cb = () => {};
      if (!session) return cb({ error: 'Não há sessão ativa' });
      name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!name) return cb({ error: 'Escreve o nome completo' });
      if (db.students.some(x => norm(x.name) === norm(name)) || session.roster.some(x => norm(x.name) === norm(name))) return cb({ error: `Já existe um formando chamado "${name}".` });
      const st = { id: uid(), name, photo: null };
      db.students.push(st); db.students.sort((a, b) => a.name.localeCompare(b.name, 'pt')); saveDb();
      session.roster.push({ ...st });
      assignShortNames(session.roster);
      // quem já entrou mantém-se; atualiza só o nome curto mostrado
      Object.values(session.players).forEach(p => { const r = session.roster.find(x => x.id === p.studentId); if (r) p.short = r.short; });
      persistSession(); cb({ ok: true }); broadcast();
    }));

    socket.on('host:release', guard((studentId, cb) => {
      if (typeof cb !== 'function') cb = () => {};
      if (!session || !session.players[studentId]) return cb({ error: 'Aluno não encontrado' });
      const p = session.players[studentId];
      if (p.socketId) { const s = io.sockets.sockets.get(p.socketId); if (s) { s.emit('released'); s.leave('players'); s.join('lobby'); } }
      // mantém as respostas; só a pessoa a quem dás o código de reentrada pode voltar a este lugar
      p.token = null; p.socketId = null;
      p.rejoin = String(crypto.randomInt(1000, 10000));
      cb({ rejoin: p.rejoin });
      broadcast();
    }));
    return;
  }

  // ----- aluno -----
  socket.data.code = cleanCode(socket.handshake.auth && socket.handshake.auth.code);
  socket.join('lobby');
  socket.emit('roster', rosterForPlayers(socket));
  let me = null;

  // liga este dispositivo a um participante (novo token: só este telemóvel o pode usar)
  function attach(p, cb) {
    p.token = uid(16);
    p.rejoin = null;
    if (p.socketId && p.socketId !== socket.id) { const old = io.sockets.sockets.get(p.socketId); if (old) old.emit('released'); }
    p.socketId = socket.id;
    session.players[p.studentId] = p;
    me = p;
    socket.leave('lobby'); socket.join('players');
    persistSession();
    cb({ ok: true, token: p.token, sessionId: session.id, studentId: p.studentId, name: p.name });
    broadcast();
  }
  const newPlayer = st => ({ studentId: st.id, name: st.name, short: st.short || st.name, photo: st.photo || null, score: 0, joinedAt: Date.now() });

  // Mesmo dispositivo a voltar (recarregou a página): só com o token que recebeu ao entrar
  socket.on('player:claim', (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const { studentId, token } = (data && typeof data === 'object') ? data : {};
    if (!session || typeof studentId !== 'string' || typeof token !== 'string') return cb({ error: 'Pedido inválido.' });
    const p = session.players[studentId];
    if (!p || !p.token || p.token !== token) return cb({ error: 'Sessão expirada neste dispositivo.' });
    if (p.socketId && p.socketId !== socket.id) { const old = io.sockets.sockets.get(p.socketId); if (old) old.emit('released'); }
    p.socketId = socket.id; me = p;
    socket.leave('lobby'); socket.join('players');
    cb({ ok: true, token: p.token, sessionId: session.id, studentId: p.studentId, name: p.name });
    broadcast();
  });

  // Entrar escrevendo o nome completo. Quem é quem decide-o sempre o sistema, pela lista do formador.
  socket.on('player:join', (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const { name } = (data && typeof data === 'object') ? data : {};
    if (!codeOk(socket.data.code)) return cb({ error: 'Código da sessão inválido ou sessão terminada. Lê de novo o QR code.' });
    if (me && session.players[me.studentId] === me) return cb({ error: 'Já entraste neste dispositivo.' });
    if (typeof name !== 'string' || !name.trim() || name.length > 80) return cb({ error: 'Escreve o teu nome completo.' });
    const T = norm(name).split(' ').filter(Boolean);
    if (!T.length) return cb({ error: 'Escreve o teu nome completo.' });
    const found = session.roster.filter(st => matchesStudent(st, T));
    if (found.length === 0) return cb({ notFound: true });
    if (found.length > 1) return cb({ error: 'Escreve o teu nome completo (nome e apelidos).' });
    const st = found[0];
    if (session.players[st.id]) return cb({ error: `${st.short} já entrou noutro dispositivo. Se mudaste de telemóvel, pede ao formador o código de reentrada.` });
    attach(newPlayer(st), cb);
  });

  // Mudou de telemóvel: o formador liberta o nome e dá-lhe um código de reentrada
  socket.on('player:rejoin', (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const rejoin = String((data && data.rejoin) || '').replace(/\D/g, '');
    if (!codeOk(socket.data.code)) return cb({ error: 'Código da sessão inválido ou sessão terminada.' });
    const p = rejoin.length === 4 && Object.values(session.players).find(x => !x.token && x.rejoin === rejoin);
    if (!p) return cb({ error: 'Código de reentrada inválido. Pede-o ao formador.' });
    attach(p, cb);
  });

  // "Não sou eu" (só antes de responder a alguma pergunta): desfaz a entrada por completo
  // Fotografia tirada pelo próprio formando (opcional): só é usada nesta sessão
  socket.on('player:photo', (dataUrl, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!session || !me || me.socketId !== socket.id) return cb({ error: 'Pedido inválido.' });
    if (typeof dataUrl !== 'string' || dataUrl.length > 400000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) return cb({ error: 'Fotografia inválida.' });
    const url = savePhoto(dataUrl);
    if (!url) return cb({ error: 'Fotografia inválida.' });
    me.photo = url;
    const r = session.roster.find(x => x.id === me.studentId); if (r) r.photo = url;
    persistSession(); cb({ ok: true }); broadcast();
  });

  socket.on('player:leave', (cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!session || !me || me.socketId !== socket.id) return cb({ error: 'Pedido inválido.' });
    const answered = Object.values(session.answers).some(a => a[me.studentId]);
    if (answered) return cb({ error: 'Já respondeste a perguntas. Fala com o formador.' });
    delete session.players[me.studentId];
    me = null;
    socket.leave('players'); socket.join('lobby');
    persistSession();
    cb({ ok: true });
    socket.emit('roster', rosterForPlayers(socket));
    broadcast();
  });

  socket.on('player:examAnswer', (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!session || !me || me.socketId !== socket.id || session.players[me.studentId] !== me) return cb({ error: 'Não identificado' });
    if (session.phase !== 'exam' || Date.now() > session.deadline) return cb({ error: 'O tempo terminou.' });
    if ((session.submitted || {})[me.studentId]) return cb({ error: 'Já entregaste.' });
    const i = parseInt(data && data.q, 10), qq = session.questions[i];
    if (!qq) return cb({ error: 'Pedido inválido.' });
    const g = Q.grade(qq, data.value !== undefined ? data.value : data.option);
    if (g.error) return cb({ error: g.error });
    const prevA = answersFor(i)[me.studentId];
    answersFor(i)[me.studentId] = { ...g.entry, timeMs: Date.now() - session.examStart, points: pointsFor(qq, g.entry, 0, false), at: Date.now() };
    if (Q.typeOf(qq) === 'open') { const mm = cleanMeta(data.meta, prevA && prevA.meta) || {}; mm.invisible = Math.max(invisibleCount(data.value), (prevA && prevA.meta && prevA.meta.invisible) || 0); answersFor(i)[me.studentId].meta = mm; }
    examRecompute(me);
    persistSession(); cb({ ok: true }); broadcast();
  });
  socket.on('player:submit', (cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!session || !me || me.socketId !== socket.id || session.phase !== 'exam') return cb({ error: 'Pedido inválido.' });
    (session.submitted ||= {})[me.studentId] = Date.now();
    persistSession(); cb({ ok: true });
    // todos os formandos ligados entregaram: termina
    const on = Object.values(session.players).filter(p => p.socketId);
    if (on.length && on.every(p => session.submitted[p.studentId])) return endExam();
    broadcast();
  });

  socket.on('player:answer', (option, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!session || !me || session.players[me.studentId] !== me || me.socketId !== socket.id) return cb && cb({ error: 'Não identificado' });
    if (session.phase !== 'question') return cb && cb({ error: 'Tempo esgotado' });
    const q = currentQ();
    const ans = answersFor(session.qIndex);
    if (ans[me.studentId]) return cb && cb({ error: 'Já respondeste' });
    // resposta: número (escolha múltipla, V/F, escala), lista de palavras (completar) ou texto (livre)
    const raw = option && typeof option === 'object' && !Array.isArray(option) ? option.value : option;
    const g = Q.grade(q, raw);
    if (g.error) return cb({ error: g.error });
    const timeMs = Date.now() - session.questionStartedAt;
    const points = pointsFor(q, g.entry, timeMs, session.settings.speedPoints);
    ans[me.studentId] = { ...g.entry, timeMs, points, at: Date.now() };
    if (Q.typeOf(q) === 'open') { const mm = cleanMeta(option && option.meta) || {}; mm.invisible = invisibleCount(raw); ans[me.studentId].meta = mm; }
    me.score += points;
    persistSession();
    cb && cb({ ok: true });
    // no modo por tempo fecha logo quando todos responderem; no manual é o formador que decide
    if (timedMode() && allAnswered()) closeQuestion(); else broadcast();
  });

  socket.on('disconnect', () => {
    if (me && me.socketId === socket.id) { me.socketId = null; broadcast(); }
  });
});

server.listen(PORT, () => {
  console.log('\n  🎉 Quiz a correr!');
  console.log(`  Formador:  http://localhost:${PORT}/host.html`);
  if (PW_GENERATED) console.log(`  🔑 Palavra-passe do formador gerada: ${HOST_PASSWORD}\n     (guardada em data/palavra-passe-formador.txt — podes definir a tua com HOST_PASSWORD=...)`);
  else if (!process.env.HOST_PASSWORD) console.log('  🔑 Palavra-passe do formador: ver data/palavra-passe-formador.txt');
  console.log(`  Alunos:    http://localhost:${PORT}/`);
  lanIps().forEach(ip => console.log(`  Na rede:   http://${ip}:${PORT}/`));
  console.log('');
});
