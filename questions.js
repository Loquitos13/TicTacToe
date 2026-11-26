// Tipos de pergunta: validação no editor, correção das respostas e textos para os resultados.
//  mc    — escolha múltipla (2 a 6 opções; uma ou mais corretas)
//  tf    — verdadeiro / falso
//  fill  — completar espaços: o texto tem [[palavra]] em cada espaço; o formando escolhe as
//          palavras de um banco (as certas + palavras extra que baralham)
//  open  — resposta livre (escrita). É SEMPRE validada pelo formador, uma a uma, nos resultados.
//          As "respostas modelo" (accepted) só servem de referência / sugestão
//  scale — escala de 1 a 5 ou de 1 a 10 (opinião): não tem resposta certa nem pontos
//  cloud — nuvem de palavras: cada formando escreve até 3 palavras; sem resposta certa nem pontos
//  rank  — ranking de opções: o formando ordena as opções. Com "ordered", a ordem do editor é a certa
//          (pontos por posição certa); sem ela é uma opinião (resultado = posição média de cada opção)
//  scramble — letras baralhadas: a pergunta é a pista; o formando forma a palavra tocando nas letras
//  cross — palavras cruzadas: lista de palavras + pistas; a grelha é gerada sozinha; pontos por palavra certa
//  guess — adivinha a palavra: palavra secreta com N letras e várias tentativas; cada letra fica
//          verde (sítio certo), laranja (existe noutro sítio) ou vermelha (não existe).
//          As tentativas são avaliadas no servidor: a palavra nunca vai para o telemóvel.
//  number — adivinhar um número num intervalo: certo se acertar em cheio; perto ainda dá metade dos pontos (ou menos)
//  match — correspondência: cada item da esquerda liga-se a uma opção da direita (baralhadas); pontos por ligação certa
//  spot — encontrar na imagem: toca no sítio certo da imagem; o formador marca a zona no editor (nunca vai para o telemóvel)
//  potato — batata quente (jogo em grupo): em cada ronda há um tema; o representante do grupo que tem a batata
//           escreve uma palavra do tema; se for aceite a batata passa ao grupo seguinte; quando rebenta, o grupo perde pontos
//  hangman — jogo da forca: adivinhar a palavra letra a letra; a cada letra errada o boneco perde uma peça
const TYPES = ['mc', 'tf', 'fill', 'open', 'scale', 'cloud', 'rank', 'scramble', 'cross', 'guess', 'number', 'match', 'spot', 'potato', 'hangman'];
const { buildCrossword, cwNorm } = require('./public/crossword.js');
const LETTERS = 'ABCDEF';
const norm = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const BLANK_RE = /\[\[([^\]]+?)\]\]/g;

function typeOf(q) { return TYPES.includes(q.type) ? q.type : 'mc'; }
// é uma pergunta com resposta certa? (a escala e a resposta livre sem respostas aceites não são)
// (a resposta livre só passa a contar depois de o formador a validar)
function isGraded(q) { const t = typeOf(q); return t === 'rank' ? !!q.ordered : t === 'mc' && q && q.poll ? false : t !== 'scale' && t !== 'open' && t !== 'cloud'; }
// encontrar na imagem: uma ou várias zonas certas (as perguntas antigas tinham só "zone")
const zonesOf = q => Array.isArray(q.zones) && q.zones.length ? q.zones : q.zone ? [q.zone] : [];
// várias zonas podem valer pelo mesmo problema (mesmo "g"): conta-se o nº de problemas, não de zonas
const spotGroups = q => { const m = new Map(); zonesOf(q).forEach((z, k) => { const g = z.g != null ? 'g' + z.g : 'z' + k; m.set(g, [...(m.get(g) || []), z]); }); return [...m.values()]; };
const spotCount = q => spotGroups(q).length;
// ranking: ordem (baralhada mas sempre igual para a mesma pergunta) em que as opções aparecem,
// para não denunciar a ordem certa e para o projetor e os telemóveis mostrarem as mesmas letras
function rankOrder(q) {
  const n = (q.options || []).length, idx = [...Array(n).keys()];
  let h = 2166136261; for (const c of String(q.id || q.text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0, h / 4294967296);
  // no máximo 1/3 das opções fica no lugar certo (com 2 ou 3 opções, nenhuma)
  for (let k = 0; k < 40; k++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    if (n < 2 || idx.filter((v, i) => v === i).length <= Math.floor(n / 4)) break;
  }
  return idx;
}
// palavras da nuvem: limpa, tira repetidas e corta no máximo
// letras baralhadas: as letras da resposta (sem espaços), baralhadas sempre da mesma maneira
// para a mesma pergunta e nunca pela ordem certa
function scrambleTiles(q) {
  const letters = [...String(q.answer || '').toUpperCase()].filter(ch => /\p{L}/u.test(ch));
  let h = 2166136261; for (const c of String(q.id || q.answer)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0, h / 4294967296);
  const out = letters.slice();
  for (let k = 0; k < 20; k++) {
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    if (out.join('') !== letters.join('') || new Set(letters).size < 2) break;
  }
  return out;
}
// adivinha a palavra: cor de cada letra da tentativa ('g' verde, 'y' laranja, 'r' vermelho).
// Letras repetidas: primeiro marcam-se as certas; as outras só ficam laranja enquanto houver
// dessa letra por encontrar na palavra (ex.: palavra VALOR, tentativa AVAAA → laranja, laranja, vermelho…)
function guessColors(secret, word) {
  const s = [...secret], w = [...word], out = w.map(() => 'r'), left = {};
  w.forEach((ch, i) => { if (ch === s[i]) out[i] = 'g'; else left[s[i]] = (left[s[i]] || 0) + 1; });
  w.forEach((ch, i) => { if (out[i] !== 'g' && left[ch]) { out[i] = 'y'; left[ch]--; } });
  return out;
}
// pontos: à 1ª tentativa vale tudo; na última vale metade; não acertar vale 0
const guessFrac = (q, tries) => 1 - 0.5 * (tries - 1) / Math.max(1, (q.maxTries || 6) - 1);
// tamanho de cada palavra da resposta (ex.: "pós venda" → [3, 5])
const scrambleShape = q => String(q.answer || '').trim().split(/\s+/).map(w => [...w].filter(ch => /\p{L}/u.test(ch)).length).filter(Boolean);
function cloudWords(raw, max) {
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;\n]+/)).map(w => String(w ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean);
  const seen = new Set(), out = [];
  for (const w of list) { const k = norm(w); if (k && !seen.has(k)) { seen.add(k); out.push(w); } }
  return out.slice(0, max);
}
function blanksOf(text) { return [...String(text).matchAll(BLANK_RE)].map(m => m[1].trim()); }
// texto da pergunta para mostrar (os espaços aparecem como ____)
function displayText(q) { return typeOf(q) === 'fill' ? String(q.text).replace(BLANK_RE, '_____') : q.text; }
// banco de palavras de uma pergunta de completar (sem repetidos, ordenado de forma estável)
function wordBank(q) {
  const seen = new Set(), out = [];
  for (const w of [...(q.blanks || []), ...(q.options || [])]) { const k = norm(w); if (k && !seen.has(k)) { seen.add(k); out.push(w); } }
  return out.sort((a, b) => a.localeCompare(b, 'pt'));
}

// Limpa e valida uma pergunta vinda do editor. Devolve null se estiver incompleta.
function cleanQuestion(x, uid, savePhoto) {
  const type = TYPES.includes(x.type) ? x.type : 'mc';
  const base = {
    id: x.id || uid(), type, text: String(x.text || '').trim(),
    time: Math.max(5, Math.min(300, parseInt(x.time, 10) || 20)),
    image: x.image && String(x.image).startsWith('data:') ? savePhoto(x.image) : /^\/uploads\/[\w.-]+$/.test(x.image || '') ? x.image : null,
    options: [], correct: [],
  };
  if (!base.text) return null;
  // explicação opcional: aparece junto da resposta certa (no projetor e no telemóvel)
  const ex = String(x.explain || '').trim().slice(0, 400); if (ex) base.explain = ex;
  if (type === 'mc') {
    base.options = (x.options || []).map(o => String(o).trim()).filter(Boolean).slice(0, 6);
    // votação: sem resposta certa (opinião, diagnóstico); não dá pontos
    if (x.poll) { base.poll = true; base.correct = []; if (base.options.length < 2) return null; return base; }
    base.correct = (x.correct || []).map(Number).filter(i => i >= 0 && i < base.options.length);
    if (base.options.length < 2 || !base.correct.length) return null;
  } else if (type === 'tf') {
    base.options = ['Verdadeiro', 'Falso'];
    const c = Number((x.correct || [0])[0]); base.correct = [c === 1 ? 1 : 0];
  } else if (type === 'fill') {
    base.blanks = blanksOf(base.text);
    if (!base.blanks.length) return null;
    base.options = (x.options || []).map(o => String(o).trim()).filter(Boolean).slice(0, 12); // palavras extra
  } else if (type === 'open') {
    base.accepted = (x.accepted || []).map(a => String(a).trim()).filter(Boolean).slice(0, 20);
  } else if (type === 'scale') {
    base.scaleTo = Number(x.scaleTo) === 10 ? 10 : 5;
    base.scaleMin = String(x.scaleMin || '').trim().slice(0, 40);
    base.scaleMax = String(x.scaleMax || '').trim().slice(0, 40);
  } else if (type === 'cloud') {
    base.words = Math.max(1, Math.min(3, parseInt(x.words, 10) || 3));
  } else if (type === 'rank') {
    base.options = (x.options || []).map(o => String(o).trim()).filter(Boolean).slice(0, 6);
    base.ordered = !!x.ordered;
    if (base.options.length < 2) return null;
  } else if (type === 'scramble') {
    base.answer = String(x.answer || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (cwNorm(base.answer).length < 2) return null;
  } else if (type === 'number') {
    const num = v => (v === '' || v == null || !isFinite(Number(v))) ? null : Number(v);
    base.min = num(x.min) ?? 0; base.max = num(x.max) ?? 10; base.answer = num(x.answer);
    base.step = num(x.step) > 0 ? num(x.step) : 1;
    if (base.answer == null || !(base.min < base.max) || base.answer < base.min || base.answer > base.max || (base.max - base.min) / base.step > 100000) return null;
  } else if (type === 'match') {
    base.pairs = (x.pairs || []).map(p => ({ left: String(p.left || '').trim().slice(0, 150), right: String(p.right || '').trim().slice(0, 150) })).filter(p => p.left && p.right).slice(0, 6);
    if (base.pairs.length < 2) return null;
  } else if (type === 'spot') {
    const f = v => Math.max(0, Math.min(1, Number(v) || 0));
    base.zones = (Array.isArray(x.zones) ? x.zones : x.zone ? [x.zone] : []).map(z => Object.assign({ x: f(z.x), y: f(z.y), w: f(z.w), h: f(z.h) }, Number.isInteger(z.g) && z.g >= 1 && z.g <= 12 ? { g: z.g } : {}))
      .filter(z => z.w >= 0.01 && z.h >= 0.01).slice(0, 12);
    if (!base.image || !base.zones.length) return null;
  } else if (type === 'potato') {
    const cl = (v, a, b, d) => { v = Math.round(Number(v)); return isFinite(v) && v ? Math.max(a, Math.min(b, v)) : d; };
    // cada ronda: um tema com palavras aceites, OU uma lista de perguntas (a pergunta segue com a batata)
    const qLine = l => { const [q, keys, a] = String(l).split(/\s+=\s+|\s*=\s*$/); return { q, keys: String(keys || '').split('|'), a }; };
    base.rounds = (x.rounds || []).map(r => {
      const qs = (Array.isArray(r && r.questions) ? r.questions : String((r && r.questions) || '').split('\n').filter(l => l.trim()).map(qLine))
        .map(o => ({ q: String((o && o.q) || '').trim().slice(0, 300), keys: (Array.isArray(o && o.keys) ? o.keys : [o && o.keys]).map(k => String(k || '').trim().slice(0, 120)).filter(Boolean).slice(0, 12), a: String((o && o.a) || '').trim().slice(0, 300) }))
        .filter(o => o.q && o.keys.length).slice(0, 60);
      const words = (Array.isArray(r && r.words) ? r.words : String((r && r.words) || '').split(/[,;\n]/)).map(w => String(w).trim().slice(0, 60)).filter(Boolean).slice(0, 300);
      return qs.length ? { theme: String((r && r.theme) || '').trim().slice(0, 120), questions: qs } : { theme: String((r && r.theme) || '').trim().slice(0, 120), words };
    }).filter(r => r.theme && ((r.questions || []).length || (r.words || []).length)).slice(0, 12);
    base.fuseMin = cl(x.fuseMin, 5, 300, 25); base.fuseMax = Math.max(base.fuseMin, cl(x.fuseMax, 5, 600, 50));
    base.pts = cl(x.pts, 1, 1000, 100); base.penalty = cl(x.penalty, 0, 1000, 50);
    if (!base.rounds.length) return null;
  } else if (type === 'hangman') {
    base.answer = String(x.answer || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    base.maxWrong = Math.max(4, Math.min(10, parseInt(x.maxWrong, 10) || 7));
    const n = cwNorm(base.answer).length;
    if (n < 2 || n > 24) return null;
  } else if (type === 'guess') {
    base.answer = String(x.answer || '').trim().slice(0, 20);
    base.maxTries = Math.max(3, Math.min(8, parseInt(x.maxTries, 10) || 6));
    const n = cwNorm(base.answer).length;
    if (n < 3 || n > 14) return null;
  } else if (type === 'cross') {
    base.entries = (x.entries || []).map(e => ({ word: String(e.word || '').trim().slice(0, 30), clue: String(e.clue || '').trim().slice(0, 200) }))
      .filter(e => cwNorm(e.word).length >= 2 && e.clue).slice(0, 15);
    const cw = buildCrossword(base.entries);
    if (cw.words.length < 2) return null;
    base.cross = { rows: cw.rows, cols: cw.cols, words: cw.words };   // só as palavras que cruzam
  }
  return base;
}

// Corrige uma resposta. raw: número (mc/tf/scale), lista de palavras (fill) ou texto (open).
// Devolve { error } ou { entry: { option?, value?, correct, frac } } (frac = fração certa, 0..1).
// o que vem do telemóvel só pode ser texto, número, ou uma lista deles (um objeto forjado rebentava as conversões)
const plain = v => v == null || ['string', 'number', 'boolean'].includes(typeof v);
function grade(q, raw) {
  if (!(plain(raw) || (Array.isArray(raw) && raw.length <= 50 && raw.every(plain)))) return { error: 'Resposta inválida.' };
  const t = typeOf(q);
  if (t === 'mc' || t === 'tf') {
    const option = parseInt(raw, 10);
    if (!(option >= 0 && option < q.options.length)) return { error: 'Resposta inválida.' };
    if (q.poll) return { entry: { option, correct: null, frac: 0 } };   // votação: não há certo nem errado
    const ok = q.correct.includes(option);
    return { entry: { option, correct: ok, frac: ok ? 1 : 0 } };
  }
  if (t === 'scale') {
    const v = parseInt(raw, 10);
    if (!(v >= 1 && v <= (q.scaleTo === 10 ? 10 : 5))) return { error: 'Resposta inválida.' };
    return { entry: { value: v, correct: null, frac: 0 } };
  }
  if (t === 'fill') {
    if (!Array.isArray(raw) || raw.length !== q.blanks.length) return { error: 'Preenche todos os espaços.' };
    const bank = new Set(wordBank(q).map(norm));
    const value = raw.map(w => String(w ?? '').slice(0, 60));
    if (value.some(w => !bank.has(norm(w)))) return { error: 'Resposta inválida.' };
    const right = value.filter((w, i) => norm(w) === norm(q.blanks[i])).length;
    return { entry: { value, correct: right === q.blanks.length, frac: right / q.blanks.length, right } };
  }
  if (t === 'cloud') {
    const value = cloudWords(raw, q.words || 3);
    if (!value.length) return { error: 'Escreve pelo menos uma palavra.' };
    return { entry: { value, correct: null, frac: 0 } };
  }
  if (t === 'rank') {
    const n = q.options.length;
    if (!Array.isArray(raw) || raw.length !== n) return { error: 'Ordena todas as opções.' };
    // o telemóvel manda as posições em que VÊ as opções (baralhadas); aqui passam a ser as do editor
    const shown = raw.map(v => parseInt(v, 10));
    if (new Set(shown).size !== n || shown.some(v => !(v >= 0 && v < n))) return { error: 'Resposta inválida.' };
    const order = rankOrder(q), value = shown.map(k => order[k]);
    if (!q.ordered) return { entry: { value, correct: null, frac: 0 } };
    const right = value.filter((v, pos) => v === pos).length;
    return { entry: { value, correct: right === n, frac: right / n, right } };
  }
  if (t === 'scramble') {
    const value = String(raw ?? '').trim().slice(0, 40);
    if (!cwNorm(value)) return { error: 'Forma a palavra.' };
    const ok = cwNorm(value) === cwNorm(q.answer);
    return { entry: { value, correct: ok, frac: ok ? 1 : 0 } };
  }
  if (t === 'guess' || t === 'hangman') return { error: 'Usa o teclado do jogo para adivinhar a palavra.' };
  if (t === 'potato') return { error: 'Na batata quente, escreve na caixa do jogo quando for a tua vez.' };
  if (t === 'number') {
    const v = Number(raw);
    if (raw === '' || raw == null || !isFinite(v) || v < q.min || v > q.max) return { error: `Escolhe um número entre ${q.min} e ${q.max}.` };
    const diff = Math.abs(v - q.answer), ok = diff < 1e-9;
    // perto também conta: até metade dos pontos, a descer até zero a meio do intervalo de distância
    const frac = ok ? 1 : Math.max(0, 0.5 * (1 - diff / ((q.max - q.min) / 2)));
    return { entry: { value: v, correct: ok, frac: Math.round(frac * 100) / 100, diff } };
  }
  if (t === 'match') {
    const n = q.pairs.length;
    if (!Array.isArray(raw) || raw.length !== n) return { error: 'Liga todos os itens.' };
    const shown = raw.map(v => parseInt(v, 10));
    if (shown.some(v => !(v >= 0 && v < n))) return { error: 'Resposta inválida.' };
    const order = matchOrder(q), value = shown.map(k => order[k]);   // posição em que o telemóvel via → par original
    const right = value.filter((v, i) => v === i).length;
    return { entry: { value, correct: right === n, frac: right / n, right } };
  }
  if (t === 'spot') {
    // [x1, y1, x2, y2, …]: no máximo um toque por zona certa (não vale tocar em todo o lado)
    const groups = spotGroups(q), n = groups.length, m = 0.01;
    if (!Array.isArray(raw) || raw.length < 2 || raw.length % 2 || raw.length > 2 * n) return { error: 'Toca na imagem.' };
    const v = raw.map(Number);
    if (!v.every(c => c >= 0 && c <= 1)) return { error: 'Resposta inválida.' };
    const inZ = (px, py, z) => px >= z.x - m && px <= z.x + z.w + m && py >= z.y - m && py <= z.y + z.h + m;
    const pts = []; for (let k = 0; k < v.length; k += 2) pts.push([v[k], v[k + 1]]);
    const right = groups.filter(zs => zs.some(z => pts.some(([px, py]) => inZ(px, py, z)))).length;
    return { entry: { value: v.map(c => Math.round(c * 1000) / 1000), correct: right === n, frac: right / n, right } };
  }
  if (t === 'cross') {
    const ws = q.cross.words;
    if (!Array.isArray(raw) || raw.length !== ws.length) return { error: 'Resposta inválida.' };
    const value = raw.map((v, k) => cwNorm(v).slice(0, ws[k].len));
    if (!value.some(Boolean)) return { error: 'Preenche pelo menos uma palavra.' };
    const right = value.filter((v, k) => v === ws[k].word).length;
    return { entry: { value, correct: right === ws.length, frac: right / ws.length, right } };
  }
  if (t === 'open') {
    const value = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!value) return { error: 'Escreve a tua resposta.' };
    // fica por validar; se coincidir com uma resposta modelo, fica marcada como sugestão
    const suggest = (q.accepted || []).length ? q.accepted.some(a => norm(a) === norm(value)) : null;
    return { entry: { value, correct: null, frac: 0, suggest } };
  }
  return { error: 'Resposta inválida.' };
}

// Textos para a grelha / Excel
function answerText(q, a) {
  if (!a) return '';
  const t = typeOf(q);
  if (t === 'hangman') return `${a.correct ? 'Acertou' : 'Não acertou'} · ${a.wrong || 0} erro(s) · letras: ${(a.value || []).join(' ')}`;
  if (t === 'potato') return `${(a.value || []).length ? (a.value || []).join(', ') + ' · ' : ''}${a.points || 0} pts${a.booms ? ` · ${a.booms} explos${a.booms > 1 ? 'ões' : 'ão'}` : ''}`;
  if (t === 'number') return String(a.value);
  if (t === 'match') return q.pairs.map((p, i) => `${p.left} → ${(q.pairs[(a.value || [])[i]] || {}).right || '—'}`).join(' | ');
  if (t === 'spot') return spotCount(q) > 1 ? `${a.right || 0} de ${spotCount(q)} encontrados` : a.correct ? 'Na zona certa' : 'Fora da zona';
  if (t === 'mc' || t === 'tf') return `${LETTERS[a.option]}) ${q.options[a.option]}`;
  if (t === 'fill') return (a.value || []).join(' | ');
  if (t === 'cloud') return (a.value || []).join(', ');
  if (t === 'rank') return (a.value || []).map((k, pos) => `${pos + 1}. ${q.options[k]}`).join(' | ');
  if (t === 'cross') return q.cross.words.map((w, k) => `${w.n}${w.dir === 'a' ? '→' : '↓'} ${(a.value || [])[k] || '—'}`).join(' | ');
  if (t === 'guess') return (a.value || []).join(' → ') + (a.correct ? ` (acertou à ${a.tries}ª)` : ' (não acertou)');
  return String(a.value ?? '');
}
function answerShort(q, a) {
  const t = typeOf(q);
  if (t === 'hangman') return a.correct ? `✓ ${a.wrong || 0} erros` : '✗';
  if (t === 'potato') return `🥔 ${a.points || 0}`;
  if (t === 'number') return String(a.value);
  if (t === 'match') return `${a.right ?? 0}/${q.pairs.length}`;
  if (t === 'spot') return spotCount(q) > 1 ? `${a.right || 0}/${spotCount(q)}` : a.correct ? 'zona' : 'fora';
  if (t === 'mc') return LETTERS[a.option];
  if (t === 'tf') return a.option === 0 ? 'V' : 'F';
  if (t === 'fill') return `${a.right ?? 0}/${q.blanks.length}`;
  if (t === 'scale') return String(a.value);
  if (t === 'rank') return q.ordered ? `${a.right ?? 0}/${q.options.length}` : '1º ' + String(q.options[(a.value || [])[0]] || '').slice(0, 14);
  if (t === 'cloud') { const j = (a.value || []).join(', '); return j.slice(0, 18) + (j.length > 18 ? '…' : ''); }
  if (t === 'cross') return `${a.right ?? 0}/${q.cross.words.length}`;
  if (t === 'guess') return a.correct ? `${a.tries}ª tent.` : `✗ ${(a.value || []).length} tent.`;
  if (t === 'scramble') return String(a.value || '').toUpperCase().slice(0, 18);
  return String(a.value || '').slice(0, 18) + (String(a.value || '').length > 18 ? '…' : '');
}
function correctText(q) {
  const t = typeOf(q);
  if (t === 'hangman') return String(q.answer).toUpperCase();
  if (t === 'potato') return '(batata quente: palavras aceites por tema)';
  if (t === 'number') return String(q.answer);
  if (t === 'match') return q.pairs.map(p => `${p.left} → ${p.right}`).join(' | ');
  if (t === 'spot') return spotCount(q) > 1 ? `(${spotCount(q)} zonas marcadas na imagem)` : '(zona marcada na imagem)';
  if (t === 'mc' && q.poll) return 'Votação (sem resposta certa)';
  if (t === 'mc' || t === 'tf') return q.correct.map(i => `${LETTERS[i]}) ${q.options[i]}`).join(' | ');
  if (t === 'fill') return q.blanks.join(' | ');
  if (t === 'open') return (q.accepted || []).length ? 'Modelo: ' + q.accepted.join(' | ') + ' (validada pelo formador)' : '(resposta livre — validada pelo formador)';
  if (t === 'cloud') return '(nuvem de palavras — sem resposta certa)';
  if (t === 'scramble' || t === 'guess') return String(q.answer).toUpperCase();
  if (t === 'cross') return q.cross.words.map(w => `${w.n}${w.dir === 'a' ? '→' : '↓'} ${w.display}`).join(' | ');
  if (t === 'rank') return q.ordered ? q.options.map((o, k) => `${k + 1}. ${o}`).join(' | ') : '(ranking de opinião — sem ordem certa)';
  return '(escala 1–5 — sem resposta certa)';
}
function correctShort(q) {
  const t = typeOf(q);
  if (t === 'hangman') return String(q.answer).toUpperCase().slice(0, 14);
  if (t === 'potato') return 'batata';
  if (t === 'number') return String(q.answer);
  if (t === 'match') return q.pairs.length + ' pares';
  if (t === 'spot') return spotCount(q) > 1 ? spotCount(q) + ' zonas' : 'zona';
  if (t === 'mc') return q.poll ? 'votação' : q.correct.map(i => LETTERS[i]).join('/');
  if (t === 'tf') return q.correct[0] === 0 ? 'V' : 'F';
  if (t === 'fill') return q.blanks.join(', ');
  if (t === 'open') return (q.accepted || []).length ? q.accepted[0] + (q.accepted.length > 1 ? '…' : '') : 'livre';
  if (t === 'cloud') return 'nuvem';
  if (t === 'scramble' || t === 'guess') return String(q.answer).toUpperCase().slice(0, 14);
  if (t === 'cross') return q.cross.words.length + ' palavras';
  if (t === 'rank') return q.ordered ? 'ordem' : 'opinião';
  return `1–${q.scaleTo === 10 ? 10 : 5}`;
}

// O que o telemóvel recebe da pergunta (nunca a resposta certa). hide = só no ecrã do formador.
function publicQuestion(q, hide) {
  const t = typeOf(q);
  // na imagem do "encontrar na imagem" é a própria pergunta: vai sempre (a zona certa nunca vai)
  const p = { type: t, time: q.time, text: hide ? '' : displayText(q), image: hide && t !== 'spot' ? null : (q.image || null), hidden: !!hide };
  if (t === 'number') Object.assign(p, { min: q.min, max: q.max, step: q.step });
  if (t === 'hangman') { p.shape = hangShape(q); p.maxWrong = q.maxWrong || 7; }   // só o tamanho das palavras, nunca as letras
  if (t === 'potato') p.rounds = q.rounds.length;   // os temas e as palavras aceites nunca vão para o telemóvel
  if (t === 'spot') p.spots = spotCount(q);      // quantos sítios há para encontrar (não onde)
  if (t === 'mc' && q.poll) p.poll = true;
  if (t === 'match') { p.lefts = q.pairs.map((x, i) => hide ? '' : x.left); p.rights = matchOrder(q).map((i, k) => ({ k, text: hide ? '' : q.pairs[i].right, letter: LETTERS[k] })); }
  if (t === 'mc' || t === 'tf') p.options = hide ? q.options.map(() => '') : q.options;
  if (t === 'fill') { p.blanks = q.blanks.length; p.bank = wordBank(q); if (!hide) p.parts = String(q.text).split(BLANK_RE).filter((_, i) => i % 2 === 0); }
  if (t === 'scale') { p.scaleMin = q.scaleMin || ''; p.scaleMax = q.scaleMax || ''; p.scaleTo = q.scaleTo === 10 ? 10 : 5; }
  if (t === 'cloud') p.words = q.words || 3;
  if (t === 'scramble') { p.tiles = scrambleTiles(q); p.shape = scrambleShape(q); }
  if (t === 'guess') { p.len = cwNorm(q.answer).length; p.maxTries = q.maxTries || 6; }
  // palavras cruzadas: a grelha sem as letras (as pistas só no projetor, se escondidas nos telemóveis)
  if (t === 'cross') p.cross = { rows: q.cross.rows, cols: q.cross.cols, words: q.cross.words.map(w => ({ n: w.n, dir: w.dir, r: w.r, c: w.c, len: w.len, clue: hide ? '' : w.clue })) };
  // ranking: opções pela ordem baralhada; o telemóvel devolve os números originais (i)
  if (t === 'rank') p.ordered = !!q.ordered;
  // ranking: o telemóvel só conhece a ordem em que vê as opções (o nº do editor denunciaria a ordem certa)
  if (t === 'rank') p.items = rankOrder(q).map((i, k) => ({ i: k, text: hide ? '' : q.options[i], letter: LETTERS[k] }));
  return p;
}
// a resposta certa, para mostrar ao formando quando chega a altura
function solutionOf(q) {
  const s = solutionBase(q);
  return q.explain && s ? { ...s, explain: q.explain } : q.explain ? { explain: q.explain } : s;
}
function solutionBase(q) {
  const t = typeOf(q);
  if (t === 'hangman') return { answer: q.answer };
  if (t === 'potato') return { rounds: q.rounds.map(r => ({ theme: r.theme })) };
  if (t === 'number') return { answer: q.answer };
  if (t === 'match') return { pairs: q.pairs };
  if (t === 'spot') return { zones: zonesOf(q) };
  if (t === 'mc' || t === 'tf') return { correct: q.correct };
  if (t === 'fill') return { blanks: q.blanks };
  if (t === 'open') return { accepted: q.accepted || [] };
  if (t === 'rank' && q.ordered) return { order: q.options };
  if (t === 'scramble' || t === 'guess') return { answer: q.answer };
  if (t === 'cross') return { words: q.cross.words.map(w => ({ n: w.n, dir: w.dir, word: w.word, display: w.display })) };
  return {};
}

// Texto completo para as fichas (sem letras nem abreviaturas)
const fillSentence = (q, words) => { let k = 0; return String(q.text).replace(BLANK_RE, () => { const w = words[k++]; return w ? w : '_____'; }); };
function plainCorrect(q) {
  const t = typeOf(q);
  if (t === 'hangman') return String(q.answer).toUpperCase();
  if (t === 'potato') return q.rounds.map(r => `${r.theme}: ${(r.questions || []).length ? r.questions.length + ' perguntas' : r.words.join(', ')}`).join(' | ');
  if (t === 'number') return String(q.answer);
  if (t === 'match') return q.pairs.map(p => `${p.left} → ${p.right}`).join('; ');
  if (t === 'spot') return spotCount(q) > 1 ? `As ${spotCount(q)} zonas marcadas na imagem` : 'A zona marcada na imagem';
  if (t === 'mc' && q.poll) return 'Votação (sem resposta certa)';
  if (t === 'mc' || t === 'tf') return q.correct.map(i => q.options[i]).join(' / ');
  if (t === 'fill') return fillSentence(q, q.blanks);
  if (t === 'open') return (q.accepted || []).length ? q.accepted.join(' / ') : 'Sem resposta modelo (validada pelo formador)';
  if (t === 'rank' && q.ordered) return q.options.map((o, k) => `${k + 1}. ${o}`).join('; ');
  if (t === 'scramble' || t === 'guess') return String(q.answer).toUpperCase();
  if (t === 'cross') return q.cross.words.map(w => `${w.n} ${w.dir === 'a' ? 'horizontal' : 'vertical'}: ${w.display}`).join('; ');
  return '—';
}
function plainAnswer(q, a) {
  if (!a) return '';
  const t = typeOf(q);
  if (t === 'hangman') return `${a.correct ? 'Acertou' : 'Não acertou'} com ${a.wrong || 0} erro(s) · letras: ${(a.value || []).join(' ') || '—'}`;
  if (t === 'potato') return `Palavras: ${(a.value || []).join(', ') || '—'} · ${a.points || 0} pontos${a.booms ? ` · rebentou ${a.booms}×` : ''}`;
  if (t === 'number') return String(a.value) + (a.correct ? '' : ` (a resposta era ${q.answer})`);
  if (t === 'match') return q.pairs.map((p, i) => `${p.left} → ${(q.pairs[(a.value || [])[i]] || {}).right || '—'}${(a.value || [])[i] === i ? ' ✓' : ' ✗'}`).join('; ');
  if (t === 'spot') return spotCount(q) > 1 ? `Encontrou ${a.right || 0} de ${spotCount(q)}` : a.correct ? 'Tocou na zona certa' : 'Tocou fora da zona certa';
  if (t === 'mc' || t === 'tf') return q.options[a.option];
  if (t === 'fill') return fillSentence(q, a.value || []);
  if (t === 'scale') { const N = q.scaleTo === 10 ? 10 : 5, lab = a.value === 1 ? q.scaleMin : a.value === N ? q.scaleMax : ''; return `${a.value} de ${N}${lab ? ' (' + lab + ')' : ''}`; }
  if (t === 'cloud') return (a.value || []).join(', ');
  if (t === 'rank') return (a.value || []).map((k, pos) => `${pos + 1}. ${q.options[k]}`).join('; ');
  if (t === 'scramble') return String(a.value || '').toUpperCase();
  if (t === 'cross') return q.cross.words.map((w, k) => `${w.n} ${w.dir === 'a' ? 'horizontal' : 'vertical'}: ${(a.value || [])[k] || '(em branco)'}${(a.value || [])[k] === w.word ? ' ✓' : ' ✗'}`).join('; ');
  if (t === 'guess') return `Tentativas: ${(a.value || []).join(', ')}${a.correct ? ` — acertou à ${a.tries}ª` : ' — não acertou'}`;
  return String(a.value ?? '');
}

// resposta guardada → como o telemóvel a conhece (o ranking volta à ordem em que ele vê as opções)
function forPhone(q, v) {
  if (typeOf(q) === 'rank' && Array.isArray(v)) return v.map(i => rankOrder(q).indexOf(i));
  if (typeOf(q) === 'match' && Array.isArray(v)) return v.map(i => matchOrder(q).indexOf(i));
  return v;
}
// correspondência: ordem (sempre igual) em que as opções da direita aparecem no telemóvel e no projetor
const matchOrder = q => rankOrder({ id: q.id + ':m', options: q.pairs });

// batata quente: a palavra conta se for uma das aceites do tema da ronda (acentos, maiúsculas, pontuação e plural
// não contam; "a/b" na lista são alternativas) e se ainda não foi dita nesta ronda
// pergunta da batata: certa se for igual a uma das respostas aceites (sem espaços, acentos nem maiúsculas: "=B3*C3",
// "A2:A10", "62,5" — estas têm de ser iguais) ou, se a resposta aceite só tiver palavras, se as tiver todas
// ("esquerda direita" aceita "o texto à esquerda e os números à direita"); "a/b" são alternativas
function potatoAnswer(item, typed) {
  const raw = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, '');
  const forms = t => { const n = norm(t); return n ? [n, n.replace(/es$/, ''), n.replace(/s$/, '')] : []; };
  const have = new Set(norm(typed).split(' ').filter(Boolean).flatMap(forms));
  if (!raw(typed)) return false;
  return item.keys.some(k => String(k).split('/').some(alt => {
    if (raw(alt) && raw(alt) === raw(typed)) return true;
    // com números ou símbolos (62,5 · C4 · =B3*C3 · $H$1) tem de ser igual; só com palavras, basta contê-las
    if (/[^\p{L}\s]/u.test(alt)) return false;
    const kt = norm(alt).split(' ').filter(Boolean);
    return kt.length > 0 && kt.every(t => forms(t).some(f => have.has(f)));
  }));
}
function potatoCheck(q, round, word, used) {
  const r = (q.rounds || [])[round]; if (!r) return { ok: false, reason: 'no' };
  if ((r.questions || []).length) {   // modo perguntas: confere com a pergunta em curso (used = [índice da pergunta])
    const item = r.questions[used[0] || 0];
    return item && potatoAnswer(item, word) ? { ok: true, key: 'q' + (used[0] || 0) } : { ok: false, reason: 'no' };
  }
  const forms = w => { const n = norm(w); return n ? [n, n.replace(/es$/, ''), n.replace(/s$/, '')].filter(Boolean) : []; };
  const typed = forms(word); if (!typed.length) return { ok: false, reason: 'no' };
  for (const entry of r.words) {
    const alts = String(entry).split('/');
    if (alts.some(a => forms(a).some(f => typed.includes(f)))) {
      const key = norm(alts[0]);
      return used.includes(key) ? { ok: false, reason: 'used', key } : { ok: true, key };
    }
  }
  return { ok: false, reason: 'no', key: norm(word) };
}
// Nota de 0 a 20: média das perguntas com resposta certa (as meio certas contam a parte certa; certa = inteira).
// Não contam: opiniões, votações, respostas livres por validar e jogos ao vivo (batata quente).
// escala qualitativa (sobre a % de acerto): <50 Insuficiente · 50–69 Suficiente · 70–89 Elevado · ≥90 Excelente
const QUAL_LEVELS = [[90, 'Excelente'], [70, 'Elevado'], [50, 'Suficiente'], [0, 'Insuficiente']];
const qualOf = pct => pct == null ? null : QUAL_LEVELS.find(([min]) => pct >= min)[1];
function finalGrade(questions, answers, asked, sid, scale = 20) {
  if (scale === 'q') { const pct = finalGrade(questions, answers, asked, sid, 100); return pct == null ? null : qualOf(pct); }
  const idx = asked.filter(i => { const q = questions[i]; if (!q || typeOf(q) === 'potato') return false; return isGraded(q) || Object.values(answers[i] || {}).some(a => a.correct != null); });
  if (!idx.length) return null;
  const sum = idx.reduce((s, i) => { const a = (answers[i] || {})[sid]; if (!a) return s; return s + (a.correct === true ? 1 : typeof a.frac === 'number' ? Math.max(0, Math.min(1, a.frac)) : 0); }, 0);
  return scale === 100 ? Math.round(sum / idx.length * 100) : Math.round(sum / idx.length * 200) / 10;
}
// forca: tamanho de cada palavra, letras já descobertas ("_" nas outras) e pontuação (menos erros, mais pontos)
const hangShape = q => String(q.answer).trim().split(/\s+/).map(w => cwNorm(w).length).filter(Boolean);
function hangMask(q, letters) {
  const set = new Set(letters);
  return String(q.answer).trim().split(/\s+/).map(w => [...cwNorm(w)].map(c => set.has(c) ? c : '_').join('')).filter(Boolean).join(' ');
}
const hangFrac = (q, wrong) => Math.max(0.3, 1 - 0.6 * wrong / (q.maxWrong || 7));
module.exports = { hangShape, hangMask, hangFrac, potatoAnswer, qualOf, finalGrade, potatoCheck, zonesOf, spotCount, matchOrder, forPhone, guessColors, guessFrac, cwNorm, scrambleTiles, scrambleShape, rankOrder, cloudWords, plainCorrect, plainAnswer,  TYPES, typeOf, isGraded, blanksOf, displayText, wordBank, cleanQuestion, grade, answerText, answerShort, correctText, correctShort, publicQuestion, solutionOf, norm };
