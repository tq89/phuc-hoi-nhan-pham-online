// Cấu hình: mặc định + file data/config.json (chỉnh được qua trang Admin khi đang Live).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deepMerge } from './util.js';

// Quy tắc so khớp (xem moderation.js):
//  - Mục KHÔNG dấu  → so trên văn bản đã bỏ dấu, theo nguyên từ (VD "cong san").
//  - Mục CÓ dấu     → so trên văn bản giữ dấu (dùng cho từ dễ trùng khi bỏ dấu:
//    "lồn" ≠ "lớn", "tự tử" ≠ "từ từ", "bạo động" ≠ "báo động", "biển đông" ≠ "biến động").
export const DEFAULT_BLACKLIST = [
  // Chính trị / nhà nước / lịch sử nhạy cảm
  'chinh tri', 'chinh quyen', 'dang cong san', 'cong san', 'phan dong', 'bieu tinh', 'bạo động', 'lật đổ',
  'trại cải tạo', 'trai cai tao', 'chu tich nuoc', 'tong bi thu', 'thu tuong', 'quoc hoi', 'bo chinh tri', 'viet tan',
  'hoang sa', 'truong sa', 'biển đông', 'chien tranh', 'khung bo', 'ho chi minh', 'bác hồ', 'dan chu', 'nhan quyen',
  // Tôn giáo
  'ton giao', 'phat giao', 'thien chua', 'hoi giao', 'đạo phật', 'chua giesu', 'jesus', 'allah', 'nhà thờ', 'nhà chùa',
  // Tình dục / khiêu dâm
  'sex', 'địt', 'dit nhau', 'djt', 'loz', 'lồn', 'buồi', 'cặc', 'hiep dam', 'khieu dam', 'porn', 'nude', 'thu dam', 'gai goi', 'mai dam',
  // Bạo lực thực / tự hại / ma tuý
  'giết', 'tự tử', 'tự sát', 'cắt cổ', 'đâm chết', 'súng', 'đánh bom', 'ma tuy', 'thuoc lac', 'kẹo ke', 'heroin', 'can sa',
  // Phân biệt, xúc phạm nặng
  'moi rot', 'bede', 'pede', 'đồng tính', 'khuyết tật', 'thieu nang', 'óc chó', 'do ngu', 'con đĩ', 'thằng chó', 'dm', 'dcm', 'vcl', 'clm', 'dmm', 'vkl',
  // Lừa đảo / quảng cáo
  'http', 'www.', '.com', 'zalo', 'telegram', 'tai xiu', 'nha cai', 'ca do', 'kiem tien online',
];

export const DEFAULT_CONFIG = {
  server: { port: 3000, host: '0.0.0.0' },
  admin: { token: '' },
  tiktok: { username: '', signApiKey: '', autoConnect: true, enableExtendedGiftInfo: true },
  ai: {
    enabled: true,
    apiKey: '',
    model: 'gemini-3.5-flash-lite',
    timeoutMs: 5000,
    maxCallsPerMinute: 30,
    temperature: 0.95,
  },
  tts: {
    provider: 'browser', // browser | gemini | off
    geminiModel: 'gemini-3.1-flash-tts-preview',
    voice: 'Puck',
    browserRate: 1.08,
    volume: 1,
  },
  persona: 'rotate', // judge | gangster | romance | rotate
  game: {
    title: 'PHỤC HỒI NHÂN PHẨM ONLINE',
    subtitle: 'Trại Giáo Dưỡng Lầy Lội · Đang tiếp nhận hồ sơ 24/7',
    minSentence: 50,
    maxSentence: 500,
    maxStack: 999,
    decayDaysPerSec: 1,
    cellCount: 6,
    perCell: 4,
    maxQueue: 40,
    recidivismMultiplier: 1.5,
    likeDays: 1,
    stormThreshold: 300,
    stormDays: 20,
    followDays: 30,
    shareDays: 50,
    selfConfessFactor: 0.5,
    defenseMaxDays: 80,
    reportCooldownSec: 15,
    defenseCooldownSec: 30,
    npcEnabled: true,
    npcIdleSec: 40,
    rollCallMin: 6,
    laborEventMin: 12,
    laborEventSec: 60,
    laborGoalLikes: 500,
    laborRewardDays: 60,
    showSafeZone: false,
  },
  gifts: {
    // Bậc thang theo tổng xu (diamondCount × repeatCount). Đọc từ trên xuống, bậc lớn nhất thoả mãn sẽ áp dụng.
    tiers: [
      { minCoins: 1, days: 20, label: 'Thăm nuôi nhẹ' },
      { minCoins: 5, days: 60, label: 'Gói mì tôm' },
      { minCoins: 10, days: 100, label: 'Hộp cơm' },
      { minCoins: 30, days: 150, label: 'Giỏ trái cây' },
      { minCoins: 99, action: 'pardon_one', label: 'Lệnh Đặc Xá' },
      { minCoins: 299, action: 'pardon_all', label: 'Đại Xá Toàn Trại' },
    ],
    // Ghi đè theo giftId TikTok: { "5655": { "days": 20, "label": "Hoa hồng" } } hoặc { "action": "pardon_all" }
    overrides: {},
  },
  moderation: {
    blacklist: DEFAULT_BLACKLIST,
    blockedUsers: [],
  },
};

const SECRET_FIELDS = [['ai', 'apiKey'], ['tiktok', 'signApiKey'], ['admin', 'token']];
export const MASK = '••••••••';

export class ConfigStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'config.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = structuredClone(DEFAULT_CONFIG);
    if (fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        // Mảng (tiers, blacklist) được thay thế nguyên khối bởi deepMerge
        deepMerge(this.data, saved);
      } catch (e) {
        console.error('Không đọc được config.json, dùng mặc định:', e.message);
      }
    }
    // Biến môi trường ưu tiên cao nhất
    const env = process.env;
    if (env.PORT) this.data.server.port = Number(env.PORT);
    if (env.ADMIN_TOKEN) this.data.admin.token = env.ADMIN_TOKEN;
    if (env.GEMINI_API_KEY) this.data.ai.apiKey = env.GEMINI_API_KEY;
    if (env.GEMINI_MODEL) this.data.ai.model = env.GEMINI_MODEL;
    if (env.TIKTOK_USERNAME) this.data.tiktok.username = env.TIKTOK_USERNAME;
    if (env.EULER_API_KEY) this.data.tiktok.signApiKey = env.EULER_API_KEY;
    if (!this.data.admin.token) {
      this.data.admin.token = crypto.randomBytes(9).toString('base64url');
      this.generatedToken = true;
    }
    this.save();
  }

  get() { return this.data; }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  /** Bản cấu hình gửi lên Admin: che khoá bí mật. */
  publicView() {
    const c = structuredClone(this.data);
    for (const [a, b] of SECRET_FIELDS) c[a][b] = c[a][b] ? MASK : '';
    return c;
  }

  /** Cập nhật từng phần. Trường bí mật giữ nguyên nếu gửi lên chuỗi mặt nạ. */
  update(patch) {
    const p = structuredClone(patch || {});
    for (const [a, b] of SECRET_FIELDS) {
      if (p[a] && (p[a][b] === MASK || p[a][b] === undefined)) delete p[a][b];
    }
    if (p.server) delete p.server; // cổng/host chỉ đổi qua env hoặc file
    if (p.gifts?.overrides) this.data.gifts.overrides = {}; // ghi đè thay thế nguyên khối (để xoá được)
    deepMerge(this.data, p);
    sanitize(this.data);
    this.save();
    return this.data;
  }
}

function sanitize(c) {
  const g = c.game;
  g.minSentence = Math.max(1, Number(g.minSentence) || 50);
  g.maxSentence = Math.max(g.minSentence, Number(g.maxSentence) || 500);
  g.cellCount = Math.min(6, Math.max(1, Number(g.cellCount) || 6));
  g.perCell = Math.min(4, Math.max(1, Number(g.perCell) || 4));
  c.gifts.tiers = (c.gifts.tiers || [])
    .map((t) => ({ ...t, minCoins: Math.max(1, Number(t.minCoins) || 1), days: t.days != null ? Number(t.days) : undefined }))
    .sort((a, b) => a.minCoins - b.minCoins);
  c.moderation.blacklist = (c.moderation.blacklist || []).map((s) => String(s).trim()).filter(Boolean);
}
