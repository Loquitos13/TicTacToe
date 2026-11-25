// Diapositivo do PowerPoint (suplemento "Quiz ao vivo").
// Cada diapositivo tem um papel, guardado na própria apresentação:
//   entrada  → QR code e quem já entrou (põe-se no início)
//   pergunta → quando o diapositivo aparece na apresentação, essa pergunta começa sozinha
//   final    → pódio final
// A editar a apresentação só se vê uma pré-visualização (não mexe no quiz nem pede palavra-passe).
// A apresentar, o computador tem de estar autorizado (uma vez, fica 180 dias).
let slideCfg = null, slideView = 'read', officeOk = false;
const slideQ = new URLSearchParams(location.search);

const slideStore = {
  get() {
    try { if (officeOk) return Office.context.document.settings.get('quiz') || null; } catch {}
    try { return JSON.parse(localStorage.getItem('aq_slidecfg') || 'null'); } catch { return null; }
  },
  set(v, done) {
    if (officeOk) { const st = Office.context.document.settings; if (v) st.set('quiz', v); else st.remove('quiz'); st.saveAsync(() => done()); return; }
    try { localStorage.setItem('aq_slidecfg', JSON.stringify(v)); } catch {}
    done();
  },
};
// 'edit' (a editar a apresentação) ou 'read' (a apresentar)
const slideGetView = () => new Promise(res => {
  if (slideQ.get('view')) return res(slideQ.get('view'));
  if (!officeOk) return res('read');
  try { Office.context.document.getActiveViewAsync(r => res(r.status === 'succeeded' ? r.value : 'read')); } catch { res('read'); }
});

// diapositivo que o PowerPoint tem selecionado (a editar) ou à vista (a apresentar): { id, index }; null se não souber
const slideGetSel = () => new Promise(res => {
  if (!officeOk) return res(null);
  try {
    Office.context.document.getSelectedDataAsync(Office.CoercionType.SlideRange, r => {
      const sl = r.status === 'succeeded' && r.value && r.value.slides;
      res(sl && sl.length === 1 ? { id: sl[0].id, index: sl[0].index } : null);
    });
  } catch { res(null); }
});
const slideGetId = () => slideGetSel().then(s => s ? s.id : null);
const slideInst = Math.random().toString(36).slice(2);   // esta cópia do suplemento (cada diapositivo tem a sua)

async function slideBoot() {
  slideCfg = window.slideCfg = slideStore.get();
  slideView = await slideGetView();
  // passou de editar para apresentar (ou ao contrário): recomeça no modo certo
  if (officeOk) try { Office.context.document.addHandlerAsync(Office.EventType.ActiveViewChanged, () => location.reload()); } catch {}
  // a editar só se mostra a pré-visualização. O id do diapositivo só muda no "Guardar": o PowerPoint carrega os
  // diapositivos todos ao mesmo tempo e só quando o formador carrega em Guardar se sabe ao certo qual é este.
  if (slideView === 'edit') return slidePreview();
  if (!PW) return slideLogin('Para apresentar o quiz, autoriza este computador. Só é preciso uma vez.');
  start();
}
function slideAfterLogin() { $('#login').classList.add('hidden'); if (slideView === 'edit') return slideConfigure(); start(); }
function slideLogin(msg) {
  $('#main').classList.add('hidden'); const pv = $('#slidePrev'); if (pv) pv.remove();
  $('#login').classList.remove('hidden');
  let m = $('#loginMsg'); if (!m) { m = document.createElement('p'); m.id = 'loginMsg'; m.className = 'muted'; $('#loginForm').before(m); }
  m.textContent = msg; $('#pw').focus();
}

// ---------- a editar: pré-visualização e configuração ----------
function slidePane(html) {
  $('#login').classList.add('hidden'); $('#main').classList.add('hidden');
  let pv = $('#slidePrev'); if (!pv) { pv = document.createElement('div'); pv.id = 'slidePrev'; document.body.appendChild(pv); }
  pv.innerHTML = html; return pv;
}
function slidePreview() {
  const c = slideCfg;
  const body = !c ? `<div class="sp-emoji">🎯</div><h1>Quiz ao vivo</h1><p>Escolhe o que este diapositivo mostra na apresentação:<br>a <b>entrada</b> (QR code), uma <b>pergunta</b> ou o <b>pódio final</b>.</p>`
    : c.role === 'join' ? `<div class="sp-tag">📱 Entrada no quiz</div><h1>${esc(c.quizTitle)}</h1>
        <div class="sp-qr">QR code</div><p>Na apresentação aparece aqui o <b>QR code</b> e quem já entrou. Põe este diapositivo no início.</p>`
    : c.role === 'question' ? `<div class="sp-tag">❓ Pergunta ${c.qNum} de ${c.qTotal} · ${esc(c.quizTitle)}</div><h1>${esc(c.qText)}</h1>
        <p>Na apresentação, esta pergunta <b>começa sozinha</b> quando o diapositivo aparecer.</p>`
    : `<div class="sp-tag">🏆 Final · ${esc(c.quizTitle)}</div><h1>Pódio final</h1><p>Na apresentação mostra o pódio e termina o quiz.</p>`;
  const where = !c ? '' : c.slideId == null ? `<p class="sp-warn">⚠ Ainda não está ligado a este diapositivo: carrega em <b>⚙ Mudar → Guardar</b>.</p>`
    : `<p class="sp-where">📍 Ligado ao diapositivo ${c.slideIdx || '?'}${c.slideIdx ? '' : ''} — se não for este, carrega em ⚙ Mudar → Guardar</p>`;
  const pv = slidePane(`<div class="sp">${body}${where}<button class="btn ${c ? 'ghost small' : 'primary'}" id="spCfg">⚙ ${c ? 'Mudar' : 'Escolher'}</button></div>`);
  $('#spCfg', pv).onclick = () => PW ? slideConfigure() : slideLogin('Autoriza este computador para escolheres o quiz. Só é preciso uma vez.');
}
async function slideConfigure() {
  let qz, cs;
  try { [qz, cs] = await Promise.all([api('GET', '/api/quizzes'), api('GET', '/api/courses')]); }
  catch (e) { return slidePane(`<div class="sp"><h1>Sem ligação ao quiz</h1><p>Confirma que o quiz está ligado (iniciar-online.bat).</p><p class="muted">${esc(e.message)}</p></div>`); }
  qz = qz.filter(q => q.questions.length);
  if (!qz.length) return slidePane(`<div class="sp"><h1>Ainda não há questionários</h1><p>Cria um no painel do formador e volta aqui.</p></div>`);
  const c = slideCfg || {};
  const pv = slidePane(`<form class="sp sp-form" id="spForm">
    <h2>Este diapositivo mostra…</h2>
    <label>Questionário <select id="spQuiz">${cs.map(co => { const list = qz.filter(q => q.courseId === co.id); return list.length ? `<optgroup label="${esc(co.name)}">${list.map(q => `<option value="${q.id}" ${q.id === c.quizId ? 'selected' : ''}>${esc(q.title)}</option>`).join('')}</optgroup>` : ''; }).join('')}</select></label>
    <div class="sp-roles">
      <label><input type="radio" name="spRole" value="join" ${c.role !== 'question' && c.role !== 'final' ? 'checked' : ''}> 📱 Entrada (QR code)</label>
      <label><input type="radio" name="spRole" value="question" ${c.role === 'question' ? 'checked' : ''}> ❓ Pergunta</label>
      <label><input type="radio" name="spRole" value="final" ${c.role === 'final' ? 'checked' : ''}> 🏆 Pódio final</label>
    </div>
    <label id="spQL">Pergunta <select id="spQ"></select></label>
    <label>Como avançam as perguntas <select id="spMode"><option value="manual">🎮 Manual: fechas tu cada pergunta</option><option value="timed" ${c.mode === 'timed' ? 'selected' : ''}>⏱ Por tempo: fecham sozinhas</option></select></label>
    <div class="row"><button class="btn primary">Guardar</button>${slideCfg ? '<button type="button" class="btn ghost" id="spCancel">Cancelar</button>' : ''}</div>
    <p class="muted">Dica: um diapositivo de entrada no início e um diapositivo por pergunta. O diapositivo de cada pergunta pode ter o teu conteúdo à volta (o quiz ocupa só a caixa).</p></form>`);
  const fillQ = () => {
    const q = qz.find(x => x.id === $('#spQuiz', pv).value);
    $('#spQ', pv).innerHTML = q.questions.map((x, i) => `<option value="${x.id}" ${x.id === c.qid ? 'selected' : ''}>${i + 1}. ${esc(String(x.text).replace(/\[\[|\]\]/g, '').slice(0, 80))}</option>`).join('');
  };
  const syncRole = () => { $('#spQL', pv).hidden = $('[name=spRole]:checked', pv).value !== 'question'; };
  $('#spQuiz', pv).onchange = fillQ; $$('[name=spRole]', pv).forEach(r => r.onchange = syncRole); fillQ(); syncRole();
  if ($('#spCancel', pv)) $('#spCancel', pv).onclick = slidePreview;
  $('#spForm', pv).onsubmit = e => {
    e.preventDefault();
    const q = qz.find(x => x.id === $('#spQuiz', pv).value), role = $('[name=spRole]:checked', pv).value;
    const k = q.questions.findIndex(x => x.id === $('#spQ', pv).value);
    const cfg = { quizId: q.id, quizTitle: q.title, role, mode: $('#spMode', pv).value, qTotal: q.questions.length };
    if (role === 'question') Object.assign(cfg, { qid: q.questions[k].id, qNum: k + 1, qText: String(q.questions[k].text).replace(/\[\[|\]\]/g, '') });
    slideGetSel().then(sel => { if (sel) { cfg.slideId = sel.id; cfg.slideIdx = sel.index; } slideStore.set(cfg, () => { slideCfg = window.slideCfg = cfg; slidePreview(); }); });
  };
}

// ---------- a apresentar ----------
let slideT = null, slideMine = null, slideKnown = false, slideFired = false;
const slideT0 = Date.now();
function slideOnSocket(sock) {
  if (!slideCfg) return;
  // o PowerPoint carrega os diapositivos com o suplemento todos ao mesmo tempo: só o que está à vista pode mandar.
  // Sabe-se qual é pelo id do diapositivo (guardado ao configurar). Sem esse id, as perguntas não arrancam sozinhas
  // (aparece o botão "Começar a pergunta"), para nunca começarem fora do sítio.
  const auto = () => !slideDup() && (slideMine === true || (slideKnown && slideMine === null && slideCfg.role === 'join' && document.visibilityState === 'visible'));
  const fire = (force, manual) => {
    if (!manual && !auto()) return;
    clearTimeout(slideT);
    slideT = setTimeout(() => sock.emit('host:slide', { ...slideCfg, force: !!force, manual: !!manual }, r => {
      if (r && r.conflict) slideConflict(r.conflict); else if (r && r.error) toast(r.error, 6000);
    }), 400);
  };
  window.slideFire = force => fire(force, true);
  sock.on('connect', () => { slideFired = false; });
  document.addEventListener('visibilitychange', () => { slideFired = false; });
  // de 0,7 em 0,7 s: este diapositivo passou a estar à vista?
  const check = async () => {
    slideBeat();
    const id = await slideGetId();
    const now = id == null || slideCfg.slideId == null ? null : id === slideCfg.slideId;
    const first = !slideKnown; slideKnown = true;
    if (now !== slideMine || first) {
      slideMine = now; slideFired = false;
      Sound.setForcedOff(now !== true && !(now === null && slideCfg.role === 'join'));   // os diapositivos que não estão à vista ficam calados
      slideCheck();
    }
    // arranca uma vez por "visita" ao diapositivo, e só depois de 2 s: dá tempo a todas as cópias carregadas de se
    // anunciarem, para se apanhar diapositivos repetidos antes de alguém arrancar
    if (!slideFired && sock.connected && Date.now() - slideT0 > 2000 && auto()) { slideFired = true; fire(); }
  };
  check(); setInterval(check, 700);
  sock.on('state', () => setTimeout(slideCheck, 50));
}
// botões do diapositivo: a entrada não começa o quiz; numa pergunta, o botão amarelo só faz os passos dessa pergunta
// (pergunta → fechar → sondagem → resposta certa → ranking); a seguinte começa no diapositivo dela
// várias cópias com o mesmo diapositivo e papéis diferentes (configuração antiga ou estragada): nenhuma arranca sozinha
function slideBeat() {
  if (!slideCfg || slideCfg.slideId == null) return;
  try { localStorage.setItem('aq_inst_' + slideInst, JSON.stringify({ s: slideCfg.slideId, k: slideCfg.role + ':' + (slideCfg.qid || ''), t: Date.now() })); } catch {}
}
function slideDup() {
  if (!slideCfg || slideCfg.slideId == null) return false;
  const me = slideCfg.role + ':' + (slideCfg.qid || '');
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k.startsWith('aq_inst_') || k === 'aq_inst_' + slideInst) continue;
      const o = JSON.parse(localStorage.getItem(k) || 'null');
      if (!o || Date.now() - o.t > 5000) { if (o && Date.now() - o.t > 60000) localStorage.removeItem(k); continue; }
      if (o.s === slideCfg.slideId && o.k !== me) return true;
    }
  } catch {}
  return false;
}
function slideTweak() {
  if (!slideCfg || !S || !$('.controls')) return;
  const nb = $('#btnNext'), c = slideCfg;
  let hide = false, msg = '';
  if (c.role === 'join' && S.phase !== 'end') { hide = true; msg = S.phase === 'lobby' ? '➡ Quando todos tiverem entrado, avança para o diapositivo seguinte' : ''; }
  // entrada com o quiz já a meio (ex.: sessão de um ensaio anterior): botão para começar de novo
  let rb = $('#slideRestart');
  const wantR = c.role === 'join' && S.phase !== 'lobby';
  if (wantR && !rb) {
    rb = document.createElement('button'); rb.id = 'slideRestart'; rb.className = 'btn small'; rb.textContent = '🔄 Recomeçar o quiz';
    rb.onclick = () => {
      if (!rb.dataset.armed) { rb.dataset.armed = '1'; rb.textContent = 'Carrega outra vez: nova sessão'; setTimeout(() => { if (rb.isConnected) { delete rb.dataset.armed; rb.textContent = '🔄 Recomeçar o quiz'; } }, 3500); return; }
      socket.emit('host:slide', { ...slideCfg, manual: true, restart: true }, r => r && r.error && toast(r.error, 6000));
    };
    $('.controls').appendChild(rb);
  }
  if (rb && !wantR) rb.remove();
  else if (c.role === 'question') {
    const here = S.question && S.question.id === c.qid;
    if (!here && S.phase !== 'end') hide = true;
    else if (nb && /Próxima pergunta|Resultados finais/.test(nb.textContent)) { hide = true; msg = '➡ Avança para o diapositivo seguinte'; }
  }
  if (nb && (nb.style.display === 'none') !== hide) nb.style.display = hide ? 'none' : '';
  const ci = $('#ctlInfo'); if (ci && ci.textContent.includes('espaço')) ci.textContent = ci.textContent.replace(' · espaço/→ avança', '');   // termina-se no diapositivo final ou no painel
  if (slideMine === true && slideDup()) msg = '⚠ Vários diapositivos ligados ao mesmo sítio: a editar, carrega em ⚙ Mudar → Guardar em cada um';
  let n = $('#slideNote');
  if (!n && msg) { n = document.createElement('span'); n.id = 'slideNote'; $('.controls').appendChild(n); }
  if (n && n.textContent !== msg) n.textContent = msg;
  if (n && (n.style.display === 'none') !== !msg) n.style.display = msg ? '' : 'none';
}
// a pergunta deste diapositivo não começou sozinha (ex.: o PowerPoint não avisou): botão para a começar
function slideCheck() {
  let b = $('#slideGo');
  const c = slideCfg, need = slideMine !== false && c && c.role === 'question' && (!S || S.phase !== 'end' && S.phase !== 'exam'
    && !(S.question && S.question.id === c.qid) && !(S.askedIds || []).includes(c.qid));
  if (!need) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('button'); b.id = 'slideGo'; b.className = 'btn primary'; document.body.appendChild(b); b.onclick = () => window.slideFire && window.slideFire(); }
  b.textContent = `▶ Começar a pergunta ${c.qNum}`;
}
function slideConflict(title) {
  const d = document.createElement('div'); d.className = 'dlg';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100;display:grid;place-items:center;padding:16px';
  d.innerHTML = `<div class="card center" style="max-width:520px"><h2>Está a decorrer outro quiz</h2><p>«${esc(title)}» ainda está aberto.</p>
    <div class="row" style="justify-content:center"><button class="btn primary" id="cfYes">Terminar esse e começar este</button><button class="btn ghost" id="cfNo">Manter</button></div></div>`;
  document.body.appendChild(d);
  $('#cfYes', d).onclick = () => { d.remove(); window.slideFire(true); };
  $('#cfNo', d).onclick = () => d.remove();
}

// arranque: espera pelo Office (se estiver dentro do PowerPoint)
if (window.Office && Office.onReady) Office.onReady(info => { officeOk = !!(info && info.host); slideBoot(); });
else slideBoot();
