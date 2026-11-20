const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LETTERS = 'ABCDEF';
function initials(name) { return String(name).trim().split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
function colorFor(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 65% 55%)`; }
function avatar(p, cls = '') {
  if (p && p.photo) return `<img class="avatar ${cls}" src="${esc(p.photo)}" alt="${esc(p.name)}">`;
  return `<span class="avatar ${cls}" style="background:${colorFor(p?.name || '?')}">${esc(initials(p?.name || '?'))}</span>`;
}
function toast(msg, ms = 2500) {
  const t = document.createElement('div'); t.className = 'toast slide-up'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function muteButton() {
  const b = document.createElement('button'); b.className = 'mute-btn'; b.title = 'Som';
  const upd = () => b.textContent = Sound.isMuted() ? '🔇' : '🔊'; upd();
  b.onclick = () => { Sound.init(); Sound.setMuted(!Sound.isMuted()); upd(); };
  document.body.appendChild(b);
}
// Reduz uma imagem para JPEG quadrado (para fotos dos alunos)
function resizeImage(file, size = 320, square = true) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      let sx = 0, sy = 0, sw = img.width, sh = img.height, w, h;
      if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 3; sw = sh = m; w = h = size; }
      else { const k = Math.min(1, size / Math.max(sw, sh)); w = sw * k; h = sh * k; }
      c.width = w; c.height = h; c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = rej; img.src = url;
  });
}

// Boneco simples a dançar com a foto/iniciais do aluno na cabeça.
// move: jump | disco | wave | sway | robot
function dancer(p, move = 'wave', color = '#ffd93d', crown = false) {
  return `<div class="dancer m-${move}" style="--body:${color}">
    <div class="dz">
      ${crown ? '<div class="crown">👑</div>' : ''}
      <div class="arm l"></div><div class="arm r"></div>
      <div class="leg l"></div><div class="leg r"></div>
      <div class="torso"></div>
      <div class="head">${avatar(p)}</div>
    </div></div>`;
}
