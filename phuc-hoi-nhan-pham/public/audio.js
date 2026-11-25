// Âm thanh tổng hợp hoàn toàn bằng Web Audio API (không dùng file nhạc có bản quyền):
// nhạc nền lặp, búa đập đá, búa toà, còng tay, chuông quà, pháo hoa, còi báo động + hàng đợi TTS không chồng tiếng.
let ctx = null;
let master; let bgmGain; let sfxGain; let voiceGain;
let bgmTimer = null;
let step = 0;
let nextTime = 0;
let noiseBuf = null;

const BPM = 96;
const STEP = 60 / BPM / 4;
// Am – F – C – G
const BASS = [45, 45, 45, 45, 41, 41, 41, 41, 48, 48, 48, 48, 43, 43, 43, 43];
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
const LEAD = [69, null, 72, null, 71, null, 69, 67, null, 69, null, null, 64, null, 67, null,
  65, null, 69, null, 67, null, 65, 64, null, 65, null, null, 62, null, 64, null];

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export function initAudio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(master);
  bgmGain = ctx.createGain(); bgmGain.gain.value = 0.16; bgmGain.connect(comp);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.55; sfxGain.connect(comp);
  voiceGain = ctx.createGain(); voiceGain.gain.value = 1; voiceGain.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function resumeAudio() { initAudio(); return ctx.resume(); }
export function audioRunning() { return ctx && ctx.state === 'running'; }

function env(g, t, a, peak, dcy) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
}

function osc(type, freq, t, dur, peak, dest = sfxGain, attack = 0.005) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  env(g, t, attack, peak, dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + attack + dur + 0.05);
  return o;
}

function noise(t, dur, peak, filterType = 'highpass', freq = 6000, dest = sfxGain, q = 1) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t, 0.002, peak, dur);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}

// ───── nhạc nền ─────
function scheduleStep(t) {
  const s = step % 16;
  const bar = Math.floor(step / 16) % 4;
  if (s % 4 === 0) { const o = osc('sine', 120, t, 0.25, 0.9, bgmGain); o.frequency.exponentialRampToValueAtTime(42, t + 0.18); }
  if (s % 4 === 2) noise(t, 0.05, 0.25, 'highpass', 8000, bgmGain);
  if (s === 4 || s === 12) noise(t, 0.16, 0.35, 'bandpass', 1800, bgmGain, 0.8);
  if (s % 2 === 0) {
    const b = BASS[(bar * 4 + Math.floor(s / 4)) % 16];
    const o = ctx.createOscillator(); const g = ctx.createGain(); const f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = midi(b - 12); f.type = 'lowpass'; f.frequency.value = 500;
    env(g, t, 0.01, 0.35, STEP * 1.6); o.connect(f).connect(g).connect(bgmGain); o.start(t); o.stop(t + STEP * 2);
  }
  if (s === 0) for (const n of CHORDS[bar]) osc('triangle', midi(n), t, STEP * 15, 0.07, bgmGain, 0.3);
  const l = LEAD[(step % 32)];
  if (l && bar % 2 === 1) osc('square', midi(l), t, STEP * 1.5, 0.045, bgmGain);
  step++;
}

export function startBgm() {
  initAudio();
  if (bgmTimer) return;
  nextTime = ctx.currentTime + 0.1;
  bgmTimer = setInterval(() => {
    while (nextTime < ctx.currentTime + 0.25) { scheduleStep(nextTime); nextTime += STEP; }
  }, 60);
}

function duck(on) {
  if (!ctx) return;
  const t = ctx.currentTime;
  bgmGain.gain.cancelScheduledValues(t);
  bgmGain.gain.setTargetAtTime(on ? 0.05 : 0.16, t, 0.15);
}

// ───── hiệu ứng ─────
export const sfx = {
  hammer() { if (!ctx) return; const t = ctx.currentTime; osc('sine', 90, t, 0.18, 0.9); noise(t, 0.08, 0.7, 'bandpass', 3200, sfxGain, 2); osc('square', 1240, t, 0.25, 0.12); osc('sine', 1870, t, 0.35, 0.1); },
  hammerStorm(n = 6) { if (!ctx) return; for (let i = 0; i < n; i++) setTimeout(() => sfx.hammer(), i * 170 + Math.random() * 60); },
  gavel() { if (!ctx) return; const t = ctx.currentTime; for (const dt of [0, 0.22]) { osc('triangle', 210, t + dt, 0.12, 0.9); noise(t + dt, 0.05, 0.5, 'bandpass', 900, sfxGain, 3); } },
  cuffs() { if (!ctx) return; const t = ctx.currentTime; for (let i = 0; i < 5; i++) { osc('square', 2400 + Math.random() * 900, t + i * 0.045, 0.06, 0.06); noise(t + i * 0.045, 0.03, 0.2, 'highpass', 5000); } },
  chime() { if (!ctx) return; const t = ctx.currentTime; [76, 79, 83, 88].forEach((n, i) => osc('sine', midi(n), t + i * 0.08, 0.5, 0.25)); },
  coin() { if (!ctx) return; const t = ctx.currentTime; osc('square', midi(83), t, 0.08, 0.12); osc('square', midi(88), t + 0.08, 0.25, 0.12); },
  fanfare() { if (!ctx) return; const t = ctx.currentTime; [[60, 0], [64, 0.12], [67, 0.24], [72, 0.36], [67, 0.56], [72, 0.68]].forEach(([n, dt]) => { osc('sawtooth', midi(n), t + dt, 0.3, 0.09); osc('square', midi(n + 12), t + dt, 0.22, 0.04); }); },
  release() { if (!ctx) return; const t = ctx.currentTime; const o = osc('triangle', 300, t, 0.5, 0.3); o.frequency.exponentialRampToValueAtTime(1200, t + 0.45); },
  pop() { if (!ctx) return; const t = ctx.currentTime; const o = osc('sine', 600, t, 0.08, 0.08); o.frequency.exponentialRampToValueAtTime(1400, t + 0.06); },
  firework() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.6, 0.5, 'lowpass', 1200); for (let i = 0; i < 10; i++) noise(t + 0.25 + Math.random() * 0.6, 0.03, 0.25, 'highpass', 6000); },
  siren() { if (!ctx) return; const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(600, t);
    for (let i = 0; i < 4; i++) { o.frequency.linearRampToValueAtTime(1000, t + i * 0.5 + 0.25); o.frequency.linearRampToValueAtTime(600, t + i * 0.5 + 0.5); }
    g.gain.setValueAtTime(0.06, t); g.gain.linearRampToValueAtTime(0.0001, t + 2); o.connect(g).connect(sfxGain); o.start(t); o.stop(t + 2.05); },
  whoosh() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.35, 0.3, 'bandpass', 900, sfxGain, 0.6); },
};

// ───── hàng đợi giọng đọc ─────
const queue = [];
let speaking = false;
let current = null;
let ttsCfg = { provider: 'browser', rate: 1.08, volume: 1 };
let viVoice = null;
const PERSONA_VOICE = { judge: { pitch: 0.8, rate: 0.95 }, gangster: { pitch: 0.95, rate: 1.12 }, romance: { pitch: 1.3, rate: 0.95 } };

function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices();
  viVoice = vs.find((v) => /^vi/i.test(v.lang) && /google|natural|online/i.test(v.name)) || vs.find((v) => /^vi/i.test(v.lang)) || null;
  return viVoice;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

export function setTtsConfig(c) { if (c) ttsCfg = { ...ttsCfg, ...c }; }
export function hasViVoice() { return Boolean(viVoice || pickVoice()); }

export function enqueueSpeech(item) {
  if (ttsCfg.provider === 'off') return;
  queue.push({ ...item, received: Date.now() });
  // tối đa 6 câu chờ: bỏ câu ưu tiên thấp nhất, cũ nhất
  while (queue.length > 6) {
    let idx = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].priority < queue[idx].priority || (queue[i].priority === queue[idx].priority && queue[i].received < queue[idx].received)) idx = i;
    queue.splice(idx, 1);
  }
  playNext();
}

function playNext() {
  if (speaking) return;
  const now = Date.now();
  for (let i = queue.length - 1; i >= 0; i--) if (now - queue[i].received > 25000) queue.splice(i, 1);
  if (!queue.length) { duck(false); return; }
  queue.sort((a, b) => b.priority - a.priority || a.received - b.received);
  const item = queue.shift();
  speaking = true;
  duck(true);
  const token = {};
  current = token;
  // done() chỉ có hiệu lực cho đúng câu đang đọc (hẹn giờ dự phòng của câu cũ không cắt câu mới)
  const done = () => { if (current !== token) return; current = null; speaking = false; setTimeout(playNext, 250); };
  if (item.audio?.pcm16 && ctx) playPcm(item.audio, done);
  else speakBrowser(item, done);
}

function playPcm({ pcm16, sampleRate }, done) {
  try {
    const bin = atob(pcm16);
    const n = bin.length >> 1;
    const buf = ctx.createBuffer(1, n, sampleRate || 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
      if (v >= 32768) v -= 65536;
      ch[i] = v / 32768;
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = ttsCfg.volume ?? 1;
    src.connect(g).connect(voiceGain); src.onended = done; src.start();
    setTimeout(done, buf.duration * 1000 + 1500);
  } catch (e) { console.warn('PCM lỗi', e); done(); }
}

function speakBrowser(item, done) {
  if (!('speechSynthesis' in window)) { done(); return; }
  const u = new SpeechSynthesisUtterance(item.text);
  const pv = PERSONA_VOICE[item.persona] || {};
  u.lang = 'vi-VN';
  if (viVoice || pickVoice()) u.voice = viVoice;
  u.rate = (ttsCfg.rate || 1) * (pv.rate || 1);
  u.pitch = pv.pitch || 1;
  u.volume = ttsCfg.volume ?? 1;
  u.onend = done; u.onerror = done;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  // Chrome đôi khi không gọi onend → hẹn giờ dự phòng
  setTimeout(done, 2500 + item.text.length * 110);
}
