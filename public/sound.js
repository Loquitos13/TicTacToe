// Música e efeitos sonoros sintetizados (Web Audio) — sem ficheiros, sem direitos de autor.
const Sound = (() => {
  let ctx = null, master = null, musicGain = null, sfxGain = null;
  let volume = 0.9; // volume geral (0–1); nos telemóveis dos alunos é mais baixo
  let muted = false, current = null, timerId = null, step = 0, nextTime = 0;
  try { muted = localStorage.getItem('aq_muted') === '1'; } catch {}

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : volume; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.5; musicGain.connect(comp);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.8; sfxGain.connect(comp);
  }
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);

  function tone(dest, t, midi, dur, type = 'square', vol = 0.2, slideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(hz(midi), t);
    if (slideTo != null) o.frequency.exponentialRampToValueAtTime(hz(slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  // som de marimba/pluck (seno com ataque curto)
  function pluck(dest, t, midi, dur, vol) {
    tone(dest, t, midi, dur, 'sine', vol);
    tone(dest, t, midi + 12, dur * 0.4, 'sine', vol * 0.3);
  }
  function bandNoise(dest, t, dur, vol, freq, q = 1) {
    if (!noiseBuf) noise(dest, t, 0.001, 0.0001);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.3); s.stop(t + dur + 0.05);
  }
  let noiseBuf = null;
  function noise(dest, t, dur, vol = 0.15, hp = 6000) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t); s.stop(t + dur);
  }
  function kick(dest, t, vol = 0.6) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.25);
  }

  // ----- Faixas (16 passos por compasso) -----
  // Lobby: alegre, maior, saltitante
  const lobbyChords = [[60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74]]; // C Am F G
  const lobbyMelody = [72, null, 76, null, 79, 76, null, 72, 74, null, 77, null, 76, null, 74, null];
  const tracks = {
    lobby: {
      bpm: 116,
      play(t, s) {
        const bar = Math.floor(s / 16) % 4, st = s % 16, ch = lobbyChords[bar];
        if (st % 4 === 0) kick(musicGain, t, 0.45);
        if (st % 4 === 2) noise(musicGain, t, 0.05, 0.08);
        if (st % 8 === 4) noise(musicGain, t, 0.12, 0.12, 2500);
        if (st % 2 === 0) tone(musicGain, t, ch[0] - 24, 0.18, 'triangle', 0.35);
        tone(musicGain, t, ch[st % 3] + 12, 0.09, 'square', 0.05);
        const m = lobbyMelody[st];
        if (m && bar % 2 === 0) tone(musicGain, t, m + (bar === 2 ? -3 : 0), 0.22, 'triangle', 0.14);
      },
    },
    // Pergunta: tensa, menor, mais rápida
    // Pergunta no ar: música de "pensar" leve e divertida (marimba + baixo + shaker)
    think: {
      bpm: 112,
      play(t, s) {
        const bar = Math.floor(s / 16) % 8, st = s % 16;
        const roots = [48, 45, 41, 43, 48, 45, 50, 43];            // C Am F G C Am Dm G
        const r = roots[bar];
        if (st % 8 === 0) kick(musicGain, t, 0.28);
        if (st % 2 === 1) noise(musicGain, t, 0.025, 0.035, 7000);   // shaker
        if (st % 8 === 4) noise(musicGain, t, 0.08, 0.06, 3000);     // snare suave
        if ([0, 3, 6, 10].includes(st)) pluck(musicGain, t, r - 12, 0.3, 0.22);
        const pent = [0, 2, 4, 7, 9, 12, 14, 16];
        const mel = [0, null, 2, 4, null, 3, 2, null, 5, null, 4, 2, null, 1, null, null];
        const m = mel[(st + (bar % 2) * 3) % 16];
        if (m != null) pluck(musicGain, t, r + 12 + pent[m], 0.25, 0.13);
        if (st === 0) [0, 4, 7].forEach(k => tone(musicGain, t, r + 12 + k, 1.6, 'sine', 0.025));
        if (st % 4 === 0) tone(musicGain, t, 100, 0.03, 'sine', 0.05);   // tic-tac discreto
      },
    },
    // Classificação/fim: festivo
    party: {
      bpm: 124,
      play(t, s) {
        const bar = Math.floor(s / 16) % 4, st = s % 16;
        const ch = [[65, 69, 72], [67, 71, 74], [64, 67, 71], [69, 72, 76]][bar];
        if (st % 4 === 0) kick(musicGain, t, 0.5);
        if (st % 4 === 2) noise(musicGain, t, 0.06, 0.1);
        if (st % 8 === 4) noise(musicGain, t, 0.15, 0.14, 2000);
        tone(musicGain, t, ch[0] - 24 + (st % 4 === 3 ? 12 : 0), 0.12, 'triangle', 0.3);
        if ([0, 3, 6, 10, 12].includes(st)) for (const n of ch) tone(musicGain, t, n, 0.14, 'square', 0.035);
        const mel = [76, null, 79, 81, null, 79, 76, null, 74, null, 76, null, 72, null, null, null];
        if (mel[st] && bar >= 2) tone(musicGain, t, mel[st] - (bar === 3 ? 0 : 2), 0.18, 'triangle', 0.14);
      },
    },
  };

  function scheduler() {
    const tr = tracks[current]; if (!tr) return;
    const stepDur = 60 / tr.bpm / 4;
    while (nextTime < ctx.currentTime + 0.12) { tr.play(nextTime, step); step++; nextTime += stepDur; }
  }
  function music(name) {
    init();
    if (current === name) return;
    stopMusic();
    if (!tracks[name]) return;
    current = name; step = 0; nextTime = ctx.currentTime + 0.05;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(0, ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.6); // entra suave
    timerId = setInterval(scheduler, 25);
  }
  // pára a música com um fade-out curto (não corta de repente)
  function stopMusic(fade = 0.5) {
    clearInterval(timerId); timerId = null; current = null;
    if (ctx && fade) { const t = ctx.currentTime; musicGain.gain.cancelScheduledValues(t); musicGain.gain.setValueAtTime(musicGain.gain.value, t); musicGain.gain.linearRampToValueAtTime(0, t + fade); }
  }

  const sfx = {
    // fim do tempo / todos responderam: sininho suave
    softEnd() {
      const t = ctx.currentTime;
      [[88, 0], [83, 0.18], [76, 0.36]].forEach(([n, d]) => { tone(sfxGain, t + d, n, 1.6, 'sine', 0.12); tone(sfxGain, t + d, n + 19, 0.6, 'sine', 0.02); });
    },
    // enquanto as barras da sondagem crescem: notas a subir + "swoosh" suave
    pollRise(sec = 1.4) {
      const t = ctx.currentTime, scale = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84];
      const n = 14;
      for (let i = 0; i < n; i++) pluck(sfxGain, t + i * sec / n, scale[Math.floor(i / n * scale.length)], 0.18, 0.07 + 0.05 * i / n);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(660, t + sec);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + sec * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + sec + 0.2);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + sec + 0.3);
      tone(sfxGain, t + sec, 84, 0.5, 'sine', 0.12);
    },
    // revelar a resposta correta: brilho + acorde
    revealCorrect() {
      const t = ctx.currentTime;
      [84, 88, 91, 96, 100].forEach((n, i) => tone(sfxGain, t + i * 0.045, n, 0.3, 'sine', 0.08));
      [60, 64, 67, 72].forEach(n => { tone(sfxGain, t + 0.22, n, 1.4, 'triangle', 0.1); tone(sfxGain, t + 0.22, n + 12, 0.8, 'sine', 0.05); });
      kick(sfxGain, t + 0.22, 0.35); noise(sfxGain, t + 0.22, 0.5, 0.08, 6000);
    },
    // festa no pódio: aplausos + cornetas de festa + apito
    cheer(sec = 2.6) {
      const t = ctx.currentTime;
      for (let i = 0; i < 160; i++) { const d = Math.random() * sec; bandNoise(sfxGain, t + d, 0.04 + Math.random() * 0.05, 0.12 * (1 - d / sec * 0.6), 1500 + Math.random() * 2500, 2); }
      [[0.1, 62, 74], [0.35, 65, 77], [0.6, 67, 79]].forEach(([d, a, b]) => tone(sfxGain, t + d, a, 0.35, 'sawtooth', 0.06, b));
      tone(sfxGain, t + 1.0, 96, 0.12, 'sine', 0.1, 98); tone(sfxGain, t + 1.15, 96, 0.3, 'sine', 0.1, 93);
      [72, 76, 79, 84].forEach((n, i) => tone(sfxGain, t + 0.9 + i * 0.1, n, 0.4, 'square', 0.05));
    },
    pop() { const t = ctx.currentTime; tone(sfxGain, t, 76, 0.08, 'sine', 0.3, 88); tone(sfxGain, t + 0.06, 88, 0.1, 'sine', 0.2); },
    tick() { const t = ctx.currentTime; tone(sfxGain, t, 96, 0.04, 'square', 0.12); },
    tock() { const t = ctx.currentTime; tone(sfxGain, t, 84, 0.06, 'square', 0.18); },
    whoosh() { const t = ctx.currentTime; noise(sfxGain, t, 0.4, 0.25, 800); tone(sfxGain, t, 55, 0.35, 'sine', 0.3, 79); },
    gong() { const t = ctx.currentTime; [48, 55, 60, 64].forEach((n, i) => tone(sfxGain, t, n, 1.4, 'triangle', 0.18 - i * 0.03)); noise(sfxGain, t, 0.3, 0.2, 300); },
    correct() { const t = ctx.currentTime; [72, 76, 79, 84].forEach((n, i) => tone(sfxGain, t + i * 0.08, n, 0.25, 'triangle', 0.25)); },
    wrong() { const t = ctx.currentTime; tone(sfxGain, t, 52, 0.25, 'sawtooth', 0.18, 46); tone(sfxGain, t + 0.22, 46, 0.4, 'sawtooth', 0.18, 40); },
    sent() { const t = ctx.currentTime; tone(sfxGain, t, 79, 0.1, 'sine', 0.25); tone(sfxGain, t + 0.07, 86, 0.15, 'sine', 0.2); },
    fanfare() {
      const t = ctx.currentTime; const seq = [[67, 0, .15], [67, .15, .15], [67, .3, .15], [72, .45, .7], [76, 1.2, .2], [79, 1.4, .9]];
      seq.forEach(([n, d, l]) => { tone(sfxGain, t + d, n, l, 'square', 0.12); tone(sfxGain, t + d, n - 12, l, 'triangle', 0.2); });
      kick(sfxGain, t + .45); kick(sfxGain, t + 1.4); noise(sfxGain, t + 1.4, 0.6, 0.15, 3000);
    },
    drumroll(sec = 2.5) {
      const t = ctx.currentTime; const n = Math.floor(sec / 0.05);
      for (let i = 0; i < n; i++) noise(sfxGain, t + i * 0.05, 0.05, 0.04 + 0.12 * i / n, 1500);
      kick(sfxGain, t + sec, 0.8); noise(sfxGain, t + sec, 0.8, 0.25, 4000);
    },
  };
  function play(name, ...a) { init(); if (sfx[name]) sfx[name](...a); }

  function setMuted(m) {
    muted = m; try { localStorage.setItem('aq_muted', m ? '1' : '0'); } catch {}
    if (master) master.gain.setTargetAtTime(m ? 0 : volume, ctx.currentTime, 0.05);
  }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master && !muted) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  }
  return { init, music, stopMusic, play, setMuted, setVolume, isMuted: () => muted, get current() { return current; } };
})();

// Confettis simples em canvas
const Confetti = (() => {
  let cv, cx, parts = [], raf = null;
  function burst(n = 180) {
    if (!cv) {
      cv = document.createElement('canvas');
      Object.assign(cv.style, { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 });
      document.body.appendChild(cv); cx = cv.getContext('2d');
    }
    cv.width = innerWidth; cv.height = innerHeight;
    const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#ff9f1c'];
    for (let i = 0; i < n; i++) parts.push({
      x: innerWidth / 2 + (Math.random() - .5) * innerWidth * .6, y: innerHeight * .35,
      vx: (Math.random() - .5) * 16, vy: -Math.random() * 16 - 4, r: Math.random() * 6 + 4,
      c: colors[i % colors.length], a: Math.random() * 6, va: (Math.random() - .5) * .4, life: 0,
    });
    if (!raf) loop();
  }
  function loop() {
    cx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach(p => { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va; p.life++;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.fillStyle = p.c; cx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); cx.restore(); });
    parts = parts.filter(p => p.y < cv.height + 40 && p.life < 400);
    raf = parts.length ? requestAnimationFrame(loop) : (cx.clearRect(0, 0, cv.width, cv.height), null);
  }
  return { burst };
})();
