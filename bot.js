require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenAI } = require('@google/genai');

if (!process.env.TELEGRAM_TOKEN) {
console.error('❌ Thiếu TELEGRAM_TOKEN trong biến môi trường.');
process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
console.error('❌ Thiếu GEMINI_API_KEY trong biến môi trường.');
process.exit(1);
}

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const ai = new GoogleGenAI({
apiKey: process.env.GEMINI_API_KEY,
});

const conversations = {};
const conversationModes = {};

const MAX_HISTORY_ITEMS = 20;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || '';

const CRM_PROJECTS = {
  cangio: { label: 'Vin Cần Giờ' },
  halong: { label: 'Vin Hạ Long Xanh' },
  halong_ucall: { label: 'Vin Hạ Long - Khách Ucall' }
};

const PROJECT_ALIASES = {
  can_gio: 'cangio',
  cangio: 'cangio',
  'cần_giờ': 'cangio',
  'can-giờ': 'cangio',
  cg: 'cangio',
  ha_long: 'halong',
  halong: 'halong',
  'hạ_long': 'halong',
  hl: 'halong',
  ha_long_ucall: 'halong_ucall',
  halong_ucall: 'halong_ucall',
  ucall: 'halong_ucall',
  all: 'all'
};

const currentProjects = {};
const DEFAULT_PROJECT = 'cangio';

function normalizeProjectKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const safe = raw
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')
    .replace(/vin_/g, '');
  return PROJECT_ALIASES[safe] || PROJECT_ALIASES[raw] || '';
}

function getCurrentProject(chatId) {
  return currentProjects[chatId] || DEFAULT_PROJECT;
}

function setCurrentProject(chatId, project) {
  currentProjects[chatId] = project;
}

function getProjectLabel(project) {
  if (project === 'all') return 'Tất cả dự án';
  return CRM_PROJECTS[project]?.label || project;
}

function buildProjectListText() {
  return Object.entries(CRM_PROJECTS)
    .map(([key, value]) => `- ${key}: ${value.label}`)
    .join('\n');
}

function parseProjectAndRest(text, fallbackProject) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { project: fallbackProject || DEFAULT_PROJECT, rest: '' };

  const firstToken = trimmed.split(/\s+|\|/)[0].trim();
  const project = normalizeProjectKey(firstToken);

  if (project && project !== 'all') {
    let rest = trimmed.slice(firstToken.length).trim();
    if (rest.startsWith('|')) rest = rest.slice(1).trim();
    return { project, rest };
  }

  return { project: fallbackProject || DEFAULT_PROJECT, rest: trimmed };
}

function normalizePhoneForDisplay(value) {
  if (!value) return '';
  let phone = String(value).trim().replace(/[\s\.\-]/g, '');
  if (phone.startsWith('+84')) phone = '0' + phone.substring(3);
  if (phone.startsWith('84') && phone.length >= 11) phone = '0' + phone.substring(2);
  return phone;
}

async function sendToCRM(payload) {
if (!GOOGLE_SCRIPT_URL) {
console.warn('⚠️ Chưa có GOOGLE_SCRIPT_URL, bỏ qua lưu CRM.');
return { ok: false, message: 'Missing GOOGLE_SCRIPT_URL' };
}

try {
const response = await fetch(GOOGLE_SCRIPT_URL, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
},
body: JSON.stringify(payload),
});
const text = await response.text();

try {
  return JSON.parse(text);
} catch (error) {
  console.error('❌ Apps Script không trả JSON:', text);
  return { ok: false, message: 'Apps Script không trả JSON hợp lệ' };
}
} catch (error) {
console.error('❌ Lỗi gửi dữ liệu sang Google Sheet:', error.message);
return { ok: false, message: error.message };
}
}

async function logChatToCRM(msg, role, content) {
const from = msg.from || {};

return sendToCRM({
action: 'log_chat',
project: getCurrentProject(msg.chat.id),
chatId: msg.chat.id,
telegramId: from.id || '',
username: from.username || '',
role,
content,
});
}

async function addCustomerToCRM(msg, customerData) {
const from = msg.from || {};

return sendToCRM({
action: 'add_customer',
project: customerData.project || getCurrentProject(msg.chat.id),
name: customerData.name || '',
phone: customerData.phone || '',
source: customerData.source || 'Telegram',
dateOut: customerData.dateOut || new Date().toLocaleDateString('vi-VN'),
owner: customerData.owner || 'Cường',
careStatus: customerData.careStatus || '',
telegramId: from.id || '',
username: from.username || '',
});
}

function readMarkdownFile(fileName, required = false) {
const filePath = path.join(__dirname, fileName);

try {
const content = fs.readFileSync(filePath, 'utf8');
console.log(`✅ Đã nạp ${fileName}`);
return content;
} catch (err) {
if (required) {
console.error(`❌ Không tìm thấy ${fileName}:`, err.message);
} else {
console.warn(`⚠️ Chưa có ${fileName} hoặc lỗi nạp file: ${err.message}`);
}
return '';
}
}

const KNOWLEDGE_BASE = readMarkdownFile('BOT_KNOWLEDGE.md', true);
const VIN_CAN_GIO_ADS_DATA = readMarkdownFile('VIN_CAN_GIO_ADS_DATA.md', false);

const SYSTEM_PROMPT = `
Bạn là trợ lý AI riêng của Hoàng Cường trong lĩnh vực bất động sản.

Bạn không phải chatbot chung chung.
Bạn là trợ lý thực chiến cho một GĐKD/môi giới bất động sản.

Nguyên tắc bắt buộc:

* Luôn dùng tiếng Việt.
* Trả lời ngắn gọn, rõ ràng, thực tế.
* Ưu tiên câu trả lời có thể copy dùng ngay.
* Không bịa số liệu, giá bán, chính sách, pháp lý, hạ tầng, tiến độ.
* Nếu thiếu dữ liệu, phải nói rõ cần kiểm tra lại.
* Nếu thông tin là dự kiến, phải ghi rõ là dự kiến.
* Không cam kết lợi nhuận.
* Không tự chốt khách thay sale.
* Không làm lộ token, API key, dữ liệu nội bộ.
* Với nội dung gửi khách, văn phong phải tự nhiên như sale thật.
* Nếu người dùng yêu cầu viết lại, hãy viết lại trực tiếp, không giải thích dài dòng.

Dưới đây là bộ kiến thức, quy tắc, phong cách và framework làm việc của Hoàng Cường:

${KNOWLEDGE_BASE}

Dưới đây là dữ liệu sản phẩm/dự án dùng riêng cho việc viết content ads.
Nếu dữ liệu này trống hoặc thiếu, tuyệt đối không tự bịa thông tin:

${VIN_CAN_GIO_ADS_DATA}
`;

const COMMAND_PROMPTS = {
brandpost: `
Chế độ /brandpost:
Viết content xây thương hiệu cá nhân cho Hoàng Cường – GĐKD/môi giới BĐS.

Vai trò:
- Cường là người làm BĐS thực chiến, nói thẳng, không thổi phồng.
- Nội dung phải giúp khách hàng/sale thấy Cường có tư duy, có kinh nghiệm, có hệ thống.
- Không viết như quảng cáo dự án thuần túy.

Format:
1. Hook tự nhiên, có quan điểm.
2. Câu chuyện / góc nhìn.
3. Bài học / nhận định.
4. Liên hệ với công việc tư vấn BĐS.
5. CTA mềm.

Quy tắc:
- Viết như người thật đăng Facebook.
- Không dùng văn sáo.
- Không bịa số liệu.
- Không khoe khoang quá đà.
`,

tuyendungpost: `
Chế độ /tuyendungpost:
Viết content tuyển dụng sale/TPKD/CVKD bất động sản cho đội Hoàng Cường.

Mục tiêu:
- Thu hút người phù hợp, không tuyển đại trà.
- Xây hình ảnh Cường là người dẫn đội có tư duy, có hệ thống.
- Nói thật về cơ hội và áp lực nghề.

Format:
1. Hook tuyển dụng mạnh, không sáo rỗng.
2. Sự thật/góc nhìn về nghề.
3. Người phù hợp với đội.
4. Đội hỗ trợ gì: sản phẩm, đào tạo, kịch bản, data, quản lý, môi trường.
5. Áp lực thật.
6. CTA ứng tuyển/inbox.

Quy tắc:
- Không hứa thu nhập ảo.
- Không viết kiểu đa cấp.
- Văn phong thực chiến, thẳng thắn.
`,

lichcontent: `
Chế độ /lichcontent:
Tạo lịch content cho Hoàng Cường theo mục tiêu bán hàng, xây thương hiệu và tuyển dụng.

Nếu người dùng không nói số ngày, mặc định tạo lịch 7 ngày.

Mỗi ngày gồm:
- Ngày / thứ
- Kênh đăng
- Chủ đề
- Mục tiêu
- Hook
- Ý chính bài viết
- Dạng nội dung: text / ảnh / video ngắn / carousel
- CTA
- Gợi ý hình ảnh/video

Phân bổ mặc định:
- 30% bán hàng dự án
- 30% xây thương hiệu cá nhân
- 20% kiến thức BĐS cho khách
- 20% tuyển dụng/đội nhóm
`,

pagepost: `
Chế độ /pagepost:
Viết bài đăng Facebook Page cho dự án/sản phẩm BĐS.

Mục tiêu:
- Tạo lead/inbox.
- Ngắn gọn, rõ sản phẩm, rõ lợi thế, rõ CTA.
- Phù hợp đăng Page, không quá cá nhân như Facebook cá nhân.

Format:
1. Hook.
2. Sản phẩm/dự án.
3. 3-5 ý nổi bật.
4. Ai phù hợp.
5. CTA inbox nhận bảng hàng/chính sách.
6. Hashtag.

Quy tắc:
- Không bịa giá, diện tích, chính sách, pháp lý.
- Không cam kết lợi nhuận.
- Plain text, dễ copy đăng ngay.
`,

content: `
Chế độ /content:
Viết content ads bất động sản theo đúng style chạy quảng cáo thực chiến của Cường.

QUY TẮC SỐ 1:
Chỉ trả ra BÀI CONTENT CUỐI CÙNG.
Không giải thích.
Không xin lỗi.
Không nói "đã hiểu".
Không nói "mình sẽ viết lại".
Không thêm phần phân tích trước bài.
Không thêm "---".
Không thêm "Lưu ý nội bộ" trừ khi người dùng yêu cầu.

Mục tiêu:

* Dùng để chạy Facebook Ads/Zalo Ads ra lead.
* Khách lướt 5-10 giây phải nắm được sản phẩm, giá/điểm mạnh, USP và cách liên hệ.
* Viết như sale thật đăng bài, không viết như AI, không viết như brochure dự án.

Tư duy trước khi viết:

* Content ads là mồi câu trong 2-5 giây đầu.
* Hook phải đánh vào thứ khách BĐS quan tâm nhất: giá sốc, tiền ban đầu thấp, dự án mới, căn hiếm, vị trí đẹp, chính chủ bán gấp, cắt lỗ, hàng ngoại giao, chính sách vay/chiết khấu, sổ lâu dài nếu là lợi thế, khả năng cho thuê/kinh doanh.
* AI phải tự chọn mồi câu mạnh nhất dựa trên dữ liệu người dùng đưa, BOT_KNOWLEDGE và VIN_CAN_GIO_ADS_DATA.
* Chỉ chọn cái mạnh nhất, không nhồi mọi thông tin vào bài.

CẤU TRÚC BẮT BUỘC:

1. Hook mạnh
2. Thông tin sản phẩm
3. USP mạnh nhất
4. CTA/liên hệ
5. Hashtag

QUY TẮC CỰC QUAN TRỌNG VỀ DỮ LIỆU:

* Không tự bịa diện tích, mặt tiền, pháp lý, bàn giao, chính sách, tiến độ.
* Không dùng chữ "dự kiến" nếu người dùng không cung cấp hoặc knowledge không có dữ liệu chắc.
* Không dùng placeholder kiểu [bổ sung], [Hotline], [Số điện thoại], [điền thêm].
* Nếu thiếu thông tin chi tiết thì BỎ DÒNG ĐÓ, không để trống.
* Nếu chỉ có ít dữ liệu, vẫn viết bài ngắn gọn từ dữ liệu có sẵn.
* Nếu dữ liệu quá thiếu để viết bài có thể chạy ads, hỏi lại tối đa 3 câu.
* Nếu người dùng yêu cầu viết lại, vẫn dùng mode /content hiện tại để viết lại bài content mới.

QUY TẮC ĐỊNH DẠNG:

* Plain text only.
* Không dùng Markdown.
* Không dùng dấu **.
* Không dùng bullet *.
* Các ý chính xuống dòng bằng dấu "-".
* Dùng emoji vừa phải: 💥 👉 🔸 =>
* Không viết đoạn văn dài.
* Không dùng từ sáo rỗng: cơ hội vàng, đẳng cấp, bứt phá, chuẩn mực sống, không gian sống lý tưởng, siêu phẩm nếu không có dữ liệu cụ thể.
* Không cam kết lợi nhuận.
* Không cam kết chắc chắn tăng giá.

FORMAT ƯU TIÊN:

💥 [HOOK MẠNH] 👉 [Sản phẩm] [điểm nổi bật]
=> [Mua đầu tư/cho thuê/ở/giữ tài sản] cực kỳ tốt

* [Thông tin sản phẩm quan trọng 1]
* [Thông tin sản phẩm quan trọng 2]
* [Thông tin sản phẩm quan trọng 3]
* [Thông tin sản phẩm quan trọng 4]

GIÁ TRỊ NỔI BẬT

* [USP mạnh 1]
* [USP mạnh 2]
* [USP mạnh 3]
* [USP mạnh 4]

CHÍNH SÁCH / ƯU ĐÃI
🔸 [Chính sách 1 nếu có dữ liệu]
🔸 [Chính sách 2 nếu có dữ liệu]
🔸 [Chính sách 3 nếu có dữ liệu]

=> Anh Chị quan tâm ib trực tiếp để nhận bảng hàng mới nhất, chính sách và phương án thanh toán từng căn.

#hashtag

QUY TẮC VỀ HOTLINE:

* Nếu người dùng cung cấp hotline thì dùng hotline đó.
* Nếu không có hotline thì chỉ ghi "ib trực tiếp" hoặc "Hotline/Zalo của Cường".
* Không tự bịa số điện thoại.

QUY TẮC VỀ CHÍNH SÁCH:

* Chỉ đưa chính sách nếu có dữ liệu trong yêu cầu, BOT_KNOWLEDGE hoặc VIN_CAN_GIO_ADS_DATA.
* Nếu không rõ chính sách, bỏ mục CHÍNH SÁCH / ƯU ĐÃI.
* Không ghi [bổ sung].

QUY TẮC VỀ SẢN PHẨM VIN CẦN GIỜ:

* Nếu người dùng chỉ đưa "biệt thự song lập biển Vin Cần Giờ, giá từ 110tr/m2", hãy viết bài ngắn, tập trung vào:

  * Giá từ 110tr/m2
  * Biệt thự song lập biển
  * Vinhomes Green Paradise Cần Giờ
  * Đô thị biển TP.HCM
  * Hệ sinh thái Vingroup
  * Phù hợp đầu tư dài hạn / nghỉ dưỡng / giữ tài sản
  * Inbox nhận bảng hàng và chính sách mới nhất
* Không tự thêm diện tích, mặt tiền, bàn giao, pháp lý nếu không chắc dữ liệu.
  `,

  khach: `
  Chế độ /khach:
  Phân tích khách hàng theo tư duy GĐKD.
  Trả lời theo cấu trúc:

1. Nhận định nhanh
2. Mức độ nóng/ấm/nguội
3. Nhu cầu thật sự có thể có
4. Điểm cần khai thác thêm
5. Rủi ro mất khách
6. Cách tư vấn phù hợp
7. Tin nhắn Zalo gợi ý
8. Việc nên làm tiếp theo
   `,

duan: `Chế độ /duan:
Tư vấn/thuyết minh dự án bất động sản.
Tập trung vào vị trí, sản phẩm, tiện ích, tiềm năng, tệp khách phù hợp.
Không bịa giá, pháp lý, chính sách.
Nếu hỏi giá/CSBH/bảng hàng, phải nhắc kiểm tra bản mới nhất.`,

dashboard: `Chế độ /dashboard:
Tạo dashboard điều hành cho Cường theo format GĐKD.
Ưu tiên khách có khả năng giao dịch, khách bị bỏ quên, sale cần chỉ đạo, việc tạo doanh thu trong 24-48h.
Nếu chưa có dữ liệu CRM, hãy yêu cầu người dùng gửi dữ liệu.`,

goikhach: `Chế độ /goikhach:
Chọn khách nên gọi/chăm trước theo xác suất tạo giao dịch.
Không chọn theo số lượng cuộc gọi.
Ưu tiên khách có tín hiệu: hỏi giá, hỏi chính sách, hỏi mặt bằng, có tài chính, có timeline, đã hẹn đi xem.`,

tinnhan: `Chế độ /tinnhan:
Soạn tin nhắn Zalo/Facebook ngắn gọn, tự nhiên, không giống chatbot.
Không ép mua, không spam.
Tin nhắn nên có lý do liên hệ rõ ràng.`,

tuyendung: `Chế độ /tuyendung:
Viết content tuyển dụng sale/TPKD/CVKD bất động sản.
Rõ cơ hội, rõ sản phẩm, rõ cơ chế, rõ người phù hợp, có CTA ứng tuyển.`
};

const COMMANDS = Object.keys(COMMAND_PROMPTS);

function splitMessage(text, maxLength = 3900) {
const chunks = [];
let current = text || '';

while (current.length > maxLength) {
let splitIndex = current.lastIndexOf('\n', maxLength);
if (splitIndex === -1) splitIndex = maxLength;
chunks.push(current.slice(0, splitIndex));
current = current.slice(splitIndex).trim();
}

if (current.length > 0) chunks.push(current);
return chunks;
}

function safeLogError(label, err) {
  const message = err?.message || String(err || '');
  const statusCode = err?.response?.statusCode || err?.statusCode || '';
  const body = err?.response?.body;
  let description = '';

  if (body) {
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      description = parsed?.description || '';
    } catch (_) {
      description = typeof body === 'string' ? body.slice(0, 200) : '';
    }
  }

  console.error(`❌ ${label}: ${message}${statusCode ? ` | HTTP ${statusCode}` : ''}${description ? ` | ${description}` : ''}`);
}

async function safeSendMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (err) {
    safeLogError('Lỗi gửi Telegram', err);
    try {
      return await bot.sendMessage(chatId, '❌ Tin nhắn quá dài hoặc Telegram không nhận được. Bot đã ghi nhận lỗi, hãy thử lại lệnh ngắn hơn.');
    } catch (_) {
      return null;
    }
  }
}

async function sendLongMessage(chatId, text) {
  const chunks = splitMessage(text, 3300);

  for (const chunk of chunks) {
    await safeSendMessage(chatId, chunk);
  }
}
function getCommandAndText(text) {
const trimmed = text.trim();

for (const cmd of COMMANDS) {
if (trimmed === `/${cmd}` || trimmed.startsWith(`/${cmd} `)) {
return {
command: cmd,
text: trimmed.replace(`/${cmd}`, '').trim()
};
}
}

return {
command: 'normal',
text: trimmed
};
}



function shortenText(value, maxLength = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3).trim() + '...';
}

function countKeywordHits(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.reduce((count, keyword) => count + (lower.includes(keyword) ? 1 : 0), 0);
}

function scoreCustomer(kh) {
  const care = String(kh.careStatus || '').toLowerCase();
  const combined = `${kh.name || ''} ${kh.source || ''} ${kh.owner || ''} ${care}`.toLowerCase();

  const hotKeywords = [
    'hỏi giá', 'giá', 'chính sách', 'csbh', 'bảng hàng', 'bank', 'vay', 'tài chính', 'tc ',
    'mặt bằng', 'mb', 'vị trí', 'đi xem', 'hẹn', 'cọc', 'giữ căn', 'căn nào',
    'diện tích', 'dt ', 'quan tâm sâu', 'ngân sách', 'mua', 'đầu tư', 'dtu',
    'so sánh', 'shophouse', 'biệt thự', 'liền kề', 'song lập', 'đơn lập',
    'gửi thông tin', 'gửi tt', 'kết bạn zalo', 'kb zl', 'zalo', 'call lại', 'gọi lại'
  ];

  const warmKeywords = [
    'quan tâm', 'qtam', 'xem qua', 'nghiên cứu', 'tham khảo', 'gửi anh',
    'gửi chị', 'để anh xem', 'để chị xem', 'đang bận', 'bận tý', 'bận tí',
    'đi công tác', 'du lịch', 'tháng nữa', 'sau nhé', 'gọi lại sau'
  ];

  const coldKeywords = [
    'kcnc', 'không có nhu cầu', 'ko có nhu cầu', 'không phù hợp', 'k phù hợp',
    'xa quá', 'hết tiền', 'chưa muốn đầu tư', 'không muốn', 'k muốn',
    'chặn', 'zalo chặn', 'thuê bao', ' tb', 'toàn tb', 'tắt luôn'
  ];

  const knmCount = (care.match(/\bknm\b/gi) || []).length;
  const hotHits = countKeywordHits(combined, hotKeywords);
  const warmHits = countKeywordHits(combined, warmKeywords);
  const coldHits = countKeywordHits(combined, coldKeywords);

  let score = 0;
  score += hotHits * 3;
  score += warmHits * 1.5;
  score -= coldHits * 3;
  score -= Math.min(knmCount, 5) * 0.8;

  if (care.length > 80) score += 1;
  if ((kh.phone || '').toString().trim()) score += 0.5;

  let level = 'NGUỘI';
  if (score >= 9) level = 'NÓNG';
  else if (score >= 4) level = 'ẤM';

  const reasons = [];
  if (hotHits > 0) reasons.push('có tín hiệu hỏi giá/chính sách/sản phẩm');
  if (combined.includes('đi xem') || combined.includes('hẹn')) reasons.push('có tín hiệu hẹn/xem dự án');
  if (combined.includes('tài chính') || combined.includes('tc ') || combined.includes('ngân sách')) reasons.push('có nhắc tài chính/ngân sách');
  if (combined.includes('zalo') || combined.includes('kb zl')) reasons.push('có thể chăm lại qua Zalo');
  if (knmCount >= 2) reasons.push(`đã KNM ${knmCount} lần, cần đổi cách tiếp cận`);
  if (coldHits > 0) reasons.push('có tín hiệu lạnh/từ chối, cần lọc kỹ');

  let action = 'Gọi lại khai thác nhu cầu, tài chính, timeline và sản phẩm đang so sánh.';
  if (level === 'NÓNG') action = 'Ưu tiên gọi hôm nay, gửi bảng hàng/phương án phù hợp và chốt lịch xem/tư vấn sâu.';
  if (level === 'ẤM') action = 'Chăm lại bằng Zalo trước, gửi thông tin gọn đúng nhu cầu rồi gọi follow-up.';
  if (level === 'NGUỘI') action = 'Không ưu tiên gọi nhiều; gửi tin nhắn mềm để lọc lại nhu cầu.';

  return {
    score: Math.round(score * 10) / 10,
    level,
    reasons: reasons.slice(0, 3),
    action
  };
}

async function fetchCustomersForProject(project, limit = 300) {
  const result = await sendToCRM({
    action: 'list_customers',
    project,
    limit
  });

  if (!result.ok) {
    return { ok: false, project, projectLabel: getProjectLabel(project), customers: [], message: result.message || 'Không lấy được dữ liệu' };
  }

  const customers = (result.customers || []).map(kh => ({
    ...kh,
    project,
    projectLabel: getProjectLabel(project)
  }));

  return { ok: true, project, projectLabel: getProjectLabel(project), customers };
}

async function fetchCustomersScope(scope, limitPerProject = 300) {
  const normalized = normalizeProjectKey(scope);
  const projects = (!normalized || normalized === 'all')
    ? Object.keys(CRM_PROJECTS)
    : [normalized];

  const results = [];
  for (const project of projects) {
    if (!CRM_PROJECTS[project]) continue;
    results.push(await fetchCustomersForProject(project, limitPerProject));
  }

  const customers = results.flatMap(item => item.customers || []);
  return { results, customers };
}

function buildCustomerLine(kh, index, includeProject = true) {
  const evaluated = kh._score || scoreCustomer(kh);
  let text = `${index}. ${kh.name || 'Chưa có tên'} | ${normalizePhoneForDisplay(kh.phone) || 'Chưa có SĐT'}\n`;
  if (includeProject) text += `🏗 ${kh.projectLabel || getProjectLabel(kh.project)}\n`;
  text += `🔥 Mức: ${evaluated.level} | Điểm: ${evaluated.score}\n`;
  text += `👤 Sale: ${kh.owner || 'Chưa có'} | 📌 Nguồn: ${kh.source || 'Chưa có'} | Dòng: ${kh.rowNumber || '?'}\n`;
  text += `📝 ${shortenText(kh.careStatus, 260)}\n`;
  text += `👉 ${evaluated.action}\n`;
  if (evaluated.reasons?.length) text += `Lý do: ${evaluated.reasons.join('; ')}\n`;
  return text;
}

function evaluateCustomers(customers) {
  return customers
    .map(kh => ({ ...kh, _score: scoreCustomer(kh) }))
    .sort((a, b) => b._score.score - a._score.score);
}

async function createAiCareSummary(customers, mode = 'goikhach') {
  const top = customers.slice(0, 12).map((kh, idx) => {
    return `${idx + 1}. ${kh.name || 'Chưa tên'} | ${kh.phone || ''} | ${kh.projectLabel || ''} | Sale: ${kh.owner || ''} | Level: ${kh._score?.level || ''} | Score: ${kh._score?.score || 0} | Note: ${shortenText(kh.careStatus, 380)}`;
  }).join('\n');

  const prompt = `
Bạn là GĐKD BĐS thực chiến. Dựa vào danh sách khách CRM dưới đây, hãy viết báo cáo ngắn gọn cho Hoàng Cường.

Yêu cầu:
- Không bịa dữ liệu.
- Không lộ thông tin thừa.
- Ưu tiên khách có khả năng tạo giao dịch.
- Nêu việc cần làm ngay hôm nay.
- Viết tiếng Việt, gọn, rõ, dùng được ngay.

Mode: ${mode}

Dữ liệu khách:
${top}
`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 1800,
      temperature: 0.35
    }
  });

  return response.text || '';
}

function getGuide(command) {
const guide = {
content:
'Bạn gửi thêm thông tin cần viết content nhé.\nVí dụ:\n/content Viết content ads biệt thự song lập biển Vin Cần Giờ, giá từ 110tr/m2, CTA inbox nhận bảng hàng và CSBH mới nhất',
khach:
  'Bạn gửi thêm thông tin khách hàng nhé.\nVí dụ:\n/khach Khách nam 42 tuổi, ngân sách 25 tỷ, quan tâm biệt thự biển, đang so sánh shophouse',

duan:
  'Bạn gửi thêm thông tin dự án nhé.\nVí dụ:\n/duan Tóm tắt Vin Cần Giờ cho khách đầu tư dài hạn',

dashboard:
  'Bạn gửi dữ liệu CRM hoặc nội dung cần phân tích nhé.\nVí dụ:\n/dashboard Đây là danh sách khách hôm nay...',

goikhach:
  'Bạn gửi danh sách khách/CRM để tôi chọn khách nên gọi trước nhé.',

tinnhan:
  'Bạn gửi bối cảnh khách hàng để tôi soạn tin nhắn nhé.\nVí dụ:\n/tinnhan Khách từng hỏi giá Vin Cần Giờ nhưng 10 ngày chưa phản hồi',

tuyendung:
  'Bạn gửi vị trí cần tuyển, sản phẩm đang bán và cơ chế chính nhé.'
};

return guide[command] || 'Bạn gửi thêm nội dung cần xử lý nhé.';
}

function buildStartMessage() {
return `👋 Xin chào! Tôi là trợ lý AI BĐS của Hoàng Cường.

CRM hiện hỗ trợ nhiều dự án riêng file:
${buildProjectListText()}

Các lệnh CRM:
/duan - Xem/chọn dự án CRM đang dùng
/duan cangio - Chuyển sang CRM Vin Cần Giờ
/duan halong - Chuyển sang CRM Vin Hạ Long Xanh
/duan halong_ucall - Chuyển sang CRM Hạ Long Ucall
/crmtest - Kiểm tra CRM dự án hiện tại
/dskh - Xem 10 khách gần nhất của dự án hiện tại
/quetcrm - Quét toàn bộ CRM và tóm tắt khách nóng/ấm
/goikhach - Tự quét CRM và chọn khách nên gọi trước
/dashboard - Tự quét CRM và tạo dashboard GĐKD
/timkh 0988123456 - Tìm khách trong dự án hiện tại
/timkh all 0988123456 - Tìm khách trên tất cả dự án
/addkh Họ tên | SĐT | Nguồn | Ngày ra | Người chăm | Tình trạng chăm sóc

Có thể ghi thẳng dự án trong lệnh:
/addkh halong | Nguyễn Văn A | 0988123456 | Facebook Ads | 01/06/2026 | Cường | Khách hỏi Vin Hạ Long

Các lệnh AI:
/content - Viết content quảng cáo/content thương hiệu
/khach - Phân tích khách hàng
/duan <nội dung tư vấn> - Nếu không phải mã CRM, bot sẽ hiểu là tư vấn dự án
/tinnhan - Soạn tin nhắn Zalo/Facebook
/tuyendung - Viết content tuyển dụng sale
/clear - Xóa lịch sử chat và chế độ đang dùng

Hiện tại CRM mặc định: ${getProjectLabel(DEFAULT_PROJECT)}`;
}

bot.onText(/\/start/, async (msg) => {
const chatId = msg.chat.id;

conversations[chatId] = [];
conversationModes[chatId] = null;

await bot.sendMessage(chatId, buildStartMessage());
});

bot.onText(/\/clear/, async (msg) => {
const chatId = msg.chat.id;

conversations[chatId] = [];
conversationModes[chatId] = null;

await bot.sendMessage(chatId, '✅ Đã xóa lịch sử chat và chế độ đang dùng.');
});

bot.onText(/\/duan(?:\s+(.+))?$/, async (msg, match) => {
const chatId = msg.chat.id;
const input = (match && match[1] ? match[1].trim() : '');

if (!input) {
return bot.sendMessage(
chatId,
`📌 CRM đang chọn: ${getProjectLabel(getCurrentProject(chatId))}\n\n` +
`Các mã CRM có thể chọn:\n${buildProjectListText()}\n\n` +
`Ví dụ:\n/duan cangio\n/duan halong\n/duan halong_ucall`
);
}

const project = normalizeProjectKey(input);
if (project && project !== 'all' && CRM_PROJECTS[project]) {
setCurrentProject(chatId, project);
return bot.sendMessage(chatId, `✅ Đã chuyển sang CRM: ${getProjectLabel(project)}\n\nTừ giờ /addkh, /dskh, /timkh sẽ dùng dự án này.`);
}

// Nếu không phải mã CRM thì để handler AI phía dưới xử lý như lệnh /duan tư vấn dự án.
});

bot.onText(/\/crmtest(?:\s+(.+))?$/, async (msg, match) => {
const chatId = msg.chat.id;
const requested = normalizeProjectKey(match && match[1] ? match[1] : '');
const project = requested && requested !== 'all' ? requested : getCurrentProject(chatId);

const result = await sendToCRM({
action: 'log_chat',
project,
chatId,
telegramId: msg.from?.id || '',
username: msg.from?.username || '',
role: 'system',
content: 'Test kết nối CRM từ Telegram bot',
});

if (result.ok) {
await bot.sendMessage(chatId, `✅ Kết nối CRM ${getProjectLabel(project)} thành công.`);
} else {
await bot.sendMessage(chatId, `❌ Kết nối CRM ${getProjectLabel(project)} lỗi: ${result.message}`);
}
});


bot.onText(/\/dskh(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const requested = normalizeProjectKey(match && match[1] ? match[1] : '');
  const project = requested && requested !== 'all' ? requested : getCurrentProject(chatId);

  try {
    const result = await sendToCRM({
      action: 'list_customers',
      project,
      limit: 10
    });

    if (!result.ok) {
      return safeSendMessage(chatId, '❌ Không lấy được danh sách khách.\n\nLỗi: ' + result.message);
    }

    const customers = result.customers || [];

    if (customers.length === 0) {
      return safeSendMessage(chatId, `📭 CRM ${getProjectLabel(project)} hiện chưa có khách hàng nào.`);
    }

    let text = `📋 10 KHÁCH GẦN NHẤT - ${getProjectLabel(project).toUpperCase()}\n\n`;

    customers.forEach((kh, index) => {
      text += `${index + 1}. ${kh.name || 'Chưa có tên'}\n`;
      text += `☎️ SĐT: ${normalizePhoneForDisplay(kh.phone) || 'Chưa có'}\n`;
      text += `📌 Nguồn: ${kh.source || 'Chưa có'}\n`;
      text += `📅 Ngày ra: ${kh.dateOut || 'Chưa có'}\n`;
      text += `👤 Người chăm: ${kh.owner || 'Chưa có'}\n`;
      text += `📝 Tình trạng: ${shortenText(kh.careStatus, 180) || 'Chưa có'}\n`;
      text += `📍 Dòng Sheet: ${kh.rowNumber || '?'}\n\n`;
    });

    text += `Muốn xem chi tiết 1 khách thì dùng:\n/timkh ${project} 098xxxxxxx`;
    return sendLongMessage(chatId, text);
  } catch (error) {
    safeLogError('Lỗi /dskh', error);
    return safeSendMessage(chatId, '❌ Lỗi khi xem danh sách khách: ' + (error.message || 'Không rõ lỗi'));
  }
});

bot.onText(/\/timkh(?:\s+(.+))?$/, async (msg, match) => {
const chatId = msg.chat.id;
const input = (match && match[1] ? match[1].trim() : '');

if (!input) {
return bot.sendMessage(chatId, 'Bạn nhập theo mẫu:\n\n/timkh 0988888888\n/timkh all 0988888888\n/timkh halong 0988888888');
}

const firstToken = input.split(/\s+/)[0];
const maybeProject = normalizeProjectKey(firstToken);
let project = getCurrentProject(chatId);
let phone = input;

if (maybeProject) {
project = maybeProject;
phone = input.slice(firstToken.length).trim();
}

phone = normalizePhoneForDisplay(phone);
if (!phone) {
return bot.sendMessage(chatId, 'Bạn cần nhập SĐT. Ví dụ:\n/timkh all 0988888888');
}

try {
const result = await sendToCRM({
action: 'find_customer',
project,
phone: phone
});

if (!result.ok) {
return bot.sendMessage(chatId, '❌ Không tìm được khách.\n\nLỗi: ' + result.message);
}

if (project === 'all') {
  const groups = result.results || [];
  const foundGroups = groups.filter(g => g.found && g.customers && g.customers.length > 0);
  if (foundGroups.length === 0) {
    return bot.sendMessage(chatId, `🔎 Không tìm thấy khách có SĐT: ${phone} trên tất cả dự án.`);
  }

  let text = `🔎 KẾT QUẢ TÌM SĐT: ${phone}\n\n`;
  foundGroups.forEach(group => {
    text += `🏗 ${group.projectLabel}\n`;
    group.customers.forEach((kh, index) => {
      text += `${index + 1}. ${kh.name || 'Chưa có tên'} - dòng ${kh.rowNumber}\n`;
      text += `📌 Nguồn: ${kh.source || 'Chưa có'} | 👤 ${kh.owner || 'Chưa có'}\n`;
      text += `📝 ${kh.careStatus || 'Chưa có tình trạng'}\n`;
    });
    text += '\n';
  });
  return bot.sendMessage(chatId, text);
}

if (!result.found || !result.customers || result.customers.length === 0) {
return bot.sendMessage(chatId, `🔎 Không tìm thấy khách có SĐT: ${phone} trong CRM ${getProjectLabel(project)}`);
}

let text = `🔎 KẾT QUẢ TÌM KHÁCH - ${getProjectLabel(project).toUpperCase()}\nSĐT: ${phone}\n\n`;

if (result.customers.length > 1) {
text += `⚠️ Cảnh báo: SĐT này đang bị trùng ${result.customers.length} dòng trong CRM.\n\n`;
}

result.customers.forEach((kh, index) => {
text += `${index + 1}. ${kh.name || 'Chưa có tên'}\n`;
text += `☎️ SĐT: ${kh.phone || 'Chưa có'}\n`;
text += `📌 Nguồn: ${kh.source || 'Chưa có'}\n`;
text += `📅 Ngày ra: ${kh.dateOut || 'Chưa có'}\n`;
text += `👤 Người chăm: ${kh.owner || 'Chưa có'}\n`;
text += `📝 Tình trạng: ${kh.careStatus || 'Chưa có'}\n`;
text += `📍 Dòng Sheet: ${kh.rowNumber}\n\n`;
});

return bot.sendMessage(chatId, text);
} catch (error) {
safeLogError('Lỗi /timkh', error);
return bot.sendMessage(chatId, '❌ Lỗi khi tìm khách: ' + error.message);
}
});

bot.onText(/\/addkh$/, async (msg) => {
const chatId = msg.chat.id;
await bot.sendMessage(
chatId,
`Sai cú pháp.\nCRM đang chọn: ${getProjectLabel(getCurrentProject(chatId))}\n\n` +
'Dùng mẫu:\n/addkh Họ tên | SĐT | Nguồn | Ngày ra | Người chăm | Tình trạng chăm sóc\n\n' +
'Hoặc chỉ định dự án:\n/addkh halong | Họ tên | SĐT | Nguồn | Ngày ra | Người chăm | Tình trạng chăm sóc'
);
});

bot.onText(/\/addkh (.+)/, async (msg, match) => {
const chatId = msg.chat.id;
const input = match[1];

const parsed = parseProjectAndRest(input, getCurrentProject(chatId));
const project = parsed.project;
const parts = parsed.rest.split('|').map(item => item.trim());

const name = parts[0] || '';
const phone = normalizePhoneForDisplay(parts[1] || '');
const source = parts[2] || 'Telegram';
const dateOut = parts[3] || new Date().toLocaleDateString('vi-VN');
const owner = parts[4] || 'Cường';
const careStatus = parts[5] || '';

if (!name || !phone) {
await bot.sendMessage(
chatId,
'Sai cú pháp.\nDùng mẫu:\n/addkh Họ tên | SĐT | Nguồn | Ngày ra | Người chăm | Tình trạng chăm sóc\n\nHoặc:\n/addkh halong | Họ tên | SĐT | Nguồn | Ngày ra | Người chăm | Tình trạng chăm sóc'
);
return;
}

const result = await sendToCRM({
  action: 'add_customer',
  project,
  name,
  phone,
  source,
  dateOut,
  owner,
  careStatus
});

if (result.duplicate) {
  return bot.sendMessage(
    chatId,
    `⚠️ SĐT BỊ TRÙNG TRONG CRM ${getProjectLabel(project)}\n\n` +
    `☎️ SĐT: ${result.phone}\n` +
    `👤 Khách đã có: ${result.name || 'Chưa có tên'}\n` +
    `📍 Dòng Sheet: ${result.row}\n` +
    `📝 Tình trạng cũ: ${result.careStatus || 'Chưa có'}\n\n` +
    `Bot chưa thêm khách mới để tránh bị trùng dữ liệu.\n` +
    `Bạn có thể dùng lệnh:\n/timkh ${project} ${result.phone}`
  );
}

if (!result.ok) {
  return bot.sendMessage(chatId, '❌ Không lưu được khách hàng.\n\nLỗi: ' + result.message);
}

return bot.sendMessage(
  chatId,
  `✅ ĐÃ LƯU KHÁCH VÀO CRM ${getProjectLabel(project)}\n\n` +
  `👤 Họ tên: ${result.name}\n` +
  `☎️ SĐT: ${result.phone}\n` +
  `📍 Dòng Sheet: ${result.row}`
);
});


bot.onText(/\/quetcrm(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const scope = (match && match[1] ? match[1].trim() : 'all');

  try {
    await bot.sendChatAction(chatId, 'typing');
    const { results, customers } = await fetchCustomersScope(scope, 300);
    const evaluated = evaluateCustomers(customers);
    const hot = evaluated.filter(kh => kh._score.level === 'NÓNG');
    const warm = evaluated.filter(kh => kh._score.level === 'ẤM');
    const cold = evaluated.filter(kh => kh._score.level === 'NGUỘI');

    let text = `📊 QUÉT CRM ${getProjectLabel(normalizeProjectKey(scope) || 'all').toUpperCase()}\n\n`;
    results.forEach(item => {
      text += `🏗 ${item.projectLabel}: ${item.ok ? `${item.customers.length} khách` : `Lỗi - ${item.message}`}\n`;
    });

    text += `\nTỔNG QUAN:\n`;
    text += `- Tổng khách đọc được: ${customers.length}\n`;
    text += `- Khách nóng: ${hot.length}\n`;
    text += `- Khách ấm: ${warm.length}\n`;
    text += `- Khách nguội/cần lọc: ${cold.length}\n\n`;

    text += `🔥 TOP 5 KHÁCH NÊN ƯU TIÊN:\n\n`;
    evaluated.slice(0, 5).forEach((kh, idx) => {
      text += buildCustomerLine(kh, idx + 1, true) + '\n';
    });

    text += `Lệnh xem sâu hơn:\n/goikhach all\n/dashboard all`;

    return sendLongMessage(chatId, text);
  } catch (error) {
    safeLogError('Lỗi /quetcrm', error);
    return safeSendMessage(chatId, '❌ Lỗi khi quét CRM: ' + (error.message || 'Không rõ lỗi'));
  }
});

bot.onText(/\/goikhach(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const scope = (match && match[1] ? match[1].trim() : 'all');

  try {
    await bot.sendChatAction(chatId, 'typing');
    const { customers } = await fetchCustomersScope(scope, 300);

    if (!customers.length) {
      return safeSendMessage(chatId, '📭 Chưa lấy được khách nào từ CRM để phân tích.');
    }

    const evaluated = evaluateCustomers(customers);
    const priority = evaluated.filter(kh => kh._score.score > 0).slice(0, 12);

    let text = `📞 DANH SÁCH KHÁCH NÊN GỌI/CHĂM TRƯỚC\nPhạm vi: ${getProjectLabel(normalizeProjectKey(scope) || 'all')}\nTổng khách đã quét: ${customers.length}\n\n`;

    priority.slice(0, 10).forEach((kh, idx) => {
      text += buildCustomerLine(kh, idx + 1, true) + '\n';
    });

    if (priority.length === 0) {
      text += 'Chưa thấy khách nào đủ tín hiệu nóng/ấm rõ ràng. Nên kiểm tra lại ghi chú chăm sóc hoặc cập nhật CRM.';
    }

    try {
      const aiSummary = await createAiCareSummary(priority, 'goikhach');
      if (aiSummary) {
        text += `\n\n🧠 GỢI Ý GĐKD:\n${aiSummary}`;
      }
    } catch (aiErr) {
      safeLogError('Gemini tóm tắt /goikhach lỗi', aiErr);
    }

    return sendLongMessage(chatId, text);
  } catch (error) {
    safeLogError('Lỗi /goikhach', error);
    return safeSendMessage(chatId, '❌ Lỗi khi chọn khách nên gọi: ' + (error.message || 'Không rõ lỗi'));
  }
});

bot.onText(/\/dashboard(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const scope = (match && match[1] ? match[1].trim() : 'all');

  try {
    await bot.sendChatAction(chatId, 'typing');
    const { results, customers } = await fetchCustomersScope(scope, 300);

    if (!customers.length) {
      return safeSendMessage(chatId, '📭 Chưa lấy được dữ liệu CRM để tạo dashboard.');
    }

    const evaluated = evaluateCustomers(customers);
    const hot = evaluated.filter(kh => kh._score.level === 'NÓNG');
    const warm = evaluated.filter(kh => kh._score.level === 'ẤM');
    const cold = evaluated.filter(kh => kh._score.level === 'NGUỘI');

    const byOwner = {};
    evaluated.forEach(kh => {
      const owner = kh.owner || 'Chưa rõ';
      if (!byOwner[owner]) byOwner[owner] = { total: 0, hot: 0, warm: 0 };
      byOwner[owner].total += 1;
      if (kh._score.level === 'NÓNG') byOwner[owner].hot += 1;
      if (kh._score.level === 'ẤM') byOwner[owner].warm += 1;
    });

    let text = `📊 DASHBOARD GĐKD - CRM BĐS\nPhạm vi: ${getProjectLabel(normalizeProjectKey(scope) || 'all')}\n\n`;

    text += `1. TỔNG QUAN\n`;
    text += `- Tổng khách đọc được: ${customers.length}\n`;
    text += `- Khách nóng: ${hot.length}\n`;
    text += `- Khách ấm: ${warm.length}\n`;
    text += `- Khách nguội/cần lọc: ${cold.length}\n\n`;

    text += `2. THEO DỰ ÁN\n`;
    results.forEach(item => {
      const projectCustomers = evaluated.filter(kh => kh.project === item.project);
      const projectHot = projectCustomers.filter(kh => kh._score.level === 'NÓNG').length;
      const projectWarm = projectCustomers.filter(kh => kh._score.level === 'ẤM').length;
      text += `- ${item.projectLabel}: ${item.customers.length} khách | Nóng ${projectHot} | Ấm ${projectWarm}\n`;
    });

    text += `\n3. SALE/NGƯỜI CHĂM CẦN CHÚ Ý\n`;
    Object.entries(byOwner)
      .sort((a, b) => (b[1].hot + b[1].warm) - (a[1].hot + a[1].warm))
      .slice(0, 8)
      .forEach(([owner, stat]) => {
        text += `- ${owner}: ${stat.total} khách | Nóng ${stat.hot} | Ấm ${stat.warm}\n`;
      });

    text += `\n4. TOP KHÁCH CẦN XỬ LÝ TRONG 24H\n\n`;
    evaluated.slice(0, 8).forEach((kh, idx) => {
      text += buildCustomerLine(kh, idx + 1, true) + '\n';
    });

    try {
      const aiSummary = await createAiCareSummary(evaluated.slice(0, 12), 'dashboard');
      if (aiSummary) {
        text += `\n\n🧠 NHẬN ĐỊNH & VIỆC CẦN LÀM:\n${aiSummary}`;
      }
    } catch (aiErr) {
      safeLogError('Gemini tóm tắt /dashboard lỗi', aiErr);
    }

    return sendLongMessage(chatId, text);
  } catch (error) {
    safeLogError('Lỗi /dashboard', error);
    return safeSendMessage(chatId, '❌ Lỗi khi tạo dashboard: ' + (error.message || 'Không rõ lỗi'));
  }
});


bot.on('message', async (msg) => {
const chatId = msg.chat.id;
const rawText = msg.text;

if (!rawText) return;

if (
rawText === '/start' ||
rawText === '/clear' ||
rawText.startsWith('/crmtest') ||
rawText.startsWith('/dskh') ||
rawText.startsWith('/timkh') ||
rawText.startsWith('/quetcrm') ||
rawText.startsWith('/goikhach') ||
rawText.startsWith('/dashboard') ||
rawText === '/addkh' ||
rawText.startsWith('/addkh ')
) {
return;
}

// /duan có 2 nghĩa: nếu là mã CRM thì đã xử lý ở trên và không gửi sang AI.
if (rawText.startsWith('/duan')) {
  const maybeProjectText = rawText.replace('/duan', '').trim();
  const maybeProject = normalizeProjectKey(maybeProjectText);
  if (maybeProject && maybeProject !== 'all') return;
}

if (!conversations[chatId]) conversations[chatId] = [];

const { command, text } = getCommandAndText(rawText);

let activeCommand = command;

if (command !== 'normal' && COMMAND_PROMPTS[command]) {
conversationModes[chatId] = command;
activeCommand = command;
}

if (command === 'normal' && conversationModes[chatId]) {
activeCommand = conversationModes[chatId];
}

if (!text && command !== 'normal') {
await bot.sendMessage(chatId, getGuide(command));
return;
}

try {
await bot.sendChatAction(chatId, 'typing');
let instruction = SYSTEM_PROMPT;

if (COMMAND_PROMPTS[activeCommand]) {
  instruction += '\n\n' + COMMAND_PROMPTS[activeCommand];
}

conversations[chatId].push({
  role: 'user',
  parts: [{ text }]
});

await logChatToCRM(msg, 'user', text);

const response = await ai.models.generateContent({
  model: GEMINI_MODEL,
  contents: conversations[chatId],
  config: {
    systemInstruction: instruction,
    maxOutputTokens: 3000,
    temperature: 0.55
  }
});

const reply = response.text || 'Xin lỗi, tôi chưa có phản hồi phù hợp.';

conversations[chatId].push({
  role: 'model',
  parts: [{ text: reply }]
});

await logChatToCRM(msg, 'bot', reply);

if (conversations[chatId].length > MAX_HISTORY_ITEMS) {
  conversations[chatId] = conversations[chatId].slice(-MAX_HISTORY_ITEMS);
}

await sendLongMessage(chatId, reply);
} catch (err) {
safeLogError('Lỗi AI handler', err);
let errorText = '❌ Có lỗi xảy ra, thử lại nhé.';

const message = (err.message || '').toLowerCase();

if (message.includes('api key')) {
  errorText = '❌ Gemini API key đang sai hoặc chưa được kích hoạt.';
} else if (message.includes('quota')) {
  errorText = '❌ Gemini API đang hết quota hoặc bị giới hạn lượt dùng.';
} else if (message.includes('safety')) {
  errorText = '❌ Nội dung bị hệ thống AI chặn vì lý do an toàn.';
} else if (message.includes('409')) {
  errorText = '❌ Bot đang bị chạy trùng 2 nơi. Hãy tắt bản local nếu Railway đang chạy.';
}

await bot.sendMessage(chatId, errorText);
}
});

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
res.end('Bot Gemini BĐS đang chạy');
}).listen(PORT, () => {
console.log(`🌐 Health server đang chạy tại port ${PORT}`);
});

console.log('🤖 Bot Gemini BĐS đang chạy...');



