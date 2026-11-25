// Overlay 9:16: nhận trạng thái + hiệu ứng từ server qua WebSocket và vẽ lên DOM.
import { chibiSVG } from './chibi.js';
import { initAudio, resumeAudio, audioRunning, startBgm, sfx, enqueueSpeech, setTtsConfig } from './audio.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const params = new URLSearchParams(location.search);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : String(n));

// ───── co giãn khung 1080×1920 theo cửa sổ ─────
function fit() {
  const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

// ───── bật âm thanh ─────
const startEl = $('start');
async function begin() {
  try { await resumeAudio(); } catch { /* bỏ qua */ }
  startBgm();
  startEl.classList.add('hidden');
}
$('start-btn').addEventListener('click', begin);
if (params.has('autostart')) {
  startEl.classList.add('hidden');
  initAudio();
  begin();
  // Trình duyệt thường chặn tự phát: thử lại khi có tương tác bất kỳ
  window.addEventListener('pointerdown', begin, { once: true });
} else {
  initAudio();
  resumeAudio().then(() => { if (audioRunning()) begin(); }).catch(() => {});
}

// ───── trạng thái & render ─────
let state = null;
const els = new Map(); // id → { el, data }
const cellEls = [];

function buildCells(n) {
  const root = $('cells');
  if (cellEls.length === n) return;
  root.innerHTML = '';
  cellEls.length = 0;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'cell';
    c.innerHTML = `<div class="cell-head"><span><i class="lamp"></i>BUỒNG ${String(i + 1).padStart(2, '0')}</span><span class="cnt">0/4</span></div>
      <div class="cell-empty">Buồng trống<br/>— chờ phạm nhân —</div><div class="cell-body"></div>`;
    root.appendChild(c);
    cellEls.push(c);
  }
  for (const [, v] of els) v.el.remove();
  els.clear();
}

function seedOf(id) { let h = 7; for (const ch of String(id)) h = (h * 33 + ch.charCodeAt(0)) >>> 0; return h; }

function moodOf(p) {
  if (p.days < p.initial * 0.25) return 'happy';
  if (p.recidivist) return 'shock';
  return 'sad';
}

function figHTML(p, size = 'sm') {
  const hasAvatar = Boolean(p.avatar);
  return `${chibiSVG({ hue: p.hue, seed: seedOf(p.id), mood: moodOf(p), hasAvatar, size })}${hasAvatar ? `<img class="ava" src="${esc(p.avatar)}" referrerpolicy="no-referrer" onerror="this.remove()"/>` : ''}`;
}

function makePrisoner(p) {
  const el = document.createElement('div');
  el.className = 'pr enter';
  el.dataset.id = p.id;
  el.innerHTML = `<div class="fig"></div><div class="tag"><div class="nm"></div><div class="cr"></div><div class="dbar"><i></i><b></b></div></div>`;
  setTimeout(() => el.classList.remove('enter'), 800);
  return el;
}

function updatePrisoner(entry, p) {
  const { el } = entry;
  const prev = entry.data;
  if (!prev || prev.avatar !== p.avatar || moodOf(prev) !== moodOf(p)) el.querySelector('.fig').innerHTML = figHTML(p);
  if (!prev || prev.name !== p.name) el.querySelector('.nm').textContent = p.name;
  if (!prev || prev.crime !== p.crime) el.querySelector('.cr').textContent = p.crime;
  el.querySelector('.dbar b').textContent = `${p.days} NGÀY`;
  el.querySelector('.dbar i').style.width = `${Math.min(100, (p.days / Math.max(1, p.initial)) * 100)}%`;
  el.classList.toggle('npc', Boolean(p.npc));
  let badge = el.querySelector('.badge:not(.present)');
  if (p.recidivist && !badge) { badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'TÁI PHẠM'; el.appendChild(badge); }
  let pres = el.querySelector('.badge.present');
  if (p.present && !p.npc && !pres) { pres = document.createElement('span'); pres.className = 'badge present'; pres.textContent = 'CÓ MẶT'; el.appendChild(pres); }
  entry.data = p;
}

function render(s) {
  state = s;
  $('title').textContent = s.title; $('title').dataset.text = s.title;
  $('subtitle').textContent = s.subtitle;
  const pe = $('persona');
  if (pe.dataset.key !== s.persona.key) {
    pe.dataset.key = s.persona.key;
    pe.querySelector('.p-icon').textContent = s.persona.icon;
    pe.querySelector('.p-name').textContent = s.persona.short;
    pe.classList.remove('swap'); void pe.offsetWidth; pe.classList.add('swap');
  }
  $('st-viewers').textContent = fmt(s.stats.viewers);
  $('st-likes').textContent = fmt(s.stats.likes);
  $('st-coins').textContent = fmt(s.stats.coins);
  $('st-jailed').textContent = fmt(s.stats.jailed);

  renderBoard('b-gifters', s.boards.gifters, (x) => `${fmt(x.coins)}🪙`, 'Chưa có ai thăm nuôi');
  renderBoard('b-reporters', s.boards.reporters, (x) => `${x.count} vụ`, 'Chưa ai tố giác');
  renderBoard('b-toughest', s.boards.toughest, (x) => `${x.days}d`, 'Trại đang trống');

  buildCells(s.cells.length);
  const seen = new Set();
  s.cells.forEach((cell, ci) => {
    const cEl = cellEls[ci];
    const body = cEl.querySelector('.cell-body');
    cEl.querySelector('.cnt').textContent = `${cell.prisoners.length}/${s.perCell}`;
    body.className = `cell-body n${Math.min(4, cell.prisoners.length)}`;
    cEl.classList.toggle('full', cell.prisoners.length >= s.perCell);
    cEl.querySelector('.cell-empty').classList.toggle('hidden', cell.prisoners.length > 0);
    for (const p of cell.prisoners) {
      seen.add(p.id);
      let entry = els.get(p.id);
      if (entry?.leaving) { entry.el.remove(); els.delete(p.id); entry = null; } // vừa ra trại đã bị bế lại
      if (!entry) { entry = { el: makePrisoner(p), data: null }; els.set(p.id, entry); }
      if (entry.el.parentElement !== body) body.appendChild(entry.el);
      updatePrisoner(entry, p);
    }
  });
  for (const [id, entry] of els) {
    if (!seen.has(id) && !entry.leaving) { entry.el.remove(); els.delete(id); }
  }

  const st = s.storm;
  $('storm-fill').style.width = `${Math.min(100, (st.value / st.threshold) * 100)}%`;
  $('storm-text').textContent = `${st.value} / ${st.threshold}`;
  renderLabor(s.labor);

  $('q-count').textContent = s.queueCount;
  const qText = s.queue.length ? s.queue.map((q, i) => `#${i + 1} ${q.name} (${q.days} ngày)`).join('   ·   ') : 'Trại còn chỗ — bình luận "bế @tên vì tội ..." để tố giác bạn bè!';
  const qm = $('q-marquee');
  if (qm.textContent !== qText) qm.textContent = qText;
  $('safezone').classList.toggle('hidden', !s.showSafeZone);
}

function renderBoard(id, rows, val, empty) {
  const ol = $(id);
  const html = rows.length ? rows.slice(0, 3).map((r) => `<li><span>${esc(r.name)}</span><b>${esc(val(r))}</b></li>`).join('') : `<li class="empty">${empty}</li>`;
  if (ol.dataset.h !== html) {
    const firstChanged = ol.dataset.first !== (rows[0]?.name || '');
    ol.innerHTML = html; ol.dataset.h = html; ol.dataset.first = rows[0]?.name || '';
    if (firstChanged && rows.length) ol.firstElementChild?.classList.add('flash');
  }
}

let laborTimer = null;
function renderLabor(l) {
  const box = $('labor');
  if (!l) { box.classList.add('hidden'); clearInterval(laborTimer); laborTimer = null; stage.querySelectorAll('.pr.working').forEach((e) => e.classList.remove('working')); return; }
  box.classList.remove('hidden');
  $('labor-likes').textContent = l.likes;
  $('labor-goal').textContent = l.goal;
  $('labor-days').textContent = l.days;
  $('labor-fill').style.width = `${Math.min(100, (l.likes / l.goal) * 100)}%`;
  const tick = () => { $('labor-time').textContent = Math.max(0, Math.ceil((l.endsAt - Date.now()) / 1000)); };
  tick();
  clearInterval(laborTimer); laborTimer = setInterval(tick, 250);
  stage.querySelectorAll('.pr').forEach((e) => e.classList.add('working'));
}

// ───── tiện ích hiệu ứng ─────
function posOf(id) {
  const e = els.get(id)?.el;
  if (!e) return null;
  const r = e.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  const k = 1080 / sr.width;
  return { x: (r.left + r.width / 2 - sr.left) * k, y: (r.top + r.height * 0.3 - sr.top) * k };
}

function floater(text, x, y, cls = '') {
  const f = document.createElement('div');
  f.className = `floater ${cls}`;
  f.textContent = text;
  f.style.left = `${x}px`; f.style.top = `${y}px`;
  $('float-layer').appendChild(f);
  setTimeout(() => f.remove(), 1700);
}

let heartBudget = 0;
setInterval(() => { heartBudget = 8; }, 1000);
function hearts(x, y, n = 3) {
  for (let i = 0; i < n && heartBudget > 0; i++, heartBudget--) {
    const h = document.createElement('div');
    h.className = 'heart';
    h.textContent = ['❤️', '💖', '💗', '💕'][i % 4];
    h.style.left = `${x + (Math.random() * 60 - 30)}px`; h.style.top = `${y}px`;
    h.style.setProperty('--dx', `${Math.random() * 120 - 60}px`);
    h.style.setProperty('--rot', `${Math.random() * 60 - 30}deg`);
    $('float-layer').appendChild(h);
    setTimeout(() => h.remove(), 1900);
  }
}

function pulse(cls, ms = 1000, el = stage) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); }

function toast(icon, html, kind = 'info') {
  const feed = $('feed');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `<span class="ti">${icon}</span><span>${html}</span>`;
  feed.prepend(t);
  while (feed.children.length > 5) feed.lastElementChild.remove();
  setTimeout(() => { t.style.transition = 'opacity .6s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 700); }, 9000);
}

function bubble(id, text) {
  const e = els.get(id)?.el;
  if (!e) return;
  e.querySelector('.bubble')?.remove();
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  e.appendChild(b);
  setTimeout(() => b.remove(), 4100);
}

// ───── thẻ tuyên án (hàng đợi để không đè nhau) ─────
const verdictQ = [];
let verdictBusy = false;
function showVerdict(v) {
  verdictQ.push(v);
  if (verdictQ.length > 4) verdictQ.splice(0, verdictQ.length - 4);
  runVerdict();
}
function runVerdict() {
  if (verdictBusy || !verdictQ.length) return;
  verdictBusy = true;
  const v = verdictQ.shift();
  const p = v.prisoner;
  const kindCls = v.kind === 'recidivist' ? 'recid' : v.kind === 'confess' ? 'confess' : '';
  const stamp = v.kind === 'confess' ? 'TỰ THÚ' : v.kind === 'stack' ? 'CỘNG ÁN' : 'ĐÃ TUYÊN';
  const head = v.kind === 'stack' ? 'BỔ SUNG HỒ SƠ' : `BIÊN BẢN TỐ GIÁC #${String(Date.now()).slice(-5)}`;
  const badges = [
    v.kind === 'recidivist' ? `<span>TÁI PHẠM ×1.5 · ${v.priors} tiền án</span>` : '',
    v.queued ? '<span class="q">TRẠI ĐẦY · VÀO HÀNG CHỜ</span>' : '',
    v.kind === 'stack' ? `<span>+${v.added} NGÀY</span>` : '',
  ].join('');
  const el = document.createElement('div');
  el.className = `verdict ${kindCls}`;
  el.innerHTML = `
    <div class="v-head"><span>${head}</span><span class="v-persona">${esc(state?.persona.icon || '')} ${esc(state?.persona.name || '')}</span></div>
    <div class="v-main">
      <div class="v-fig">${chibiSVG({ hue: p.hue, seed: seedOf(p.id), mood: 'shock', hasAvatar: Boolean(p.avatar), size: 'lg' })}${p.avatar ? `<img src="${esc(p.avatar)}" referrerpolicy="no-referrer" onerror="this.remove()"/>` : ''}</div>
      <div class="v-info">
        <div class="v-label">Bị cáo</div>
        <div class="v-name">${esc(p.name)}</div>
        <div class="v-crime">${esc(v.crime)}</div>
        <div class="v-by">${v.reporter && v.kind !== 'confess' ? `Người tố giác: <b>${esc(v.reporter)}</b>` : v.kind === 'confess' ? 'Thành khẩn tự thú — được giảm nhẹ' : ''}</div>
        <div class="v-badges">${badges}</div>
      </div>
    </div>
    <div class="v-days"><b class="v-count">0</b><span>NGÀY</span></div>
    <div class="v-line">“${esc(v.line)}”</div>
    ${v.law ? `<div class="v-law">⚖️ <b>${esc(v.law.law)}</b> — ${esc(v.law.title)}</div>` : ''}
    <div class="v-stamp">${stamp}</div>`;
  $('verdict-layer').appendChild(el);
  sfx.gavel();
  setTimeout(() => sfx.cuffs(), 650);
  // số ngày chạy lên
  const target = v.days; const t0 = performance.now(); const cnt = el.querySelector('.v-count');
  const run = (t) => { const k = Math.min(1, (t - t0) / 900); cnt.textContent = Math.round(target * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(run); };
  requestAnimationFrame(run);
  if (v.law) showLaw(v.law);
  const dur = verdictQ.length > 1 ? 3000 : 5200;
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { el.remove(); verdictBusy = false; runVerdict(); }, 450);
  }, dur);
}

// ───── banner lớn (đặc xá, vua mới, bão tim...) ─────
const bannerQ = [];
let bannerBusy = false;
function showBanner(b) { bannerQ.push(b); if (bannerQ.length > 3) bannerQ.shift(); runBanner(); }
function runBanner() {
  if (bannerBusy || !bannerQ.length) return;
  bannerBusy = true;
  const b = bannerQ.shift();
  const el = $('banner');
  el.className = `banner ${b.color || ''}`;
  el.innerHTML = `<div class="bn-icon">${b.icon}</div><div class="bn-title">${esc(b.title)}</div>${b.sub ? `<div class="bn-sub">${b.sub}</div>` : ''}${b.avatar ? `<img src="${esc(b.avatar)}" referrerpolicy="no-referrer" onerror="this.remove()"/>` : ''}`;
  setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.className = 'banner hidden'; bannerBusy = false; runBanner(); }, 400); }, b.ms || 3200);
}

// ───── pháo hoa (canvas) ─────
const cv = $('fx-canvas'); const g2 = cv.getContext('2d');
let parts = []; let fxRunning = false;
function burst(x, y, n = 90, hueBase = Math.random() * 360) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2; const sp = 3 + Math.random() * 9;
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 60 + Math.random() * 40, h: (hueBase + Math.random() * 60) % 360, s: 2 + Math.random() * 3 });
  }
  if (!fxRunning) { fxRunning = true; requestAnimationFrame(loop); }
}
function confetti(n = 160) {
  for (let i = 0; i < n; i++) parts.push({ x: Math.random() * 1080, y: -20 - Math.random() * 400, vx: Math.random() * 4 - 2, vy: 3 + Math.random() * 5, life: 200, h: Math.random() * 360, s: 6 + Math.random() * 6, conf: true, r: Math.random() * 6 });
  if (!fxRunning) { fxRunning = true; requestAnimationFrame(loop); }
}
function loop() {
  g2.clearRect(0, 0, 1080, 1920);
  g2.globalCompositeOperation = 'lighter';
  parts = parts.filter((p) => p.life > 0 && p.y < 2000);
  for (const p of parts) {
    p.life--; p.x += p.vx; p.y += p.vy;
    if (p.conf) { p.r += 0.1; g2.save(); g2.translate(p.x, p.y); g2.rotate(p.r); g2.fillStyle = `hsl(${p.h} 90% 60%)`; g2.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g2.restore(); continue; }
    p.vx *= 0.97; p.vy = p.vy * 0.97 + 0.12;
    g2.globalAlpha = Math.max(0, p.life / 100);
    g2.fillStyle = `hsl(${p.h} 100% 65%)`;
    g2.beginPath(); g2.arc(p.x, p.y, p.s, 0, Math.PI * 2); g2.fill();
  }
  g2.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(loop); else { fxRunning = false; g2.clearRect(0, 0, 1080, 1920); }
}
function fireworks(times = 6) {
  for (let i = 0; i < times; i++) setTimeout(() => { burst(150 + Math.random() * 780, 300 + Math.random() * 700); sfx.firework(); }, i * 380);
}

// ───── thẻ thông tin cột phải (xoay vòng: hướng dẫn → bảng quà → pháp luật) ─────
let lawCard = null; let infoIdx = 0; let lawUntil = 0;
function showLaw(card) { lawCard = card; lawUntil = Date.now() + 15000; drawInfo('law'); }
function drawInfo(kind) {
  const c = $('info-card');
  const h = state?.help || { likeDays: 1, followDays: 30, shareDays: 50, tiers: [] };
  c.className = 'info-card';
  if (kind === 'law' && lawCard) {
    c.classList.add('law');
    c.innerHTML = `<h4>⚖️ GÓC PHÁP LUẬT THẬT</h4><div class="law-ref">${esc(lawCard.law)}</div><div class="law-title">${esc(lawCard.title)}</div><div class="law-text">${esc(lawCard.text)}</div><div class="law-foot">Trò chơi chỉ để giải trí. Kiến thức pháp luật là thật.</div>`;
  } else if (kind === 'gifts') {
    const rows = (h.tiers || []).map((t) => `<div class="tier"><span>${t.minCoins}+ xu · ${esc(t.label || '')}</span><b>${t.action === 'pardon_all' ? 'ĐẠI XÁ' : t.action === 'pardon_one' ? 'ĐẶC XÁ' : `-${t.days}d`}</b></div>`).join('');
    c.innerHTML = `<h4>🎁 BẢNG THĂM NUÔI</h4>${rows}<div class="row" style="margin-top:12px"><i>💡</i><span>Quà giảm án cho người bạn vừa tố/bào chữa, hoặc người án nặng nhất.</span></div>`;
  } else {
    c.innerHTML = `<h4>📖 CÁCH CHƠI</h4>
      <div class="row"><i>💬</i><span>Tố giác: <code>bế @tên vì tội …</code></span></div>
      <div class="row"><i>❤️</i><span>Thả tim: <b>-${h.likeDays} ngày</b>/tim · đủ mốc ra <b>Bão Tim</b></span></div>
      <div class="row"><i>🧑‍⚖️</i><span>Bào chữa: <code>bào chữa @tên + lý do</code></span></div>
      <div class="row"><i>🙋</i><span>Tự thú: <code>tự thú tội …</code> (án nhẹ hơn)</span></div>
      <div class="row"><i>➕</i><span>Follow <b>-${h.followDays}d</b> · Share <b>-${h.shareDays}d</b></span></div>
      <div class="row"><i>📜</i><span>Không muốn chơi: <code>miễn tố</code></span></div>`;
  }
  void c.offsetWidth; c.classList.add('swap');
}
setInterval(() => {
  if (Date.now() < lawUntil) return;
  infoIdx = (infoIdx + 1) % 3;
  drawInfo(['help', 'gifts', 'law'][infoIdx]);
}, 10000);

// ───── xử lý hiệu ứng từ server ─────
const SOCIAL_ICON = { follow: '➕', share: '📣' };
let filingTimer = null;
function onFx(m) {
  switch (m.fx) {
    case 'say': enqueueSpeech(m); break;
    case 'filing': {
      const f = $('filing');
      f.textContent = m.kind === 'defense' ? `🧑‍⚖️ Toà đang nghe ${m.by} bào chữa` : `📝 Đang lập biên bản theo tố giác của ${m.by}`;
      f.classList.remove('hidden');
      clearTimeout(filingTimer); filingTimer = setTimeout(() => f.classList.add('hidden'), 3500);
      break;
    }
    case 'verdict': {
      $('filing').classList.add('hidden');
      if (m.quiet) break;
      showVerdict(m);
      const icon = m.kind === 'confess' ? '🙋' : m.kind === 'stack' ? '📎' : '⛓️';
      toast(icon, m.kind === 'confess' ? `<b>${esc(m.prisoner.name)}</b> tự thú ${esc(m.crime)} · ${m.days} ngày` : `<b>${esc(m.reporter || '?')}</b> tố <b>${esc(m.prisoner.name)}</b> ${esc(m.crime)} · ${m.days} ngày`, 'jail');
      setTimeout(() => { const c = m.prisoner.cell; if (c != null && cellEls[c]) pulse('shake', 600, cellEls[c]); }, 300);
      break;
    }
    case 'release': {
      const entry = els.get(m.id);
      if (entry) {
        entry.leaving = true;
        const label = { pardon: 'ĐẶC XÁ', pardon_all: 'ĐẠI XÁ', optout: 'MIỄN TỐ', served: 'MÃN HẠN', admin: 'RA TRẠI', npc: '' }[m.reason] ?? 'TỰ DO';
        if (label) { const s = document.createElement('div'); s.className = `stamp ${m.reason?.startsWith('pardon') ? 'gold' : ''}`; s.textContent = label; entry.el.appendChild(s); }
        entry.el.classList.add('leave');
        setTimeout(() => { entry.el.remove(); els.delete(m.id); }, 1200);
      }
      if (!m.silent) { sfx.release(); toast('🕊️', `<b>${esc(m.name)}</b> đã ra trại — nhân phẩm phục hồi!`, 'good'); }
      break;
    }
    case 'bubble': bubble(m.id, m.text); break;
    case 'presence': {
      toast('👀', `Phạm nhân <b>${esc(m.name)}</b> đã có mặt trên live!`, 'jail');
      const pos = posOf(m.id); if (pos) floater('CÓ MẶT!', pos.x, pos.y - 30, '');
      break;
    }
    case 'like': {
      const pos = m.id ? posOf(m.id) : null;
      if (pos) { hearts(pos.x, pos.y, Math.min(4, Math.ceil(m.count / 5))); if (m.count >= 5) floater(`-${m.count}`, pos.x, pos.y - 20); }
      else hearts(900 + Math.random() * 100, 1300, 2);
      if (Math.random() < 0.25) sfx.pop();
      break;
    }
    case 'gift': {
      sfx.chime();
      const pos = m.id ? posOf(m.id) : null;
      if (pos) {
        const e = els.get(m.id)?.el; if (e) pulse('hit', 700, e);
        floater(m.coins >= 10 ? '🍗' : m.coins >= 5 ? '🍜' : '🌹', pos.x, pos.y - 60, 'emoji');
        setTimeout(() => floater(`-${m.days} NGÀY`, pos.x, pos.y - 10), 250);
      }
      toast('🎁', `<b>${esc(m.giver)}</b> tặng ${esc(m.gift)} (${m.coins} xu)${m.name ? ` thăm nuôi <b>${esc(m.name)}</b> · -${m.days} ngày` : ''}`, 'gift');
      if (m.coins >= 30) burst(540, 900, 70);
      break;
    }
    case 'pardon': {
      sfx.fanfare(); fireworks(3);
      showBanner({ icon: '📜', title: 'LỆNH ĐẶC XÁ', sub: `${esc(m.giver)} → trả tự do cho ${esc(m.name)}`, avatar: m.avatar, color: '' });
      toast('📜', `<b>${esc(m.giver)}</b> ban Lệnh Đặc Xá cho <b>${esc(m.name)}</b>`, 'gift');
      break;
    }
    case 'pardonAll': {
      sfx.fanfare(); pulse('flash', 700); fireworks(10); confetti(220);
      showBanner({ icon: '🎆', title: 'ĐẠI XÁ TOÀN TRẠI', sub: `Ân điển từ ${esc(m.giver)} · ${m.count} phạm nhân được tự do`, avatar: m.avatar, color: '', ms: 4500 });
      toast('🎆', `<b>${esc(m.giver)}</b> ĐẠI XÁ TOÀN TRẠI!`, 'gift');
      break;
    }
    case 'newKing': {
      sfx.coin(); confetti(80);
      showBanner({ icon: '👑', title: 'VUA THĂM NUÔI MỚI', sub: `${esc(m.name)} · ${fmt(m.coins)} xu`, avatar: m.avatar, color: 'pink' });
      break;
    }
    case 'storm': {
      sfx.hammerStorm(8); pulse('shake', 1000, $('viewport')); pulse('storm', 1800, $('yard'));
      stage.querySelectorAll('.pr').forEach((e) => { e.classList.add('working'); setTimeout(() => { if (!state?.labor) e.classList.remove('working'); }, 2600); });
      for (const [id] of els) { const pos = posOf(id); if (pos) floater(`-${m.days}`, pos.x, pos.y); }
      showBanner({ icon: '⛏️', title: 'BÃO TIM!', sub: `Cả trại đập đá · -${m.days} ngày mỗi người`, color: 'pink', ms: 2200 });
      break;
    }
    case 'laborStart': sfx.siren(); showBanner({ icon: '🚨', title: 'LAO ĐỘNG TẬP THỂ', sub: `${m.goal} ❤️ trong ${Math.round((m.endsAt - Date.now()) / 1000)} giây → -${m.days} ngày cả trại`, color: 'red', ms: 2800 }); break;
    case 'laborEnd':
      if (m.win) { sfx.fanfare(); confetti(150); showBanner({ icon: '🏆', title: 'HOÀN THÀNH CHỈ TIÊU', sub: `Cả trại -${m.days} ngày!`, color: 'cyan' }); }
      else toast('😮‍💨', 'Chỉ tiêu lao động chưa đạt… lần sau thả tim mạnh hơn!', 'warn');
      break;
    case 'defense': {
      sfx.gavel();
      const pos = posOf(m.id); if (pos && m.win) floater(`-${m.days} NGÀY`, pos.x, pos.y);
      toast('🧑‍⚖️', `Luật sư <b>${esc(m.lawyer)}</b> bào chữa cho <b>${esc(m.name)}</b>: ${m.win ? `thắng, -${m.days} ngày` : 'bác bỏ'} (${m.score}/10)`, m.win ? 'good' : 'warn');
      break;
    }
    case 'social': {
      const pos = posOf(m.id); if (pos) floater(`-${m.days}`, pos.x, pos.y);
      toast(SOCIAL_ICON[m.kind] || '✨', `<b>${esc(m.giver)}</b> ${m.kind === 'share' ? 'kêu oan (share)' : 'bảo lãnh (follow)'} cho <b>${esc(m.name)}</b> · -${m.days} ngày`, 'good');
      break;
    }
    case 'rollCall': sfx.siren(); toast('📋', `ĐIỂM DANH: ${m.count} phạm nhân · lì nhất <b>${esc(m.name)}</b> (${m.days} ngày)`, 'info'); if (m.law) showLaw(m.law); break;
    case 'toast': toast(m.icon, esc(m.text), m.kind); break;
    default:
  }
}

// ───── WebSocket ─────
let ws; let backoff = 1000;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=overlay`);
  ws.onopen = () => { backoff = 1000; $('conn').classList.add('hidden'); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'state') { if (m.tts) setTtsConfig(m.tts); render(m.state); }
    else if (m.type === 'fx') onFx(m);
  };
  ws.onclose = () => { $('conn').classList.remove('hidden'); setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 10000); };
}
connect();
drawInfo('help');
