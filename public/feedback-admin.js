/* Separador "Feedback" do formador: questionários de satisfação anónimos (sem tempo, sem jogo).
   Usa as funções globais do host.html: api, esc, toast, $, $$, courses, joinUrl. */
const FB_TYPES = { scale: '⭐ Escala 1 a 5', tf: '✅ Verdadeiro / Falso', choice: '🔘 Escolher uma opção', multi: '☑️ Escolher várias', open: '✍️ Resposta livre' };
let fbForms = [], fbView = { kind: 'list' }, fbPoll = null;
const fbUid = () => Math.random().toString(36).slice(2, 10);
const fbLink = f => `${(joinUrl || location.origin).replace(/\/$/, '')}/f/${f.code}`;

function fbTemplate() {
  const s = (text, scaleMin, scaleMax) => ({ id: fbUid(), type: 'scale', text, scaleMin, scaleMax, required: true });
  return {
    title: 'Avaliação da formação', course: '', intro: 'Queremos saber a tua opinião sincera sobre esta formação. Demora 2 minutos.',
    questions: [
      s('De forma geral, como avalias a formação?', 'Muito fraca', 'Excelente'),
      s('Os conteúdos foram úteis para o teu trabalho?', 'Nada úteis', 'Muito úteis'),
      s('Como avalias o formador (clareza, domínio do tema, disponibilidade)?', 'Muito fraco', 'Excelente'),
      s('A duração da formação foi adequada?', 'Nada adequada', 'Totalmente adequada'),
      s('Como avalias a sala, os equipamentos e os materiais?', 'Muito fracos', 'Excelentes'),
      { id: fbUid(), type: 'choice', text: 'O ritmo da formação foi…', options: ['Demasiado lento', 'Adequado', 'Demasiado rápido'], required: true },
      { id: fbUid(), type: 'tf', text: 'Recomendarias esta formação a um colega.', required: true },
      { id: fbUid(), type: 'open', text: 'O que mais gostaste?', required: false },
      { id: fbUid(), type: 'open', text: 'O que podia ser melhorado?', required: false },
    ],
  };
}

async function renderFeedback() {
  clearInterval(fbPoll); fbPoll = null;
  const el = $('#tab-feedback');
  if (fbView.kind === 'edit') return fbEditor(el);
  if (fbView.kind === 'share') return fbShare(el);
  if (fbView.kind === 'results') return fbResults(el);
  fbForms = await api('GET', '/api/feedback');
  el.innerHTML = `<div class="card"><div class="row"><h2 class="grow" style="margin:0">💬 Feedback anónimo da formação</h2>
      <button class="btn primary" id="fbNewT">+ Novo (modelo de satisfação)</button><button class="btn" id="fbNew">+ Novo em branco</button></div>
    <p class="muted" style="margin:10px 0 0">Um formulário simples, <b>sem tempo e sem jogo</b>: os formandos leem o QR code e respondem ao seu ritmo.
      É <b>completamente anónimo</b> — não se pede nome nem fotografia, e nem tu consegues saber quem respondeu o quê. Vês as médias, os gráficos e os comentários.</p></div>
    <div class="list" style="margin-top:16px">${fbForms.map(f => `<div class="item fb-item">
      <div class="grow"><b>${esc(f.title)}</b> ${f.open ? '<span class="tag ok">🟢 a receber respostas</span>' : '<span class="tag none">fechado</span>'}<br>
        <small class="muted">${f.course ? '🎓 ' + esc(f.course) + ' · ' : ''}${f.questions.length} perguntas · <b>${f.responses}</b> resposta${f.responses === 1 ? '' : 's'} · código ${esc(f.code)}</small></div>
      <button class="btn small ${f.open ? '' : 'primary'}" data-share="${f.id}">📱 ${f.open ? 'Mostrar QR' : 'Abrir e mostrar QR'}</button>
      <button class="btn small" data-res="${f.id}">📊 Resultados</button>
      <button class="btn small" data-fedit="${f.id}">Editar</button><button class="btn small" data-fdup="${f.id}">Duplicar</button>
      <button class="btn small danger" data-fdel="${f.id}" title="Apagar">✕</button></div>`).join('') || '<div class="card"><p class="muted" style="margin:0">Ainda não tens questionários de feedback. Começa pelo modelo de satisfação e ajusta as perguntas.</p></div>'}</div>`;
  $('#fbNewT').onclick = () => { fbView = { kind: 'edit', form: fbTemplate() }; renderFeedback(); };
  $('#fbNew').onclick = () => { fbView = { kind: 'edit', form: { title: 'Feedback da formação', course: '', intro: '', questions: [{ id: fbUid(), type: 'scale', text: '', required: true }] } }; renderFeedback(); };
  const find = id => fbForms.find(f => f.id === id);
  $$('[data-share]').forEach(b => b.onclick = async () => { const f = find(b.dataset.share); if (!f.open) await api('POST', `/api/feedback/${f.id}/open`, { open: true }); fbView = { kind: 'share', id: f.id }; renderFeedback(); });
  $$('[data-res]').forEach(b => b.onclick = () => { fbView = { kind: 'results', id: b.dataset.res }; renderFeedback(); });
  $$('[data-fedit]').forEach(b => b.onclick = () => { fbView = { kind: 'edit', form: JSON.parse(JSON.stringify(find(b.dataset.fedit))) }; renderFeedback(); });
  $$('[data-fdup]').forEach(b => b.onclick = async () => {
    const f = JSON.parse(JSON.stringify(find(b.dataset.fdup))); delete f.id; f.title += ' (cópia)'; f.questions.forEach(q => q.id = fbUid());
    await api('POST', '/api/feedback', f); toast('Duplicado'); renderFeedback();
  });
  $$('[data-fdel]').forEach(b => b.onclick = async () => {
    const f = find(b.dataset.fdel);
    if (!confirm(`Apagar "${f.title}"${f.responses ? ` e as ${f.responses} respostas recebidas` : ''}? Não dá para desfazer.`)) return;
    await api('DELETE', '/api/feedback/' + f.id); renderFeedback();
  });
}

/* ---------- Editor ---------- */
function fbEditor(el) {
  const f = fbView.form, locked = !!f.responses;
  const qHtml = (q, i) => `<div class="card fb-q" data-i="${i}" style="margin-top:12px;background:#faf8fd">
    <div class="row"><b style="font-size:1.2em">${i + 1}.</b>
      <select class="fbType" ${locked ? 'disabled' : ''}>${Object.entries(FB_TYPES).map(([k, v]) => `<option value="${k}" ${k === q.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label class="switch" style="margin-left:auto"><input type="checkbox" class="fbReq" ${q.required ? 'checked' : ''}> Obrigatória</label>
      <button class="btn small" data-up="${i}" ${i === 0 || locked ? 'disabled' : ''} title="Subir">↑</button><button class="btn small" data-down="${i}" ${i === f.questions.length - 1 || locked ? 'disabled' : ''} title="Descer">↓</button>
      <button class="btn small danger" data-rm="${i}" ${locked ? 'disabled' : ''} title="Apagar pergunta">✕</button></div>
    <textarea class="fbText" rows="2" style="width:100%;margin-top:8px" placeholder="Escreve a pergunta…">${esc(q.text)}</textarea>
    ${q.type === 'scale' ? `<div class="row" style="margin-top:6px"><span class="muted">1 =</span><input type="text" class="fbMin grow" placeholder="ex.: Muito fraco" value="${esc(q.scaleMin || '')}"><span class="muted">5 =</span><input type="text" class="fbMax grow" placeholder="ex.: Excelente" value="${esc(q.scaleMax || '')}"></div>` : ''}
    ${q.type === 'choice' || q.type === 'multi' ? `<label class="muted" style="display:block;margin-top:6px">Opções (uma por linha)</label><textarea class="fbOpts" rows="4" style="width:100%" ${locked ? 'readonly' : ''}>${esc((q.options || []).join('\n'))}</textarea>` : ''}
  </div>`;
  el.innerHTML = `<div class="card"><div class="row"><button class="btn small" id="fbBack">← Voltar</button><h2 class="grow" style="margin:0">${f.id ? 'Editar' : 'Novo'} questionário de feedback</h2></div>
    ${locked ? `<p class="fb-warn">🔒 Já tem ${f.responses} resposta${f.responses === 1 ? '' : 's'}: podes corrigir textos, mas não acrescentar, apagar ou mudar o tipo das perguntas (estragaria os resultados). Para isso, usa "Duplicar".</p>` : ''}
    <div class="grid2" style="margin-top:12px;gap:12px">
      <label>Título<input type="text" id="fbTitle" style="width:100%" value="${esc(f.title)}"></label>
      <label>Curso / turma <small class="muted">(opcional)</small><input type="text" id="fbCourse" list="fbCourses" style="width:100%" value="${esc(f.course || '')}" placeholder="ex.: Técnico de Vendas — turma de março">
        <datalist id="fbCourses">${(typeof courses !== 'undefined' ? courses : []).map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></label></div>
    <label style="display:block;margin-top:10px">Mensagem de abertura <small class="muted">(opcional)</small><textarea id="fbIntro" rows="2" style="width:100%">${esc(f.intro || '')}</textarea></label></div>
    <div id="fbQs">${f.questions.map(qHtml).join('')}</div>
    <div class="row" style="margin-top:14px">${locked ? '' : '<button class="btn" id="fbAdd">+ Acrescentar pergunta</button>'}<span class="grow"></span>
      <button class="btn" id="fbCancel">Cancelar</button><button class="btn primary" id="fbSave">💾 Guardar</button></div>`;
  const collect = () => {
    f.title = $('#fbTitle').value; f.course = $('#fbCourse').value; f.intro = $('#fbIntro').value;
    $$('.fb-q').forEach(box => {
      const q = f.questions[+box.dataset.i];
      q.type = $('.fbType', box).value; q.text = $('.fbText', box).value; q.required = $('.fbReq', box).checked;
      if ($('.fbMin', box)) { q.scaleMin = $('.fbMin', box).value; q.scaleMax = $('.fbMax', box).value; }
      if ($('.fbOpts', box)) q.options = $('.fbOpts', box).value.split('\n').map(s => s.trim()).filter(Boolean);
    });
  };
  $$('.fbType').forEach(s => s.onchange = () => {
    collect(); const q = f.questions[+s.closest('.fb-q').dataset.i];
    if ((q.type === 'choice' || q.type === 'multi') && !(q.options || []).length) q.options = ['', ''];
    fbEditor(el);
  });
  $$('[data-up]').forEach(b => b.onclick = () => { collect(); const i = +b.dataset.up; [f.questions[i - 1], f.questions[i]] = [f.questions[i], f.questions[i - 1]]; fbEditor(el); });
  $$('[data-down]').forEach(b => b.onclick = () => { collect(); const i = +b.dataset.down; [f.questions[i + 1], f.questions[i]] = [f.questions[i], f.questions[i + 1]]; fbEditor(el); });
  $$('[data-rm]').forEach(b => b.onclick = () => { collect(); f.questions.splice(+b.dataset.rm, 1); fbEditor(el); });
  if ($('#fbAdd')) $('#fbAdd').onclick = () => { collect(); f.questions.push({ id: fbUid(), type: 'scale', text: '', required: true }); fbEditor(el); setTimeout(() => { const t = $$('.fbText').pop(); t.scrollIntoView({ block: 'center' }); t.focus(); }, 30); };
  const back = () => { fbView = { kind: 'list' }; renderFeedback(); };
  $('#fbBack').onclick = $('#fbCancel').onclick = back;
  $('#fbSave').onclick = async () => {
    collect();
    const empty = f.questions.findIndex(q => !q.text.trim());
    if (empty >= 0) return toast(`A pergunta ${empty + 1} está vazia`), $$('.fbText')[empty].focus();
    const bad = f.questions.findIndex(q => (q.type === 'choice' || q.type === 'multi') && (q.options || []).length < 2);
    if (bad >= 0) return toast(`A pergunta ${bad + 1} precisa de pelo menos 2 opções`);
    if (!f.questions.length) return toast('Acrescenta pelo menos uma pergunta');
    try { await api('POST', '/api/feedback', f); toast('Guardado ✅'); back(); } catch (e) { toast(e.message, 5000); }
  };
}

/* ---------- Partilhar (QR) ---------- */
async function fbShare(el) {
  const forms = await api('GET', '/api/feedback'), f = forms.find(x => x.id === fbView.id);
  if (!f) { fbView = { kind: 'list' }; return renderFeedback(); }
  const link = fbLink(f);
  el.innerHTML = `<div class="card fb-share">
    <div class="row"><button class="btn small" id="fbBack">← Voltar</button><h2 class="grow" style="margin:0">${esc(f.title)}</h2>
      <button class="btn small ${f.open ? 'danger' : 'primary'}" id="fbToggle">${f.open ? '⏹ Fechar respostas' : '▶ Abrir respostas'}</button></div>
    <div class="fb-share-body">
      <img class="fb-qr" src="/api/qr?url=${encodeURIComponent(link)}" alt="QR code">
      <div class="fb-share-info">
        <p class="fb-step">📱 Lê o QR code com a câmara do telemóvel<br><small class="muted">ou abre <b>${esc(link.replace(/^https?:\/\//, ''))}</b></small></p>
        <div class="fb-code">${esc(f.code)}</div>
        <p class="muted" style="margin:0">🕶️ Anónimo · sem tempo · cada um responde ao seu ritmo</p>
        <div class="fb-count"><span id="fbN">${f.responses}</span><small>resposta${f.responses === 1 ? '' : 's'} recebida${f.responses === 1 ? '' : 's'}</small></div>
        ${f.open ? '' : '<p class="fb-warn">⏸ Está fechado: os formandos ainda não conseguem responder.</p>'}
        <div class="row" style="justify-content:center"><button class="btn small" id="fbCopy">🔗 Copiar link</button><button class="btn small" id="fbRes">📊 Ver resultados</button></div>
      </div></div></div>`;
  $('#fbBack').onclick = () => { fbView = { kind: 'list' }; renderFeedback(); };
  $('#fbRes').onclick = () => { fbView = { kind: 'results', id: f.id }; renderFeedback(); };
  $('#fbToggle').onclick = async () => { await api('POST', `/api/feedback/${f.id}/open`, { open: !f.open }); toast(f.open ? 'Fechado: já não aceita respostas' : 'Aberto: os formandos já podem responder'); renderFeedback(); };
  $('#fbCopy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copiado'); } catch { prompt('Copia o link:', link); } };
  let last = f.responses;
  fbPoll = setInterval(async () => {
    if (tab !== 'feedback' || fbView.kind !== 'share') return clearInterval(fbPoll);
    const n = ((await api('GET', '/api/feedback').catch(() => [])).find(x => x.id === f.id) || {}).responses;
    if (n != null && n !== last) { last = n; const s = $('#fbN'); if (s) { s.textContent = n; s.classList.remove('pop-in'); void s.offsetWidth; s.classList.add('pop-in'); } if (window.Sound) Sound.play('pop'); }
  }, 3000);
}

/* ---------- Resultados ---------- */
async function fbResults(el) {
  const { form: f, answers } = await api('GET', `/api/feedback/${fbView.id}/results`);
  const n = answers.length, pct = (k, t) => t ? Math.round(100 * k / t) : 0;
  const bars = rows => `<div class="fb-bars">${rows.map(([label, k, t, cls]) => `<div class="fb-bar-row"><span class="fb-bl">${label}</span>
    <span class="fb-bt"><i class="${cls || ''}" style="width:${pct(k, t)}%"></i></span><span class="fb-bn"><b>${k}</b> · ${pct(k, t)}%</span></div>`).join('')}</div>`;
  const block = (q, i) => {
    const vals = answers.map(a => a[q.id]).filter(v => v != null), t = vals.length;
    let body = '';
    if (q.type === 'scale') {
      const avg = t ? vals.reduce((s, v) => s + v, 0) / t : 0;
      body = `<div class="fb-avg"><b>${t ? avg.toFixed(1).replace('.', ',') : '—'}</b><span>/ 5</span><span class="fb-stars">${'★'.repeat(Math.round(avg))}${'☆'.repeat(5 - Math.round(avg))}</span></div>
        ${bars([5, 4, 3, 2, 1].map(s => [`${s}${s === 5 && q.scaleMax ? ' · ' + esc(q.scaleMax) : s === 1 && q.scaleMin ? ' · ' + esc(q.scaleMin) : ''}`, vals.filter(v => v === s).length, t, 's' + s]))}`;
    } else if (q.type === 'tf') body = bars([['Verdadeiro', vals.filter(v => v === true).length, t, 's5'], ['Falso', vals.filter(v => v === false).length, t, 's1']]);
    else if (q.type === 'choice') body = bars(q.options.map(o => [esc(o), vals.filter(v => v === o).length, t]));
    else if (q.type === 'multi') body = `<p class="muted" style="margin:0 0 6px">Percentagem de quem respondeu (cada pessoa podia escolher várias).</p>` + bars(q.options.map(o => [esc(o), vals.filter(v => v.includes(o)).length, t]));
    else body = t ? `<div class="fb-comments">${vals.map(v => `<div class="fb-comment">“${esc(v)}”</div>`).join('')}</div>` : '<p class="muted">Sem comentários.</p>';
    return `<div class="card fb-res-q"><div class="fb-res-t"><span>${i + 1}. ${esc(q.text)}</span><small class="muted">${t} resposta${t === 1 ? '' : 's'}</small></div>${body}</div>`;
  };
  const scales = f.questions.filter(q => q.type === 'scale');
  const allScale = answers.flatMap(a => scales.map(q => a[q.id]).filter(v => v != null));
  const overall = allScale.length ? (allScale.reduce((s, v) => s + v, 0) / allScale.length).toFixed(1).replace('.', ',') : null;
  el.innerHTML = `<div class="card fb-res-head"><div class="row noprint"><button class="btn small" id="fbBack">← Voltar</button><span class="grow"></span>
      <button class="btn small" id="fbRefresh">🔄 Atualizar</button><button class="btn small" id="fbCsv">⬇ Excel (CSV)</button><button class="btn small" id="fbPrint">🖨 Imprimir / PDF</button></div>
    <h2 style="margin:10px 0 2px">📊 ${esc(f.title)}</h2>
    <p class="muted" style="margin:0">${f.course ? '🎓 ' + esc(f.course) + ' · ' : ''}${new Date().toLocaleDateString('pt-PT')} · respostas anónimas</p>
    <div class="fb-kpis"><div><b>${n}</b><span>respostas</span></div>${overall ? `<div><b>${overall}</b><span>média geral (escalas, de 1 a 5)</span></div>` : ''}</div>
    ${n > 0 && n < 3 ? '<p class="fb-warn noprint">⚠ Com tão poucas respostas pode ser fácil adivinhar quem respondeu o quê. Evita mostrar estes resultados à turma.</p>' : ''}</div>
    ${n ? f.questions.map(block).join('') : '<div class="card"><p class="muted" style="margin:0">Ainda não há respostas. Mostra o QR code aos formandos.</p></div>'}`;
  $('#fbBack').onclick = () => { fbView = { kind: 'list' }; renderFeedback(); };
  $('#fbRefresh').onclick = () => renderFeedback();
  $('#fbPrint').onclick = () => window.print();
  $('#fbCsv').onclick = async () => {
    const r = await fetch(`/api/feedback/${f.id}/csv`, { headers: { 'x-host-password': PW } });
    const blob = await r.blob(), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = (r.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || 'feedback.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
}
