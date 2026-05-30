require('dotenv').config();

const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenAI } = require('@google/genai');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const conversations = {};

const KNOWLEDGE_PATH = path.join(__dirname, 'BOT_KNOWLEDGE.md');

let KNOWLEDGE_BASE = '';
try {
  KNOWLEDGE_BASE = fs.readFileSync(KNOWLEDGE_PATH, 'utf8');
  console.log('✅ Đã nạp BOT_KNOWLEDGE.md');
} catch (err) {
  console.warn('⚠️ Không tìm thấy BOT_KNOWLEDGE.md, bot sẽ chạy với system prompt cơ bản.');
}

const SYSTEM_PROMPT = `
Bạn là trợ lý AI riêng của Hoàng Cường trong lĩnh vực bất động sản.

Bạn không phải chatbot chung chung.
Bạn là trợ lý thực chiến cho một GĐKD/môi giới bất động sản.

Nguyên tắc bắt buộc:
- Luôn dùng tiếng Việt.
- Trả lời ngắn gọn, rõ ràng, thực tế.
- Ưu tiên câu trả lời có thể copy dùng ngay.
- Không bịa số liệu, giá bán, chính sách, pháp lý, hạ tầng, tiến độ.
- Nếu thiếu dữ liệu, phải nói rõ cần kiểm tra lại.
- Nếu thông tin là dự kiến, phải ghi rõ là dự kiến.
- Không cam kết lợi nhuận.
- Không tự chốt khách thay sale.
- Không làm lộ token, API key, dữ liệu nội bộ.
- Với nội dung gửi khách, văn phong phải tự nhiên như sale thật.

Dưới đây là bộ kiến thức, quy tắc, phong cách và framework làm việc của Hoàng Cường:

${KNOWLEDGE_BASE}
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
- Dùng để chạy Facebook Ads/Zalo Ads ra lead.
- Khách lướt 5-10 giây phải nắm được sản phẩm, giá/điểm mạnh, USP và cách liên hệ.
- Viết như sale thật đăng bài, không viết như AI, không viết như brochure dự án.

Tư duy trước khi viết:
- Content ads là mồi câu trong 2-5 giây đầu.
- Hook phải đánh vào thứ khách BĐS quan tâm nhất: giá sốc, tiền ban đầu thấp, dự án mới, căn hiếm, vị trí đẹp, chính chủ bán gấp, cắt lỗ, hàng ngoại giao, chính sách vay/chiết khấu, sổ lâu dài nếu là lợi thế, khả năng cho thuê/kinh doanh.
- AI phải tự chọn mồi câu mạnh nhất dựa trên dữ liệu người dùng đưa và BOT_KNOWLEDGE.
- Chỉ chọn cái mạnh nhất, không nhồi mọi thông tin vào bài.

CẤU TRÚC BẮT BUỘC:
1. Hook mạnh
2. Thông tin sản phẩm
3. USP mạnh nhất
4. CTA/liên hệ
5. Hashtag

QUY TẮC CỰC QUAN TRỌNG VỀ DỮ LIỆU:
- Không tự bịa diện tích, mặt tiền, pháp lý, bàn giao, chính sách, tiến độ.
- Không dùng chữ "dự kiến" nếu người dùng không cung cấp hoặc knowledge không có dữ liệu chắc.
- Không dùng placeholder kiểu [bổ sung], [Hotline], [Số điện thoại], [điền thêm].
- Nếu thiếu thông tin chi tiết thì BỎ DÒNG ĐÓ, không để trống.
- Nếu chỉ có ít dữ liệu, vẫn viết bài ngắn gọn từ dữ liệu có sẵn.
- Nếu dữ liệu quá thiếu để viết bài có thể chạy ads, hỏi lại tối đa 3 câu.

QUY TẮC ĐỊNH DẠNG:
- Plain text only.
- Không dùng Markdown.
- Không dùng dấu **.
- Không dùng bullet *.
- Các ý chính xuống dòng bằng dấu "-".
- Dùng emoji vừa phải: 💥 👉 🔸 =>
- Không viết đoạn văn dài.
- Không dùng từ sáo rỗng: cơ hội vàng, đẳng cấp, bứt phá, chuẩn mực sống, không gian sống lý tưởng, siêu phẩm nếu không có dữ liệu cụ thể.
- Không cam kết lợi nhuận.
- Không cam kết chắc chắn tăng giá.

FORMAT ƯU TIÊN:

💥 [HOOK MẠNH] 👉 [Sản phẩm] [điểm nổi bật]
=> [Mua đầu tư/cho thuê/ở/giữ tài sản] cực kỳ tốt

- [Thông tin sản phẩm quan trọng 1]
- [Thông tin sản phẩm quan trọng 2]
- [Thông tin sản phẩm quan trọng 3]
- [Thông tin sản phẩm quan trọng 4]

GIÁ TRỊ NỔI BẬT
- [USP mạnh 1]
- [USP mạnh 2]
- [USP mạnh 3]
- [USP mạnh 4]

CHÍNH SÁCH / ƯU ĐÃI
🔸 [Chính sách 1 nếu có dữ liệu]
🔸 [Chính sách 2 nếu có dữ liệu]
🔸 [Chính sách 3 nếu có dữ liệu]

=> Anh Chị quan tâm ib trực tiếp để nhận bảng hàng mới nhất, chính sách và phương án thanh toán từng căn.

#hashtag

QUY TẮC VỀ HOTLINE:
- Nếu người dùng cung cấp hotline thì dùng hotline đó.
- Nếu không có hotline thì chỉ ghi "ib trực tiếp" hoặc "Hotline/Zalo của Cường".
- Không tự bịa số điện thoại.

QUY TẮC VỀ CHÍNH SÁCH:
- Chỉ đưa chính sách nếu có dữ liệu trong yêu cầu hoặc trong BOT_KNOWLEDGE.
- Nếu không rõ chính sách, bỏ mục CHÍNH SÁCH / ƯU ĐÃI.
- Không ghi [bổ sung].

QUY TẮC VỀ SẢN PHẨM VIN CẦN GIỜ:
- Nếu người dùng chỉ đưa "biệt thự song lập biển Vin Cần Giờ, giá từ 110tr/m2", hãy viết bài ngắn, tập trung vào:
  + Giá từ 110tr/m2
  + Biệt thự song lập biển
  + Vinhomes Green Paradise Cần Giờ
  + Đô thị biển TP.HCM
  + Hệ sinh thái Vingroup
  + Phù hợp đầu tư dài hạn / nghỉ dưỡng / giữ tài sản
  + Inbox nhận bảng hàng và chính sách mới nhất
- Không tự thêm diện tích, mặt tiền, bàn giao, pháp lý nếu không chắc dữ liệu.

Nếu người dùng yêu cầu viết lại, vẫn chỉ trả ra bài content mới, không xin lỗi, không giải thích.
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

  duan: `
Chế độ /duan:
Tư vấn/thuyết minh dự án bất động sản.
Tập trung vào vị trí, sản phẩm, tiện ích, tiềm năng, tệp khách phù hợp.
Không bịa giá, pháp lý, chính sách.
Nếu hỏi giá/CSBH/bảng hàng, phải nhắc kiểm tra bản mới nhất.
`,

  dashboard: `
Chế độ /dashboard:
Tạo dashboard điều hành cho Cường theo format GĐKD.
Ưu tiên khách có khả năng giao dịch, khách bị bỏ quên, sale cần chỉ đạo, việc tạo doanh thu trong 24-48h.
Nếu chưa có dữ liệu CRM, hãy yêu cầu người dùng gửi dữ liệu.
`,

  goikhach: `
Chế độ /goikhach:
Chọn khách nên gọi/chăm trước theo xác suất tạo giao dịch.
Không chọn theo số lượng cuộc gọi.
Ưu tiên khách có tín hiệu: hỏi giá, hỏi chính sách, hỏi mặt bằng, có tài chính, có timeline, đã hẹn đi xem.
`,

  tinnhan: `
Chế độ /tinnhan:
Soạn tin nhắn Zalo/Facebook ngắn gọn, tự nhiên, không giống chatbot.
Không ép mua, không spam.
Tin nhắn nên có lý do liên hệ rõ ràng.
`,

  tuyendung: `
Chế độ /tuyendung:
Viết content tuyển dụng sale/TPKD/CVKD bất động sản.
Rõ cơ hội, rõ sản phẩm, rõ cơ chế, rõ người phù hợp, có CTA ứng tuyển.
`
};

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

  const commands = [
    'content',
    'khach',
    'duan',
    'dashboard',
    'goikhach',
    'tinnhan',
    'tuyendung'
  ];

  for (const cmd of commands) {
    if (trimmed.startsWith(`/${cmd}`)) {
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

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  conversations[chatId] = [];

  await bot.sendMessage(
    chatId,
    '👋 Xin chào! Tôi là trợ lý AI BĐS của Hoàng Cường.\n\n' +
    'Các lệnh có thể dùng:\n' +
    '/content - Viết content quảng cáo/content thương hiệu\n' +
    '/khach - Phân tích khách hàng\n' +
    '/duan - Tư vấn/thuyết minh dự án\n' +
    '/dashboard - Tạo dashboard GĐKD\n' +
    '/goikhach - Chọn khách nên gọi/chăm trước\n' +
    '/tinnhan - Soạn tin nhắn Zalo/Facebook\n' +
    '/tuyendung - Viết content tuyển dụng sale\n' +
    '/clear - Xóa lịch sử chat\n\n' +
    'Ví dụ:\n' +
    '/content Viết content ads biệt thự song lập biển Vin Cần Giờ, giá từ 110tr/m2\n\n' +
    '/khach Khách nam 42 tuổi, ngân sách 25 tỷ, quan tâm biệt thự biển, đang so sánh shophouse\n\n' +
    '/tinnhan Soạn tin nhắn chăm lại khách từng hỏi giá Vin Cần Giờ nhưng 10 ngày chưa phản hồi'
  );
});

bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id;
  conversations[chatId] = [];
  await bot.sendMessage(chatId, '✅ Đã xóa lịch sử chat.');
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const rawText = msg.text;

  if (!rawText) return;
  if (rawText === '/start' || rawText === '/clear') return;

  if (!process.env.TELEGRAM_TOKEN) {
    console.error('Thiếu TELEGRAM_TOKEN trong biến môi trường.');
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('Thiếu GEMINI_API_KEY trong biến môi trường.');
    await bot.sendMessage(chatId, '❌ Bot chưa có GEMINI_API_KEY.');
    return;
  }

  if (!conversations[chatId]) conversations[chatId] = [];

  const { command, text } = getCommandAndText(rawText);

  if (!text && command !== 'normal') {
    const guide = {
      content: 'Bạn gửi thêm thông tin cần viết content nhé.\nVí dụ:\n/content Viết content ads căn 3PN view nội khu, giá từ 8 tỷ',
      khach: 'Bạn gửi thêm thông tin khách hàng nhé.\nVí dụ:\n/khach Khách 35 tuổi, ngân sách 10 tỷ, muốn mua để ở gần trung tâm',
      duan: 'Bạn gửi thêm thông tin dự án nhé.\nVí dụ:\n/duan Tóm tắt Vin Cần Giờ cho khách đầu tư dài hạn',
      dashboard: 'Bạn gửi dữ liệu CRM hoặc nội dung cần phân tích nhé.\nVí dụ:\n/dashboard Đây là danh sách khách hôm nay...',
      goikhach: 'Bạn gửi danh sách khách/CRM để tôi chọn khách nên gọi trước nhé.',
      tinnhan: 'Bạn gửi bối cảnh khách hàng để tôi soạn tin nhắn nhé.',
      tuyendung: 'Bạn gửi vị trí cần tuyển, sản phẩm đang bán và cơ chế chính nhé.'
    };

    await bot.sendMessage(chatId, guide[command] || 'Bạn gửi thêm nội dung cần xử lý nhé.');
    return;
  }

  try {
    await bot.sendChatAction(chatId, 'typing');

    let instruction = SYSTEM_PROMPT;

    if (COMMAND_PROMPTS[command]) {
      instruction += '\n\n' + COMMAND_PROMPTS[command];
    }

    conversations[chatId].push({
      role: 'user',
      parts: [{ text }]
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: conversations[chatId],
      config: {
        systemInstruction: instruction,
        maxOutputTokens: 1800,
        temperature: 0.7
      }
    });

    const reply = response.text || 'Xin lỗi, tôi chưa có phản hồi phù hợp.';

    conversations[chatId].push({
      role: 'model',
      parts: [{ text: reply }]
    });

    if (conversations[chatId].length > 20) {
      conversations[chatId] = conversations[chatId].slice(-20);
    }

    await sendLongMessage(chatId, reply);

  } catch (err) {
    console.error('Lỗi:', err);

    let errorText = '❌ Có lỗi xảy ra, thử lại nhé.';

    const message = (err.message || '').toLowerCase();

    if (message.includes('api key')) {
      errorText = '❌ Gemini API key đang sai hoặc chưa được kích hoạt.';
    }

    if (message.includes('quota')) {
      errorText = '❌ Gemini API đang hết quota hoặc bị giới hạn lượt dùng.';
    }

    if (message.includes('safety')) {
      errorText = '❌ Nội dung bị hệ thống AI chặn vì lý do an toàn.';
    }

    await bot.sendMessage(chatId, errorText);
  }
});

console.log('🤖 Bot Gemini BĐS đang chạy...');