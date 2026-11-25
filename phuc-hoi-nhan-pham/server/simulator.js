// Giả lập khán giả: test/demo không cần Live thật.
import { pick, randInt } from './util.js';

const PEOPLE = [
  ['tuananh.2k7', 'Tuấn Anh'], ['ngoc_nhi', 'Ngọc Nhi'], ['hoang.bao', 'Hoàng Bảo'], ['linh_xinh', 'Linh Xinh'],
  ['minhkhoi99', 'Minh Khôi'], ['thu_trang', 'Thu Trang'], ['datvu', 'Đạt Vũ'], ['kimchi_ne', 'Kim Chi'],
  ['phuong.anh', 'Phương Anh'], ['quang_huy', 'Quang Huy'], ['bichngoc', 'Bích Ngọc'], ['tranduc', 'Trần Đức'],
];
const VIEWERS = PEOPLE.map((p) => p[0]);
const REPORTS = [
  'Bế con @{t} vào trỏng vì tội nợ 500k chưa trả',
  'tố cáo @{t} tội seen tin nhắn không rep',
  'bắt @{t} vì đi chơi không rủ',
  '@{t} vô trại đi, tội ngủ nướng',
  'nhốt @{t} vì tội ăn hết bánh của tao',
  'be @{t} vi toi tre hen 2 tieng',
  'bế @{t} tội đẹp trai quá mức',
  'tố @{t} vì tội crush người ta mà không dám nói',
  'em tự thú tội lười học',
];
const CHATS = ['hahaha', 'cứu tui với', 'oan quá', 'thả tim đi mn', 'ai thăm nuôi tui với 🥺', 'vui quá', 'ủa gì vậy trời'];
const DEFENSES = ['bào chữa @{t} vì bạn ấy tốt bụng hay cho mình mượn vở', 'bào chữa @{t} lần đầu phạm tội, xin toà khoan hồng'];
export const SIM_GIFTS = [
  { giftId: 'sim_rose', giftName: 'Hoa hồng', coins: 1 },
  { giftId: 'sim_tiktok', giftName: 'TikTok', coins: 1 },
  { giftId: 'sim_finger', giftName: 'Tim ngón tay', coins: 5 },
  { giftId: 'sim_noodle', giftName: 'Mì tôm', coins: 10 },
  { giftId: 'sim_perfume', giftName: 'Nước hoa', coins: 20 },
  { giftId: 'sim_chicken', giftName: 'Gà quay', coins: 99 },
  { giftId: 'sim_pardon', giftName: 'Lệnh Đặc Xá', coins: 299 },
];

function viewer() {
  const [uniqueId, name] = pick(PEOPLE);
  return { uniqueId, name, avatar: '' };
}

export class Simulator {
  constructor(engine) {
    this.engine = engine;
    this.timer = null;
    this.speed = 1;
  }

  get running() { return Boolean(this.timer); }

  start(speed = 1) {
    this.stop();
    this.speed = Math.max(0.25, Number(speed) || 1);
    const loop = () => {
      this.randomEvent();
      this.timer = setTimeout(loop, randInt(1200, 3500) / this.speed);
    };
    loop();
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  randomEvent() {
    const r = Math.random();
    if (r < 0.28) return this.emit('report');
    if (r < 0.62) return this.emit('like', { count: randInt(5, 40) });
    if (r < 0.75) return this.emit('chat');
    if (r < 0.9) return this.emit('gift', { tier: Math.random() < 0.85 ? randInt(0, 3) : randInt(4, 5) });
    if (r < 0.95) return this.emit('defense');
    return this.emit(Math.random() < 0.5 ? 'follow' : 'share');
  }

  /** Bắn một sự kiện cụ thể (dùng cho nút bấm trên Admin). */
  emit(kind, opts = {}) {
    const e = this.engine;
    const user = opts.user ? { uniqueId: opts.user, name: opts.user, avatar: '' } : viewer();
    const jailed = [...e.prisoners.values()].filter((p) => !p.npc);
    const someone = () => (jailed.length && Math.random() < 0.4 ? pick(jailed).name : pick(VIEWERS));
    switch (kind) {
      case 'report': {
        let t = opts.target || pick(VIEWERS);
        while (!opts.target && t === user.uniqueId) t = pick(VIEWERS);
        const text = opts.text || pick(REPORTS).replace('{t}', t);
        return e.handleChat({ user, text });
      }
      case 'chat': {
        const speaker = jailed.length ? pick(jailed) : null;
        const u = speaker ? { uniqueId: speaker.id, name: speaker.name, avatar: '' } : user;
        return e.handleChat({ user: u, text: opts.text || pick(CHATS) });
      }
      case 'defense': {
        if (!jailed.length) return null;
        return e.handleChat({ user, text: pick(DEFENSES).replace('{t}', pick(jailed).id) });
      }
      case 'like': return e.handleLike({ user, count: opts.count || randInt(10, 50) });
      case 'gift': {
        const g = SIM_GIFTS[clampIdx(opts.tier ?? 0)];
        return e.handleGift({ user, ...g, repeatCount: 1 });
      }
      case 'follow':
      case 'share': return e.handleSocial({ user, kind });
      case 'storm': return e.handleLike({ user, count: e.getConfig().game.stormThreshold });
      case 'labor': return e.startLabor();
      default: return someone();
    }
  }
}

function clampIdx(i) { return Math.max(0, Math.min(SIM_GIFTS.length - 1, Number(i) || 0)); }
