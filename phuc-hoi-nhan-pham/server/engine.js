// Game Engine — server giữ toàn bộ trạng thái (F5 overlay không mất dữ liệu).
import { EventEmitter } from 'node:events';
import { userKey, clamp, randInt, pick, hashHue, cleanText } from './util.js';
import { PERSONAS, PERSONA_KEYS, line, NPCS, NPC_CHATTER } from './personas.js';
import { parseCommand, heuristicReport, funnyCrime, pickLegal, extractMentions } from './parser.js';

const ROTATE_MS = 10 * 60_000;

/** Tên đọc được cho TTS: bỏ ký tự lạ, số, gạch dưới. */
export function speakable(name) {
  const s = String(name).replace(/[._\-\d]+/g, ' ').replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim();
  return s || 'bạn này';
}

export class Engine extends EventEmitter {
  constructor({ getConfig, store, ai, moderator, legalCards, log }) {
    super();
    this.getConfig = getConfig;
    this.store = store;
    this.ai = ai;
    this.mod = moderator;
    this.cards = legalCards;
    this.log = log || { info() {}, warn() {}, error() {} };
    this.prisoners = new Map();
    this.queue = [];
    this.lastTarget = new Map();
    this.cooldown = new Map();
    this.gates = new Map();
    this.viewers = 0;
    this.storm = 0;
    this.labor = null;
    this.lastLikeAt = 0;
    const now = Date.now();
    this.lastRealActivity = now;
    this.lastRollCall = now;
    this.lastLabor = now;
    this.lastNpcSpawn = 0;
    this.lastNpcChat = 0;
    this.lastIdleSay = now;
    this.personaIdx = 0;
    this.personaSince = now;
    this.connection = { status: 'offline', detail: '' };
    this.resetSession();
  }

  resetSession() {
    this.session = { gifters: new Map(), reporters: new Map(), likes: 0, gifts: 0, coins: 0, jailed: 0, released: 0 };
    this.kingKey = null;
    this.changed();
  }

  // ───────────────────────── tiện ích nội bộ ─────────────────────────
  get cfg() { return this.getConfig(); }
  get g() { return this.cfg.game; }

  get personaKey() {
    const p = this.cfg.persona;
    if (PERSONAS[p]) return p;
    return PERSONA_KEYS[this.personaIdx % PERSONA_KEYS.length];
  }

  fx(name, payload = {}) { this.emit('fx', { type: 'fx', fx: name, at: Date.now(), ...payload }); }

  toast(icon, text, kind = 'info') { this.fx('toast', { icon, text: cleanText(text, 90), kind }); }

  /** Đọc TTS (đã qua lọc lớp 3). gate: chống spam theo loại câu. */
  say(text, priority = 1, gate = null, gapMs = 0) {
    if (!text) return;
    if (gate) {
      const last = this.gates.get(gate) || 0;
      if (Date.now() - last < gapMs) return;
      this.gates.set(gate, Date.now());
    }
    if (!this.mod.isClean(text)) { this.log.warn('Chặn câu TTS chứa từ cấm:', text); return; }
    this.emit('say', { text, persona: this.personaKey, priority });
  }

  changed() { this.emit('changed'); }

  capacity() { return this.g.cellCount * this.g.perCell; }

  jailed() { return [...this.prisoners.values()].filter((p) => p.cell != null); }

  realPrisoners() { return this.jailed().filter((p) => !p.npc); }

  senderKeys(user) {
    return [user.uniqueId, user.name].map((x) => userKey(x || '')).filter(Boolean);
  }

  findBySender(user) {
    for (const k of this.senderKeys(user)) {
      const p = this.prisoners.get(k);
      if (p) return p;
    }
    return null;
  }

  onCooldown(kind, key, sec) {
    const id = `${kind}:${key}`;
    const last = this.cooldown.get(id) || 0;
    if (Date.now() - last < sec * 1000) return true;
    this.cooldown.set(id, Date.now());
    if (this.cooldown.size > 5000) this.cooldown.clear();
    return false;
  }

  sentenceFor(severity) {
    const { minSentence: lo, maxSentence: hi } = this.g;
    const s = clamp(Number(severity) || 2, 1, 5);
    const base = lo + ((s - 1) / 4) * (hi - lo);
    const jitter = base * (Math.random() * 0.3 - 0.15);
    return clamp(Math.round((base + jitter) / 10) * 10, lo, hi);
  }

  place(p) {
    const cap = this.capacity();
    let jailed = this.jailed();
    if (jailed.length >= cap && !p.npc) {
      const npc = jailed.find((x) => x.npc);
      if (npc) { this.prisoners.delete(npc.id); this.fx('release', { id: npc.id, name: npc.name, reason: 'npc', silent: true }); jailed = this.jailed(); }
    }
    if (jailed.length < cap) {
      const counts = Array(this.g.cellCount).fill(0);
      for (const x of jailed) if (x.cell < counts.length) counts[x.cell]++;
      const min = Math.min(...counts);
      const candidates = counts.map((c, i) => (c === min ? i : -1)).filter((i) => i >= 0);
      p.cell = pick(candidates);
      this.prisoners.set(p.id, p);
      return 'cell';
    }
    if (p.npc) return null;
    if (this.queue.length >= this.g.maxQueue) return null;
    p.cell = null;
    this.prisoners.set(p.id, p);
    this.queue.push(p.id);
    return 'queue';
  }

  fillFromQueue() {
    while (this.queue.length && this.jailed().length < this.capacity()) {
      const id = this.queue.shift();
      const p = this.prisoners.get(id);
      if (!p) continue;
      this.prisoners.delete(id);
      if (this.place(p) === 'cell') this.toast('🚪', `${p.name} được chuyển vào Buồng ${p.cell + 1}`);
    }
  }

  pub(p) {
    return {
      id: p.id, name: p.name, avatar: p.avatar || '', crime: p.crime, days: Math.max(0, Math.ceil(p.days)),
      initial: p.initial, cell: p.cell, recidivist: p.recidivist, npc: p.npc, hue: p.hue,
      reporter: p.reporter, present: p.present, crimes: p.crimes, since: p.since,
    };
  }

  /** Mục tiêu nhận giảm án từ một người (quà/tim/follow): chính họ → người họ đã tương tác → người án nặng nhất. */
  resolveTarget(user) {
    const self = this.findBySender(user);
    if (self) return self;
    const key = userKey(user.uniqueId || user.name);
    const t = this.prisoners.get(this.lastTarget.get(key));
    if (t) return t;
    const list = this.jailed();
    if (!list.length) return null;
    const real = list.filter((x) => !x.npc);
    return (real.length ? real : list).sort((a, b) => b.days - a.days)[0];
  }

  reduce(p, days, reason) {
    if (!p || days <= 0) return;
    p.days -= days;
    if (p.days <= 0) this.release(p, reason);
  }

  release(p, reason = 'served', { silent = false } = {}) {
    if (!this.prisoners.has(p.id)) return;
    this.prisoners.delete(p.id);
    this.queue = this.queue.filter((id) => id !== p.id);
    if (!p.npc) { this.session.released++; this.store.data.stats.released++; this.store.touch(); }
    this.fx('release', { id: p.id, name: p.name, reason, silent: silent || p.npc });
    if (!silent && !p.npc && (reason === 'served' || reason === 'like' || reason === 'storm' || reason === 'labor')) {
      this.say(line(this.personaKey, 'release', { name: speakable(p.name) }), 1, 'release', 6000);
    }
    this.fillFromQueue();
    this.changed();
  }

  // ───────────────────────── sự kiện vào ─────────────────────────
  async handleChat({ user, text }) {
    if (!user || !text) return;
    if (this.mod.isBlockedUser(user.uniqueId) || this.mod.isBlockedUser(user.name)) return;
    const clean = cleanText(text, 200);
    const me = this.findBySender(user);
    if (me && !me.present) this.markPresent(me, user);
    if (!this.mod.isClean(clean)) return; // lớp 1
    this.lastRealActivity = Date.now();

    const cmd = parseCommand(clean);
    if (cmd) return this.handleCommand(cmd, user, me, clean);

    const looksLikeReport = extractMentions(clean).length > 0 || heuristicReport(clean).isReport;
    if (looksLikeReport) return this.handleReport(user, clean, me);
    if (me) this.fx('bubble', { id: me.id, text: cleanText(clean, 60) });
  }

  markPresent(p, user) {
    p.present = true;
    if (user.avatar) p.avatar = user.avatar;
    if (user.name && !p.npc) p.name = cleanText(user.name, 24);
    this.fx('presence', { id: p.id, name: p.name });
    this.say(line(this.personaKey, 'presence', { name: speakable(p.name) }), 1, 'presence', 8000);
    this.changed();
  }

  async handleReport(user, text, me) {
    const g = this.g;
    const reporterKey = userKey(user.uniqueId || user.name);
    if (this.onCooldown('report', reporterKey, g.reportCooldownSec)) {
      if (me) this.fx('bubble', { id: me.id, text: cleanText(text, 60) });
      return;
    }
    this.fx('filing', { by: user.name }); // overlay hiện "Đang lập biên bản..."
    const persona = this.personaKey;
    let a = null;
    try {
      a = await this.ai.analyzeReport({ text, author: user.name, persona, lawKeys: this.cards.map((c) => c.key) });
    } catch (e) { this.log.warn('AI analyze lỗi', e); }

    let targets; let crime; let severity; let aiLine = null; let lawKey = null;
    if (a) {
      if (!a.safe) { this.toast('🚫', 'Quản giáo bỏ qua một bình luận không phù hợp', 'warn'); return; }
      if (!a.isReport) { if (me) this.fx('bubble', { id: me.id, text: cleanText(text, 60) }); return; }
      targets = (a.targets || []).slice(0, 2);
      crime = cleanText(a.crime || '', 60);
      severity = a.severity;
      aiLine = a.line;
      lawKey = a.law;
      if (!crime || !this.mod.isClean(crime)) crime = funnyCrime(text);
      if (aiLine && !this.mod.isClean(aiLine)) aiLine = null; // lớp 3
    } else {
      const h = heuristicReport(text);
      if (!h.isReport) return;
      targets = h.targets;
      crime = funnyCrime(h.crimeRaw);
      severity = h.severity;
    }
    if (!/^tội/i.test(crime)) crime = `tội ${crime}`;

    let count = 0;
    for (const t of targets) {
      const isSelf = t === '__self__' || this.senderKeys(user).includes(userKey(t));
      const name = isSelf ? user.name : cleanText(String(t).replace(/^@+/, ''), 24);
      const key = isSelf ? userKey(user.uniqueId || user.name) : userKey(name);
      if (!key || key.length < 2) continue;
      if (this.store.isOptOut(key)) { this.toast('📜', `${name} có giấy miễn tố — không thể bế`, 'warn'); continue; }
      if (this.mod.isBlockedUser(name)) continue;
      this.jail({ key, name, crime, severity, reporter: user, aiLine, lawKey, confess: isSelf, avatar: isSelf ? user.avatar : '' });
      if (!isSelf) this.lastTarget.set(reporterKey, key);
      count++;
    }
    if (count) {
      const r = this.session.reporters.get(reporterKey) || { name: user.name, count: 0 };
      r.count += count;
      r.name = user.name;
      this.session.reporters.set(reporterKey, r);
    }
    this.changed();
  }

  jail({ key, name, crime, severity = 2, reporter, aiLine, lawKey, confess = false, avatar = '' }) {
    const g = this.g;
    const persona = this.personaKey;
    const existing = this.prisoners.get(key);
    if (existing) {
      const add = Math.round(this.sentenceFor(severity) * 0.5);
      existing.days = Math.min(existing.days + add, g.maxStack);
      existing.crimes++;
      existing.crime = crime;
      const text = line(persona, 'stack', { name: speakable(existing.name), crime, days: Math.ceil(existing.days) });
      this.fx('verdict', { kind: 'stack', prisoner: this.pub(existing), crime, days: Math.ceil(existing.days), added: add, reporter: reporter?.name, line: text, persona, law: null });
      this.say(text, 2, 'stack', 4000);
      this.changed();
      return existing;
    }
    let days = this.sentenceFor(severity);
    const rec = this.store.record(key);
    const recidivist = Boolean(rec && rec.priorCount > 0);
    if (recidivist) days = Math.round(days * g.recidivismMultiplier);
    if (confess) days = Math.max(g.minSentence, Math.round(days * g.selfConfessFactor));
    days = Math.min(days, g.maxStack);
    const p = {
      id: key, key, name, avatar, crime, days, initial: days, cell: null, recidivist, npc: false,
      hue: hashHue(key), reporter: confess ? '' : reporter?.name || '', present: confess, crimes: 1,
      since: Date.now(), priors: rec?.priorCount || 0,
    };
    const where = this.place(p);
    if (!where) { this.toast('⛔', `Trại quá tải! ${name} phải chờ đợt sau`, 'warn'); return null; }
    this.store.addConviction(key, name, days);
    this.session.jailed++;
    const kind = confess ? 'confess' : recidivist ? 'recidivist' : 'verdict';
    let text = aiLine && aiLine.includes('{days}') ? aiLine.replaceAll('{days}', String(days)) : null;
    if (!text || confess || recidivist) text = line(persona, kind, { name: speakable(name), crime, days });
    const card = pickLegal(this.cards, crime, lawKey);
    this.fx('verdict', {
      kind, prisoner: this.pub(p), crime, days, reporter: reporter?.name, line: text, persona,
      queued: where === 'queue', law: card, priors: p.priors,
    });
    this.say(text, 2);
    this.changed();
    return p;
  }

  async handleCommand(cmd, user, me, text) {
    const g = this.g;
    const persona = this.personaKey;
    const ukey = userKey(user.uniqueId || user.name);
    switch (cmd.cmd) {
      case 'optout': {
        this.store.setOptOut(ukey, true);
        for (const k of this.senderKeys(user)) this.store.setOptOut(k, true);
        if (me) {
          this.release(me, 'optout', { silent: true });
          this.say(line(persona, 'optout', { name: speakable(me.name) }), 1);
        }
        this.toast('📜', `${user.name} đã nhận giấy miễn tố (gõ "chơi lại" để tham gia)`);
        break;
      }
      case 'optin': {
        for (const k of [ukey, ...this.senderKeys(user)]) this.store.setOptOut(k, false);
        this.toast('🎮', `${user.name} đã tham gia lại trò chơi`);
        break;
      }
      case 'confess': {
        if (this.onCooldown('report', ukey, g.reportCooldownSec)) return;
        for (const k of [ukey, ...this.senderKeys(user)]) this.store.setOptOut(k, false);
        const crime = cmd.crime && this.mod.isClean(cmd.crime) ? funnyCrime(cmd.crime) : funnyCrime('');
        this.jail({ key: ukey, name: user.name, crime, severity: 2, reporter: user, confess: true, avatar: user.avatar });
        break;
      }
      case 'defense': {
        const targetName = cmd.targets?.[0];
        const target = targetName ? this.prisoners.get(userKey(targetName)) : me;
        if (!target) { this.toast('❓', `${user.name}: không tìm thấy phạm nhân để bào chữa`); return; }
        if (this.onCooldown('defense', ukey, g.defenseCooldownSec)) return;
        this.fx('filing', { by: user.name, kind: 'defense' });
        let score = null; let aiLine = null;
        const reason = cmd.reason || '';
        if (reason.length >= 4) {
          const r = await this.ai.judgeDefense({ lawyer: user.name, target: target.name, crime: target.crime, reason, persona });
          if (r && r.safe !== false) { score = clamp(Number(r.score) || 0, 0, 10); aiLine = this.mod.isClean(r.line) ? r.line : null; }
          if (r && r.safe === false) return;
        }
        if (score == null) score = clamp(Math.round(2 + reason.length / 20 + Math.random() * 4), 0, 10);
        const days = Math.round((score / 10) * g.defenseMaxDays);
        const win = days >= 10;
        const text = aiLine || line(persona, win ? 'defenseWin' : 'defenseLose', { giver: speakable(user.name), name: speakable(target.name), days });
        this.fx('defense', { lawyer: user.name, id: target.id, name: target.name, days, score, win, line: text });
        this.say(text, 1, 'defense', 5000);
        if (win) this.reduce(target, days, 'defense');
        this.lastTarget.set(ukey, target.id);
        break;
      }
      case 'visit': {
        const t = this.prisoners.get(userKey(cmd.targets[0]));
        if (!t) { this.toast('❓', `Không có phạm nhân ${cmd.targets[0]}`); return; }
        this.lastTarget.set(ukey, t.id);
        this.toast('🧺', `${user.name} đăng ký thăm nuôi ${t.name}`);
        break;
      }
      case 'status': {
        if (me) this.fx('bubble', { id: me.id, text: `Còn ${Math.ceil(me.days)} ngày 😭` });
        else this.toast('😇', `${user.name} vẫn đang trong sạch!`);
        break;
      }
      default:
    }
    this.changed();
  }

  resolveGiftRule(giftId, coins) {
    const ov = this.cfg.gifts.overrides?.[String(giftId)];
    if (ov && (ov.days != null || ov.action)) return ov;
    const tiers = [...this.cfg.gifts.tiers].sort((a, b) => b.minCoins - a.minCoins);
    return tiers.find((t) => coins >= t.minCoins) || null;
  }

  handleGift({ user, giftId, giftName, coins, repeatCount = 1, image }) {
    const total = Math.max(0, Number(coins) || 0);
    this.store.learnGift({ giftId, name: giftName, coins: repeatCount ? Math.round(total / repeatCount) : total, image });
    this.lastRealActivity = Date.now();
    const gkey = userKey(user.uniqueId || user.name);
    this.session.gifts++;
    this.session.coins += total;
    const s = this.session.gifters.get(gkey) || { name: user.name, coins: 0, avatar: user.avatar };
    s.coins += total;
    s.name = user.name;
    s.avatar = user.avatar || s.avatar;
    this.session.gifters.set(gkey, s);
    this.store.addGifter(gkey, user.name, total);

    const rule = this.resolveGiftRule(giftId, total);
    const persona = this.personaKey;
    const giver = speakable(user.name);
    const gift = giftName || 'quà';

    if (rule?.action === 'pardon_all') {
      const all = [...this.prisoners.values()].filter((p) => !p.npc);
      for (const p of [...this.prisoners.values()]) this.release(p, 'pardon_all', { silent: true });
      this.fx('pardonAll', { giver: user.name, avatar: user.avatar, gift, coins: total, count: all.length });
      this.say(line(persona, 'pardonAll', { giver }), 3);
    } else {
      const target = this.resolveTarget(user);
      if (rule?.action === 'pardon_one' && target) {
        this.fx('pardon', { giver: user.name, avatar: user.avatar, id: target.id, name: target.name, gift, coins: total });
        this.say(line(persona, 'pardonOne', { giver, name: speakable(target.name) }), 3);
        this.release(target, 'pardon', { silent: true });
      } else if (target) {
        const days = rule?.days != null ? Number(rule.days) * (rule.perUnit ? repeatCount : 1) : Math.round(total * 20);
        const isSelf = this.findBySender(user) === target;
        this.fx('gift', { giver: user.name, avatar: user.avatar, gift, image, coins: total, id: target.id, name: target.name, days, label: rule?.label });
        const text = line(persona, isSelf ? 'giftSelf' : 'giftSmall', { giver, name: speakable(target.name), days, gift });
        if (total >= 5) this.say(text, 2); else this.say(text, 1, 'giftSmall', 4000);
        this.lastTarget.set(gkey, target.id);
        this.reduce(target, days, 'gift');
      } else {
        this.fx('gift', { giver: user.name, avatar: user.avatar, gift, image, coins: total, id: null, days: 0 });
        this.say(line(persona, 'giftNoTarget', { giver }), 1, 'giftNoTarget', 5000);
      }
    }
    // Vua Thăm Nuôi mới?
    const top = [...this.session.gifters.entries()].sort((a, b) => b[1].coins - a[1].coins)[0];
    if (top && top[0] !== this.kingKey && top[1].coins >= 10) {
      this.kingKey = top[0];
      this.fx('newKing', { name: top[1].name, avatar: top[1].avatar, coins: top[1].coins });
      this.say(`Vua Thăm Nuôi mới: ${speakable(top[1].name)}!`, 2, 'king', 3000);
    }
    this.changed();
  }

  handleLike({ user, count = 1 }) {
    const n = Math.max(1, Number(count) || 1);
    this.session.likes += n;
    this.store.data.stats.likes += n;
    this.store.touch();
    this.lastLikeAt = Date.now();
    this.lastRealActivity = Date.now();
    const target = this.resolveTarget(user);
    if (target) this.reduce(target, n * this.g.likeDays, 'like');
    this.fx('like', { count: n, id: target?.id || null });
    this.storm += n;
    if (this.storm >= this.g.stormThreshold) {
      this.storm = 0;
      for (const p of [...this.prisoners.values()]) if (p.cell != null) this.reduce(p, this.g.stormDays, 'storm');
      this.fx('storm', { days: this.g.stormDays });
      this.say(line(this.personaKey, 'storm', { days: this.g.stormDays }), 2, 'storm', 8000);
    }
    if (this.labor) {
      this.labor.likes += n;
      if (this.labor.likes >= this.labor.goal) this.endLabor(true);
    }
    this.changed();
  }

  handleSocial({ user, kind }) {
    const days = kind === 'share' ? this.g.shareDays : this.g.followDays;
    const target = this.resolveTarget(user);
    this.lastRealActivity = Date.now();
    if (!target) { this.toast(kind === 'share' ? '📣' : '➕', `${user.name} ${kind === 'share' ? 'đã chia sẻ live' : 'đã theo dõi kênh'}. Cảm ơn!`); return; }
    const text = line(this.personaKey, kind, { giver: speakable(user.name), name: speakable(target.name), days });
    this.fx('social', { kind, giver: user.name, id: target.id, name: target.name, days });
    this.say(text, 1, kind, 6000);
    this.reduce(target, days, kind);
    this.changed();
  }

  setViewers(n) { this.viewers = Number(n) || 0; this.changed(); }

  setConnection(status, detail = '') { this.connection = { status, detail }; this.changed(); }

  // ───────────────────────── sự kiện định kỳ ─────────────────────────
  startLabor() {
    const g = this.g;
    this.labor = { goal: g.laborGoalLikes, likes: 0, endsAt: Date.now() + g.laborEventSec * 1000, days: g.laborRewardDays };
    this.lastLabor = Date.now();
    this.fx('laborStart', { ...this.labor });
    this.say(line(this.personaKey, 'laborStart', { goal: g.laborGoalLikes, sec: g.laborEventSec, days: g.laborRewardDays }), 2);
    this.changed();
  }

  endLabor(win) {
    if (!this.labor) return;
    const days = this.labor.days;
    this.labor = null;
    this.fx('laborEnd', { win, days });
    this.say(line(this.personaKey, win ? 'laborWin' : 'laborLose', { days }), 2);
    if (win) for (const p of [...this.prisoners.values()]) if (p.cell != null) this.reduce(p, days, 'labor');
    this.changed();
  }

  spawnNpc() {
    const used = new Set([...this.prisoners.values()].map((p) => p.name));
    const n = NPCS.filter((x) => !used.has(x.name));
    if (!n.length) return;
    const npc = pick(n);
    const id = `npc_${userKey(npc.name)}`;
    const days = randInt(8, 20) * 10;
    const p = { id, key: id, name: npc.name, avatar: '', crime: npc.crime, days, initial: days, cell: null, recidivist: false, npc: true, hue: hashHue(id), reporter: 'Hệ thống', present: true, crimes: 1, since: Date.now() };
    if (this.place(p) === 'cell') this.fx('verdict', { kind: 'npc', prisoner: this.pub(p), crime: p.crime, days, reporter: '', line: '', persona: this.personaKey, quiet: true });
  }

  tick(dt = 1) {
    const g = this.g;
    const now = Date.now();
    for (const p of [...this.prisoners.values()]) {
      if (p.cell == null) continue;
      p.days -= g.decayDaysPerSec * dt;
      if (p.days <= 0) this.release(p, 'served');
    }
    if (now - this.lastLikeAt > 15_000 && this.storm > 0) this.storm = Math.max(0, this.storm - g.stormThreshold * 0.01 * dt);
    if (this.labor && now >= this.labor.endsAt) this.endLabor(false);

    const real = this.realPrisoners();
    if (!this.labor && real.length >= 3 && now - this.lastLabor > g.laborEventMin * 60_000) this.startLabor();
    if (real.length && now - this.lastRollCall > g.rollCallMin * 60_000) {
      this.lastRollCall = now;
      const worst = real.sort((a, b) => b.days - a.days)[0];
      this.fx('rollCall', { count: real.length, name: worst.name, days: Math.ceil(worst.days), law: pick(this.cards) });
      this.say(line(this.personaKey, 'rollCall', { count: real.length, name: speakable(worst.name), days: Math.ceil(worst.days) }), 1);
    }
    // NPC giữ phòng không bao giờ trống
    if (g.npcEnabled && !real.length && now - this.lastRealActivity > g.npcIdleSec * 1000) {
      const npcs = this.jailed().filter((p) => p.npc);
      if (npcs.length < 4 && now - this.lastNpcSpawn > 8000) { this.lastNpcSpawn = now; this.spawnNpc(); }
      if (now - this.lastIdleSay > 120_000) { this.lastIdleSay = now; this.say(line(this.personaKey, 'idle', {}), 1); }
    }
    const npcs = this.jailed().filter((p) => p.npc);
    if (npcs.length && now - this.lastNpcChat > 9000) {
      this.lastNpcChat = now;
      const n = pick(npcs);
      this.fx('bubble', { id: n.id, text: pick(NPC_CHATTER) });
    }
    if (this.cfg.persona === 'rotate' && now - this.personaSince > ROTATE_MS) {
      this.personaIdx++;
      this.personaSince = now;
      const p = PERSONAS[this.personaKey];
      this.toast(p.icon, `Đổi ca trực: ${p.name} nhận ca!`);
    }
    this.changed();
  }

  // ───────────────────────── admin ─────────────────────────
  adminRelease(id) { const p = this.prisoners.get(id); if (p) this.release(p, 'admin', { silent: true }); }

  adminClear() { for (const p of [...this.prisoners.values()]) this.release(p, 'admin', { silent: true }); this.queue = []; this.changed(); }

  snapshot() {
    const g = this.g;
    const cells = Array.from({ length: g.cellCount }, (_, i) => ({ id: i, prisoners: [] }));
    for (const p of this.jailed()) if (cells[p.cell]) cells[p.cell].prisoners.push(this.pub(p));
    const top = (m, f) => [...m.values()].sort((a, b) => b[f] - a[f]).slice(0, 5);
    const persona = PERSONAS[this.personaKey];
    return {
      title: g.title,
      subtitle: g.subtitle,
      persona: { key: this.personaKey, name: persona.name, short: persona.short, icon: persona.icon },
      perCell: g.perCell,
      cells,
      queue: this.queue.slice(0, 12).map((id) => this.prisoners.get(id)).filter(Boolean).map((p) => ({ name: p.name, days: Math.ceil(p.days) })),
      queueCount: this.queue.length,
      storm: { value: Math.round(this.storm), threshold: g.stormThreshold },
      labor: this.labor ? { ...this.labor } : null,
      boards: {
        gifters: top(this.session.gifters, 'coins').map(({ name, coins, avatar }) => ({ name, coins, avatar })),
        reporters: top(this.session.reporters, 'count'),
        toughest: this.realPrisoners().sort((a, b) => b.days - a.days).slice(0, 5).map((p) => ({ name: p.name, days: Math.ceil(p.days) })),
        allTime: this.store.topAllTime(5),
      },
      stats: {
        viewers: this.viewers, likes: this.session.likes, gifts: this.session.gifts, coins: this.session.coins,
        jailed: this.session.jailed, released: this.session.released, totalJailed: this.store.data.stats.jailed,
      },
      help: { likeDays: g.likeDays, followDays: g.followDays, shareDays: g.shareDays, tiers: this.cfg.gifts.tiers },
      connection: this.connection,
      showSafeZone: g.showSafeZone,
    };
  }
}
