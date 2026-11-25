// Phân tích bình luận KHÔNG dùng AI: lệnh nhanh + bộ đoán tố giác dự phòng.
import { fold, pick, cleanText } from './util.js';
import { FUNNY_CRIMES, GENERIC_CRIMES } from './personas.js';

const MENTION_RE = /@([\p{L}\p{N}._]{2,30})/gu;

// Động từ "tố giác" (đã bỏ dấu). Thứ tự quan trọng: cụm dài trước.
const REPORT_VERBS = [
  'to cao', 'to giac', 'bat giam', 'bat nhot', 'dua vao trai', 'cho vao trai', 'tong giam', 'tong vao', 'bat',
  'be', 'nhot', 'tong', 'xich', 'cong tay', 'hot', 'giam', 'luom', 'khieng', 'quang', 'nem', 'keo', 'dat',
];
// Dấu hiệu bắt đầu tội danh. Văn bản có dấu dùng bản có dấu (tránh "tôi" ≠ "tội"),
// văn bản gõ không dấu dùng bản không dấu.
const CRIME_MARKERS_VI = ['vì cái tội', 'vì tội', 'tội danh', 'phạm tội', 'chỉ vì', 'bởi vì', 'tội', 'vì', 'bởi', 'do'];
const CRIME_MARKERS_ASCII = ['vi cai toi', 'vi toi', 'toi danh', 'pham toi', 'chi vi', 'boi vi', 'toi', 'vi', 'boi', 'do'];
const B = '(?<![\\p{L}\\p{N}])';

export function extractMentions(text) {
  return [...String(text).matchAll(MENTION_RE)].map((m) => m[1]);
}

/** Lệnh nhanh, không tốn AI. */
export function parseCommand(text) {
  const raw = String(text).trim();
  const f = fold(raw).replace(/^[!/.]+/, '').trim();
  if (/^(mien to|mientro|mien toi|opt ?out|khong choi)\b/.test(f)) return { cmd: 'optout' };
  if (/^(choi lai|opt ?in|cho phep to)\b/.test(f)) return { cmd: 'optin' };
  if (/^(tu thu|tu nhan toi|toi tu thu|em tu thu)\b/.test(f)) {
    return { cmd: 'confess', crime: crimeAfterMarker(raw) };
  }
  if (/^(bao chua|ba?o ve|luat su|khang cao|xin tha)\b/.test(f)) {
    const targets = extractMentions(raw);
    const reason = cleanText(raw.replace(MENTION_RE, ' ').replace(/^[!/.]*\s*\S+\s+\S+/u, ''), 160);
    return { cmd: 'defense', targets, reason };
  }
  if (/^(tham|tham nuoi|ung ho)\b/.test(f) && extractMentions(raw).length) {
    return { cmd: 'visit', targets: extractMentions(raw) };
  }
  if (/^(an|an cua toi|xem an|my ?an)\s*$/.test(f)) return { cmd: 'status' };
  return null;
}

function crimeAfterMarker(raw) {
  const text = String(raw).normalize('NFC').replace(MENTION_RE, ' ');
  const lower = text.toLowerCase();
  const isAscii = /^[\x00-\x7f]*$/.test(lower);
  const markers = isAscii ? CRIME_MARKERS_ASCII : CRIME_MARKERS_VI;
  let best = -1;
  let bestLen = 0;
  for (const m of markers) {
    const re = new RegExp(`${B}${m}\\s+`, 'u');
    const hit = re.exec(lower);
    if (hit && (best === -1 || hit.index < best)) { best = hit.index; bestLen = hit[0].length; }
  }
  if (best === -1) return '';
  return cleanText(text.slice(best + bestLen).trim(), 60);
}

/**
 * Đoán tố giác bằng luật đơn giản (dự phòng khi AI không dùng được).
 * Trả về { isReport, targets[], crimeRaw, severity }.
 */
export function heuristicReport(text) {
  const raw = String(text);
  const f = fold(raw);
  const mentions = extractMentions(raw);
  const hasVerb = REPORT_VERBS.some((v) => new RegExp(`(?:^|\\s)${v}(?:\\s|$)`).test(f));
  let targets = mentions;
  if (!targets.length && hasVerb) {
    // "bế thằng Nam vì tội ..." → lấy từ sau động từ + (thang|con|em|anh|chi|ban)?
    const m = f.match(/(?:^|\s)(?:be|bat|nhot|tong|xich|hot|luom|to cao|to giac)\s+(?:thang|con|em|anh|chi|ban|nhoc|be|lao|ong|ba|co)?\s*([a-z0-9._]{2,20})/);
    if (m) {
      // khôi phục từ gốc có dấu theo vị trí từ
      const fw = f.split(/\s+/);
      const rw = raw.trim().split(/\s+/);
      const idx = fw.indexOf(m[1]);
      targets = [idx >= 0 && rw[idx] ? rw[idx] : m[1]];
    }
  }
  const crimeRaw = crimeAfterMarker(raw);
  // Có @tag → coi là tố giác. Không có tag → phải có cả động từ lẫn tội danh (tránh "bé Nam dễ thương").
  const isReport = mentions.length > 0 || (targets.length > 0 && hasVerb && crimeRaw.length > 0);
  let severity = 2;
  if (/(nhieu|qua|lam|vcl|cuc|sieu|nang|500|trieu|\d{3,})/.test(f)) severity = 3;
  if (/(nhat|hoai|lien tuc|tai pham|ca nam|moi ngay)/.test(f)) severity = 4;
  return { isReport, targets: targets.slice(0, 2), crimeRaw, severity };
}

/** Biến tội danh thật thành tội vô hại, hài hước (không đọc nguyên văn cáo buộc). */
export function funnyCrime(crimeRaw = '') {
  const f = fold(crimeRaw);
  if (f) {
    for (const g of FUNNY_CRIMES) {
      if (g.k.some((k) => new RegExp(`(?:^|\\s)${k}(?:\\s|$)`).test(f))) return pick(g.c);
    }
  }
  return pick(GENERIC_CRIMES);
}

/** Chọn thẻ pháp luật theo từ khoá. */
export function pickLegal(cards, crimeText = '', preferKey) {
  if (preferKey) {
    const c = cards.find((x) => x.key === preferKey);
    if (c) return c;
  }
  const f = fold(crimeText);
  let best = null;
  let bestLen = 0;
  for (const c of cards) {
    for (const k of c.keywords || []) {
      if (k && new RegExp(`(?:^|\\s)${k}(?:\\s|$)`).test(f) && k.length > bestLen) { best = c; bestLen = k.length; }
    }
  }
  return best || pick(cards);
}
