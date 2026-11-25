# ⛓️ PHỤC HỒI NHÂN PHẨM ONLINE

Web game tương tác thời gian thực cho **TikTok LIVE (khung 9:16)**. Khán giả bình luận để "tố giác" bạn bè vào trại ảo, sau đó thả tim, tặng quà, follow, share hoặc bào chữa để giảm án. Mỗi bản án kèm một thẻ **Góc Pháp Luật Thật** (Bộ luật Hình sự 2015 sửa đổi 2017, Bộ luật Dân sự 2015).

```
TikTok LIVE ─► Connector (Node.js) ─► Game Engine (server giữ trạng thái) ─► WebSocket ─► Overlay 9:16 (trình duyệt/OBS)
                     ▲                    ├─ Gemini AI (hàng đợi, timeout, cache, lùi về bộ dự phòng)
               Simulator                  ├─ Bộ lọc 3 lớp + Blacklist
                                          └─ data/db.json (tiền án, BXH mọi thời đại, quà đã học)
```

## 1. Chạy nhanh

Yêu cầu Node.js ≥ 20.

```bash
npm install
npm run sim     # chạy với khán giả giả lập để xem thử
# hoặc
npm start       # chạy thật
```

- Overlay 9:16: `http://localhost:3000/`
- Trang quản trị: `http://localhost:3000/admin`. Mã quản trị in ra console khi khởi động, đổi được trong `data/config.json` (`admin.token`) hoặc qua biến `ADMIN_TOKEN`.

Vào trang Admin, nhập **username TikTok**, **Gemini API key** rồi bấm **Lưu**, sau đó bấm **Kết nối**.
- Nên có thêm **Euler Stream Sign API key** (tạo miễn phí tại eulerstream.com). Không có key thì thư viện vẫn chạy được nhưng bị giới hạn lượt.
- Bấm **Tải model** để lấy danh sách model Gemini mà key của bạn dùng được. Mặc định là `gemini-3.5-flash-lite`: rẻ, nhanh. Bấm **Thử AI** để kiểm tra.

## 2. Chạy 24/7 trên Radxa Rock 5T (Armbian) bằng Docker

```bash
cp .env.example .env   # điền ADMIN_TOKEN, GEMINI_API_KEY, TIKTOK_USERNAME...
docker compose up -d --build
docker compose logs -f
```

- Image `node:22-bookworm-slim` hỗ trợ ARM64. Dữ liệu nằm trong volume `phnp-data`.
- Khi bật "Tự kết nối", server tự chờ: kênh chưa live thì thử lại theo chu kỳ 30 giây đến 5 phút, live kết thúc thì tự chờ phiên sau.

## 3. Đưa lên sóng

**Cách khuyến nghị: OBS Studio, nguồn Browser Source**
1. Thêm nguồn *Browser*, URL `http://<IP-máy-chạy-server>:3000/?autostart`, kích thước **1080 × 1920**.
2. Tích *Control audio via OBS* để tiếng nhạc nền, hiệu ứng và giọng đọc đi vào luồng phát.
3. Giọng đọc trong OBS: trình duyệt nhúng của OBS có thể **không có giọng tiếng Việt**. Hãy chọn **Gemini TTS** trong Admin, âm thanh được phát qua Web Audio nên chạy được trong OBS.

**Cách khác: TikTok Live Studio hoặc chụp cửa sổ**
- Mở `http://localhost:3000/` bằng Chrome, bấm "Bật âm thanh", dùng *Window Capture* và trộn *Desktop Audio*.
- Chrome trên Windows/macOS thường có sẵn giọng tiếng Việt cho chế độ "Trình duyệt" (miễn phí).

**Căn bố cục:** bật "Hiện vùng UI TikTok" trong Admin để thấy các vùng bị tên kênh, bình luận và nút quà của TikTok che, căn xong thì tắt.

## 4. Luật chơi (chỉnh được hết trong Admin khi đang live)

| Khán giả làm | Hệ thống xử lý |
|---|---|
| `bế @tên vì tội …` (cú pháp tự do, có tiếng lóng, gõ không dấu cũng hiểu) | AI trích xuất người bị tố, **vô hại hoá** tội danh, tuyên 50–500 ngày, đọc câu châm biếm, hiện thẻ pháp luật |
| Tố lại người đang trong trại | Cộng dồn án |
| Người từng bị tố ở phiên trước | **Tái phạm**: án ×1.5 |
| `tự thú tội …` | Vào trại với án nhẹ hơn (×0.5) |
| `bào chữa @tên + lý do` | AI chấm lời bào chữa 0–10 điểm, giảm tối đa 80 ngày |
| Thả tim | −1 ngày/tim. Đủ 300 tim thì **Bão Tim**: cả trại đập đá, mỗi người −20 ngày |
| Tặng quà | Bậc thang: 1 xu −20, 5 xu −60, 10 xu −100, 30 xu −150, **99 xu đặc xá**, **299 xu đại xá toàn trại**. Lên Top "Vua Thăm Nuôi" |
| Follow / Share | Bảo lãnh −30 ngày / Kêu oan −50 ngày |
| `miễn tố` | Tự ra trại và không ai bế được nữa (gõ `chơi lại` để tham gia lại) |
| Người bị tag vào live và bình luận | Hiện avatar thật, gắn nhãn "CÓ MẶT", hiện bóng thoại |

Quà, tim, follow và share được tính cho: chính người đó nếu đang bị giam → người họ vừa tố hoặc bào chữa (hoặc gõ `thăm @tên`) → người đang án nặng nhất.

**Sự kiện tự động:**
- Án tự giảm theo thời gian, mặc định 1 ngày/giây.
- **Điểm danh** mỗi 6 phút.
- **Lao động tập thể** mỗi 12 phút: đủ 500 tim trong 60 giây thì cả trại −60 ngày.
- 3 quản giáo (Quan toà, Giang hồ mạng, Ngôn tình) **luân phiên** 10 phút một lần.
- Trại vắng thì có **NPC** giữ phòng.
- Trại đầy (24 người) thì vào **hàng chờ**.

**Quà thật trên TikTok:** tên và ID quà khác nhau theo khu vực. Hệ thống tự ghi lại mọi quà đã gặp ("chế độ học") trong mục *Quy đổi quà tặng* để bạn gán riêng số ngày hoặc đặc xá cho từng quà.

## 5. An toàn nội dung

1. **Lớp 1: blacklist** chặn bình luận trước khi gửi AI. Mục không dấu so trên chữ đã bỏ dấu. Mục có dấu so chính xác, tránh nhầm như "lớn"/"lồn", "từ từ"/"tự tử", "báo động"/"bạo động".
2. **Lớp 2: AI** tự đánh giá `safe` và luôn biến cáo buộc thật thành tội đời thường buồn cười.
3. **Lớp 3:** câu thoại AI và câu TTS được lọc lại trước khi lên sóng. Username chứa từ cấm cũng bị chặn.

Khi AI tắt, lỗi hoặc hết quota, bộ phân tích dự phòng vẫn chạy và **không bao giờ đọc nguyên văn cáo buộc**.

> ⚠️ Kho thẻ pháp luật ở `server/data/legal.json` được soạn tay theo khoản 1 của từng điều. Hãy rà soát lại khi luật có sửa đổi mới. Nên ghi rõ trên kênh rằng đây là trò chơi giải trí.

## 6. Lưu ý vận hành

- TikTok yêu cầu **từ 18 tuổi** mới được mua xu và tặng quà. Phần chơi miễn phí (bình luận, tim) dành cho mọi người.
- Hướng dẫn kiếm tiền trên LIVE của TikTok có thể hạn chế live chạy hoàn toàn tự động, không có người. Nên có người dẫn xen kẽ theo khung giờ.
- `tiktok-live-connector` là thư viện **không chính thức**, được ghim bản 2.5.0. Mọi xử lý sự kiện nằm gọn trong `server/connector.js` để dễ thay khi TikTok thay đổi.

## 7. Phát triển

```bash
npm test     # 22 test: bộ lọc, phân tích, engine, adapter TikTok
npm run dev  # tự khởi động lại khi sửa code
```

| Thư mục/tệp | Vai trò |
|---|---|
| `server/engine.js` | Luật chơi, trạng thái trại |
| `server/ai.js` | Gemini: phân tích bình luận, chấm lời bào chữa |
| `server/tts.js` | Giọng đọc (trình duyệt hoặc Gemini TTS) |
| `server/connector.js` | Adapter TikTok LIVE |
| `server/moderation.js` | Bộ lọc nội dung |
| `server/personas.js` | 3 quản giáo, câu mẫu, tội danh vô hại, NPC |
| `server/data/legal.json` | Thẻ Góc Pháp Luật |
| `public/` | Overlay (`index.html`, `overlay.js`, `audio.js`, `chibi.js`) và Admin |

Âm thanh được tổng hợp hoàn toàn bằng Web Audio API, chibi vẽ bằng SVG. Dự án không dùng tài nguyên có bản quyền.
