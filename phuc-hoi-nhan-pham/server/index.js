// Điểm khởi động: HTTP (overlay + admin) + WebSocket (đẩy trạng thái/hiệu ứng) + API quản trị.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ConfigStore } from './config.js';
import { Store } from './store.js';
import { Moderator } from './moderation.js';
import { AiService } from './ai.js';
import { TtsService } from './tts.js';
import { Engine } from './engine.js';
import { TikTokConnector } from './connector.js';
import { Simulator, SIM_GIFTS } from './simulator.js';
import { PERSONAS } from './personas.js';
import { makeLogger } from './util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const FONTS = path.join(ROOT, 'node_modules', '@fontsource');

const logs = [];
const log = makeLogger((l) => { logs.push(l); if (logs.length > 200) logs.shift(); broadcastAdmin({ type: 'log', line: l }); });

const config = new ConfigStore(DATA);
const getConfig = () => config.get();
const store = new Store(DATA);
const moderator = new Moderator(getConfig);
const legal = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'data', 'legal.json'), 'utf8'));
const ai = new AiService({ getConfig, log });
const engine = new Engine({ getConfig, store, ai, moderator, legalCards: legal.cards, log });
const tts = new TtsService({ getConfig, broadcast: (m) => broadcastAll(m), log });
const tiktok = new TikTokConnector({ getConfig, engine, log });
const sim = new Simulator(engine);

// ───────────── WebSocket ─────────────
const overlays = new Set();
const admins = new Set();
function send(ws, msg) { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
function broadcastAll(msg) { const s = JSON.stringify(msg); for (const ws of overlays) send(ws, s); for (const ws of admins) send(ws, s); }
function broadcastAdmin(msg) { const s = JSON.stringify(msg); for (const ws of admins) send(ws, s); }

engine.on('fx', (m) => broadcastAll(m));
engine.on('say', ({ text, persona, priority }) => tts.speak(text, { persona, priority }));

let dirty = true;
engine.on('changed', () => { dirty = true; });
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  broadcastAll({ type: 'state', state: engine.snapshot(), tts: ttsClientConfig() });
}, 250);
setInterval(() => engine.tick(1), 1000);

function ttsClientConfig() {
  const t = getConfig().tts;
  return { provider: t.provider, rate: t.browserRate, volume: t.volume };
}

// ───────────── HTTP ─────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('.woff2') ? 'max-age=86400' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function authed(req) {
  const url = new URL(req.url, 'http://x');
  const token = req.headers['x-admin-token'] || url.searchParams.get('token') || '';
  const want = getConfig().admin.token;
  const a = Buffer.from(String(token));
  const b = Buffer.from(String(want));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('Body quá lớn')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

function adminState() {
  return {
    config: config.publicView(),
    connection: engine.connection,
    simulator: { running: sim.running, speed: sim.speed, gifts: SIM_GIFTS },
    ai: { available: ai.available, ...ai.stats, queue: ai.queue.length },
    tts: tts.stats,
    learnedGifts: Object.entries(store.data.gifts).map(([id, g]) => ({ id, ...g })).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 60),
    personas: Object.fromEntries(Object.entries(PERSONAS).map(([k, v]) => [k, v.name])),
    prisoners: [...engine.prisoners.values()].map((p) => engine.pub(p)),
    stats: store.data.stats,
    logs: logs.slice(-60),
  };
}

async function handleAction(body) {
  switch (body.action) {
    case 'connect': await tiktok.start(); return { ok: true };
    case 'disconnect': tiktok.stop(); return { ok: true };
    case 'sim_start': sim.start(body.speed); return { ok: true };
    case 'sim_stop': sim.stop(); return { ok: true };
    case 'sim_event': await sim.emit(body.kind, body); return { ok: true };
    case 'release': engine.adminRelease(body.id); return { ok: true };
    case 'clear': engine.adminClear(); return { ok: true };
    case 'reset_session': engine.resetSession(); return { ok: true };
    case 'labor': engine.startLabor(); return { ok: true };
    case 'test_tts': await tts.speak(body.text || 'Xin chào, đây là giọng đọc thử của trại.', { persona: engine.personaKey, priority: 3 }); return { ok: true };
    case 'list_models': return { ok: true, models: await ai.listModels() };
    case 'test_ai': {
      const r = await ai.analyzeReport({ text: body.text || 'Bế @Nhi vào trỏng vì tội nợ 500k chưa trả', author: 'Admin', persona: engine.personaKey, lawKeys: legal.cards.map((c) => c.key) });
      return { ok: Boolean(r), result: r, error: r ? '' : ai.stats.lastError || 'AI không trả lời (chưa có key/đã tắt?)' };
    }
    case 'check_text': return { ok: true, hit: moderator.check(body.text || '') };
    default: throw new Error(`Hành động không hợp lệ: ${body.action}`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p.startsWith('/api/')) {
      if (p === '/api/health') return json(res, 200, { ok: true, connection: engine.connection });
      if (!authed(req)) return json(res, 401, { error: 'Sai mã quản trị' });
      if (p === '/api/state' && req.method === 'GET') return json(res, 200, adminState());
      if (p === '/api/config' && req.method === 'POST') {
        const before = JSON.stringify(getConfig().tiktok);
        config.update(await readBody(req));
        engine.changed();
        if (JSON.stringify(getConfig().tiktok) !== before && tiktok.wanted) tiktok.start();
        return json(res, 200, { ok: true, config: config.publicView() });
      }
      if (p === '/api/action' && req.method === 'POST') return json(res, 200, await handleAction(await readBody(req)));
      return json(res, 404, { error: 'Không có API này' });
    }
    if (p === '/' || p === '/overlay') return serveFile(res, path.join(PUBLIC, 'index.html'));
    if (p === '/admin') return serveFile(res, path.join(PUBLIC, 'admin.html'));
    if (p.startsWith('/fonts/')) {
      const f = safeJoin(FONTS, p.slice('/fonts/'.length));
      return f ? serveFile(res, f) : json(res, 400, { error: 'bad path' });
    }
    const f = safeJoin(PUBLIC, p);
    return f ? serveFile(res, f) : json(res, 400, { error: 'bad path' });
  } catch (e) {
    log.warn('HTTP', p, e.message);
    return json(res, 500, { error: e.message });
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const role = url.searchParams.get('role');
  if (role === 'admin') {
    if (!authed(req)) { ws.close(4001, 'unauthorized'); return; }
    admins.add(ws);
    ws.on('close', () => admins.delete(ws));
  } else {
    overlays.add(ws);
    ws.on('close', () => overlays.delete(ws));
  }
  send(ws, { type: 'state', state: engine.snapshot(), tts: ttsClientConfig() });
  ws.on('message', () => { /* overlay chỉ nhận, không gửi lệnh */ });
});

const { port, host } = getConfig().server;
server.listen(port, host, () => {
  log.info(`Overlay 9:16 : http://localhost:${port}/`);
  log.info(`Trang Admin  : http://localhost:${port}/admin`);
  log.info(`Mã quản trị Admin: ${getConfig().admin.token}  (đổi trong data/config.json hoặc biến ADMIN_TOKEN)`);
  if (process.env.SIMULATOR === '1') { sim.start(1); log.info('Đang chạy SIMULATOR'); }
  else if (getConfig().tiktok.autoConnect && getConfig().tiktok.username) tiktok.start();
});

function shutdown() { log.info('Đang tắt, lưu dữ liệu...'); try { store.flush(); } catch { /* bỏ qua */ } process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => log.error('unhandledRejection', e?.message || e));
