// Lưu trữ bền giữa các phiên Live (file JSON, ghi trễ để không tốn I/O; không cần thư viện native trên ARM).
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({
  records: {},        // key → { name, priorCount, totalDays, lastSeen }
  allTimeGifters: {}, // key → { name, coins }
  optOut: {},         // key → thời điểm xin miễn tố
  gifts: {},          // giftId → { name, coins, image, count, lastSeen } — "chế độ học" quà
  stats: { jailed: 0, released: 0, coins: 0, likes: 0 },
});

export class Store {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'db.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = EMPTY();
    if (fs.existsSync(this.file)) {
      try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (e) { console.error('db.json lỗi, tạo mới:', e.message); }
    }
    this._timer = null;
  }

  touch() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 3000);
  }

  flush() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  record(key) { return this.data.records[key]; }

  addConviction(key, name, days) {
    const r = this.data.records[key] || { name, priorCount: 0, totalDays: 0 };
    r.name = name;
    r.priorCount++;
    r.totalDays += Math.round(days);
    r.lastSeen = Date.now();
    this.data.records[key] = r;
    this.data.stats.jailed++;
    this.touch();
  }

  addGifter(key, name, coins) {
    const g = this.data.allTimeGifters[key] || { name, coins: 0 };
    g.name = name;
    g.coins += coins;
    this.data.allTimeGifters[key] = g;
    this.data.stats.coins += coins;
    this.touch();
  }

  learnGift({ giftId, name, coins, image }) {
    if (giftId == null) return;
    const g = this.data.gifts[giftId] || { name, coins, image, count: 0 };
    Object.assign(g, { name: name || g.name, coins: coins || g.coins, image: image || g.image });
    g.count++;
    g.lastSeen = Date.now();
    this.data.gifts[giftId] = g;
    this.touch();
  }

  isOptOut(key) { return Boolean(this.data.optOut[key]); }
  setOptOut(key, on = true) { if (on) this.data.optOut[key] = Date.now(); else delete this.data.optOut[key]; this.touch(); }

  topAllTime(n = 5) {
    return Object.values(this.data.allTimeGifters).sort((a, b) => b.coins - a.coins).slice(0, n);
  }
}
