// Tiện ích dùng chung: chuẩn hoá tiếng Việt, số ngẫu nhiên, băm màu...

/** Bỏ dấu tiếng Việt + về chữ thường để so khớp từ khoá. */
export function fold(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Khoá định danh người chơi: bỏ @, bỏ dấu, chỉ giữ chữ-số-._ */
export function userKey(name = '') {
  return fold(String(name).replace(/^@+/, '')).replace(/[^a-z0-9._]/g, '');
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function hashHue(str = '') {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}

/** Cắt chuỗi hiển thị, loại ký tự điều khiển. */
export function cleanText(text = '', max = 80) {
  const t = String(text).replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Điền biến {name} vào mẫu câu. */
export function fill(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

export function deepMerge(target, src) {
  if (!src || typeof src !== 'object') return target;
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

export function makeLogger(sink) {
  const fmt = (lvl, args) => `[${new Date().toISOString().slice(11, 19)}] ${lvl} ${args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}`;
  return {
    info: (...a) => { const l = fmt('INFO', a); console.log(l); sink?.(l); },
    warn: (...a) => { const l = fmt('WARN', a); console.warn(l); sink?.(l); },
    error: (...a) => { const l = fmt('ERR ', a); console.error(l); sink?.(l); },
  };
}
