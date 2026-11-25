// Adapter TikTok LIVE (thư viện không chính thức tiktok-live-connector).
// Mọi sự kiện được chuẩn hoá về dạng chung → đổi thư viện chỉ cần sửa file này.

const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

export function normUser(d = {}) {
  const u = d.user || d.userDetails || {};
  const uniqueId = first(u.uniqueId, u.displayId, d.uniqueId, u.username, '');
  const name = first(u.nickname, d.nickname, uniqueId, 'Ẩn danh');
  const avatar = first(
    u.profilePicture?.url?.[0], u.profilePicture?.urls?.[0], u.profilePicture?.urlList?.[0],
    u.avatarThumb?.urlList?.[0], u.avatarThumb?.url?.[0], u.avatarMedium?.urlList?.[0],
    d.profilePictureUrl, d.userDetails?.profilePictureUrls?.[0], '',
  );
  return { uniqueId: String(uniqueId), name: String(name), avatar: String(avatar) };
}

export function normGift(d = {}) {
  const det = d.giftDetails || d.gift || {};
  const ext = d.extendedGiftInfo || {};
  const giftType = Number(first(det.giftType, det.type, d.giftType, ext.type, 0));
  const repeatCount = Math.max(1, Number(first(d.repeatCount, d.comboCount, 1)));
  const repeatEnd = Boolean(d.repeatEnd);
  const diamond = Number(first(det.diamondCount, d.diamondCount, ext.diamond_count, ext.diamondCount, 0));
  return {
    giftId: String(first(d.giftId, det.id, ext.id, '')),
    giftName: String(first(det.giftName, det.name, ext.name, d.giftName, 'Quà')),
    image: first(det.giftImage?.giftPictureUrl, det.image?.urlList?.[0], det.icon?.urlList?.[0], ext.image?.url_list?.[0], ''),
    giftType,
    repeatCount,
    repeatEnd,
    coins: diamond * repeatCount,
    // Quà dạng "chuỗi" (giftType 1): chỉ xử lý khi chuỗi kết thúc để không đếm trùng
    final: giftType !== 1 || repeatEnd,
  };
}

export class TikTokConnector {
  constructor({ getConfig, engine, log }) {
    this.getConfig = getConfig;
    this.engine = engine;
    this.log = log;
    this.conn = null;
    this.wanted = false;
    this.retryMs = 30_000;
    this.timer = null;
  }

  async start() {
    const c = this.getConfig().tiktok;
    if (!c.username) { this.engine.setConnection('offline', 'Chưa nhập username TikTok'); return; }
    this.wanted = true;
    clearTimeout(this.timer);
    await this._connect();
  }

  stop() {
    this.wanted = false;
    clearTimeout(this.timer);
    try { this.conn?.disconnect(); } catch { /* bỏ qua */ }
    this.conn = null;
    this.engine.setConnection('offline', 'Đã ngắt');
  }

  _schedule(reason) {
    if (!this.wanted) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 5 * 60_000);
    this.engine.setConnection('waiting', `${reason} — thử lại sau ${Math.round(wait / 1000)}s`);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._connect(), wait);
  }

  async _connect() {
    const c = this.getConfig().tiktok;
    let lib;
    try {
      lib = await import('tiktok-live-connector');
    } catch (e) {
      this.engine.setConnection('error', `Không tải được thư viện: ${e.message}`);
      return;
    }
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
    const E = WebcastEvent || {};
    const C = ControlEvent || {};
    try { this.conn?.disconnect(); } catch { /* bỏ qua */ }
    const opts = { enableExtendedGiftInfo: c.enableExtendedGiftInfo !== false };
    if (c.signApiKey) opts.signApiKey = c.signApiKey;
    const conn = new TikTokLiveConnection(c.username, opts);
    this.conn = conn;
    this.engine.setConnection('connecting', `@${c.username}`);

    conn.on(E.CHAT || 'chat', (d) => {
      this.engine.handleChat({ user: normUser(d), text: String(d.comment ?? d.content ?? '') }).catch((e) => this.log.warn('chat', e));
    });
    conn.on(E.GIFT || 'gift', (d) => {
      const g = normGift(d);
      if (!g.final) return;
      this.engine.handleGift({ user: normUser(d), ...g });
    });
    conn.on(E.LIKE || 'like', (d) => this.engine.handleLike({ user: normUser(d), count: Number(first(d.likeCount, d.count, 1)) }));
    conn.on(E.FOLLOW || 'follow', (d) => this.engine.handleSocial({ user: normUser(d), kind: 'follow' }));
    conn.on(E.SHARE || 'share', (d) => this.engine.handleSocial({ user: normUser(d), kind: 'share' }));
    conn.on(E.ROOM_USER || 'roomUser', (d) => this.engine.setViewers(first(d.viewerCount, d.total, 0)));
    conn.on(E.STREAM_END || 'streamEnd', () => { this.engine.setConnection('waiting', 'Live đã kết thúc'); this._schedule('Live kết thúc'); });
    conn.on(C.DISCONNECTED || 'disconnected', ({ code, reason } = {}) => {
      if (this.conn !== conn) return;
      this._schedule(`Mất kết nối ${code ?? ''} ${reason ?? ''}`.trim());
    });
    conn.on(C.ERROR || 'error', ({ info, exception } = {}) => this.log.warn('TikTok error:', info || '', exception?.message || ''));

    try {
      const state = await conn.connect();
      this.retryMs = 30_000;
      this.engine.setConnection('live', `@${c.username} · room ${state?.roomId ?? ''}`);
      this.log.info('Đã kết nối TikTok LIVE', c.username);
    } catch (e) {
      const msg = e?.constructor?.name === 'UserOfflineError' || /offline|not live/i.test(e?.message || '') ? 'Kênh chưa phát Live' : e?.message || String(e);
      this.log.warn('Kết nối TikTok thất bại:', msg);
      this._schedule(msg);
    }
  }
}
