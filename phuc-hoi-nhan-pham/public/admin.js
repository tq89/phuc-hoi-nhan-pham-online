// Trang quản trị: chỉnh cấu hình ngay khi đang Live, giả lập sự kiện, xem nhật ký.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let token = '';
try { token = localStorage.getItem('phnp_token') || ''; } catch { /* bỏ qua */ }
let cfg = null;
let st = null;

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast ${bad ? 'bad' : ''}`;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-admin-token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin('Sai mã quản trị'); throw new Error('401'); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function showLogin(err = '') {
  $('#login').classList.remove('hidden'); $('#app').classList.add('hidden');
  $('#login-err').textContent = err;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  token = $('#token').value.trim();
  try { localStorage.setItem('phnp_token', token); } catch { /* bỏ qua */ }
  await boot();
});

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach((k) => { a[k] ??= {}; a = a[k]; }); a[ks.at(-1)] = v; }

function fillForm() {
  for (const el of $$('[data-k]')) {
    const v = getPath(cfg, el.dataset.k);
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else if (el.hasAttribute('data-list')) el.value = (v || []).join('\n');
    else el.value = v ?? '';
  }
  renderTiers();
}

function collect() {
  const patch = {};
  for (const el of $$('[data-k]')) {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.hasAttribute('data-list')) v = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    else if (el.type === 'number') v = el.value === '' ? undefined : Number(el.value);
    else v = el.value;
    if (v !== undefined) setPath(patch, el.dataset.k, v);
  }
  patch.gifts = { tiers: readTiers(), overrides: readOverrides() };
  return patch;
}

// ───── bậc quà ─────
function renderTiers() {
  const tb = $('#tiers tbody');
  tb.innerHTML = '';
  for (const t of cfg.gifts.tiers) addTierRow(t);
}
function addTierRow(t = { minCoins: 1, days: 20, label: '' }) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input type="number" class="t-min" value="${t.minCoins ?? 1}"/></td>
    <td><input type="number" class="t-days" value="${t.days ?? ''}"/></td>
    <td><select class="t-act"><option value="">giảm ngày</option><option value="pardon_one" ${t.action === 'pardon_one' ? 'selected' : ''}>đặc xá 1 người</option><option value="pardon_all" ${t.action === 'pardon_all' ? 'selected' : ''}>đại xá toàn trại</option></select></td>
    <td><input class="t-label" value="${esc(t.label || '')}"/></td><td><button class="btn danger t-del">✕</button></td>`;
  tr.querySelector('.t-del').onclick = () => tr.remove();
  $('#tiers tbody').appendChild(tr);
}
function readTiers() {
  return [...$('#tiers tbody').children].map((tr) => {
    const t = { minCoins: Number(tr.querySelector('.t-min').value) || 1, label: tr.querySelector('.t-label').value };
    const act = tr.querySelector('.t-act').value;
    if (act) t.action = act; else t.days = Number(tr.querySelector('.t-days').value) || 0;
    return t;
  });
}
$('#add-tier').onclick = () => addTierRow();

function renderLearned() {
  const tb = $('#learned tbody');
  const ov = cfg.gifts.overrides || {};
  const keep = new Map([...tb.querySelectorAll('tr')].map((tr) => [tr.dataset.id, tr]));
  const rows = st.learnedGifts;
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="6" class="hint">Chưa gặp quà nào. Khi có người tặng quà trên Live, quà sẽ hiện ở đây.</td></tr>'; return; }
  for (const g of rows) {
    if (keep.has(g.id)) { keep.get(g.id).querySelector('.cnt').textContent = g.count; continue; }
    const o = ov[g.id] || {};
    const tr = document.createElement('tr');
    tr.dataset.id = g.id;
    tr.innerHTML = `<td>${g.image ? `<img src="${esc(g.image)}" referrerpolicy="no-referrer"/>` : ''}${esc(g.name)}</td><td><code>${esc(g.id)}</code></td><td>${g.coins}</td><td class="cnt">${g.count}</td>
      <td><input type="number" class="o-days" value="${o.days ?? ''}" placeholder="theo bậc"/></td>
      <td><select class="o-act"><option value="">—</option><option value="pardon_one" ${o.action === 'pardon_one' ? 'selected' : ''}>đặc xá 1 người</option><option value="pardon_all" ${o.action === 'pardon_all' ? 'selected' : ''}>đại xá toàn trại</option></select></td>`;
    if (tb.querySelector('td[colspan]')) tb.innerHTML = '';
    tb.appendChild(tr);
  }
}
function readOverrides() {
  const out = { ...(cfg.gifts.overrides || {}) };
  for (const tr of $$('#learned tbody tr[data-id]')) {
    const id = tr.dataset.id;
    const days = tr.querySelector('.o-days').value;
    const act = tr.querySelector('.o-act').value;
    if (act) out[id] = { action: act, label: tr.children[0].textContent };
    else if (days !== '') out[id] = { days: Number(days), label: tr.children[0].textContent };
    else delete out[id];
  }
  return out;
}

// ───── trạng thái ─────
function renderStatus() {
  const c = st.connection;
  const pill = $('#conn-pill');
  pill.textContent = { live: '● LIVE', connecting: 'Đang kết nối', waiting: 'Chờ Live', error: 'Lỗi', offline: 'Offline' }[c.status] || c.status;
  pill.className = `pill ${c.status}`;
  $('#conn-detail').textContent = c.detail || '';
  const ai = $('#ai-pill');
  ai.textContent = st.ai.available ? `AI ✓ ${st.ai.lastLatencyMs}ms` : 'AI tắt';
  ai.className = `pill ${st.ai.available ? 'live' : ''}`;
  $('#ai-stats').textContent = `Thành công ${st.ai.ok} · lỗi ${st.ai.fail} · bỏ qua ${st.ai.skipped} · hàng đợi ${st.ai.queue}${st.ai.lastError ? ` · lỗi gần nhất: ${st.ai.lastError}` : ''} | TTS Gemini: ${st.tts.ok} ok / ${st.tts.fail} lỗi`;
  $('#pr-count').textContent = `(${st.prisoners.length})`;
  $('#prisoners').innerHTML = st.prisoners.sort((a, b) => b.days - a.days).map((p) => `<li><span><b>${esc(p.name)}</b> <small>${esc(p.crime)} · ${p.days} ngày${p.cell == null ? ' · hàng chờ' : ` · buồng ${p.cell + 1}`}${p.npc ? ' · NPC' : ''}</small></span><button class="btn" data-release="${esc(p.id)}">Thả</button></li>`).join('') || '<li class="hint">Trại trống</li>';
  if (!$('#sim-gifts').children.length) {
    $('#sim-gifts').innerHTML = st.simulator.gifts.map((g, i) => `<button class="btn" data-gift="${i}">🎁 ${esc(g.giftName)} (${g.coins})</button>`).join('');
  }
  renderLearned();
}

async function refresh() {
  st = await api('/api/state');
  renderStatus();
  $('#logs').textContent = st.logs.join('\n');
}

async function boot() {
  try {
    st = await api('/api/state');
  } catch (e) { if (e.message !== '401') showLogin(e.message); return; }
  cfg = st.config;
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  fillForm();
  renderStatus();
  $('#logs').textContent = st.logs.join('\n');
  connectWs();
  setInterval(() => refresh().catch(() => {}), 3000);
}

// ───── hành động ─────
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.id === 'save') {
      const r = await api('/api/config', collect());
      cfg = r.config; fillForm(); toast('Đã lưu cấu hình ✓');
    } else if (b.dataset.act) {
      const act = b.dataset.act;
      const body = { action: act };
      if (act === 'sim_start') body.speed = Number($('#sim-speed').value) || 1;
      if (act === 'test_tts') body.text = $('#tts-text').value;
      if (act === 'test_ai') body.text = $('#ai-test-text').value;
      if (act === 'check_text') body.text = $('#check-text').value;
      if (act === 'clear' && !confirm('Thả toàn bộ phạm nhân?')) return;
      if (act === 'connect') await api('/api/config', collect());
      b.disabled = true;
      const r = await api('/api/action', body).finally(() => { b.disabled = false; });
      if (act === 'list_models') {
        $('#models').innerHTML = r.models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
        toast(`Tìm thấy ${r.models.length} model. Bấm vào ô Model để chọn.`);
      } else if (act === 'test_ai') {
        $('#ai-out').textContent = r.ok ? JSON.stringify(r.result, null, 2) : `❌ ${r.error}`;
      } else if (act === 'check_text') {
        $('#check-out').textContent = r.hit ? `🚫 Bị chặn bởi: "${r.hit}"` : '✅ Câu sạch';
      } else toast('OK ✓');
      refresh().catch(() => {});
    } else if (b.dataset.sim) {
      await api('/api/action', { action: 'sim_event', kind: b.dataset.sim });
    } else if (b.dataset.gift) {
      await api('/api/action', { action: 'sim_event', kind: 'gift', tier: Number(b.dataset.gift) });
    } else if (b.dataset.release) {
      await api('/api/action', { action: 'release', id: b.dataset.release }); refresh();
    } else if (b.id === 'sim-send') {
      await api('/api/action', { action: 'sim_event', kind: 'report', user: $('#sim-user').value || 'khach_test', text: $('#sim-text').value });
      $('#sim-text').value = '';
    }
  } catch (err) { if (err.message !== '401') toast(`Lỗi: ${err.message}`, true); }
});
$('#sim-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#sim-send').click(); });

function connectWs() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=admin&token=${encodeURIComponent(token)}`);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'log') { const l = $('#logs'); l.textContent += `\n${m.line}`; l.scrollTop = l.scrollHeight; }
  };
  ws.onclose = () => setTimeout(connectWs, 3000);
}

boot();
