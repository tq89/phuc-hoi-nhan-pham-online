// Bộ lọc 3 lớp: (1) đầu vào trước AI, (2) AI tự đánh giá "safe", (3) đầu ra trước TTS/hiển thị.
import { fold } from './util.js';

const ASCII = /^[\x00-\x7f]+$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWordChar = (ch) => /[\p{L}\p{N}]/u.test(ch);

function buildPattern(entry) {
  const e = entry.trim();
  const left = isWordChar(e[0]) ? '(?<![\\p{L}\\p{N}])' : '';
  const right = isWordChar(e[e.length - 1]) ? '(?![\\p{L}\\p{N}])' : '';
  // Cho phép nhiều khoảng trắng giữa các từ
  return new RegExp(left + esc(e).replace(/\s+/g, '\\s+') + right, 'u');
}

export class Moderator {
  constructor(getConfig) {
    this.getConfig = getConfig;
    this._sig = '';
  }

  _compile() {
    const list = this.getConfig().moderation.blacklist || [];
    const sig = list.join('|');
    if (sig === this._sig) return;
    this._sig = sig;
    this.folded = [];
    this.accented = [];
    this.compact = [];
    for (const raw of list) {
      const entry = raw.toLowerCase().normalize('NFC');
      if (!entry) continue;
      if (ASCII.test(entry)) {
        this.folded.push({ entry, re: buildPattern(entry) });
        const c = entry.replace(/[^a-z0-9]/g, '');
        if (c.length >= 7) this.compact.push(c); // bắt kiểu lách "c.o.n.g s.a.n"
      } else {
        this.accented.push({ entry, re: buildPattern(entry) });
      }
    }
  }

  /** Trả về từ khoá vi phạm đầu tiên, hoặc null nếu sạch. */
  check(text) {
    if (!text) return null;
    this._compile();
    const lower = String(text).toLowerCase().normalize('NFC');
    for (const { entry, re } of this.accented) if (re.test(lower)) return entry;
    const f = fold(lower);
    for (const { entry, re } of this.folded) if (re.test(f)) return entry;
    const compact = f.replace(/[^a-z0-9]/g, '');
    for (const c of this.compact) if (compact.includes(c)) return c;
    return null;
  }

  isClean(text) { return this.check(text) === null; }

  isBlockedUser(name) {
    const list = (this.getConfig().moderation.blockedUsers || []).map((s) => fold(s).replace(/^@/, ''));
    const n = fold(name || '').replace(/^@/, '');
    if (list.includes(n)) return true;
    return this.check(name) !== null; // tên người dùng chứa từ cấm cũng chặn
  }
}
