// Gemini: phân tích bình luận tố giác, chấm lời bào chữa. Có hàng đợi, giới hạn tốc độ, timeout, cache.
import { PERSONAS } from './personas.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

const REPORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isReport: { type: 'BOOLEAN', description: 'true nếu người viết muốn đưa ai đó (hoặc chính mình) vào trại' },
    safe: { type: 'BOOLEAN', description: 'false nếu nội dung dính chính trị, tôn giáo, tình dục, bạo lực thật, phân biệt, xúc phạm nặng, tự hại, ma tuý, quảng cáo' },
    targets: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Tên/username người bị tố, giữ nguyên cách viết, bỏ @. Tối đa 2.' },
    crime: { type: 'STRING', description: 'Tội danh đã VÔ HẠI HOÁ, hài hước, bắt đầu bằng "tội", tối đa 10 từ' },
    severity: { type: 'INTEGER', description: 'Mức độ "nặng" vui từ 1 đến 5' },
    line: { type: 'STRING', description: 'Câu tuyên án của quản giáo, tối đa 28 từ, có tên người bị tố, có {days} để hệ thống điền số ngày' },
    law: { type: 'STRING', description: 'Khoá thẻ pháp luật liên quan nhất' },
  },
  required: ['isReport', 'safe', 'targets', 'crime', 'severity', 'line', 'law'],
};

const DEFENSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    safe: { type: 'BOOLEAN' },
    score: { type: 'INTEGER', description: 'Độ thuyết phục/hài hước của lời bào chữa từ 0 đến 10' },
    line: { type: 'STRING', description: 'Câu phán quyết ngắn của quản giáo, tối đa 25 từ' },
  },
  required: ['safe', 'score', 'line'],
};

function systemPrompt(personaKey, lawKeys) {
  const p = PERSONAS[personaKey] || PERSONAS.judge;
  return [
    'Bạn là bộ não của game livestream TikTok "Phục Hồi Nhân Phẩm Online": khán giả bình luận để "tố giác" bạn bè vào trại ảo cho vui.',
    `Vai quản giáo hiện tại: ${p.name} — ${p.style}.`,
    'NHIỆM VỤ: đọc 1 bình luận tiếng Việt (có thể có tiếng lóng, teencode, không dấu) và trả về JSON đúng schema.',
    'QUY TẮC BẮT BUỘC:',
    '1. Đây là trò đùa giữa bạn bè. Tội danh phải VÔ HẠI và HÀI HƯỚC. Không lặp lại cáo buộc nghiêm trọng như thật; biến nó thành chuyện đời thường buồn cười (VD "nợ 500k chưa trả" → "tội chiếm dụng tiền trà sữa kéo dài").',
    '2. safe=false nếu dính: chính trị, nhà nước, lãnh đạo, lịch sử nhạy cảm, tôn giáo, tình dục, bạo lực thật, ma tuý, tự hại, phân biệt vùng miền/giới tính/ngoại hình/khuyết tật, chửi thề, quảng cáo, link. Khi safe=false thì isReport=false.',
    '3. Không bao giờ dùng từ "cải tạo", không nhắc tên người nổi tiếng hoặc chính trị gia.',
    '4. Không chê ngoại hình, cân nặng, giới tính, vùng miền.',
    '5. "line" dùng đúng giọng vai quản giáo, có tên người bị tố và chuỗi {days}. Không dùng emoji (sẽ được đọc thành tiếng).',
    '6. Nếu bình luận chỉ là chào hỏi/nói chuyện, không có ý tố ai: isReport=false.',
    '7. Nếu người viết tự tố mình ("tôi", "em", "mình"), targets=["__self__"].',
    `8. law phải là một trong: ${lawKeys.join(', ')}. Không chắc thì chọn co_so_trach_nhiem.`,
  ].join('\n');
}

export class AiService {
  constructor({ getConfig, log }) {
    this.getConfig = getConfig;
    this.log = log;
    this.queue = [];
    this.running = 0;
    this.calls = []; // mốc thời gian để giới hạn mỗi phút
    this.cache = new Map();
    this.stats = { ok: 0, fail: 0, skipped: 0, lastError: '', lastLatencyMs: 0 };
  }

  get available() {
    const c = this.getConfig().ai;
    return Boolean(c.enabled && c.apiKey);
  }

  _budgetOk() {
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < 60_000);
    return this.calls.length < (this.getConfig().ai.maxCallsPerMinute || 30);
  }

  async _generate({ system, user, schema, temperature }) {
    const c = this.getConfig().ai;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), c.timeoutMs || 5000);
    const t0 = Date.now();
    try {
      const res = await fetch(`${API}/models/${encodeURIComponent(c.model)}:generateContent`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': c.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature: temperature ?? c.temperature ?? 0.9,
            maxOutputTokens: 1024,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${body?.error?.message || res.statusText}`);
      const parts = body?.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
      this.stats.lastLatencyMs = Date.now() - t0;
      return parseJson(text);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Đưa việc vào hàng đợi (tối đa 2 lời gọi song song, hàng đợi tối đa 15 — bỏ việc cũ nhất). */
  _enqueue(task) {
    return new Promise((resolve) => {
      this.queue.push({ task, resolve });
      while (this.queue.length > 15) {
        const dropped = this.queue.shift();
        this.stats.skipped++;
        dropped.resolve(null);
      }
      this._pump();
    });
  }

  _pump() {
    while (this.running < 2 && this.queue.length) {
      const { task, resolve } = this.queue.shift();
      if (!this._budgetOk()) { this.stats.skipped++; resolve(null); continue; }
      this.calls.push(Date.now());
      this.running++;
      task()
        .then((r) => { this.stats.ok++; resolve(r); })
        .catch((e) => {
          this.stats.fail++;
          this.stats.lastError = e.name === 'AbortError' ? 'Timeout' : e.message;
          this.log?.warn('AI lỗi:', this.stats.lastError);
          resolve(null);
        })
        .finally(() => { this.running--; this._pump(); });
    }
  }

  /** Phân tích một bình luận. Trả null nếu AI không dùng được → engine dùng bộ dự phòng. */
  async analyzeReport({ text, author, persona, lawKeys }) {
    if (!this.available) return null;
    const key = `${persona}|${text}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const r = await this._enqueue(() => this._generate({
      system: systemPrompt(persona, lawKeys),
      user: `Người bình luận: "${author}"\nBình luận: "${text}"`,
      schema: REPORT_SCHEMA,
    }));
    if (r) {
      this.cache.set(key, r);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
    }
    return r;
  }

  async judgeDefense({ lawyer, target, crime, reason, persona }) {
    if (!this.available) return null;
    const p = PERSONAS[persona] || PERSONAS.judge;
    return this._enqueue(() => this._generate({
      system: `Bạn là ${p.name} (${p.style}) trong game livestream vui "Phục Hồi Nhân Phẩm Online". Chấm điểm lời bào chữa vui cho bạn bè. Lời càng hài hước, sáng tạo, tử tế thì điểm càng cao. safe=false nếu dính chính trị, tôn giáo, tình dục, bạo lực, chửi thề, phân biệt. Không dùng emoji, không dùng từ "cải tạo".`,
      user: `Luật sư: ${lawyer}\nThân chủ: ${target} (đang chịu ${crime})\nLời bào chữa: "${reason}"`,
      schema: DEFENSE_SCHEMA,
      temperature: 0.8,
    }));
  }

  /** Lấy danh sách model mà key hiện tại dùng được (cho trang Admin). */
  async listModels() {
    const c = this.getConfig().ai;
    if (!c.apiKey) throw new Error('Chưa có Gemini API key');
    const out = [];
    let pageToken = '';
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${API}/models?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: { 'x-goog-api-key': c.apiKey } });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || res.statusText);
      for (const m of body.models || []) {
        out.push({ id: m.name.replace(/^models\//, ''), label: m.displayName, methods: m.supportedGenerationMethods || [] });
      }
      if (!body.nextPageToken) break;
      pageToken = body.nextPageToken;
    }
    return out.filter((m) => m.methods.includes('generateContent'));
  }
}

export function parseJson(text) {
  if (!text) throw new Error('AI trả về rỗng');
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('AI trả về không phải JSON');
  }
}
