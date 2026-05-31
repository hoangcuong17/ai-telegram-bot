require('dotenv').config();

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

async function sendLongMessage(chatId, text) {
const chunks = splitMessage(text);

for (const chunk of chunks) {
await bot.sendMessage(chatId, chunk);
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
return (
'👋 Xin chào! Tôi là trợ lý AI BĐS của Hoàng Cường.\n\n' +
'Các lệnh có thể dùng:\n' +
'/content - Viết content quảng cáo/content thương hiệu\n' +
'/khach - Phân tích khách hàng\n' +
'/duan - Tư vấn/thuyết minh dự án\n' +
'/dashboard - Tạo dashboard GĐKD\n' +
'/goikhach - Chọn khách nên gọi/chăm trước\n' +
'/tinnhan - Soạn tin nhắn Zalo/Facebook\n' +
'/tuyendung - Viết content tuyển dụng sale\n' +
'/addkh - Thêm khách hàng vào Google Sheet CRM\n' +
'/crmtest - Kiểm tra kết nối Google Sheet CRM\n' +
'/clear - Xóa lịch sử chat và chế độ đang dùng\n\n' +
'Mẫu thêm khách đúng form CRM:\n' +
'/addkh Họ tên | SĐT | Nguồn | Ngày ra | Người chăm | Tình trạng chăm sóc\n\n' +
'Ví dụ:\n' +
'/addkh Nguyễn Văn A | 0988123456 | Facebook Ads | 31/05/2026 | Cường | Khách hỏi Vin Cần Giờ, tài chính 20 tỷ\n\n' +
'/content Viết content ads biệt thự song lập biển Vin Cần Giờ, giá từ 110tr/m2'
);
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

bot.onText(/\/crmtest/, async (msg) => {
const chatId = msg.chat.id;

const result = await sendToCRM({
action: 'log_chat',
chatId,
telegramId: msg.from?.id || '',
username: msg.from?.username || '',
role: 'system',
content: 'Test kết nối CRM từ Telegram bot',
});

if (result.ok) {
await bot.sendMessage(chatId, '✅ Kết nối Google Sheet CRM thành công.');
} else {
await bot.sendMessage(chatId, `❌ Kết nối CRM lỗi: ${result.message}`);
}
});

bot.onText(/\/addkh$/, async (msg) => {
const chatId = msg.chat.id;

await bot.sendMessage(
chatId,
'Sai cú pháp.\nDùng mẫu:\n/addkh Họ tên | SĐT | Nguồn | Ngày ra | Người chăm | Tình trạng chăm sóc\n\nVí dụ:\n/addkh Nguyễn Văn A | 0988123456 | Facebook Ads | 31/05/2026 | Cường | Khách hỏi Vin Cần Giờ, tài chính 20 tỷ'
);
});

bot.onText(/\/addkh (.+)/, async (msg, match) => {
const chatId = msg.chat.id;
const input = match[1];

const parts = input.split('|').map(item => item.trim());

const name = parts[0] || '';
const phone = parts[1] || '';
const source = parts[2] || 'Telegram';
const dateOut = parts[3] || new Date().toLocaleDateString('vi-VN');
const owner = parts[4] || 'Cường';
const careStatus = parts[5] || '';

if (!name || !phone) {
await bot.sendMessage(
chatId,
'Sai cú pháp.\nDùng mẫu:\n/addkh Họ tên | SĐT | Nguồn | Ngày ra | Người chăm | Tình trạng chăm sóc'
);
return;
}

const result = await addCustomerToCRM(msg, {
name,
phone,
source,
dateOut,
owner,
careStatus,
});

if (result.ok) {
await bot.sendMessage(chatId, `✅ Đã lưu khách vào CRM: ${name} - ${phone}`);
} else {
await bot.sendMessage(chatId, `❌ Lưu khách hàng lỗi: ${result.message}`);
}
});

bot.on('message', async (msg) => {
const chatId = msg.chat.id;
const rawText = msg.text;

if (!rawText) return;

if (
rawText === '/start' ||
rawText === '/clear' ||
rawText === '/crmtest' ||
rawText === '/addkh' ||
rawText.startsWith('/addkh ')
) {
return;
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
console.error('Lỗi:', err);
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

console.log('🤖 Bot Gemini BĐS đang chạy...');


