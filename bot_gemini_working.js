require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenAI } = require('@google/genai');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const conversations = {};

const SYSTEM_PROMPT = `
Bạn là trợ lý AI cho GĐKD Bất động sản Hoàng Cường.
Trả lời ngắn gọn, rõ ràng, thân thiện.
Luôn dùng tiếng Việt.
Nếu người dùng hỏi về bất động sản, hãy trả lời theo hướng thực tế, dễ hiểu, hỗ trợ tư vấn khách hàng.
`;

function splitMessage(text, maxLength = 3900) {
  const chunks = [];
  let current = text;

  while (current.length > maxLength) {
    let splitIndex = current.lastIndexOf('\n', maxLength);
    if (splitIndex === -1) splitIndex = maxLength;

    chunks.push(current.slice(0, splitIndex));
    current = current.slice(splitIndex).trim();
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  conversations[chatId] = [];

  bot.sendMessage(
    chatId,
    '👋 Xin chào! Tôi là trợ lý AI của Hoàng Cường.\n' +
    'Gửi câu hỏi, tôi sẽ hỗ trợ ngay.\n\n' +
    '/clear - Xóa lịch sử chat'
  );
});

bot.onText(/\/clear/, (msg) => {
  const chatId = msg.chat.id;
  conversations[chatId] = [];

  bot.sendMessage(chatId, '✅ Đã xóa lịch sử.');
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  if (!process.env.TELEGRAM_TOKEN) {
    console.error('Thiếu TELEGRAM_TOKEN trong file .env');
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('Thiếu GEMINI_API_KEY trong file .env');
    bot.sendMessage(chatId, '❌ Bot chưa có GEMINI_API_KEY trong file .env.');
    return;
  }

  if (!conversations[chatId]) conversations[chatId] = [];

  try {
    await bot.sendChatAction(chatId, 'typing');

    conversations[chatId].push({
      role: 'user',
      parts: [{ text }],
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: conversations[chatId],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 1024,
      },
    });

    const reply = response.text || 'Xin lỗi, tôi chưa có phản hồi phù hợp.';

    conversations[chatId].push({
      role: 'model',
      parts: [{ text: reply }],
    });

    if (conversations[chatId].length > 20) {
      conversations[chatId] = conversations[chatId].slice(-20);
    }

    const chunks = splitMessage(reply);
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk);
    }

  } catch (err) {
    console.error('Lỗi:', err);

    let errorText = '❌ Có lỗi xảy ra, thử lại nhé.';

    if (err.message && err.message.includes('API key')) {
      errorText = '❌ Gemini API key đang sai hoặc chưa được kích hoạt.';
    }

    if (err.message && err.message.includes('quota')) {
      errorText = '❌ Gemini API đang hết quota hoặc bị giới hạn lượt dùng.';
    }

    bot.sendMessage(chatId, errorText);
  }
});

console.log('🤖 Bot Gemini đang chạy...');