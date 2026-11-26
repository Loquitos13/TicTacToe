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
// Palavra-passe: as tentativas de cada origem (computador) são vistas uma de cada vez e cada erro faz esperar
// 1,5 s antes da seguinte — tentar em paralelo deixa de ajudar. Quem acerta (o formador) não espera, e as
// tentativas de outro computador nunca atrasam o do formador. Mais de 20 em fila: recusadas sem as ver.
const pwQueues = new Map();
const originOf = (ip, cf) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip || '') ? (cf ? 'cf:' + cf : 'local') : ip;
function pwCheck(origin, password, done) {
  let q = pwQueues.get(origin);
  if (!q) pwQueues.set(origin, q = { busy: false, items: [] });
  if (q.items.length >= 20) return done(null);
  q.items.push([password, done]);
  if (!q.busy) pwNext(origin, q);
}
// Depois do login o formador usa um token aleatório (12 h). Se for roubado expira; a palavra-passe nunca fica no browser.
const hostTokens = new Map();
function newHostToken() {
  const now = Date.now();
  for (const [t, exp] of hostTokens) if (exp < now) hostTokens.delete(t);
  const t = crypto.randomBytes(24).toString('base64url');
  hostTokens.set(t, now + 12 * 3600e3);
  return t;
}
let lastSlide = null;   // último pedido automático de um diapositivo (travão contra rajadas)
// Diapositivos do PowerPoint: o computador do formador fica autorizado uma vez (chave guardada só como hash, 180 dias)
const SLIDE_KEYS_FILE = path.join(DATA_DIR, 'chaves-diapositivos.json');
let slideKeys = (() => { try { return JSON.parse(fs.readFileSync(SLIDE_KEYS_FILE, 'utf8')); } catch { return []; } })();
const keyHash = k => crypto.createHash('sha256').update(k).digest('hex');
function newSlideKey() {
  const k = 's.' + crypto.randomBytes(32).toString('base64url');
  slideKeys = slideKeys.filter(x => x.exp > Date.now()).slice(-19);   // no máximo 20 computadores
  slideKeys.push({ h: keyHash(k), exp: Date.now() + 180 * 864e5 });
  try { fs.writeFileSync(SLIDE_KEYS_FILE, JSON.stringify(slideKeys), { mode: 0o600 }); } catch {}
  return k;
}
const tokenOk = t => typeof t === 'string' && ((hostTokens.get(t) || 0) > Date.now()
  || (t.startsWith('s.') && t.length < 100 && slideKeys.some(x => x.exp > Date.now() && x.h === keyHash(t))));
function pwNext(origin, q) {
  const it = q.items.shift();
  if (!it) { pwQueues.delete(origin); return; }
  q.busy = true;
  const ok = pwOk(it[0]);
  it[1](ok);
  setTimeout(() => { q.busy = false; pwNext(origin, q); }, ok ? 0 : FAIL_DELAY_MS);
}
const DB_FILE = path.join(DATA_DIR, 'db.json');
[UPLOADS, RESULTS].forEach(d => fs.mkdirSync(d, { recursive: true }));

const uid = (n = 8) => crypto.randomBytes(n).toString('hex').slice(0, n);

// ---------- Base de dados (ficheiro JSON) ----------
let db = { students: [], courses: [], quizzes: [] };
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { console.error(`\n✗ ${DB_FILE} está estragado (${e.message}).\n  Não arranco para não o apagar: corrige o ficheiro ou repõe uma cópia e volta a arrancar.\n`); process.exit(1); }
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
    players: Object.values(session.players).map(p => ({ studentId: p.studentId, name: p.name, short: p.short, photo: p.photo, score: p.score, joinedAt: p.joinedAt, team: p.team ?? null, token: p.token, rejoin: p.rejoin })),
    phase: session.phase, qIndex: session.qIndex, deadline: session.deadline, examStart: session.examStart,
    teams: session.settings.teams ? teamStats() : null,
    code: session.code,
    anonymous: !!session.settings.anonymous,
    submitted: session.submitted || null,
    guesses: session.guesses || null,
    hangs: session.hangs || null,
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

// ---------- Jogos em grupo (equipas) ----------
const TEAMS = [
  { id: 0, name: 'Vermelha', color: '#ef4444', emoji: '🔴' }, { id: 1, name: 'Azul', color: '#3b82f6', emoji: '🔵' },
  { id: 2, name: 'Verde', color: '#22c55e', emoji: '🟢' }, { id: 3, name: 'Amarela', color: '#eab308', emoji: '🟡' },
  { id: 4, name: 'Roxa', color: '#a855f7', emoji: '🟣' }, { id: 5, name: 'Laranja', color: '#f97316', emoji: '🟠' },
];
const teamInfo = id => TEAMS[id] ? { ...TEAMS[id] } : null;
// equipa com menos pessoas (empate: ao acaso) — usada quando alguém entra
function smallestTeam() {
  const n = session.settings.teams, counts = Array(n).fill(0);
  Object.values(session.players).forEach(p => { if (p.team != null && p.team < n) counts[p.team]++; });
  const min = Math.min(...counts), opts = counts.map((c, i) => c === min ? i : -1).filter(i => i >= 0);
  return opts[crypto.randomInt(opts.length)];
}
// pontuação de cada equipa = média dos pontos dos seus membros (justo com equipas de tamanhos diferentes)
// scoreOf permite ignorar a pergunta em curso (para os telemóveis não perceberem se acertaram)
function teamStats(scoreOf = p => p.score, lastPts = null, players = Object.values(session.players), n = session.settings.teams || 0) {
  const list = [];
  for (let id = 0; id < n; id++) {
    const members = players.filter(p => p.team === id);
    const total = members.reduce((t, p) => t + scoreOf(p), 0);
    const plus = lastPts ? members.reduce((t, p) => t + (lastPts[p.studentId] || 0), 0) : 0;
    list.push({ ...teamInfo(id), size: members.length, score: members.length ? Math.round(total / members.length) : 0,
      plus: members.length ? Math.round(plus / members.length) : 0,
      members: members.map(p => ({ studentId: p.studentId, name: p.name, short: p.short || p.name, photo: p.photo, score: p.score })) });
  }
  return list.filter(t => t.size).sort((a, b) => b.score - a.score || a.id - b.id);
}

// ---------- Batata quente ----------
// Grupos: as equipas (jogos em grupo) ou, sem equipas, cada formando sozinho. A batata está sempre com um grupo; só o
// representante da vez escreve (roda pelos membros: primeiro quem está ligado, depois quem respondeu menos vezes).
// O rastilho de cada ronda tem duração ao acaso e nunca volta atrás quando a batata passa.
let potatoTimer = null;
function potatoGroups() {
  const ps = Object.values(session.players).sort((a, b) => a.joinedAt - b.joinedAt);
  if (session.settings.teams) return TEAMS.slice(0, session.settings.teams).map(t => ({ id: 't' + t.id, name: 'Equipa ' + t.name, color: t.color, emoji: t.emoji, members: ps.filter(p => p.team === t.id) })).filter(g => g.members.length);
  return ps.map((p, i) => ({ id: 'p' + p.studentId, name: p.short || p.name, color: TEAMS[i % TEAMS.length].color, emoji: '🙋', members: [p] }));
}
function potatoGive(P, gid) {
  const gs = potatoGroups(); if (!gs.length) { P.holder = null; P.rep = null; return; }
  const g = gs.find(x => x.id === gid) || gs[0], cnt = id => P.repCount[id] || 0;
  const r = g.members.slice().sort((a, b) => (!!b.socketId - !!a.socketId) || cnt(a.studentId) - cnt(b.studentId))[0];
  P.repCount[r.studentId] = cnt(r.studentId) + 1;
  P.holder = g.id; P.rep = r.studentId; P.reject = null;
}
function potatoNext(P) { const gs = potatoGroups(); if (!gs.length) return null; const i = gs.findIndex(g => g.id === P.holder); return gs[(i + 1) % gs.length].id; }
function potatoScore(p, delta, word) {
  const ans = answersFor(session.qIndex);
  const a = ans[p.studentId] || (ans[p.studentId] = { value: [], points: 0, correct: false, frac: 0, booms: 0, timeMs: 0, at: Date.now() });
  const before = p.score; p.score = Math.max(0, p.score + delta);   // nunca abaixo de 0
  a.points += p.score - before; if (word) a.value.push(word); if (delta < 0) a.booms++;
  a.correct = a.points > 0; a.frac = a.correct ? 1 : 0; a.at = Date.now();
}
function potatoRound(k) {
  const q = currentQ(), P = session.potato;
  clearTimeout(potatoTimer);
  if (!P || k >= q.rounds.length) return closeQuestion();
  P.round = k; P.used = []; P.qi = 0; P.last = null;
  const gs = potatoGroups();
  potatoFuse(P, P.startNext || (gs.length ? gs[crypto.randomInt(gs.length)].id : null));
}
const potatoQs = () => { const q = currentQ(), P = session.potato; return ((q.rounds[P.round] || {}).questions) || []; };
// rastilho novo (início da ronda, ou depois de rebentar no modo de perguntas) e a batata vai para o grupo gid
function potatoFuse(P, gid) {
  const q = currentQ();
  clearTimeout(potatoTimer);
  P.status = 'running';
  const dur = (q.fuseMin + crypto.randomInt(q.fuseMax - q.fuseMin + 1)) * 1000;
  P.fuseStart = Date.now(); P.fuseEnd = P.fuseStart + dur;
  potatoGive(P, gid);
  potatoTimer = setTimeout(potatoBoom, dur);
  persistSession(); broadcast();
}
// modo de perguntas: a pergunta seguinte; quando acabam, a secção termina (sem penalização) e segue a próxima ronda
function potatoNextQ(P) {
  P.qi++; P.reject = null;
  if (P.qi < potatoQs().length) return false;
  clearTimeout(potatoTimer); P.status = 'between'; P.startNext = potatoNext(P);
  persistSession(); broadcast();
  potatoTimer = setTimeout(() => { if (session && session.potato === P && session.phase === 'question') potatoRound(P.round + 1); }, 4000);
  return true;
}
function potatoBoom() {
  const P = session && session.potato; if (!P || P.status !== 'running' || session.phase !== 'question') return;
  const q = currentQ(), g = potatoGroups().find(x => x.id === P.holder);
  P.status = 'boom'; P.boomGroup = P.holder;
  if (g) { g.members.forEach(p => potatoScore(p, -q.penalty)); P.gscore[g.id] = Math.max(0, (P.gscore[g.id] || 0) - q.penalty); }
  P.log.push({ round: P.round, group: P.holder, boom: true, pts: -q.penalty });
  P.startNext = potatoNext(P);
  persistSession(); broadcast();
  // modo de perguntas: a ronda continua (rastilho novo; a mesma pergunta passa ao grupo seguinte); com palavras, ronda seguinte
  const qmode = potatoQs().length > 0;
  potatoTimer = setTimeout(() => { if (!session || session.potato !== P || session.phase !== 'question') return; if (qmode) potatoFuse(P, P.startNext); else potatoRound(P.round + 1); }, qmode ? 4000 : 5000);
}
function potatoAccept(word, key) {
  const P = session.potato, q = currentQ(), g = potatoGroups().find(x => x.id === P.holder);
  if (!g) return 0;
  // mais pontos quanto mais tempo faltar para a batata rebentar
  const frac = Math.max(0, (P.fuseEnd - Date.now()) / (P.fuseEnd - P.fuseStart));
  const pts = Math.max(10, Math.round(q.pts * frac));
  P.used.push(key); P.gscore[g.id] = (P.gscore[g.id] || 0) + pts;
  const rep = P.rep;
  g.members.forEach(m => potatoScore(m, pts, m.studentId === rep ? word : null));
  P.log.push({ round: P.round, group: g.id, word, pts, rep });
  const item = potatoQs()[P.qi];
  if (item) { P.last = { q: item.q, a: item.a, word, group: g.id }; if (potatoNextQ(P)) return pts; }
  potatoGive(P, potatoNext(P));
  persistSession(); broadcast();
  return pts;
}
// o que o projetor e os telemóveis veem do jogo (nunca as palavras aceites)
function potatoView(forHost, p) {
  const P = session.potato, q = currentQ();
  if (!P || P.qIndex !== session.qIndex || !q || Q.typeOf(q) !== 'potato') return null;
  const gs = potatoGroups(), info = g => g && { id: g.id, name: g.name, color: g.color, emoji: g.emoji };
  const holder = gs.find(g => g.id === P.holder), rep = session.players[P.rep], boomG = gs.find(g => g.id === P.boomGroup);
  const name = id => { const g = gs.find(x => x.id === id); return g ? g.name : '?'; };
  const v = {
    status: P.status, round: P.round + 1, rounds: q.rounds.length, theme: (q.rounds[P.round] || {}).theme || '',
    // modo de perguntas: a pergunta em curso (nunca a resposta) e a última respondida (com a explicação)
    question: (() => { const qs = (q.rounds[P.round] || {}).questions || []; return qs.length && P.qi < qs.length ? { text: qs[P.qi].q, n: P.qi + 1, total: qs.length } : null; })(),
    last: P.last ? { q: P.last.q, a: P.last.a, word: P.last.word, group: name(P.last.group) } : null,
    remainingMs: P.status === 'running' ? Math.max(0, P.fuseEnd - Date.now()) : 0, totalMs: P.fuseEnd - P.fuseStart,
    holder: info(holder), rep: rep ? (rep.short || rep.name) : null, boom: P.status === 'boom' ? { ...info(boomG), penalty: q.penalty } : null,
    groups: gs.map(g => ({ ...info(g), size: g.members.length, score: P.gscore[g.id] || 0 })).sort((a, b) => b.score - a.score),
    log: P.log.filter(l => l.round === P.round).slice(-16).map(l => ({ group: name(l.group), word: l.word || null, pts: l.pts, boom: !!l.boom })),
  };
  if (forHost) { v.reject = P.reject && P.reject.group === P.holder ? P.reject : null; v.all = P.log.filter(l => l.word).map(l => ({ round: l.round, group: name(l.group), word: l.word, pts: l.pts })); }
  if (p) { const mine = gs.find(g => g.members.includes(p)); v.mine = !!(holder && mine === holder); v.isRep = P.rep === p.studentId; v.myGroup = info(mine); }
  return v;
}

function hostView() {
  if (!session) return { session: null };
  const q = currentQ();
  const ans = q ? answersFor(session.qIndex) : {};
  const qt = q ? Q.typeOf(q) : null;
  // escolha múltipla / V-F: por opção; escala: por valor 1..5
  const slots = !q ? [] : qt === 'scale' ? Array.from({ length: q.scaleTo === 10 ? 10 : 5 }, (_, i) => i + 1) : (qt === 'mc' || qt === 'tf') ? q.options.map((_, i) => i) : [];
  const pick = a => qt === 'scale' ? a.value : a.option;
  const counts = slots.map(v => Object.values(ans).filter(a => pick(a) === v).length);
  const whoByOption = slots.map(v => Object.entries(ans).filter(([, a]) => pick(a) === v).map(([sid]) => sid));
  const extra = { askedIds: session.asked.map(i => (session.questions[i] || {}).id) };   // diapositivos do PowerPoint
  if (qt === 'potato') extra.potato = potatoView(true);
  if (qt === 'fill') extra.fillStats = q.blanks.map((w, b) => ({ word: w, right: Object.values(ans).filter(a => Q.norm((a.value || [])[b]) === Q.norm(w)).length }));
  if (qt === 'open') { const m = new Map(); Object.values(ans).forEach(a => { const k = Q.norm(a.value); const e = m.get(k) || { text: a.value, count: 0, correct: a.correct }; e.count++; m.set(k, e); }); extra.openAnswers = [...m.values()].sort((a, b) => b.count - a.count).slice(0, 40); }
  if (qt === 'scale') { const vals = Object.values(ans).map(a => a.value); extra.scaleAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; }
  // nuvem: cada palavra (sem contar maiúsculas/acentos) com o nº de pessoas que a escreveram
  if (qt === 'cloud') { const m = new Map(); Object.values(ans).forEach(a => (a.value || []).forEach(w => { const k = Q.norm(w); const e = m.get(k) || { text: w, count: 0 }; e.count++; m.set(k, e); })); extra.cloud = [...m.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'pt')).slice(0, 80); }
  // letras baralhadas: tentativas agrupadas (certas e erradas)
  if (qt === 'scramble') { const m = new Map(); Object.values(ans).forEach(a => { const k = Q.norm(a.value); const e = m.get(k) || { text: String(a.value).toUpperCase(), count: 0, correct: a.correct }; e.count++; m.set(k, e); }); extra.attempts = [...m.values()].sort((a, b) => (b.correct === true) - (a.correct === true) || b.count - a.count).slice(0, 30); }
  // adivinha a palavra: só as cores de cada um (sem letras: não estraga o jogo a ninguém)
  if (qt === 'hangman') {
    const h = (session.hangs || {})[session.qIndex] || {}, total = Q.cwNorm(q.answer).length;
    extra.hangBoards = Object.values(session.players).map(pl => { const st = h[pl.studentId] || { letters: [], wrong: 0 }, a = ans[pl.studentId];
      return { studentId: pl.studentId, name: pl.short || pl.name, wrong: st.wrong, solved: !!(a && a.correct), done: !!a, found: [...Q.cwNorm(q.answer)].filter(c => st.letters.includes(c)).length, total }; });
    extra.hangSolved = Object.values(ans).filter(a => a.correct).length;
  }
  if (qt === 'guess') {
    const g = (session.guesses || {})[session.qIndex] || {};
    extra.guessBoards = Object.entries(g).map(([sid, tries]) => ({ studentId: sid, colors: tries.map(t => t.colors), solved: !!(ans[sid] && ans[sid].correct), done: !!ans[sid] }));
    extra.guessDist = Array.from({ length: q.maxTries || 6 }, (_, k) => Object.values(ans).filter(a => a.correct && a.tries === k + 1).length);
    extra.guessSolved = Object.values(ans).filter(a => a.correct).length;
  }
  // número: quantos escolheram cada valor e a média
  if (qt === 'number') { const vals = Object.values(ans).map(a => a.value), m = new Map(); vals.forEach(v => m.set(v, (m.get(v) || 0) + 1));
    extra.numberStats = { counts: [...m.entries()].sort((a, b) => a[0] - b[0]), avg: vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null, exact: Object.values(ans).filter(a => a.correct).length }; }
  // correspondência: quantos ligaram bem cada item
  if (qt === 'match') extra.matchOrder = Q.matchOrder(q);
  if (qt === 'match') extra.matchStats = q.pairs.map((_, i) => Object.values(ans).filter(a => (a.value || [])[i] === i).length);
  // encontrar na imagem: onde tocou cada um (sem nomes)
  if (qt === 'spot') {
    // cada toque, com a indicação de ter caído numa zona certa (sem nomes)
    const zs = Q.zonesOf(q), m = 0.01, inAny = (x, y) => zs.some(z => x >= z.x - m && x <= z.x + z.w + m && y >= z.y - m && y <= z.y + z.h + m);
    extra.spotHits = Object.values(ans).slice(0, 300).flatMap(a => { const v = a.value || [], o = []; for (let k = 0; k + 1 < v.length; k += 2) o.push([v[k], v[k + 1], inAny(v[k], v[k + 1])]); return o; });
  }
  // palavras cruzadas: quantos acertaram em cada palavra
  if (qt === 'cross') extra.crossStats = q.cross.words.map((w, k) => Object.values(ans).filter(a => (a.value || [])[k] === w.word).length);
  // ranking: posição média de cada opção (1 = primeiro lugar) e quantos a puseram em 1º
  if (qt === 'rank') {
    const list = Object.values(ans);
    extra.rankOrder = Q.rankOrder(q);
    extra.rankStats = q.options.map((text, i) => {
      const pos = list.map(a => (a.value || []).indexOf(i) + 1).filter(Boolean);
      return { i, text, avg: pos.length ? pos.reduce((x, y) => x + y, 0) / pos.length : null, first: pos.filter(x => x === 1).length };
    });
    if (q.ordered) extra.rankPerfect = list.filter(a => a.correct === true).length;
  }
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
      players: Object.values(session.players).map(p => ({ studentId: p.studentId, name: p.name, photo: p.photo, score: p.score, connected: !!p.socketId, team: p.team ?? null })),
      teams: session.settings.teams ? teamStats(p => p.score, q ? Object.fromEntries(Object.entries(ans).map(([sid, a]) => [sid, a.points])) : null) : null,
      teamList: session.settings.teams ? TEAMS.slice(0, session.settings.teams) : null,
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
    answered: !!mine, myOption: mine ? mine.option : null, myValue: mine ? Q.forPhone(q, mine.value) : null,
  };
  // classificação completa para o ecrã de ranking do telemóvel (os mesmos dados que o projetor mostra)
  if (showPos && (session.phase === 'leaderboard' || isEnd)) {
    const row = (r, i) => { const x = session.players[r.studentId] || {}; return { pos: i + 1, name: x.short || r.name, photo: x.photo || null, score: showScore ? r.s : null, me: r.studentId === p.studentId }; };
    v.board = rank.slice(0, 100).map(row);
    if (pos > 100) v.board.push(row(rank[pos - 1], pos - 1));   // turmas enormes: os 100 primeiros + o próprio
  }
  if (session.settings.teams && p.team != null) {
    v.me.team = teamInfo(p.team);
    v.me.teammates = Object.values(session.players).filter(x => x.team === p.team && x !== p).map(x => x.short || x.name);
    if (showPos) {
      const ts = teamStats(scoreOf);
      v.me.teamPosition = ts.findIndex(t => t.id === p.team) + 1; v.me.teamOf = ts.length;
      if (showScore) v.me.teamScore = (ts.find(t => t.id === p.team) || {}).score;
    }
  }
  const myGuess = i => { const tries = ((session.guesses || {})[i] || {})[p.studentId] || [], a = (session.answers[i] || {})[p.studentId];
    return { tries: tries.map(t => ({ word: t.word, colors: t.colors })), done: !!a, solved: !!(a && a.correct) }; };
  if (q && Q.typeOf(q) === 'guess') v.guess = myGuess(session.qIndex);
  const myHang = i => { const qq = session.questions[i], st = ((session.hangs || {})[i] || {})[p.studentId] || { letters: [], wrong: 0 }, a = (session.answers[i] || {})[p.studentId];
    return { letters: st.letters, wrong: st.wrong, mask: Q.hangMask(qq, st.letters), done: !!a, solved: !!(a && a.correct) }; };
  if (q && Q.typeOf(q) === 'hangman') v.hang = myHang(session.qIndex);
  if (q && Q.typeOf(q) === 'potato') v.potato = potatoView(false, p);
  if (session.phase === 'exam') {
    v.exam = {
      guess: Object.fromEntries(session.questions.map((qq, i) => Q.typeOf(qq) === 'guess' ? [i, myGuess(i)] : null).filter(Boolean)),
      hang: Object.fromEntries(session.questions.map((qq, i) => Q.typeOf(qq) === 'hangman' ? [i, myHang(i)] : null).filter(Boolean)),
      questions: session.questions.map(qq => Q.publicQuestion(qq, false)),
      mine: Object.fromEntries(session.questions.map((qq, i) => { const a = (session.answers[i] || {})[p.studentId]; return [i, a ? (a.option ?? Q.forPhone(qq, a.value)) : null]; }).filter(([, o]) => o != null)),
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
  if (isEnd && session.settings.showGrade) { v.gradeScale = session.settings.gradeScale === 100 ? 100 : session.settings.gradeScale === 'q' ? 'q' : 20; v.grade = Q.finalGrade(session.questions, session.answers, session.asked, p.studentId, v.gradeScale); }
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
// depois de uma resposta: só o formador e quem respondeu precisam de um estado novo
function notifyAnswer(p) {
  io.to('hosts').emit('state', hostView());
  if (p.socketId) io.to(p.socketId).emit('state', playerView(p));
}
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
  return { session: { id: session.id, quizTitle: session.quizTitle, courseName: session.courseName, phase: session.phase, anonymous: !!session.settings.anonymous } };
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

// adivinha a palavra: quem ainda estava a tentar quando a pergunta fechou fica com a resposta "não acertou"
function finalizeGuesses(i) {
  const q = session.questions[i];
  if (q && Q.typeOf(q) === 'hangman') {
    const ans = answersFor(i), h = (session.hangs || {})[i] || {};
    for (const [sid, st] of Object.entries(h)) if (!ans[sid] && st.letters.length)
      ans[sid] = { value: st.letters, wrong: st.wrong, correct: false, frac: 0, points: 0, timeMs: st.ms || 0, at: Date.now() };
    return;
  }
  if (!q || Q.typeOf(q) !== 'guess') return;
  const ans = answersFor(i), g = (session.guesses || {})[i] || {};
  for (const [sid, tries] of Object.entries(g)) if (!ans[sid] && tries.length)
    ans[sid] = { value: tries.map(t => t.word), colors: tries.map(t => t.colors), tries: tries.length, correct: false, frac: 0, points: 0, timeMs: tries[tries.length - 1].ms || 0, at: Date.now() };
}
function closeQuestion() {
  if (!session || session.phase !== 'question') return;
  clearTimeout(timer); timer = null;
  if (session.potato && session.potato.qIndex === session.qIndex) {
    clearTimeout(potatoTimer); session.potato.status = 'done';
    // toda a gente fica com registo nesta pergunta (mesmo quem não chegou a ter a batata)
    const ans = answersFor(session.qIndex);
    Object.values(session.players).forEach(p => { if (!ans[p.studentId]) ans[p.studentId] = { value: [], points: 0, correct: false, frac: 0, booms: 0, timeMs: 0, at: Date.now() }; });
  }
  finalizeGuesses(session.qIndex);
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
  session.questions.forEach((_, i) => finalizeGuesses(i));
  Object.values(session.players).forEach(examRecompute);
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
  // pergunta de opinião (escala, nuvem, ranking sem ordem certa): ninguém ganha pontos, por isso não há Top 5
  const opinion = (q => !Q.isGraded(q) && Q.typeOf(q) !== 'open')(currentQ());
  if (ph === 'reveal' && session.settings.rankEach && !opinion) return setPhase('leaderboard');
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
  if (Q.typeOf(q) === 'potato') {
    // batata quente: o jogo acaba quando acabam as rondas (ou quando o formador o termina)
    session.deadline = null;
    session.potato = { qIndex: session.qIndex, round: 0, log: [], repCount: {}, used: [], gscore: {}, status: 'running' };
    potatoRound(0);
    return;
  }
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
app.disable('x-powered-by');
// Só corre código dos nossos ficheiros: um script injetado (XSS) é recusado pelo browser.
// 'unsafe-eval' + blob: só por causa do conversor de fotografias do iPhone (HEIC).
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-eval'", "worker-src 'self' blob:", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'", "media-src 'self' blob:", "object-src 'none'",
  "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin' });
  // atrás da Cloudflare: nada da API (dados do formador, resultados, palavras-passe) pode ficar em cache,
  // nem as páginas (para uma versão nova chegar logo a todos)
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store, private');
  else if (/\.html$|^\/$/.test(req.path)) res.set('Cache-Control', 'no-cache');
  next();
});
// Limite de pedidos por origem (computador): chega para uma turma inteira atrás do mesmo router,
// mas um só atacante não consegue ocupar o servidor. Os ficheiros das páginas não contam.
const buckets = new Map();
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 60000) buckets.delete(k); }, 60000).unref();
function allow(key, perSec, burst) {
  const now = Date.now(), b = buckets.get(key) || { n: burst, t: now };
  b.n = Math.min(burst, b.n + (now - b.t) / 1000 * perSec); b.t = now; buckets.set(key, b);
  if (b.n < 1) return false;
  b.n--; return true;
}
app.use('/api', (req, res, next) => allow('http:' + originOf(req.ip, req.get('cf-connecting-ip')), 40, 200) ? next()
  : res.status(429).json({ error: 'Demasiados pedidos. Espera um pouco.' }));
// Corpo dos pedidos: pequeno para todos; grande (fotografias) só depois de confirmar que é o formador
const bigJson = express.json({ limit: '15mb' }), smallJson = express.json({ limit: '100kb' });
app.use((req, res, next) => /^\/api\/(students|quizzes)(\/|$)/.test(req.path) ? next() : smallJson(req, res, next));
// Versão dos ficheiros: os .js/.css são pedidos com "?v=…" (muda quando o código muda). Assim nem a cache da
// Cloudflare (que os guarda horas) nem a do PowerPoint ou dos telemóveis ficam com uma versão antiga.
const PUB = path.join(__dirname, 'public');
const BUILD = crypto.createHash('sha1').update(fs.readdirSync(PUB).filter(f => /\.(js|css|html)$/.test(f))
  .map(f => f + fs.statSync(path.join(PUB, f)).mtimeMs + ':' + fs.statSync(path.join(PUB, f)).size).join('|')).digest('hex').slice(0, 10);
const versioned = html => html.replace(/(src|href)="([\w.-]+\.(?:js|css))"/g, `$1="$2?v=${BUILD}"`);
app.get(['/host.html', '/play.html', '/feedback.html'], (req, res) => {
  res.set('Cache-Control', 'no-cache').type('html').send(versioned(fs.readFileSync(path.join(PUB, path.basename(req.path)), 'utf8')));
});
app.use(express.static(PUB));
// conversor de fotografias do iPhone (HEIC → JPEG), carregado só quando é preciso
app.get('/vendor/heic2any.min.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules/heic2any/dist/heic2any.min.js'), { maxAge: '7d' }));
app.use('/uploads', express.static(UPLOADS, { maxAge: '1h' }));
// mantém o código da sessão (?c=...) ao redirecionar
// /slide.html = host.html em modo diapositivo: carrega o office.js e pode ficar dentro do PowerPoint
const OFFICE_JS = 'https://appsforoffice.microsoft.com/lib/1/hosted/office.js';
const OFFICE_FRAMES = 'https://*.officeapps.live.com https://*.office.com https://*.office365.com https://*.microsoft365.com https://*.sharepoint.com https://*.live.com https://*.cloud.microsoft';
app.get('/slide.html', (req, res) => {
  const html = versioned(fs.readFileSync(path.join(__dirname, 'public', 'host.html'), 'utf8'))
    .replace('<body>', '<body class="slide">')
    .replace('<script src="/socket.io/socket.io.js"></script>', `<script src="${OFFICE_JS}"></script>\n<script src="/socket.io/socket.io.js"></script>`)
    .replace(`<script src="host.js?v=${BUILD}"></script>`, `<script src="host.js?v=${BUILD}"></script>\n<script src="slide.js?v=${BUILD}"></script>`);
  res.removeHeader('X-Frame-Options');
  res.set('Content-Security-Policy', CSP.replace("script-src 'self'", "script-src 'self' https://appsforoffice.microsoft.com")
    .replace("connect-src 'self'", "connect-src 'self' https://appsforoffice.microsoft.com")
    .replace("frame-ancestors 'none'", `frame-ancestors 'self' ${OFFICE_FRAMES}`));
  res.set('Cache-Control', 'no-cache').type('html').send(html);
});
// ficheiro do suplemento do PowerPoint (só faz sentido com endereço https fixo)
function addinManifest(base) {
  const id = crypto.createHash('sha256').update('quiz-addin:' + base).digest('hex');
  const guid = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}`;
  const x = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ContentApp">
  <Id>${guid}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Quiz</ProviderName>
  <DefaultLocale>pt-PT</DefaultLocale>
  <DisplayName DefaultValue="Quiz ao vivo"/>
  <Description DefaultValue="Mostra o quiz em direto dentro do diapositivo: QR code, perguntas, resultados e ranking."/>
  <IconUrl DefaultValue="${x(base)}/addin-icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="${x(base)}/addin-icon-64.png"/>
  <SupportUrl DefaultValue="${x(base)}/"/>
  <AppDomains>
    <AppDomain>${x(base)}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Presentation"/>
  </Hosts>
  <DefaultSettings>
    <SourceLocation DefaultValue="${x(base)}/slide.html"/>
    <RequestedWidth>960</RequestedWidth>
    <RequestedHeight>540</RequestedHeight>
  </DefaultSettings>
  <Permissions>ReadDocument</Permissions>
  <AllowSnapshot>true</AllowSnapshot>
</OfficeApp>
`;
}
// guarda-o também em data/ para o iniciar-online.ps1 o registar no PowerPoint do computador
function writeAddinManifest(base) { try { fs.writeFileSync(path.join(DATA_DIR, 'suplemento-powerpoint.xml'), addinManifest(base)); } catch (e) { console.error('Não consegui gravar o suplemento do PowerPoint:', e.message); } }
app.get('/api/addin-manifest', auth, (req, res) => {
  const base = (fixedTunnel && fixedTunnel.url) || '';
  if (!base) return res.status(409).json({ error: 'O suplemento precisa de um endereço fixo (https). Corre primeiro o configurar-dominio.bat.' });
  res.set('Content-Disposition', 'attachment; filename="suplemento-powerpoint.xml"').type('application/xml').send(addinManifest(base));
});
app.get('/', (req, res) => { const q = req.originalUrl.indexOf('?'); res.redirect('/play.html' + (q >= 0 ? req.originalUrl.slice(q) : '')); });
app.get('/formador', (req, res) => res.redirect('/host.html'));

// Só aceita a palavra-passe no cabeçalho (nunca no endereço, para não ficar no histórico)
function auth(req, res, next) {
  if (tokenOk(req.get('x-host-token'))) return next();
  pwCheck(originOf(req.ip, req.get('cf-connecting-ip')), req.get('x-host-password'), ok => ok ? next()
    : res.status(ok === null ? 429 : 401).json({ error: ok === null ? 'Demasiadas tentativas. Espera um pouco.' : 'Palavra-passe do formador inválida' }));
}

// Questionários de feedback anónimos (módulo à parte)
require('./feedback')(app, { auth, DATA_DIR });

app.post('/api/login', (req, res) => {
  pwCheck(originOf(req.ip, req.get('cf-connecting-ip')), req.body && req.body.password, ok =>
    ok === null ? res.status(429).json({ ok: false, error: 'Demasiadas tentativas. Espera um pouco.' }) : res.json(ok ? { ok, token: req.body.slide === true ? newSlideKey() : newHostToken() } : { ok }));
});

// Alunos
app.get('/api/students', auth, (req, res) => res.json(db.students));
function savePhoto(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
  const buf = Buffer.from(m[2], 'base64'), sig = buf.subarray(0, 12).toString('hex');
  if (!(sig.startsWith('ffd8ff') || sig.startsWith('89504e47') || (sig.startsWith('52494646') && sig.slice(16, 24) === '57454250'))) return null;
  const name = uid(12) + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return '/uploads/' + name;
}
app.post('/api/students', auth, bigJson, (req, res) => {
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
app.put('/api/students/:id', auth, bigJson, (req, res) => {
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
    anonymous: !!q.anonymous, // respostas anónimas: não se pede o nome nem se guarda quem respondeu
    questions: (q.questions || []).map(x => Q.cleanQuestion(x, uid, savePhoto)).filter(Boolean),
  };
}
app.get('/api/quizzes', auth, (req, res) => res.json(db.quizzes));
app.post('/api/quizzes', auth, bigJson, (req, res) => {
  if (!db.courses.length) return res.status(400).json({ error: 'Cria primeiro um curso' });
  const q = cleanQuiz(req.body);
  const i = db.quizzes.findIndex(x => x.id === q.id);
  if (i >= 0) db.quizzes[i] = q; else db.quizzes.push(q);
  saveDb(); res.json(q);
});
// Lista de soluções em Word (todas as perguntas com a resposta correta destacada)
const safe = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
app.get('/api/quizzes/:id/docx', auth, safe(async (req, res) => {
  const quiz = db.quizzes.find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).end();
  const course = (db.courses.find(c => c.id === quiz.courseId) || {}).name || '';
  const buf = await buildKeyDocx(quiz, course);
  const clean = t => String(t).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w\-]+/g, '_').slice(0, 60);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="Solucoes_${clean(quiz.title)}.docx"`);
  res.send(buf);
}));
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
      return { id: r.id, quizTitle: r.quizTitle, courseName: r.courseName || '', anonymous: !!r.anonymous, startedAt: r.startedAt, endedAt: r.endedAt, players: r.players.length, questions: r.questions.length };
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
function csvCell(v) { v = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
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
const okText = (q, a) => (!Q.isGraded(q) && Q.typeOf(q) !== 'open') ? '—' : a.correct === true ? 'Sim' : a.correct === false ? 'Não' : 'Por avaliar';

app.get('/api/results/:id/csv', auth, (req, res) => {
  const f = resultFile(path.basename(req.params.id));
  if (!fs.existsSync(f)) return res.status(404).end();
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const people = participants(r);
  const joined = new Set(r.players.map(p => p.studentId));
  const score = Object.fromEntries(r.players.map(p => [p.studentId, p.score]));
  let rows;
  if (req.query.type === 'grelha') {
    const gs = (r.settings || {}).gradeScale === 100 ? 100 : (r.settings || {}).gradeScale === 'q' ? 'q' : 20;
    rows = [['Curso', r.courseName || ''], ['Questionário', r.quizTitle], ['Data', new Date(r.startedAt).toLocaleString('pt-PT')], []];
    // jogos em grupo: coluna com a equipa e, no fim, a pontuação de cada equipa
    const teamName = Object.fromEntries((r.teams || []).map(t => [t.id, t.name]));
    const teamOf = Object.fromEntries(r.players.map(p => [p.studentId, p.team]));
    const tcol = r.teams ? [''] : [];
    rows.push(['Aluno', ...(r.teams ? ['Equipa'] : []), ...r.questions.map((q, i) => 'P' + (i + 1)), 'Certas', 'Perguntas avaliadas', '% acerto', gs === 100 ? 'Nota (%)' : gs === 'q' ? 'Nota (qualitativa)' : 'Nota (0-20)', 'Pontos']);
    rows.push(['RESPOSTA CORRETA', ...tcol, ...r.questions.map(q => Q.correctShort(q)), '', '', '', '', '']);
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
      rows.push([p.name, ...(r.teams ? [teamName[teamOf[p.id]] || ''] : []), ...cells, ok, n, n ? Math.round(ok / n * 100) + '%' : '', (g => g == null ? '' : gs === 'q' ? `${g} (${Q.finalGrade(r.questions, r.answers, r.asked, p.id, 100)}%)` : String(g).replace('.', ',') + (gs === 100 ? '%' : ''))(Q.finalGrade(r.questions, r.answers, r.asked, p.id, gs)), score[p.id] ?? 0]);
    }
    if (r.teams) { rows.push([]); rows.push(['EQUIPAS', 'Lugar', 'Membros', 'Pontos (média)']); r.teams.forEach((t, k) => rows.push(['Equipa ' + t.name, k + 1 + 'º', t.members.map(m => m.name).join(', '), t.score])); }
  } else {
    rows = [['Curso', 'Questionário', 'Nº', 'Pergunta', 'Opções', 'Resposta correta', 'Aluno', 'Resposta dada', 'Correta?', 'Tempo (s)', 'Pontos']];
    r.questions.forEach((q, i) => {
      const t = Q.typeOf(q);
      const opts = t === 'mc' || t === 'tf' ? q.options.map((o, k) => L(k) + ') ' + o).join(' | ') : t === 'fill' ? 'Palavras: ' + Q.wordBank(q).join(', ') : t === 'cloud' ? 'Nuvem de palavras' : t === 'number' ? `Número de ${q.min} a ${q.max}` : t === 'match' ? 'Ligar: ' + q.pairs.map(p => p.left).join(' | ') : t === 'spot' ? 'Encontrar na imagem' : t === 'scramble' ? 'Letras baralhadas' : t === 'guess' ? `Adivinha a palavra (${q.maxTries || 6} tentativas)` : t === 'hangman' ? `Jogo da forca (${q.maxWrong || 7} erros)` : t === 'cross' ? 'Palavras cruzadas: ' + q.cross.words.map(w => `${w.n}${w.dir === 'a' ? '→' : '↓'} ${w.clue}`).join(' | ') : t === 'rank' ? 'Ordenar: ' + q.options.join(' | ') : t === 'scale' ? `Escala 1–${q.scaleTo === 10 ? 10 : 5}` : 'Resposta livre';
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
app.get('/api/results/:id/docx', auth, safe(async (req, res) => {
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
}));

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
  if (r) {
    if (r.teams) r.teams = teamStats(p => p.score, null, r.players, r.settings.teams);
    fs.writeFileSync(f + '.tmp', JSON.stringify(r, null, 2)); fs.renameSync(f + '.tmp', f);
  } else { persistSession(); broadcast(); }
  res.json({ ok: true });
});

// QR code + endereço para os alunos
function lanIps() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}
app.get('/api/joininfo', auth, (req, res) => {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const suggestions = [];
  if (tunnelUrl) suggestions.push(tunnelUrl);
  if (base) suggestions.push(base);
  // aberto como "localhost": os telemóveis não chegam lá, por isso o endereço da rede Wi-Fi vem primeiro
  const here = `${req.protocol}://${req.get('host')}`, local = /^https?:\/\/(localhost|127\.)/.test(here);
  if (!local) suggestions.push(here);
  lanIps().forEach(ip => suggestions.push(`http://${ip}:${PORT}`));
  if (local) suggestions.push(here);
  res.json({ suggestions: [...new Set(suggestions)], tunnel: tunnelUrl || null, fixed: fixedTunnel ? fixedTunnel.url : null });
});
app.get('/api/qr', safe(async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\//.test(url) || url.length > 300) return res.status(400).end();
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
}));

// ---------- Socket.IO ----------
// verifica os prazos dos pedidos a cada 2 s (por omissão 30 s): pedidos pendurados de propósito saem depressa
const server = http.createServer({ connectionsCheckingInterval: 2000 }, app);
io = new Server(server, { maxHttpBufferSize: 1e6 });
// Ligações abertas por origem: uma turma atrás do mesmo router cabe folgada; um só atacante não esgota o servidor
const sockCount = new Map();
io.use((socket, next) => {
  const k = originOf(socket.handshake.address, socket.handshake.headers['cf-connecting-ip']), n = (sockCount.get(k) || 0) + 1;
  if (n > 250 || io.engine.clientsCount > 3000) return next(new Error('Demasiadas ligações'));
  sockCount.set(k, n);
  socket.on('disconnect', () => { const m = (sockCount.get(k) || 1) - 1; m ? sockCount.set(k, m) : sockCount.delete(k); });
  // mensagens por ligação: um telemóvel real manda poucas por segundo; inundações são ignoradas
  let ignored = 0;
  socket.use((packet, nextPacket) => {
    if (allow('ws:' + socket.id, 15, 40)) { ignored = 0; return nextPacket(); }
    const cb = packet[packet.length - 1]; if (typeof cb === 'function') cb({ error: 'Demasiados pedidos. Espera um pouco.' });
    if (++ignored > 300) socket.disconnect(true);
  });
  next();
});

io.on('connection', socket => {
  const role = socket.handshake.auth && socket.handshake.auth.role;
  const guard = fn => (...args) => {
    try { fn(...args); } catch (e) {
      console.error(e);
      const cb = args[args.length - 1]; if (typeof cb === 'function') cb({ error: 'Pedido inválido.' });
    }
  };

  const hostAuth = (pw, done) => tokenOk(socket.handshake.auth.token) ? done(true) : pwCheck(originOf(socket.handshake.address, socket.handshake.headers['cf-connecting-ip']), pw, done);
  if (role === 'host') return hostAuth(socket.handshake.auth.password, ok => {
    if (!ok) { socket.emit('auth_error'); socket.disconnect(); return; }
    socket.join('hosts');
    socket.emit('state', hostView());


    const doStart = ({ quizId, settings, studentIds }) => {
      if (session) persistSession();
      clearTimeout(timer); clearTimeout(autoTimer);
      const quiz = db.quizzes.find(q => q.id === quizId);
      if (!quiz || !quiz.questions.length) return socket.emit('toast', 'Questionário sem perguntas');
      let qs = JSON.parse(JSON.stringify(quiz.questions));
      if (settings && settings.mode === 'exam') qs = qs.filter(q => Q.typeOf(q) !== 'potato');
      if (!qs.length) return socket.emit('toast', 'Este questionário só tem jogos ao vivo (batata quente): não dá para "tempo total".');
      if (settings && settings.shuffle) for (let i = qs.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [qs[i], qs[j]] = [qs[j], qs[i]]; }
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
      // anónimo: nenhuma ligação à turma (sem nomes, fotos nem ranking)
      settings.anonymous = !!quiz.anonymous;
      settings.openJoin = settings.openJoin !== false;
      settings.phoneSound = settings.phoneSound !== false;
      settings.showGrade = !!settings.showGrade;
      settings.gradeScale = settings.gradeScale === 'q' ? 'q' : Number(settings.gradeScale) === 100 ? 100 : 20;   // 0 a 20 valores, 0 a 100 % ou qualitativa   // avaliação final: nota de 0 a 20 no telemóvel, no fim   // sons nos telemóveis dos formandos   // quem não está na lista pode entrar com o nome que escreve
      if (settings.anonymous) { settings.noRanking = true; settings.rankEach = false; settings.finalPodium = false; settings.showWho = false; }
      // jogos em grupo: 2 a 6 equipas (não há equipas no anónimo nem sem ranking)
      const nt = parseInt(settings.teams, 10);
      settings.teams = !settings.anonymous && !settings.noRanking && nt >= 2 && nt <= 6 ? nt : 0;
      const roster = settings.anonymous ? [] : db.students.filter(s => !studentIds || studentIds.includes(s.id)).map(s => ({ ...s }));
      assignShortNames(roster);
      session = {
        id: new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '_' + uid(4),
        code: newCode(), // código único da sessão (vai no QR code)
        quizId: quiz.id, quizTitle: quiz.title, courseId: quiz.courseId, courseName: (db.courses.find(c => c.id === quiz.courseId) || {}).name || '', startedAt: Date.now(),
        settings: { mode: 'manual', showWho: false, rankEach: true, finalPodium: true, speedPoints: true, ...settings },
        questions: qs, roster, phase: 'lobby', qIndex: -1, deadline: null,
        players: {}, answers: {}, asked: [], rejoinFails: 0,
      };
      persistSession();
      io.to('players').emit('reload');
      io.in('players').socketsJoin('lobby'); io.in('players').socketsLeave('players');
      broadcast();
    };
    socket.on('host:start', guard(doStart));

    // Diapositivo do PowerPoint a ser apresentado: { quizId, role: 'join' | 'question' | 'final', qid, mode, force }
    //  join → abre a sala deste quiz (se ainda não estiver aberta); question → começa essa pergunta; final → pódio
    socket.on('host:slide', guard((d, cb) => {
      if (typeof cb !== 'function') cb = () => {};
      const { quizId, role, qid, mode, force, manual, restart } = (d && typeof d === 'object') ? d : {};
      // travão: dois diapositivos diferentes a pedir perguntas em menos de 2,5 s não é o formador a avançar
      const key = role + ':' + (qid || ''), now = Date.now();
      if (!manual && role !== 'join' && lastSlide && lastSlide.key !== key && now - lastSlide.t < 2500) return cb({ ok: true, ignored: true });
      if (role !== 'join') lastSlide = { key, t: now };
      const quiz = db.quizzes.find(q => q.id === quizId);
      if (!quiz) return cb({ error: 'O questionário deste diapositivo já não existe.' });
      // outra sessão a decorrer (com respostas): não se estraga sem o formador confirmar
      const other = session && session.quizId !== quizId && session.phase !== 'end' && session.phase !== 'lobby';
      if (other && !force) return cb({ conflict: session.quizTitle });
      // quiz deste diapositivo já terminou: voltar atrás numa pergunta ou no pódio não abre outra sessão (só a entrada recomeça)
      if (session && session.quizId === quizId && session.phase === 'end' && role !== 'join') return cb({ ok: true });
      // "Recomeçar o quiz" no diapositivo de entrada: a sessão de um ensaio anterior fica guardada e abre-se outra
      const again = role === 'join' && restart && session && session.quizId === quizId && session.phase !== 'lobby';
      if (again) { session.endedAt = session.endedAt || Date.now(); persistSession(); }
      if (!session || session.quizId !== quizId || session.phase === 'end' || other || again) {
        if (role === 'final') return cb({ ok: true });
        doStart({ quizId, studentIds: [], settings: { mode: mode === 'timed' ? 'timed' : 'manual', openJoin: true, rankEach: true, finalPodium: true, showPoll: true, speedPoints: true, revealMode: 'each' } });
      }
      if (role === 'question') {
        const k = session.questions.findIndex(q => q.id === qid);
        if (k < 0) return cb({ error: 'Esta pergunta já não existe no questionário.' });
        // voltar a um diapositivo de uma pergunta já feita não a repete
        if (k === session.qIndex || session.asked.includes(k) || session.phase === 'exam') return cb({ ok: true });
        if (session.phase === 'question') closeQuestion();
        startQuestion(k);
      }
      if (role === 'final' && session.phase !== 'end') {
        if (session.phase === 'question') closeQuestion();
        clearTimeout(timer); clearTimeout(autoTimer);
        session.endedAt = Date.now(); setPhase('end');
      }
      cb({ ok: true });
    }));

    // batata quente: o formador aceita uma palavra que não estava na lista (boa, mas não prevista)
    socket.on('host:potatoAccept', guard(() => {
      const P = session && session.potato;
      if (!P || P.status !== 'running' || session.phase !== 'question' || !P.reject || P.reject.group !== P.holder || P.reject.reason === 'used') return;
      potatoAccept(P.reject.word, Q.norm(P.reject.word));
    }));
    // modo de perguntas: ninguém sabe → outra pergunta (a batata fica com o mesmo grupo)
    socket.on('host:potatoSkip', guard(() => {
      const P = session && session.potato;
      if (!P || P.status !== 'running' || session.phase !== 'question' || !potatoQs().length) return;
      if (!potatoNextQ(P)) { persistSession(); broadcast(); }
    }));

    socket.on('host:settings', guard(s => {
      if (!session) return;
      delete s.mode; delete s.autoTimes; // o modo e os tempos ficam fixos durante toda a sessão
      delete s.noRanking; delete s.revealMode; delete s.revealEnd; delete s.teams;
      if (session.settings.noRanking) { delete s.rankEach; delete s.finalPodium; }
      if (session.settings.revealMode !== 'each') delete s.rankEach;
      if ('showPoll' in s) s.showPoll = !!s.showPoll;
      if ('openJoin' in s) s.openJoin = !!s.openJoin;
      if ('miniQr' in s) s.miniQr = !!s.miniQr;
      if ('phoneSound' in s) s.phoneSound = !!s.phoneSound;
      Object.assign(session.settings, s);
      persistSession();
      if ('paused' in s || 'rankEach' in s) scheduleAuto();
      broadcast();
    }));

    socket.on('host:next', guard(seen => { if (session && (seen == null || seen === session.phase + ':' + session.qIndex)) advance(); }));

    // jogos em grupo: volta a distribuir toda a gente pelas equipas, ao acaso e equilibrado (só antes de começar)
    socket.on('host:shuffleTeams', guard(() => {
      if (!session || !session.settings.teams || session.phase !== 'lobby') return;
      const ps = Object.values(session.players);
      for (let i = ps.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [ps[i], ps[j]] = [ps[j], ps[i]]; }
      const off = crypto.randomInt(session.settings.teams);
      ps.forEach((p, k) => p.team = (k + off) % session.settings.teams);
      persistSession(); broadcast();
    }));
    // equipas a meio da sessão: formar N equipas (2 a 6, ao acaso e equilibradas), refazer com outro número ou desfazer (0 = individual)
    socket.on('host:teams', guard((n, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      if (!session || session.settings.anonymous) return reply({ error: 'Numa sessão anónima não há equipas.' });
      n = parseInt(n, 10) || 0; if (n !== 0 && (n < 2 || n > 6)) return reply({ error: 'Escolhe de 2 a 6 equipas.' });
      const q = session.questions[session.qIndex];
      if (q && q.type === 'potato' && session.phase === 'question') return reply({ error: 'Espera que a batata quente acabe para mudar as equipas.' });
      session.settings.teams = n;
      // quem está ligado primeiro, para as equipas ficarem equilibradas com quem está mesmo na sala
      const ps = Object.values(session.players);
      for (let i = ps.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [ps[i], ps[j]] = [ps[j], ps[i]]; }
      ps.sort((a, b) => (b.socketId ? 1 : 0) - (a.socketId ? 1 : 0));
      const off = n ? crypto.randomInt(n) : 0;
      ps.forEach((p, k) => p.team = n ? (k + off) % n : null);
      persistSession(); broadcast(); reply({ ok: true });
    }));
    // mudar uma pessoa de equipa (toque no cartão, na sala de espera)
    socket.on('host:moveTeam', guard((studentId) => {
      if (!session || !session.settings.teams || session.phase !== 'lobby') return;
      const p = session.players[String(studentId)]; if (!p) return;
      p.team = ((p.team ?? -1) + 1) % session.settings.teams;
      persistSession(); broadcast();
    }));
    socket.on('host:extend', guard(min => {
      if (!session || session.phase !== 'exam') return;
      const add = Math.max(1, Math.min(30, parseInt(min, 10) || 1)) * 60000;
      session.deadline += add; session.settings.examMinutes += add / 60000;
      clearTimeout(timer); timer = setTimeout(endExam, session.deadline - Date.now() + 300);
      persistSession(); broadcast();
    }));
    socket.on('host:end', guard(() => {
      if (!session) return;
      clearTimeout(timer); clearTimeout(autoTimer); session.autoAt = null;
      if (session.phase === 'question') finalizeGuesses(session.qIndex);
      if (session.phase === 'ready') session.asked = session.asked.filter(i => i !== session.qIndex);
      if (session.phase === 'exam') { session.questions.forEach((_, i) => finalizeGuesses(i)); Object.values(session.players).forEach(examRecompute); }
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
      if (session.settings.anonymous) return cb({ error: 'Questionário anónimo: não há lista de formandos.' });
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
      p.rejoin = String(crypto.randomInt(100000, 1000000));
      cb({ rejoin: p.rejoin });
      broadcast();
    }));
  });

  // ----- aluno -----
  // todas as mensagens dos alunos passam pelo guard: um pedido forjado devolve erro em vez de parar o servidor
  const on = socket.on.bind(socket); socket.on = (ev, fn) => on(ev, guard(fn));
  socket.data.code = cleanCode(socket.handshake.auth && socket.handshake.auth.code);
  socket.join('lobby');
  socket.emit('roster', rosterForPlayers(socket));
  let me = null;

  // liga este dispositivo a um participante (novo token: só este telemóvel o pode usar)
  function attach(p, cb, back) {
    p.token = uid(16);
    p.rejoin = null;
    if (p.socketId && p.socketId !== socket.id) { const old = io.sockets.sockets.get(p.socketId); if (old) old.emit('released', back ? 'moved' : ''); }
    p.socketId = socket.id;
    session.players[p.studentId] = p;
    me = p;
    socket.leave('lobby'); socket.join('players');
    persistSession();
    cb({ ok: true, token: p.token, sessionId: session.id, studentId: p.studentId, name: p.name, back: !!back });
    broadcast();
  }
  // Voltar ao próprio lugar (fechou o browser, mudou de app, abriu o QR noutra aplicação): se o telemóvel antigo
  // estiver desligado ou não responder em 2,5 s, quem escreve o nome volta ao lugar, com os pontos e as respostas.
  // Se o antigo ainda responder, é outra pessoa (ou o mesmo nome noutro telemóvel ativo): fica a mensagem.
  function reclaim(p, msg) {
    const old = p.socketId && io.sockets.sockets.get(p.socketId);
    if (!old) return attach(p, cb0(), true);
    old.timeout(2500).emit('alive', err => { if (err) attach(p, cb0(), true); else cb0()({ taken: true, error: msg }); });
  }
  let pendingCb = null; const cb0 = () => pendingCb || (() => {});
  const newPlayer = st => ({ studentId: st.id, name: st.name, short: st.short || st.name, photo: st.photo || null, score: 0, joinedAt: Date.now(),
    team: session.settings.teams ? smallestTeam() : null });

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
    pendingCb = cb;
    const { name } = (data && typeof data === 'object') ? data : {};
    if (!codeOk(socket.data.code)) return cb({ error: 'Código da sessão inválido ou sessão terminada. Lê de novo o QR code.' });
    if (me && session.players[me.studentId] === me) return cb({ error: 'Já entraste neste dispositivo.' });
    if (Object.keys(session.players).length >= 500) return cb({ error: 'A sessão está cheia.' });
    if (session.settings.anonymous) {
      // cada dispositivo é um participante anónimo com um código aleatório (não fica registado quem é)
      let code; do { code = Array.from(crypto.randomBytes(3), b => CODE_ABC[b % CODE_ABC.length]).join(''); } while (session.roster.some(r => r.name.endsWith('#' + code)));
      const st = { id: 'a' + uid(8), name: 'Anónimo #' + code, short: '#' + code, photo: null, anon: true };
      session.roster.push(st);
      return attach(newPlayer(st), cb);
    }
    if (typeof name !== 'string' || !name.trim() || name.length > 80) return cb({ error: 'Escreve o teu nome completo.' });
    const T = norm(name).split(' ').filter(Boolean);
    if (!T.length) return cb({ error: 'Escreve o teu nome completo.' });
    // os convidados (entraram sem estar na lista) só se comparam pelo nome exato, mais abaixo
    // com a entrada aberta, um apelido escrito que não existe no nome do aluno quer dizer que é outra pessoa
    // ("Ana Martins" não é a "Ana Costa" registada, mesmo sendo a única Ana)
    const open = session.settings.openJoin !== false;
    const same = st => matchesStudent(st, T) && (!open || T.length < 2 || norm(st.name).split(' ').includes(T[T.length - 1]));
    let found = session.roster.filter(st => !st.guest && same(st));
    if (found.length === 0 && session.settings.openJoin !== false) {   // sessões retomadas de versões antigas não têm a opção: conta como ligada
      // aluno registado que não foi escolhido para esta sessão: entra com a ficha dele (e a fotografia)
      const others = db.students.filter(s => !session.roster.some(r => r.id === s.id)).map(s => ({ ...s }));
      assignShortNames(others);
      const fromDb = others.filter(same);
      if (fromDb.length === 1) {
        session.roster.push(fromDb[0]);
        assignShortNames(session.roster.filter(r => !r.guest && !r.anon));
        return attach(newPlayer(fromDb[0]), cb);
      }
      // não está registado: entra como convidado com o nome que escreveu
      const typed = T.join(' '), dup = session.roster.find(r => r.guest && norm(r.name) === typed);
      if (dup && session.players[dup.id]) return reclaim(session.players[dup.id], `Já entrou alguém com o nome "${dup.name}". Se não és tu, escreve também o apelido. Se és tu, fecha a app no outro telemóvel (ou pede ao formador o código de reentrada).`);
      let clean = name.trim().replace(/\s+/g, ' ').slice(0, 60);
      if (clean === clean.toLowerCase()) clean = clean.replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
      const w = clean.split(' ');
      const st = { id: 'g' + uid(8), name: clean, short: w.length > 2 ? w[0] + ' ' + w[w.length - 1] : clean, photo: null, guest: true };
      session.roster.push(st);
      return attach(newPlayer(st), cb);
    }
    if (found.length === 0) return cb({ notFound: true });
    // vários servem (ex.: "Rui" e "Rui Santos" na turma e escreveu "Rui Santos"): fica o mais específico,
    // ou seja, o que usa mais palavras do nome escrito; o nome exatamente igual ganha sempre
    if (found.length > 1) {
      const typed = T.join(' ');
      const score = st => (norm(st.name) === typed ? 100 : 0) + (st.key || [0]).length;
      const best = Math.max(...found.map(score));
      found = found.filter(st => score(st) === best);
    }
    if (found.length > 1) return cb({ error: 'Há mais do que uma pessoa com esse nome. Escreve o teu nome completo (nome e apelidos).' });
    const st = found[0];
    if (session.players[st.id]) {
      // já entrou alguém com este nome: pode ser outra pessoa com o mesmo primeiro nome
      const homonyms = session.roster.some(o => o !== st && norm(o.name).split(' ')[0] === T[0]);
      const ambiguous = homonyms && T.join(' ') !== norm(st.name);
      const msg = T.length === 1 || ambiguous
        ? `Já entrou um "${st.short}". Se não és tu, escreve mais alguma coisa do teu nome (por exemplo, o apelido). Se és tu, fecha a app no outro telemóvel ou pede ao formador o código de reentrada.`
        : `${st.short} já está ligado noutro dispositivo. Se és tu, fecha a app no outro telemóvel (ou pede ao formador o código de reentrada).`;
      return ambiguous ? cb({ taken: true, error: msg }) : reclaim(session.players[st.id], msg);
    }
    attach(newPlayer(st), cb);
  });

  // Mudou de telemóvel: o formador liberta o nome e dá-lhe um código de reentrada
  socket.on('player:rejoin', (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const rejoin = String((data && data.rejoin) || '').replace(/\D/g, '');
    if (!codeOk(socket.data.code)) return cb({ error: 'Código da sessão inválido ou sessão terminada.' });
    const p = rejoin.length === 6 && Object.values(session.players).find(x => !x.token && x.rejoin === rejoin);
    if (!p) {
      // tentativas a mais na sessão = alguém a adivinhar: anula os códigos pendentes (o formador dá outros)
      if (++session.rejoinFails >= 30) { Object.values(session.players).forEach(x => { x.rejoin = null; }); session.rejoinFails = 0; io.to('hosts').emit('toast', 'Muitas tentativas erradas de reentrada: os códigos foram anulados. Gera um novo para quem precisar.'); }
      return setTimeout(() => cb({ error: 'Código de reentrada inválido. Pede-o ao formador.' }), FAIL_DELAY_MS);
    }
    attach(p, cb);
  });

  // "Não sou eu" (só antes de responder a alguma pergunta): desfaz a entrada por completo
  // Fotografia tirada pelo próprio formando (opcional): só é usada nesta sessão
  socket.on('player:photo', (dataUrl, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!session || !me || me.socketId !== socket.id) return cb({ error: 'Pedido inválido.' });
    if (session.settings.anonymous) return cb({ error: 'Este questionário é anónimo.' });
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

  // adivinha a palavra: cada tentativa é avaliada aqui (a palavra nunca sai do servidor)
  socket.on('player:guess', (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!session || !me || me.socketId !== socket.id || session.players[me.studentId] !== me) return cb({ error: 'Não identificado' });
    const exam = session.phase === 'exam';
    const i = exam ? parseInt(data && data.q, 10) : session.qIndex, q = session.questions[i];
    if (!q || Q.typeOf(q) !== 'guess') return cb({ error: 'Pedido inválido.' });
    if (exam ? (Date.now() > session.deadline || (session.submitted || {})[me.studentId]) : session.phase !== 'question') return cb({ error: 'Tempo esgotado' });
    const ans = answersFor(i);
    if (ans[me.studentId]) return cb({ error: 'Já terminaste esta palavra.' });
    const secret = Q.cwNorm(q.answer), word = Q.cwNorm(data && data.word);
    if (word.length !== secret.length) return cb({ error: `A palavra tem ${secret.length} letras.` });
    const tries = ((session.guesses ||= {})[i] ||= {})[me.studentId] ||= [];
    if (tries.length >= (q.maxTries || 6)) return cb({ error: 'Já não tens tentativas.' });
    const colors = Q.guessColors(secret, word), solved = word === secret;
    const ms = exam ? Date.now() - session.examStart : Date.now() - session.questionStartedAt;
    tries.push({ word, colors, ms });
    let points = 0;
    if (solved || tries.length >= (q.maxTries || 6)) {
      const entry = { value: tries.map(t => t.word), colors: tries.map(t => t.colors), tries: tries.length, correct: solved, frac: solved ? Q.guessFrac(q, tries.length) : 0 };
      points = pointsFor(q, entry, exam ? 0 : ms, exam ? false : session.settings.speedPoints);
      ans[me.studentId] = { ...entry, timeMs: ms, points, at: Date.now() };
      if (exam) examRecompute(me); else me.score += points;
    }
    persistSession();
    cb({ ok: true, colors, solved, done: !!ans[me.studentId] });
    if (!exam && timedMode() && allAnswered()) closeQuestion(); else notifyAnswer(me);
  });

  socket.on('player:hangman', (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!session || !me || me.socketId !== socket.id || session.players[me.studentId] !== me) return cb({ error: 'Não identificado' });
    const exam = session.phase === 'exam';
    const i = exam ? parseInt(data && data.q, 10) : session.qIndex, q = session.questions[i];
    if (!q || Q.typeOf(q) !== 'hangman') return cb({ error: 'Pedido inválido.' });
    if (exam ? (Date.now() > session.deadline || (session.submitted || {})[me.studentId]) : session.phase !== 'question') return cb({ error: 'Tempo esgotado' });
    const ans = answersFor(i);
    if (ans[me.studentId]) return cb({ error: 'Já terminaste esta palavra.' });
    const L = Q.cwNorm(data && data.letter);
    if (L.length !== 1) return cb({ error: 'Escolhe uma letra.' });
    const st = ((session.hangs ||= {})[i] ||= {})[me.studentId] ||= { letters: [], wrong: 0 };
    if (st.letters.includes(L)) return cb({ error: 'Já escolheste essa letra.' });
    const secret = Q.cwNorm(q.answer), hit = secret.includes(L);
    st.letters.push(L); if (!hit) st.wrong++;
    st.ms = exam ? Date.now() - session.examStart : Date.now() - session.questionStartedAt;
    const mask = Q.hangMask(q, st.letters), solved = !mask.includes('_'), lost = st.wrong >= (q.maxWrong || 7);
    let points = 0;
    if (solved || lost) {
      const entry = { value: st.letters.slice(), wrong: st.wrong, correct: solved, frac: solved ? Q.hangFrac(q, st.wrong) : 0 };
      points = pointsFor(q, entry, exam ? 0 : st.ms, exam ? false : session.settings.speedPoints);
      ans[me.studentId] = { ...entry, timeMs: st.ms, points, at: Date.now() };
      if (exam) examRecompute(me); else me.score += points;
    }
    persistSession();
    cb({ ok: true, hit, mask, wrong: st.wrong, letters: st.letters, solved, done: solved || lost, answer: lost ? String(q.answer) : undefined });
    if (!exam && timedMode() && allAnswered()) closeQuestion(); else notifyAnswer(me);
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
    persistSession(); cb({ ok: true }); notifyAnswer(me);
  });
  socket.on('player:submit', (cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!session || !me || me.socketId !== socket.id || session.phase !== 'exam') return cb({ error: 'Pedido inválido.' });
    (session.submitted ||= {})[me.studentId] = Date.now();
    persistSession(); cb({ ok: true });
    // todos os formandos entregaram: termina
    if (Object.values(session.players).every(p => session.submitted[p.studentId])) return endExam();
    broadcast();
  });

  socket.on('player:potato', (word, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const P = session && session.potato, q = session && currentQ();
    if (!P || session.phase !== 'question' || !q || Q.typeOf(q) !== 'potato' || P.qIndex !== session.qIndex) return cb({ error: 'Agora não dá.' });
    if (P.status !== 'running') return cb({ error: 'Espera pela próxima ronda.' });
    if (!me || me.socketId !== socket.id || P.rep !== me.studentId) return cb({ error: 'Não é a tua vez.' });
    const w = String(typeof word === 'string' ? word : '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!w) return cb({ error: 'Escreve uma palavra.' });
    const r = Q.potatoCheck(q, P.round, w, (q.rounds[P.round] || {}).questions ? [P.qi] : P.used);
    if (!r.ok) { P.reject = { word: w, group: P.holder, reason: r.reason }; broadcast(); return cb({ ok: false, reason: r.reason }); }
    cb({ ok: true, pts: potatoAccept(w, r.key) });
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
    if (timedMode() && allAnswered()) closeQuestion(); else notifyAnswer(me);
  });

  socket.on('disconnect', () => {
    if (me && me.socketId === socket.id) { me.socketId = null; broadcast(); }
  });
});

// O servidor reiniciou a meio de uma sessão (fechou-se a janela, o portátil adormeceu)? Retoma a última que não
// terminou; os telemóveis voltam a entrar sozinhos com o token que guardaram. Uma pergunta aberta fica fechada.
try {
  const files = fs.readdirSync(RESULTS).filter(n => n.endsWith('.json')).map(n => path.join(RESULTS, n));
  const f = files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const r = f && Date.now() - fs.statSync(f).mtimeMs < 12 * 3600e3 && JSON.parse(fs.readFileSync(f, 'utf8'));
  if (r && !r.endedAt && r.code && r.phase) {
    session = { ...r, rejoinFails: 0, autoAt: null, players: Object.fromEntries(r.players.map(p => [p.studentId, { ...p, socketId: null }])) };
    if (session.phase === 'ready' || session.phase === 'question') { finalizeGuesses(session.qIndex); session.phase = 'closed'; session.deadline = null; }
    if (session.phase === 'exam') timer = setTimeout(endExam, Math.max(0, session.deadline - Date.now()) + 300);
    scheduleAuto();
    console.log(`↺ Sessão ${session.code} retomada (${session.quizTitle}) — os formandos voltam a entrar sozinhos.`);
  }
} catch (e) { console.error('Não foi possível retomar a sessão anterior:', e.message); }

// npm run online: liga também o túnel da Cloudflare e põe o endereço dele no QR code (sem copiar nada à mão)
let tunnelUrl = '';
// endereço fixo no domínio do formador (configurar-dominio.ps1): { "tunnel": "nome", "url": "https://quiz.dominio.pt" }
const ONLINE_FILE = path.join(DATA_DIR, 'online.json');
const fixedTunnel = (() => { try { const c = JSON.parse(fs.readFileSync(ONLINE_FILE, 'utf8').replace(/^\uFEFF/, '')); // o túnel pode ter sido criado pelo script (nome) ou no painel da Cloudflare (token)
  const okTunnel = /^[\w-]{1,64}$/.test(c.tunnel || '') || /^[\w+/=.-]{50,4000}$/.test(c.token || '');
  return okTunnel && /^https:\/\/[a-z0-9.-]+$/i.test(c.url) ? c : null; } catch { return null; } })();
if (process.argv.includes('--online')) {
  // o iniciar-online.ps1 pode ter descarregado o cloudflared para a pasta ferramentas/
  const localCf = path.join(__dirname, 'ferramentas', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  // com token (túnel criado no painel) o endereço e a porta vêm do painel; o token vai por variável de ambiente
  const args = !fixedTunnel ? ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`]
    : fixedTunnel.token ? ['tunnel', '--no-autoupdate', 'run'] : ['tunnel', '--no-autoupdate', 'run', '--url', `http://localhost:${PORT}`, fixedTunnel.tunnel];
  const env = fixedTunnel && fixedTunnel.token ? { ...process.env, TUNNEL_TOKEN: fixedTunnel.token } : process.env;
  const cf = require('child_process').spawn(fs.existsSync(localCf) ? localCf : 'cloudflared', args, { windowsHide: true, env });
  if (fixedTunnel) writeAddinManifest(fixedTunnel.url);
  const look = d => {
    // túnel fixo: fica pronto quando a primeira ligação à Cloudflare é registada
    const m = fixedTunnel ? (/Registered tunnel connection/i.test(String(d)) ? [fixedTunnel.url] : null) : /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
    if (!m || tunnelUrl) return;
    tunnelUrl = m[0];
    console.log(`\n  🌍 Online: ${tunnelUrl}   (já está no QR code)\n`);
    io.to('hosts').emit('tunnel', tunnelUrl);
  };
  cf.stdout.on('data', look); cf.stderr.on('data', look);
  cf.on('error', () => console.error('\n✗ Não encontrei o cloudflared. Abre o iniciar-online.bat (descarrega-o sozinho)\n  ou instala-o com:  winget install --id Cloudflare.cloudflared A app continua a funcionar na rede local.\n'));
  cf.on('exit', () => { if (tunnelUrl) console.error('✗ O túnel da Cloudflare fechou. Volta a arrancar para ter um endereço novo.'); else if (fixedTunnel) console.error(`✗ O túnel ${fixedTunnel.token ? 'do painel da Cloudflare' : '"' + fixedTunnel.tunnel + '"'} não arrancou. Confirma-o no painel ou corre de novo o configurar-dominio.bat.`); tunnelUrl = ''; });
  const stop = () => { cf.kill(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', () => cf.kill());
}
server.headersTimeout = 15000; server.requestTimeout = 120000;
// porta ocupada (normalmente o quiz já está aberto noutra janela): mensagem clara em vez do erro técnico
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\n✗ A porta ${PORT} já está ocupada — o quiz já deve estar a correr noutra janela.\n  Fecha essa janela (ou o outro programa) e volta a tentar.\n`);
  else console.error('\n✗ Não consegui arrancar o servidor:', e.message, '\n');
  process.exit(1);
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
