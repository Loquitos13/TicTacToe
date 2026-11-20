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
    .map(p => ({ studentId: p.studentId, name: p.name, photo: p.photo, score: p.score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function hostView() {
  if (!session) return { session: null };
  const q = currentQ();
  const ans = q ? answersFor(session.qIndex) : {};
  const counts = q ? q.options.map((_, i) => Object.values(ans).filter(a => a.option === i).length) : [];
  const whoByOption = q ? q.options.map((_, i) => Object.entries(ans).filter(([, a]) => a.option === i).map(([sid]) => sid)) : [];
  return {
    session: {
      id: session.id, quizTitle: session.quizTitle, courseName: session.courseName, phase: session.phase, qIndex: session.qIndex,
      total: session.questions.length, settings: session.settings,
      question: q, remainingMs: session.deadline ? Math.max(0, session.deadline - Date.now()) : 0,
      counts, whoByOption, answeredIds: Object.keys(ans),
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
  const v = {
    session: { id: session.id, quizTitle: session.quizTitle, courseName: session.courseName, phase: session.phase, qIndex: session.qIndex, total: session.questions.length, settings: session.settings },
    me: {
      studentId: p.studentId, name: p.name, photo: p.photo, position: pos, of: rank.length,
      score: scoreOf(p),
      correct: Object.entries(session.answers).filter(([i, a]) => !(hideCurrent && +i === session.qIndex) && a[p.studentId] && a[p.studentId].correct).length,
    },
    answered: !!mine, myOption: mine ? mine.option : null,
  };
  if (q && ['ready', 'question', 'closed', 'reveal', 'leaderboard'].includes(session.phase)) {
    v.question = { text: q.text, options: q.options, time: q.time, image: q.image || null };
    v.remainingMs = session.deadline ? Math.max(0, session.deadline - Date.now()) : 0;
  }
  if (q && ['reveal', 'leaderboard'].includes(session.phase)) {
    v.correct = q.correct;
    v.wasCorrect = mine ? mine.correct : false;
    v.points = mine ? mine.points : 0;
  }
  return v;
}

let io;
function broadcast() {
  io.to('hosts').emit('state', hostView());
  if (!session) { io.to('players').emit('state', { session: null }); return; }
  for (const p of Object.values(session.players)) if (p.socketId) io.to(p.socketId).emit('state', playerView(p));
  // jogadores ainda sem identificação recebem só a fase
  io.to('lobby').emit('roster', rosterForPlayers());
}

function rosterForPlayers() {
  if (!session) return { session: null, students: [] };
  return {
    session: { id: session.id, quizTitle: session.quizTitle, courseName: session.courseName, phase: session.phase },
    students: session.roster.map(s => ({ id: s.id, name: s.name, photo: s.photo, taken: !!session.players[s.id] })),
  };
}

const READY_MS = 3000; // compasso de espera "Prepara-te! 3-2-1" antes de cada pergunta

function closeQuestion() {
  if (!session || session.phase !== 'question') return;
  clearTimeout(timer); timer = null;
  // tempo esgotado / fechado pelo formador → já não aceita respostas e mostra a sondagem
  session.phase = 'closed';
  session.deadline = null;
  persistSession();
  broadcast();
}

function setPhase(ph) { session.phase = ph; persistSession(); broadcast(); }

// Fluxo de cada pergunta: prepara-te → pergunta → sondagem → resposta correta → (ranking) → próxima
function advance() {
  if (!session) return;
  const ph = session.phase;
  if (ph === 'lobby') return startQuestion(0);
  if (ph === 'ready') return openQuestion();
  if (ph === 'question') return closeQuestion();
  if (ph === 'closed') return setPhase('reveal');
  if (ph === 'reveal' && session.settings.rankEach) return setPhase('leaderboard');
  if (ph === 'reveal' || ph === 'leaderboard') {
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
  clearTimeout(timer);
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
  if (session.settings.mode === 'timed') {
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
app.use('/uploads', express.static(UPLOADS, { maxAge: '1h' }));
app.get('/', (req, res) => res.redirect('/play.html'));
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
  const added = [];
  for (const s of list) {
    const name = String(s.name || '').trim();
    if (!name) continue;
    const st = { id: uid(), name, photo: savePhoto(s.photo) };
    db.students.push(st); added.push(st);
  }
  db.students.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  saveDb(); res.json(added);
});
app.put('/api/students/:id', auth, (req, res) => {
  const st = db.students.find(s => s.id === req.params.id);
  if (!st) return res.status(404).end();
  if (req.body.name) st.name = String(req.body.name).trim();
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
    questions: (q.questions || []).map(x => ({
      id: x.id || uid(), text: String(x.text || '').trim(),
      options: (x.options || []).map(o => String(o).trim()).filter(Boolean).slice(0, 6),
      correct: (x.correct || []).map(Number),
      time: Math.max(5, Math.min(300, parseInt(x.time, 10) || 20)),
      image: x.image && String(x.image).startsWith('data:') ? savePhoto(x.image) : (x.image || null),
    })).filter(x => x.text && x.options.length >= 2),
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
  r.roster.forEach(s => map.set(s.id, { id: s.id, name: s.name }));
  r.players.forEach(p => map.set(p.studentId, { id: p.studentId, name: p.name }));
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
}
function answerText(q, a) { return a == null ? '' : L(a.option) + ') ' + q.options[a.option]; }
function correctText(q) { return q.correct.map(i => L(i) + ') ' + q.options[i]).join(' | '); }

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
    rows.push(['Aluno', ...r.questions.map((q, i) => 'P' + (i + 1)), 'Certas', 'Total perguntas', '% acerto', 'Pontos']);
    rows.push(['RESPOSTA CORRETA', ...r.questions.map(q => q.correct.map(L).join('/')), '', '', '', '']);
    for (const p of people) {
      let ok = 0;
      const cells = r.questions.map((q, i) => {
        const a = (r.answers[i] || {})[p.id];
        if (!r.asked.includes(i)) return '(não feita)';
        if (!a) return joined.has(p.id) ? 'Sem resposta' : 'Ausente';
        if (a.correct) ok++;
        return L(a.option) + (a.correct ? ' ✓' : ' ✗');
      });
      const n = r.asked.length;
      rows.push([p.name, ...cells, ok, n, n ? Math.round(ok / n * 100) + '%' : '', score[p.id] ?? 0]);
    }
  } else {
    rows = [['Curso', 'Questionário', 'Nº', 'Pergunta', 'Opções', 'Resposta correta', 'Aluno', 'Resposta dada', 'Correta?', 'Tempo (s)', 'Pontos']];
    r.questions.forEach((q, i) => {
      const opts = q.options.map((o, k) => L(k) + ') ' + o).join(' | ');
      for (const p of people) {
        const a = (r.answers[i] || {})[p.id];
        let given, ok = '';
        if (!r.asked.includes(i)) given = '(pergunta não feita)';
        else if (!a) given = joined.has(p.id) ? 'Sem resposta' : 'Ausente';
        else { given = answerText(q, a); ok = a.correct ? 'Sim' : 'Não'; }
        rows.push([r.courseName || '', r.quizTitle, i + 1, q.text, opts, correctText(q), p.name, given, ok || (r.asked.includes(i) ? 'Não' : ''), a ? (a.timeMs / 1000).toFixed(1).replace('.', ',') : '', a ? a.points : 0]);
      }
    });
  }
  const safe = ((r.courseName ? r.courseName + '_' : '') + r.quizTitle).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w\-]+/g, '_').slice(0, 60);
  const date = new Date(r.startedAt).toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}_${date}_${req.query.type === 'grelha' ? 'grelha' : 'detalhado'}.csv"`);
  res.send(toCsv(rows));
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
      clearTimeout(timer);
      const quiz = db.quizzes.find(q => q.id === quizId);
      if (!quiz || !quiz.questions.length) return socket.emit('toast', 'Questionário sem perguntas');
      let qs = JSON.parse(JSON.stringify(quiz.questions));
      if (settings && settings.shuffle) qs.sort(() => Math.random() - 0.5);
      // tempo igual para todas as perguntas (opcional, escolhido ao abrir a sala)
      const fixed = parseInt(settings && settings.fixedTime, 10);
      if (fixed >= 5) qs.forEach(q => q.time = Math.min(300, fixed));
      const roster = db.students.filter(s => !studentIds || studentIds.includes(s.id)).map(s => ({ ...s }));
      session = {
        id: new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '_' + uid(4),
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
      delete s.mode; // o modo (manual / por tempo) fica fixo durante toda a sessão
      Object.assign(session.settings, s);
      persistSession();
      broadcast();
    }));

    socket.on('host:next', guard(advance));
    socket.on('host:goto', guard(i => { if (session && session.questions[i]) startQuestion(i); }));
    socket.on('host:end', guard(() => {
      if (!session) return;
      clearTimeout(timer);
      session.phase = 'end'; session.endedAt = Date.now(); session.deadline = null;
      persistSession(); broadcast();
    }));
    socket.on('host:close', guard(() => {
      if (session) persistSession();
      clearTimeout(timer); session = null;
      io.to('players').emit('state', { session: null });
      io.in('players').socketsJoin('lobby'); io.in('players').socketsLeave('players');
      broadcast();
    }));
    socket.on('host:release', guard(studentId => {
      if (!session || !session.players[studentId]) return;
      const p = session.players[studentId];
      if (p.socketId) { const s = io.sockets.sockets.get(p.socketId); if (s) { s.emit('released'); s.leave('players'); s.join('lobby'); } }
      // mantém respostas já dadas; apenas liberta o lugar para outro dispositivo
      p.token = null; p.socketId = null;
      broadcast();
    }));
    return;
  }

  // ----- aluno -----
  socket.join('lobby');
  socket.emit('roster', rosterForPlayers());
  let me = null;

  socket.on('player:claim', (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const { studentId, token } = (data && typeof data === 'object') ? data : {};
    if (typeof studentId !== 'string' || (token != null && typeof token !== 'string')) return cb({ error: 'Pedido inválido.' });
    if (!session) return cb && cb({ error: 'Ainda não há sessão ativa.' });
    const st = session.roster.find(s => s.id === studentId);
    if (!st) return cb && cb({ error: 'Aluno não encontrado.' });
    const existing = session.players[studentId];
    if (existing && existing.token && existing.token !== token) return cb && cb({ error: 'Este nome já está a ser usado noutro dispositivo. Pede ao formador para o libertar.' });
    const p = existing || { studentId, name: st.name, photo: st.photo, score: 0, joinedAt: Date.now() };
    p.token = token || existing?.token || uid(16);
    if (p.socketId && p.socketId !== socket.id) { const old = io.sockets.sockets.get(p.socketId); if (old) old.emit('released'); }
    p.socketId = socket.id;
    session.players[studentId] = p;
    me = p;
    socket.leave('lobby'); socket.join('players');
    persistSession();
    cb && cb({ ok: true, token: p.token, sessionId: session.id });
    broadcast();
  });

  socket.on('player:answer', (option, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!session || !me || session.players[me.studentId] !== me || me.socketId !== socket.id) return cb && cb({ error: 'Não identificado' });
    if (session.phase !== 'question') return cb && cb({ error: 'Tempo esgotado' });
    const q = currentQ();
    option = parseInt(option, 10);
    if (!(option >= 0 && option < q.options.length)) return;
    const ans = answersFor(session.qIndex);
    if (ans[me.studentId]) return cb && cb({ error: 'Já respondeste' });
    const timeMs = Date.now() - session.questionStartedAt;
    const correct = q.correct.includes(option);
    let points = 0;
    if (correct) points = session.settings.speedPoints ? Math.round(1000 * (1 - Math.min(timeMs, q.time * 1000) / (q.time * 1000) / 2)) : 1000;
    ans[me.studentId] = { option, timeMs, correct, points, at: Date.now() };
    me.score += points;
    persistSession();
    cb && cb({ ok: true });
    // no modo por tempo fecha logo quando todos responderem; no manual é o formador que decide
    if (session.settings.mode === 'timed' && allAnswered()) closeQuestion(); else broadcast();
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
