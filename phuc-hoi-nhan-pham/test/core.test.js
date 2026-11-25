import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../server/config.js';
import { Moderator } from '../server/moderation.js';
import { parseCommand, heuristicReport, funnyCrime, extractMentions } from '../server/parser.js';
import { Engine } from '../server/engine.js';
import { Store } from '../server/store.js';
import { PERSONAS } from '../server/personas.js';
import { normGift, normUser } from '../server/connector.js';
import { parseJson } from '../server/ai.js';

const legal = JSON.parse(fs.readFileSync(new URL('../server/data/legal.json', import.meta.url), 'utf8'));

function setup(overrides = {}) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  Object.assign(cfg.game, { npcEnabled: false }, overrides.game);
  if (overrides.gifts) Object.assign(cfg.gifts, overrides.gifts);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phnp-'));
  const store = new Store(dir);
  const mod = new Moderator(() => cfg);
  const ai = { analyzeReport: async () => null, judgeDefense: async () => null };
  const engine = new Engine({ getConfig: () => cfg, store, ai, moderator: mod, legalCards: legal.cards });
  const fx = [];
  const says = [];
  engine.on('fx', (m) => fx.push(m));
  engine.on('say', (m) => says.push(m));
  return { cfg, store, engine, fx, says };
}

const U = (id, name = id) => ({ uniqueId: id, name, avatar: '' });

// ───── kiểm duyệt ─────
test('blacklist: chặn từ cấm, không chặn từ thường khi bỏ dấu trùng nhau', () => {
  const m = new Moderator(() => DEFAULT_CONFIG);
  assert.ok(m.check('bế @a vì tội phản động'));
  assert.ok(m.check('đồ lồn'));
  assert.ok(m.check('nó muốn tự tử'));
  assert.ok(m.check('vào http://abc.com nhận quà'));
  assert.ok(m.check('c.o.n.g s.a.n'), 'bắt kiểu lách bằng dấu chấm');
  assert.equal(m.check('bạn ấy lớn rồi'), null, '"lớn" ≠ "lồn"');
  assert.equal(m.check('từ từ thôi'), null, '"từ từ" ≠ "tự tử"');
  assert.equal(m.check('buổi sáng đi học muộn'), null, '"buổi" không bị chặn');
  assert.equal(m.check('các bạn ơi thả tim'), null, '"các" không bị chặn');
  assert.equal(m.check('chuông báo động kêu'), null, '"báo động" ≠ "bạo động"');
  assert.equal(m.check('giá biến động quá'), null, '"biến động" ≠ "biển đông"');
  assert.equal(m.check('bế @Nhi vì tội nợ 500k chưa trả'), null);
});

test('tất cả câu mẫu của quản giáo đều sạch', () => {
  const m = new Moderator(() => DEFAULT_CONFIG);
  for (const [k, p] of Object.entries(PERSONAS)) {
    for (const [kind, arr] of Object.entries(p.lines)) {
      for (const l of arr) assert.equal(m.check(l), null, `${k}.${kind}: ${l}`);
    }
  }
});

test('thẻ pháp luật đều sạch và đủ trường', () => {
  const m = new Moderator(() => DEFAULT_CONFIG);
  for (const c of legal.cards) {
    assert.ok(c.key && c.title && c.law && c.text, c.key);
    assert.equal(m.check(`${c.title} ${c.text}`), null, c.key);
  }
});

// ───── phân tích ─────
test('parser: mention, lệnh và tố giác dự phòng', () => {
  assert.deepEqual(extractMentions('Bế con @Nhi vào trỏng vì tội nợ 500k'), ['Nhi']);
  assert.equal(parseCommand('!miễn tố').cmd, 'optout');
  assert.equal(parseCommand('chơi lại').cmd, 'optin');
  assert.equal(parseCommand('tự thú tội lười học').cmd, 'confess');
  const d = parseCommand('bào chữa @Nam vì bạn ấy rất tốt bụng');
  assert.equal(d.cmd, 'defense');
  assert.deepEqual(d.targets, ['Nam']);
  assert.match(d.reason, /tốt bụng/);

  const h = heuristicReport('Bế con @Nhi vào trỏng vì tội nợ 500k chưa trả');
  assert.equal(h.isReport, true);
  assert.deepEqual(h.targets, ['Nhi']);
  assert.match(h.crimeRaw, /nợ 500k/);

  const h2 = heuristicReport('bế thằng Nam vì tội ngủ nướng');
  assert.equal(h2.isReport, true);
  assert.deepEqual(h2.targets, ['Nam']);

  assert.equal(heuristicReport('bé Nam dễ thương quá').isReport, false, 'không nhầm "bé" thành "bế"');
  assert.equal(heuristicReport('tôi thích live này').isReport, false, '"tôi" không phải "tội"');
  assert.equal(heuristicReport('be @lan vi toi tre hen').crimeRaw, 'tre hen', 'gõ không dấu');
});

test('funnyCrime: vô hại hoá theo từ khoá', () => {
  const c = funnyCrime('nợ 500k chưa trả');
  assert.match(c, /tội/);
  assert.doesNotMatch(c, /500k/);
});

// ───── engine ─────
test('tố giác → vào buồng, án trong khoảng, có tuyên án + TTS', async () => {
  const { engine, fx, says } = setup();
  await engine.handleChat({ user: U('an'), text: 'Bế con @Nhi vào trỏng vì tội nợ 500k chưa trả' });
  const p = engine.prisoners.get('nhi');
  assert.ok(p);
  assert.ok(p.cell != null);
  assert.ok(p.days >= 50 && p.days <= 500);
  assert.ok(fx.some((f) => f.fx === 'verdict' && f.prisoner.id === 'nhi' && f.law));
  assert.equal(says.length, 1);
});

test('chống spam: chờ giữa 2 lần tố', async () => {
  const { engine } = setup();
  await engine.handleChat({ user: U('an'), text: 'bế @b1 vì tội ngủ' });
  await engine.handleChat({ user: U('an'), text: 'bế @b2 vì tội ngủ' });
  assert.ok(engine.prisoners.has('b1'));
  assert.ok(!engine.prisoners.has('b2'));
});

test('tố lại người đang trong trại → cộng dồn án', async () => {
  const { engine } = setup({ game: { reportCooldownSec: 0 } });
  await engine.handleChat({ user: U('a'), text: 'bế @xx vì tội ngủ' });
  const d1 = engine.prisoners.get('xx').days;
  await engine.handleChat({ user: U('b'), text: 'bế @xx vì tội ăn vụng' });
  assert.ok(engine.prisoners.get('xx').days > d1);
  assert.equal(engine.prisoners.get('xx').crimes, 2);
});

test('tái phạm (giữa các phiên) → án nhân hệ số', async () => {
  const { engine, store } = setup({ game: { minSentence: 100, maxSentence: 100, recidivismMultiplier: 1.5 } });
  store.addConviction('xx', 'xx', 100);
  await engine.handleChat({ user: U('a'), text: 'bế @xx vì tội ngủ' });
  const p = engine.prisoners.get('xx');
  assert.equal(p.recidivist, true);
  assert.equal(p.days, 150);
});

test('tim giảm án đúng người, đủ mốc → Bão Tim', async () => {
  const { engine, fx } = setup({ game: { stormThreshold: 50, stormDays: 10, minSentence: 200, maxSentence: 200 } });
  await engine.handleChat({ user: U('a'), text: 'bế @xx vì tội ngủ' });
  engine.handleLike({ user: U('a'), count: 20 });
  assert.equal(engine.prisoners.get('xx').days, 180, 'người tố thả tim → giảm cho người họ tố');
  engine.handleLike({ user: U('z'), count: 30 });
  assert.ok(fx.some((f) => f.fx === 'storm'));
  assert.equal(engine.prisoners.get('xx').days, 200 - 50 - 10);
});

test('quà: bậc thang, đặc xá 1 người, đại xá toàn trại, Vua Thăm Nuôi', async () => {
  const { engine, fx } = setup({ game: { reportCooldownSec: 0, minSentence: 400, maxSentence: 400 } });
  await engine.handleChat({ user: U('a'), text: 'bế @xx vì tội ngủ' });
  await engine.handleChat({ user: U('b'), text: 'bế @yy vì tội ngủ' });
  engine.handleGift({ user: U('a'), giftId: '1', giftName: 'Hoa hồng', coins: 1 });
  assert.equal(engine.prisoners.get('xx').days, 380);
  engine.handleGift({ user: U('a'), giftId: '2', giftName: 'Mì tôm', coins: 10 });
  assert.equal(engine.prisoners.get('xx').days, 280);
  engine.handleGift({ user: U('a'), giftId: '3', giftName: 'Gà quay', coins: 99 });
  assert.ok(!engine.prisoners.has('xx'), 'đặc xá');
  assert.ok(fx.some((f) => f.fx === 'newKing' && f.name === 'a'));
  engine.handleGift({ user: U('c'), giftId: '4', giftName: 'Lệnh', coins: 299 });
  assert.equal(engine.prisoners.size, 0, 'đại xá');
  assert.ok(fx.some((f) => f.fx === 'pardonAll'));
});

test('quà ghi đè theo giftId', async () => {
  const { engine } = setup({ game: { minSentence: 400, maxSentence: 400 }, gifts: { overrides: { 5655: { days: 7 } } } });
  await engine.handleChat({ user: U('a'), text: 'bế @xx vì tội ngủ' });
  engine.handleGift({ user: U('a'), giftId: '5655', giftName: 'Rose', coins: 1 });
  assert.equal(engine.prisoners.get('xx').days, 393);
});

test('miễn tố: tự ra trại và không bị bế lại', async () => {
  const { engine } = setup({ game: { reportCooldownSec: 0 } });
  await engine.handleChat({ user: U('a'), text: 'bế @xx vì tội ngủ' });
  await engine.handleChat({ user: U('xx'), text: 'miễn tố' });
  assert.ok(!engine.prisoners.has('xx'));
  await engine.handleChat({ user: U('b'), text: 'bế @xx vì tội ngủ' });
  assert.ok(!engine.prisoners.has('xx'));
  await engine.handleChat({ user: U('xx'), text: 'chơi lại' });
  await engine.handleChat({ user: U('c'), text: 'bế @xx vì tội ngủ' });
  assert.ok(engine.prisoners.has('xx'));
});

test('tự thú → án giảm theo hệ số', async () => {
  const { engine } = setup({ game: { minSentence: 50, maxSentence: 400, selfConfessFactor: 0.5 } });
  await engine.handleChat({ user: U('me'), text: 'tự thú tội lười học' });
  const p = engine.prisoners.get('me');
  assert.ok(p);
  assert.ok(p.days <= 230);
});

test('người bị tố vào live chat → đánh dấu có mặt + bóng thoại', async () => {
  const { engine, fx } = setup();
  await engine.handleChat({ user: U('a'), text: 'bế @nhi vì tội ngủ' });
  await engine.handleChat({ user: { uniqueId: 'nhi', name: 'Ngọc Nhi', avatar: 'http://img' }, text: 'oan quá' });
  const p = engine.prisoners.get('nhi');
  assert.equal(p.present, true);
  assert.equal(p.avatar, 'http://img');
  assert.equal(p.name, 'Ngọc Nhi');
  assert.ok(fx.some((f) => f.fx === 'bubble' && f.text === 'oan quá'));
});

test('bình luận chứa từ cấm bị bỏ qua hoàn toàn', async () => {
  const { engine, says } = setup();
  await engine.handleChat({ user: U('a'), text: 'bế @xx vì tội phản động' });
  assert.equal(engine.prisoners.size, 0);
  assert.equal(says.length, 0);
});

test('trại đầy → hàng chờ, có chỗ → tự chuyển vào', async () => {
  const { engine } = setup({ game: { cellCount: 1, perCell: 1, reportCooldownSec: 0 } });
  await engine.handleChat({ user: U('a'), text: 'bế @xx vì tội ngủ' });
  await engine.handleChat({ user: U('b'), text: 'bế @yy vì tội ngủ' });
  assert.equal(engine.queue.length, 1);
  engine.adminRelease('xx');
  assert.equal(engine.queue.length, 0);
  assert.equal(engine.prisoners.get('yy').cell, 0);
});

test('án tự giảm theo thời gian và mãn hạn', async () => {
  const { engine, fx } = setup({ game: { minSentence: 50, maxSentence: 50, decayDaysPerSec: 10 } });
  await engine.handleChat({ user: U('a'), text: 'bế @xx vì tội ngủ' });
  for (let i = 0; i < 5; i++) engine.tick(1);
  assert.ok(!engine.prisoners.has('xx'));
  assert.ok(fx.some((f) => f.fx === 'release' && f.reason === 'served'));
});

test('AI trả kết quả: dùng tội danh + câu thoại AI, AI báo không an toàn → bỏ qua', async () => {
  const { engine, says } = setup({ game: { reportCooldownSec: 0 } });
  engine.ai = { analyzeReport: async () => ({ isReport: true, safe: true, targets: ['Nhi'], crime: 'tội chiếm dụng trà sữa', severity: 3, line: 'Bị cáo Nhi, toà tuyên {days} ngày!', law: 'no_tien' }) };
  await engine.handleChat({ user: U('a'), text: 'bế @Nhi vì nợ 500k' });
  const p = engine.prisoners.get('nhi');
  assert.equal(p.crime, 'tội chiếm dụng trà sữa');
  assert.match(says[0].text, new RegExp(`${Math.round(p.initial)} ngày`));
  engine.ai = { analyzeReport: async () => ({ isReport: false, safe: false, targets: [], crime: '', severity: 1, line: '', law: '' }) };
  await engine.handleChat({ user: U('b'), text: 'bế @Lan vì chuyện nhạy cảm' });
  assert.ok(!engine.prisoners.has('lan'));
});

test('NPC xuất hiện khi trại vắng, bị thay khi trại đầy', async () => {
  const { engine } = setup({ game: { npcEnabled: true, npcIdleSec: 0, cellCount: 1, perCell: 1 } });
  engine.lastRealActivity = 0;
  engine.tick(1);
  assert.ok([...engine.prisoners.values()].some((p) => p.npc));
  await engine.handleChat({ user: U('a'), text: 'bế @xx vì tội ngủ' });
  assert.ok(engine.prisoners.has('xx'));
  assert.ok(![...engine.prisoners.values()].some((p) => p.npc));
});

// ───── adapter TikTok ─────
test('chuẩn hoá sự kiện TikTok theo nhiều phiên bản trường', () => {
  const u = normUser({ user: { uniqueId: 'abc', nickname: 'ABC', profilePicture: { url: ['http://a'] } } });
  assert.deepEqual(u, { uniqueId: 'abc', name: 'ABC', avatar: 'http://a' });
  const u2 = normUser({ user: { displayId: 'x', nickname: 'X', avatarThumb: { urlList: ['http://b'] } } });
  assert.equal(u2.uniqueId, 'x');
  assert.equal(u2.avatar, 'http://b');
  const g = normGift({ giftId: 5655, repeatCount: 3, repeatEnd: true, giftDetails: { giftType: 1, giftName: 'Rose', diamondCount: 1 } });
  assert.equal(g.coins, 3);
  assert.equal(g.final, true);
  assert.equal(normGift({ giftId: 1, repeatCount: 2, repeatEnd: false, gift: { type: 1, diamondCount: 1 } }).final, false, 'chuỗi chưa kết thúc');
  assert.equal(normGift({ giftId: 2, repeatCount: 1, gift: { type: 2, diamondCount: 99, name: 'Lion' } }).coins, 99);
});

test('parseJson chịu được code fence', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
});
