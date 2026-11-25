// Giọng đọc: "browser" → gửi chữ cho overlay đọc bằng Web Speech (miễn phí);
// "gemini" → server tổng hợp âm thanh PCM bằng Gemini TTS rồi gửi xuống overlay; lỗi thì tự lùi về "browser".
import { PERSONAS } from './personas.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export class TtsService {
  constructor({ getConfig, broadcast, log }) {
    this.getConfig = getConfig;
    this.broadcast = broadcast;
    this.log = log;
    this.inflight = 0;
    this.stats = { ok: 0, fail: 0, lastError: '' };
  }

  /** priority: 3 = quà lớn/đại xá, 2 = tuyên án/quà, 1 = thông báo thường */
  async speak(text, { persona = 'judge', priority = 1 } = {}) {
    const c = this.getConfig();
    const t = String(text || '').replace(/[\p{Extended_Pictographic}️]/gu, '').trim();
    if (!t || c.tts.provider === 'off') return;
    const base = { type: 'fx', fx: 'say', text: t, persona, priority, at: Date.now() };
    if (c.tts.provider === 'gemini' && c.ai.apiKey && this.inflight < 3) {
      this.inflight++;
      try {
        const audio = await this._gemini(t, persona);
        this.stats.ok++;
        this.broadcast({ ...base, audio });
        return;
      } catch (e) {
        this.stats.fail++;
        this.stats.lastError = e.message;
        this.log?.warn('TTS Gemini lỗi, dùng giọng trình duyệt:', e.message);
      } finally {
        this.inflight--;
      }
    }
    this.broadcast(base);
  }

  async _gemini(text, persona) {
    const c = this.getConfig();
    const style = PERSONAS[persona]?.ttsStyle || 'Đọc tự nhiên, vui vẻ';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${API}/models/${encodeURIComponent(c.tts.geminiModel)}:generateContent`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': c.ai.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${style} (tiếng Việt): ${text}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.tts.voice || 'Puck' } } },
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status}: ${body?.error?.message || res.statusText}`);
      const part = (body?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
      if (!part) throw new Error('Không có dữ liệu âm thanh');
      const mime = part.inlineData.mimeType || '';
      const rate = Number((mime.match(/rate=(\d+)/) || [])[1]) || 24000;
      return { pcm16: part.inlineData.data, sampleRate: rate };
    } finally {
      clearTimeout(timer);
    }
  }
}
