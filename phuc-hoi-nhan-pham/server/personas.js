// 3 sắc thái quản giáo + mẫu câu dự phòng (dùng khi AI tắt/chậm, và cho các sự kiện không cần AI).
import { pick, fill } from './util.js';

export const PERSONAS = {
  judge: {
    name: 'Quan Toà Nghiêm Khắc',
    short: 'QUAN TOÀ',
    icon: '⚖️',
    style: 'quan toà nghiêm khắc, giọng trang trọng kiểu toà án nhưng nội dung hài hước, hay dùng "Xét thấy", "Tuyên", "Bị cáo"',
    ttsStyle: 'Đọc bằng giọng quan toà nghiêm nghị, chậm rãi, trang trọng',
    lines: {
      verdict: [
        'Xét thấy bị cáo {name} phạm {crime}, toà tuyên phạt {days} ngày phục hồi nhân phẩm!',
        'Bị cáo {name}! Với {crime}, toà tuyên {days} ngày. Đập đá cho tỉnh người ra!',
        'Hồ sơ đã rõ: {name}, {crime}. Mức án {days} ngày, không được kháng cáo… trừ khi có người thăm nuôi.',
      ],
      recidivist: ['Lại là {name}! Tái phạm {crime}, án nhân rưỡi: {days} ngày!', 'Toà đã quá quen mặt {name}. Tái phạm, {days} ngày!'],
      stack: ['{name} bị tố thêm {crime}. Cộng dồn, tổng án {days} ngày!'],
      release: ['Phạm nhân {name} đã mãn hạn. Toà mong bị cáo sống tử tế!', '{name} ra trại. Nhân phẩm đã được phục hồi một trăm phần trăm!'],
      giftSmall: ['Cảm ơn {giver} đã thăm nuôi {name}. Giảm {days} ngày án!', 'Toà ghi nhận tấm lòng của {giver}. {name} được giảm {days} ngày.'],
      giftSelf: ['Bị cáo {name} tự nộp phạt bằng {gift}. Giảm {days} ngày!'],
      giftNoTarget: ['Cảm ơn {giver} đã ủng hộ quỹ thăm nuôi của trại!'],
      pardonOne: ['Lệnh đặc xá từ {giver}! Bị cáo {name} được trả tự do ngay lập tức!'],
      pardonAll: ['ĐẠI XÁ! Nhờ ân điển của {giver}, toàn trại được trả tự do!'],
      storm: ['Bão tim! Toàn trại đập đá tập thể, mỗi người giảm {days} ngày!'],
      presence: ['Bị cáo {name} đã có mặt tại phiên toà. Mời khai báo thành khẩn!'],
      defenseWin: ['Lời bào chữa của {giver} thuyết phục. {name} được giảm {days} ngày!'],
      defenseLose: ['Lời bào chữa của {giver} không thuyết phục. Toà giữ nguyên bản án!'],
      confess: ['{name} tự thú {crime}. Thành khẩn khai báo, toà giảm nhẹ còn {days} ngày.'],
      optout: ['{name} đã xuất trình giấy miễn tố. Toà trả tự do!'],
      follow: ['{giver} đã bảo lãnh cho {name}. Giảm {days} ngày!'],
      share: ['{giver} kêu oan giúp {name}. Giảm {days} ngày!'],
      rollCall: ['Điểm danh! Trại hiện có {count} phạm nhân. Người án nặng nhất: {name}, còn {days} ngày.'],
      laborStart: ['Thông báo lao động tập thể! Đạt {goal} tim trong {sec} giây, cả trại được giảm {days} ngày!'],
      laborWin: ['Lao động xuất sắc! Toàn trại được giảm {days} ngày án!'],
      laborLose: ['Chỉ tiêu chưa đạt. Toà rất thất vọng, lần sau cố gắng hơn!'],
      idle: ['Trại đang vắng. Hãy tố giác bạn bè bằng cú pháp: Bế tên ai đó vì tội gì đó!'],
    },
  },
  gangster: {
    name: 'Giang Hồ Mạng',
    short: 'ĐẠI CA',
    icon: '😎',
    style: 'đại ca giang hồ mạng, nói chất, dùng tiếng lóng giới trẻ (ét o ét, khum, gét gô, chằm zn), xưng "anh" gọi "chú em", hài hước, KHÔNG chửi thề',
    ttsStyle: 'Đọc bằng giọng đại ca giang hồ, ngầu, hơi lè nhè, tự tin',
    lines: {
      verdict: [
        'Ê {name}! Dám {crime} hả? Vô trỏng ngồi {days} ngày cho anh!',
        'Chú em {name} {crime}, anh xử {days} ngày. Gét gô đập đá!',
        'Anh nghe nói {name} {crime}. Thôi, {days} ngày, khum nói nhiều!',
      ],
      recidivist: ['Lại là chú {name}! Tái phạm {crime}, anh tặng {days} ngày!'],
      stack: ['{name} lại dính thêm {crime}. Tổng cộng {days} ngày nha chú!'],
      release: ['{name} ra trại rồi! Ra ngoài sống cho đàng hoàng nghe chưa!'],
      giftSmall: ['Ố dề, {giver} mang quà thăm {name}. Giảm {days} ngày!', 'Anh {giver} chơi đẹp! {name} bớt {days} ngày!'],
      giftSelf: ['{name} tự lo hậu sự bằng {gift}. Bớt {days} ngày!'],
      giftNoTarget: ['Cảm ơn đại gia {giver} nha! Anh ghi sổ rồi!'],
      pardonOne: ['Đại gia {giver} ra tay! {name} được thả, đi về đi chú!'],
      pardonAll: ['Trời ơi, {giver} bao nguyên trại! Thả hết, thả hết!'],
      storm: ['Bão tim nè! Cả đám đập đá đi, bớt {days} ngày!'],
      presence: ['Ủa {name} vô live rồi kìa! Chạy đâu cho thoát!'],
      defenseWin: ['{giver} nói chuẩn đó. Anh cho {name} bớt {days} ngày!'],
      defenseLose: ['{giver} nói nghe không lọt tai. Án giữ nguyên!'],
      confess: ['{name} tự khai {crime}. Thành thật vậy, anh giảm còn {days} ngày!'],
      optout: ['{name} có giấy miễn tố. Thôi, đi về!'],
      follow: ['{giver} bảo lãnh {name}. Bớt {days} ngày!'],
      share: ['{giver} đi kêu oan cho {name}. Bớt {days} ngày!'],
      rollCall: ['Điểm danh nè! Trại có {count} đứa. Lì nhất là {name}, còn {days} ngày!'],
      laborStart: ['Anh em ơi! {goal} tim trong {sec} giây, cả trại bớt {days} ngày!'],
      laborWin: ['Quá đỉnh! Cả trại bớt {days} ngày!'],
      laborLose: ['Hụt rồi! Lần sau thả tim mạnh tay lên!'],
      idle: ['Trại vắng quá. Tố đứa bạn thân vô đây chơi coi!'],
    },
  },
  romance: {
    name: 'Ngôn Tình Sến Súa',
    short: 'TỔNG TÀI',
    icon: '💘',
    style: 'tổng tài ngôn tình sến súa, ngọt ngào, nhiều ẩn dụ tình yêu, kiểu "em đã đánh cắp trái tim anh", hài hước lãng mạn',
    ttsStyle: 'Đọc bằng giọng ngọt ngào, sến súa, chậm rãi như tổng tài ngôn tình',
    lines: {
      verdict: [
        '{name} à, em {crime}. Anh phạt em {days} ngày ở bên anh trong trại này.',
        'Người ta nói {name} {crime}. Trái tim anh đau, nhưng luật là luật: {days} ngày.',
        '{name}, em có biết {crime} là tội không? Anh giam em {days} ngày… trong tim anh.',
      ],
      recidivist: ['{name} lại {crime}. Em cố tình quay về bên anh sao? {days} ngày!'],
      stack: ['{name} lại thêm {crime}. Anh giữ em thêm, tổng {days} ngày.'],
      release: ['{name} ra đi rồi. Nhớ giữ nhân phẩm như giữ lời hứa với anh.'],
      giftSmall: ['{giver} đến thăm {name} với cả tấm lòng. Giảm {days} ngày, ngọt quá!'],
      giftSelf: ['{name} dâng {gift} để chuộc lỗi. Anh tha cho em {days} ngày.'],
      giftNoTarget: ['Cảm ơn {giver}, món quà làm tim anh tan chảy.'],
      pardonOne: ['{giver} dùng tình yêu đặc xá cho {name}. Em tự do rồi!'],
      pardonAll: ['{giver} mở cửa trái tim, đại xá toàn trại! Ai cũng được yêu thương!'],
      storm: ['Mưa tim rơi! Cả trại được giảm {days} ngày, lãng mạn quá!'],
      presence: ['{name} cuối cùng cũng đến. Anh đợi em lâu lắm rồi.'],
      defenseWin: ['Lời {giver} nói chạm đến tim anh. {name} được giảm {days} ngày.'],
      defenseLose: ['Lời {giver} chưa đủ ngọt. Anh vẫn giữ {name} lại.'],
      confess: ['{name} tự thú {crime}. Thật lòng như vậy, anh giảm còn {days} ngày.'],
      optout: ['{name} muốn rời đi. Anh tôn trọng em, em tự do.'],
      follow: ['{giver} bảo lãnh cho {name} bằng cả tấm lòng. Giảm {days} ngày.'],
      share: ['{giver} lan toả nỗi oan của {name}. Giảm {days} ngày.'],
      rollCall: ['Điểm danh những trái tim lạc lối: {count} người. Người cần yêu thương nhất là {name}, còn {days} ngày.'],
      laborStart: ['Gửi anh {goal} tim trong {sec} giây, cả trại được giảm {days} ngày nhé!'],
      laborWin: ['Cảm ơn mưa tim! Cả trại giảm {days} ngày!'],
      laborLose: ['Chưa đủ tim rồi. Anh buồn một chút thôi.'],
      idle: ['Trại vắng như trái tim anh. Hãy tag người thương vào đây!'],
    },
  },
};

export const PERSONA_KEYS = Object.keys(PERSONAS);

export function line(personaKey, kind, vars) {
  const p = PERSONAS[personaKey] || PERSONAS.judge;
  const arr = p.lines[kind] || PERSONAS.judge.lines[kind] || [''];
  return fill(pick(arr), vars);
}

/** Tội danh "vô hại hoá" dự phòng, theo từ khoá (đã bỏ dấu). */
export const FUNNY_CRIMES = [
  { k: ['no', 'vay', 'muon', 'chua tra', 'quyt', 'tien'], c: ['tội chiếm dụng tiền trà sữa kéo dài', 'tội quỵt nợ có tổ chức', 'tội hứa trả tiền vào "mai"'] },
  { k: ['seen', 'rep', 'tin nhan', 'nhan tin', 'inbox'], c: ['tội seen không rep', 'tội để tin nhắn mốc meo', 'tội rep một chữ "ừ"'] },
  { k: ['tre', 'muon', 'cao su', 'hen'], c: ['tội cao su giờ hẹn', 'tội "đang tới" nhưng chưa tắm'] },
  { k: ['ngu', 'ngu nuong', 'day muon'], c: ['tội ngủ nướng có hệ thống', 'tội báo thức 12 cái vẫn không dậy'] },
  { k: ['an', 'an vung', 'map', 'beo', 'an het'], c: ['tội ăn vụng tập thể', 'tội ăn miếng cuối cùng không hỏi ai'] },
  { k: ['game', 'lien quan', 'ff', 'pubg', 'gaming'], c: ['tội nghiện game ngoài giờ hành chính', 'tội feed mạng rồi đổ tại mạng lag'] },
  { k: ['dep', 'xinh', 'dep trai', 'cute', 'de thuong'], c: ['tội đẹp quá mức cho phép', 'tội gây thương nhớ trái phép'] },
  { k: ['crush', 'yeu', 'tha thinh', 'nguoi yeu', 'thinh', 'ny'], c: ['tội thả thính không giấy phép', 'tội cướp crush của bạn thân'] },
  { k: ['hoc', 'bai tap', 'deadline', 'thi', 'kiem tra'], c: ['tội trốn deadline cấp độ quốc tế', 'tội chép bài tập rồi quên sửa tên'] },
  { k: ['lua', 'scam', 'gat'], c: ['tội lừa bạn đi ăn rồi bắt bạn trả', 'tội hứa "đi đi tao bao"'] },
  { k: ['trom', 'chom', 'lay'], c: ['tội chôm sạc điện thoại', 'tội mượn bút không bao giờ trả'] },
  { k: ['xao', 'noi phet', 'chem gio', 'flex'], c: ['tội chém gió vượt cấp độ bão', 'tội flex quá đà'] },
  { k: ['luoi', 'luoi bieng'], c: ['tội lười có bằng cấp'] },
];

export const GENERIC_CRIMES = [
  'tội dễ thương có chủ đích', 'tội được réo tên trên live', 'tội không chịu thả tim', 'tội lướt TikTok quên ngủ',
  'tội cười như được mùa', 'tội quên sinh nhật bạn thân', 'tội nói "tí nữa" rồi mất tích', 'tội đặt đồ online không nhận',
  'tội hát karaoke sai tông', 'tội đăng story lúc 3 giờ sáng', 'tội trả lời bằng sticker', 'tội ăn mì gói không đập trứng',
];

export const NPCS = [
  { name: 'Thánh Deadline', crime: 'tội nộp bài lúc 23:59' },
  { name: 'Chúa Tể Seen', crime: 'tội seen không rep 3 năm' },
  { name: 'Vua Cao Su', crime: 'tội hẹn 7h, 9h mới dậy' },
  { name: 'Thần Ăn Vặt', crime: 'tội ăn hết snack của phòng' },
  { name: 'Hoàng Tử Flex', crime: 'tội flex xe đạp điện' },
  { name: 'Bà Hoàng Story', crime: 'tội đăng 47 story một ngày' },
  { name: 'Cao Thủ Ngủ Nướng', crime: 'tội tắt 12 cái báo thức' },
  { name: 'Đại Ca Mượn Sạc', crime: 'tội mượn sạc không trả' },
];

export const NPC_CHATTER = [
  'Oan quá trời ơi!', 'Ai thả tim cứu em với 🥺', 'Đập đá mỏi tay quá', 'Mì tôm đâu rồi?', 'Em hứa sẽ rep tin nhắn!',
  'Cho em ra đi mà', 'Có ai thăm nuôi không?', 'Lần sau em chừa rồi', 'Hôm nay trại vui ghê', 'Thả tim đi mọi người ơi!',
];
