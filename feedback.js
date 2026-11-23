// Questionários de feedback anónimos (inquérito de satisfação)
// Separado dos quizzes: sem tempo, sem jogo, sem nomes. Cada formando abre o link/QR,
// responde ao seu ritmo e envia uma vez. Não se guarda nome, IP, dispositivo nem hora.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = ['scale', 'tf', 'choice', 'multi', 'open'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I

module.exports = function feedback(app, { auth, DATA_DIR }) {
  const FILE = path.join(DATA_DIR, 'feedback.json');
  const RESP = path.join(DATA_DIR, 'feedback');
  fs.mkdirSync(RESP, { recursive: true });
  const uid = (n = 8) => crypto.randomBytes(n).toString('hex').slice(0, n);
  let store = { forms: [] };
  try { if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.error('feedback.json inválido', e); }
  store.forms ||= [];
  const save = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(store, null, 2)); fs.renameSync(FILE + '.tmp', FILE); };
  const respFile = id => path.join(RESP, id.replace(/[^\w]/g, '') + '.json');
  const answersOf = id => { try { return JSON.parse(fs.readFileSync(respFile(id), 'utf8')); } catch { return []; } };
  const saveAnswers = (id, list) => { const f = respFile(id); fs.writeFileSync(f + '.tmp', JSON.stringify(list)); fs.renameSync(f + '.tmp', f); };
  const newCode = () => { let c; do { c = Array.from(crypto.randomBytes(5), b => CODE_CHARS[b % CODE_CHARS.length]).join(''); } while (store.forms.some(f => f.code === c)); return c; };
  const str = (v, max) => String(v ?? '').trim().slice(0, max);

  function cleanQuestion(x) {
    const type = TYPES.includes(x.type) ? x.type : 'scale';
    const q = { id: str(x.id, 20) || uid(), type, text: str(x.text, 500), required: x.required !== false };
    if (!q.text) return null;
    if (type === 'scale') { q.scaleMin = str(x.scaleMin, 40); q.scaleMax = str(x.scaleMax, 40); }
    if (type === 'choice' || type === 'multi') {
      q.options = (Array.isArray(x.options) ? x.options : []).map(o => str(o, 200)).filter(Boolean).slice(0, 12);
      if (q.options.length < 2) return null;
    }
    return q;
  }
  function cleanForm(f, old) {
    return {
      id: old ? old.id : uid(), code: old ? old.code : newCode(),
      title: str(f.title, 150) || 'Feedback da formação', intro: str(f.intro, 1000), course: str(f.course, 150),
      questions: (Array.isArray(f.questions) ? f.questions : []).slice(0, 60).map(cleanQuestion).filter(Boolean),
      open: old ? old.open : false, createdAt: old ? old.createdAt : new Date().toISOString().slice(0, 10),
    };
  }
  const summary = f => ({ ...f, responses: answersOf(f.id).length });
  const publicForm = f => ({ title: f.title, intro: f.intro, course: f.course, questions: f.questions });

  // ---------- Formador ----------
  app.get('/api/feedback', auth, (req, res) => res.json(store.forms.map(summary)));
  app.post('/api/feedback', auth, (req, res) => {
    const old = req.body.id && store.forms.find(f => f.id === req.body.id);
    if (old && answersOf(old.id).length && JSON.stringify(old.questions.map(q => [q.id, q.type])) !== JSON.stringify((req.body.questions || []).map(q => [q.id, q.type])))
      return res.status(409).json({ error: 'Este questionário já tem respostas: só podes mudar textos. Para mudar perguntas, duplica-o.' });
    const f = cleanForm(req.body || {}, old);
    if (!f.questions.length) return res.status(400).json({ error: 'Acrescenta pelo menos uma pergunta.' });
    if (old) store.forms[store.forms.indexOf(old)] = f; else store.forms.unshift(f);
    save(); res.json(summary(f));
  });
  app.post('/api/feedback/:id/open', auth, (req, res) => {
    const f = store.forms.find(f => f.id === req.params.id); if (!f) return res.status(404).end();
    f.open = !!req.body.open; save(); res.json(summary(f));
  });
  app.delete('/api/feedback/:id', auth, (req, res) => {
    store.forms = store.forms.filter(f => f.id !== req.params.id); save();
    try { fs.unlinkSync(respFile(req.params.id)); } catch {}
    res.json({ ok: true });
  });
  // respostas baralhadas: a ordem de chegada não serve para adivinhar quem respondeu
  const shuffled = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  app.get('/api/feedback/:id/results', auth, (req, res) => {
    const f = store.forms.find(f => f.id === req.params.id); if (!f) return res.status(404).end();
    res.json({ form: summary(f), answers: shuffled(answersOf(f.id)) });
  });
  app.get('/api/feedback/:id/csv', auth, (req, res) => {
    const f = store.forms.find(f => f.id === req.params.id); if (!f) return res.status(404).end();
    const cell = v => { let s = Array.isArray(v) ? v.join('; ') : v === true ? 'Verdadeiro' : v === false ? 'Falso' : String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const rows = [['Resposta', ...f.questions.map((q, i) => `${i + 1}. ${q.text}`)].map(cell).join(';')];
    shuffled(answersOf(f.id)).forEach((a, i) => rows.push([cell(i + 1), ...f.questions.map(q => cell(a[q.id]))].join(';')));
    const name = f.title.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w\-]+/g, '_').slice(0, 60);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Feedback_${name}.csv"`);
    res.send('﻿' + rows.join('\r\n'));
  });

  // ---------- Formandos (público) ----------
  const byCode = c => store.forms.find(f => f.code === String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  app.get('/f/:code', (req, res) => res.redirect('/feedback.html?c=' + encodeURIComponent(req.params.code)));
  app.get('/api/f/:code', (req, res) => {
    const f = byCode(req.params.code);
    if (!f) return res.status(404).json({ error: 'Não existe nenhum questionário com este código.' });
    if (!f.open) return res.status(423).json({ error: 'Este questionário está fechado. Pede ao formador para o abrir.', title: f.title });
    res.json(publicForm(f));
  });
  // limite simples contra envios repetidos em massa (não guarda nada)
  const hits = new Map();
  setInterval(() => hits.clear(), 10 * 60 * 1000).unref();
  app.post('/api/f/:code', (req, res) => {
    const ip = req.get('cf-connecting-ip') || req.ip;
    const n = (hits.get(ip) || 0) + 1; hits.set(ip, n);
    if (n > 300) return res.status(429).json({ error: 'Demasiados envios. Tenta daqui a alguns minutos.' });
    const f = byCode(req.params.code);
    if (!f) return res.status(404).json({ error: 'Questionário não encontrado.' });
    if (!f.open) return res.status(423).json({ error: 'Este questionário já foi fechado pelo formador.' });
    const body = (req.body && req.body.answers) || {}, out = {};
    for (const q of f.questions) {
      let v = body[q.id];
      if (q.type === 'scale') v = [1, 2, 3, 4, 5].includes(Number(v)) ? Number(v) : null;
      else if (q.type === 'tf') v = v === true || v === false ? v : null;
      else if (q.type === 'choice') v = q.options.includes(v) ? v : null;
      else if (q.type === 'multi') { v = Array.isArray(v) ? [...new Set(v)].filter(o => q.options.includes(o)) : []; if (!v.length) v = null; }
      else if (q.type === 'open') v = str(v, 2000) || null;
      if (v == null && q.required) return res.status(400).json({ error: `Falta responder: "${q.text}"`, missing: q.id });
      if (v != null) out[q.id] = v;
    }
    const list = answersOf(f.id); list.push(out); saveAnswers(f.id, list);
    res.json({ ok: true });
  });
};
