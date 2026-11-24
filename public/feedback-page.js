const CODE = (new URLSearchParams(location.search).get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const app = $('#app');
const logo = '<div class="logo">💬 <span>Feedback</span></div>';
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };
const DRAFT = 'fb_draft_' + CODE, DONE = 'fb_done_' + CODE;
let form = null, answers = store.get(DRAFT) || {};

function codeScreen(msg) {
  app.innerHTML = logo + `<form class="middle" id="cf" autocomplete="off"><div class="big-emoji">🔑</div><h1>Código do questionário</h1>
    <p>${msg}</p><input class="code-in" id="cd" maxlength="8" placeholder="ABCDE" autocapitalize="characters" required>
    <button class="btn primary send">Continuar</button></form>`;
  $('#cf').onsubmit = e => { e.preventDefault(); const c = $('#cd').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c) location.search = '?c=' + c; };
}
function msgScreen(emoji, title, text, extra = '') {
  app.innerHTML = logo + `<div class="middle"><div class="big-emoji pop-in">${emoji}</div><h1>${title}</h1><p>${text}</p>${extra}</div>`;
}

async function load() {
  if (!CODE) return codeScreen('Lê o QR code que o formador mostrou ou escreve o código.');
  let r;
  try { r = await fetch('/api/f/' + CODE); } catch { return msgScreen('📡', 'Sem ligação', 'Verifica a ligação à internet e tenta de novo.', '<button class="btn primary js-retry">Tentar de novo</button>'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) return codeScreen(`O código <b>${esc(CODE)}</b> não existe. Confirma com o formador.`);
  if (r.status === 423) return msgScreen('🔒', esc(j.title || 'Questionário fechado'), 'Este questionário não está aberto neste momento. Pede ao formador para o abrir e volta a carregar a página.', '<button class="btn primary js-retry">Tentar de novo</button>');
  if (!r.ok) return msgScreen('😕', 'Erro', esc(j.error || 'Tenta de novo.'));
  form = j;
  if (store.get(DONE)) return doneScreen(true);
  render();
}

const isAnswered = (q, v = answers[q.id]) => v != null && v !== '' && !(Array.isArray(v) && !v.length);
function widget(q) {
  const v = answers[q.id];
  if (q.type === 'scale') return `<div class="scale">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-v="${n}" class="${v === n ? 'sel' : ''}" aria-label="${n} de 5">${n}</button>`).join('')}</div>
    <div class="scale-l"><span>1${q.scaleMin ? ' = ' + esc(q.scaleMin) : ''}</span><span>5${q.scaleMax ? ' = ' + esc(q.scaleMax) : ''}</span></div>`;
  if (q.type === 'tf') return `<div class="opts two">${[[true, 'Verdadeiro'], [false, 'Falso']].map(([b, t]) => `<button type="button" data-v="${b}" class="${v === b ? 'sel' : ''}">${t}</button>`).join('')}</div>`;
  if (q.type === 'choice' || q.type === 'multi') {
    const sel = o => q.type === 'multi' ? (v || []).includes(o) : v === o;
    return `<div class="opts ${q.type === 'multi' ? 'multi' : ''}">${q.options.map((o, i) => `<button type="button" data-i="${i}" class="${sel(o) ? 'sel' : ''}"><span class="box">${sel(o) ? '✓' : ''}</span>${esc(o)}</button>`).join('')}</div>`;
  }
  return `<textarea data-open maxlength="2000" placeholder="Escreve aqui o que pensas…">${esc(v || '')}</textarea><div class="count"><span data-count>${(v || '').length}</span>/2000</div>`;
}
function hint(q) {
  if (q.type === 'multi') return 'Podes escolher várias opções.';
  if (q.type === 'open') return q.required ? '' : 'Opcional.';
  return q.required ? '' : 'Opcional.';
}
function render() {
  app.innerHTML = logo + `<h1>${esc(form.title)}</h1>${form.course ? `<div class="muted" style="color:#ddd">🎓 ${esc(form.course)}</div>` : ''}
    <div class="anon"><span style="font-size:1.4em">🕶️</span><span><b>Completamente anónimo.</b> Não se pede o teu nome e as respostas não ficam associadas a ti nem a este telemóvel. Sê sincero(a) — é isso que ajuda a melhorar a formação.</span></div>
    ${form.intro ? `<div class="intro">${esc(form.intro)}</div>` : ''}
    <div class="progress"><span id="pc"></span><div class="bar"><i id="pb"></i></div></div>
    <form id="fb" autocomplete="off">${form.questions.map((q, i) => `<div class="q" id="q-${q.id}" data-q="${i}">
      <div class="q-t"><span class="n">${i + 1}.</span>${esc(q.text)}${q.required ? ' <span class="req" title="Obrigatória">*</span>' : ''}</div>
      ${hint(q) ? `<p class="q-hint">${hint(q)}</p>` : ''}<div class="w">${widget(q)}</div></div>`).join('')}
      <p class="center" style="opacity:.8;font-size:.9em">* resposta obrigatória</p>
      <button class="btn primary send" id="send">📨 Enviar respostas</button></form>`;
  form.questions.forEach((q, i) => bindQ(q, $(`[data-q="${i}"]`)));
  $('#fb').onsubmit = e => { e.preventDefault(); submit(); };
  progress();
}
function setAnswer(q, v) {
  if (isAnswered(q, v)) answers[q.id] = v; else delete answers[q.id];
  store.set(DRAFT, answers); progress();
  const box = $('#q-' + q.id); if (box && isAnswered(q, v)) box.classList.remove('missing');
}
function bindQ(q, box) {
  const w = $('.w', box);
  const redraw = () => { w.innerHTML = widget(q); bindQ(q, box); };
  if (q.type === 'scale' || q.type === 'tf') $$('button', w).forEach(b => b.onclick = () => {
    const v = q.type === 'scale' ? +b.dataset.v : b.dataset.v === 'true';
    setAnswer(q, answers[q.id] === v && !q.required ? null : v); redraw();
  });
  if (q.type === 'choice') $$('button', w).forEach(b => b.onclick = () => { const o = q.options[+b.dataset.i]; setAnswer(q, answers[q.id] === o && !q.required ? null : o); redraw(); });
  if (q.type === 'multi') $$('button', w).forEach(b => b.onclick = () => {
    const o = q.options[+b.dataset.i], cur = answers[q.id] || [];
    setAnswer(q, cur.includes(o) ? cur.filter(x => x !== o) : [...cur, o]); redraw();
  });
  if (q.type === 'open') { const ta = $('textarea', w); ta.oninput = () => { $('[data-count]', w).textContent = ta.value.length; setAnswer(q, ta.value.trim() ? ta.value : null); }; }
}
function progress() {
  const n = form.questions.length, done = form.questions.filter(q => isAnswered(q)).length;
  $('#pc').textContent = `${done} de ${n}`; $('#pb').style.width = (100 * done / n) + '%';
}
async function submit() {
  const missing = form.questions.filter(q => q.required && !isAnswered(q));
  $$('.q.missing').forEach(e => e.classList.remove('missing'));
  if (missing.length) {
    missing.forEach(q => $('#q-' + q.id).classList.add('missing'));
    $('#q-' + missing[0].id).scrollIntoView({ behavior: 'smooth', block: 'start' });
    return toast(missing.length === 1 ? 'Falta responder a 1 pergunta obrigatória' : `Faltam ${missing.length} perguntas obrigatórias`, 3500);
  }
  const btn = $('#send'); btn.disabled = true; btn.textContent = 'A enviar…';
  const clean = {}; form.questions.forEach(q => { if (isAnswered(q)) clean[q.id] = q.type === 'open' ? answers[q.id].trim() : answers[q.id]; });
  try {
    const r = await fetch('/api/f/' + CODE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: clean }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { btn.disabled = false; btn.textContent = '📨 Enviar respostas'; if (j.missing) { const b = $('#q-' + j.missing); b && (b.classList.add('missing'), b.scrollIntoView({ behavior: 'smooth' })); } return toast(j.error || 'Não foi possível enviar. Tenta de novo.', 4000); }
  } catch { btn.disabled = false; btn.textContent = '📨 Enviar respostas'; return toast('Sem ligação. As tuas respostas estão guardadas aqui — tenta enviar de novo.', 4500); }
  store.del(DRAFT); store.set(DONE, 1); answers = {};
  doneScreen(false);
}
function doneScreen(already) {
  msgScreen(already ? '✅' : '💜', already ? 'Já respondeste' : 'Obrigado!',
    already ? 'Já enviaste o teu feedback a partir deste telemóvel. Obrigado!' : 'O teu feedback foi enviado de forma anónima.<br>Ajuda mesmo a melhorar a formação.',
    already ? '<button class="link" id="again">Este telemóvel é partilhado: responder outra pessoa</button>' : '');
  const a = $('#again'); if (a) a.onclick = () => { if (confirm('Responder de novo só faz sentido se outra pessoa estiver a usar este telemóvel. Continuar?')) { store.del(DONE); render(); } };
}
load();
document.addEventListener('click', e => { if (e.target.closest('.js-retry')) load(); });
