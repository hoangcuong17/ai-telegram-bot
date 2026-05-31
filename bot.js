require('dotenv').config();

const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenAI } = require('@google/genai');

if (!process.env.TELEGRAM_TOKEN) {
console.error('âŒ Thiáº¿u TELEGRAM_TOKEN trong biáº¿n mÃ´i trÆ°á»ng.');
process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
console.error('âŒ Thiáº¿u GEMINI_API_KEY trong biáº¿n mÃ´i trÆ°á»ng.');
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
console.warn('âš ï¸ ChÆ°a cÃ³ GOOGLE_SCRIPT_URL, bá» qua lÆ°u CRM.');
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
  console.error('âŒ Apps Script khÃ´ng tráº£ JSON:', text);
  return { ok: false, message: 'Apps Script khÃ´ng tráº£ JSON há»£p lá»‡' };
}
} catch (error) {
console.error('âŒ Lá»—i gá»­i dá»¯ liá»‡u sang Google Sheet:', error.message);
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
owner: customerData.owner || 'CÆ°á»ng',
careStatus: customerData.careStatus || '',
telegramId: from.id || '',
username: from.username || '',
});
}

function readMarkdownFile(fileName, required = false) {
const filePath = path.join(__dirname, fileName);

try {
const content = fs.readFileSync(filePath, 'utf8');
console.log(`âœ… ÄÃ£ náº¡p ${fileName}`);
return content;
} catch (err) {
if (required) {
console.error(`âŒ KhÃ´ng tÃ¬m tháº¥y ${fileName}:`, err.message);
} else {
console.warn(`âš ï¸ ChÆ°a cÃ³ ${fileName} hoáº·c lá»—i náº¡p file: ${err.message}`);
}
return '';
}
}

const KNOWLEDGE_BASE = readMarkdownFile('BOT_KNOWLEDGE.md', true);
const VIN_CAN_GIO_ADS_DATA = readMarkdownFile('VIN_CAN_GIO_ADS_DATA.md', false);

const SYSTEM_PROMPT = `
Báº¡n lÃ  trá»£ lÃ½ AI riÃªng cá»§a HoÃ ng CÆ°á»ng trong lÄ©nh vá»±c báº¥t Ä‘á»™ng sáº£n.

Báº¡n khÃ´ng pháº£i chatbot chung chung.
Báº¡n lÃ  trá»£ lÃ½ thá»±c chiáº¿n cho má»™t GÄKD/mÃ´i giá»›i báº¥t Ä‘á»™ng sáº£n.

NguyÃªn táº¯c báº¯t buá»™c:

* LuÃ´n dÃ¹ng tiáº¿ng Viá»‡t.
* Tráº£ lá»i ngáº¯n gá»n, rÃµ rÃ ng, thá»±c táº¿.
* Æ¯u tiÃªn cÃ¢u tráº£ lá»i cÃ³ thá»ƒ copy dÃ¹ng ngay.
* KhÃ´ng bá»‹a sá»‘ liá»‡u, giÃ¡ bÃ¡n, chÃ­nh sÃ¡ch, phÃ¡p lÃ½, háº¡ táº§ng, tiáº¿n Ä‘á»™.
* Náº¿u thiáº¿u dá»¯ liá»‡u, pháº£i nÃ³i rÃµ cáº§n kiá»ƒm tra láº¡i.
* Náº¿u thÃ´ng tin lÃ  dá»± kiáº¿n, pháº£i ghi rÃµ lÃ  dá»± kiáº¿n.
* KhÃ´ng cam káº¿t lá»£i nhuáº­n.
* KhÃ´ng tá»± chá»‘t khÃ¡ch thay sale.
* KhÃ´ng lÃ m lá»™ token, API key, dá»¯ liá»‡u ná»™i bá»™.
* Vá»›i ná»™i dung gá»­i khÃ¡ch, vÄƒn phong pháº£i tá»± nhiÃªn nhÆ° sale tháº­t.
* Náº¿u ngÆ°á»i dÃ¹ng yÃªu cáº§u viáº¿t láº¡i, hÃ£y viáº¿t láº¡i trá»±c tiáº¿p, khÃ´ng giáº£i thÃ­ch dÃ i dÃ²ng.

DÆ°á»›i Ä‘Ã¢y lÃ  bá»™ kiáº¿n thá»©c, quy táº¯c, phong cÃ¡ch vÃ  framework lÃ m viá»‡c cá»§a HoÃ ng CÆ°á»ng:

${KNOWLEDGE_BASE}

DÆ°á»›i Ä‘Ã¢y lÃ  dá»¯ liá»‡u sáº£n pháº©m/dá»± Ã¡n dÃ¹ng riÃªng cho viá»‡c viáº¿t content ads.
Náº¿u dá»¯ liá»‡u nÃ y trá»‘ng hoáº·c thiáº¿u, tuyá»‡t Ä‘á»‘i khÃ´ng tá»± bá»‹a thÃ´ng tin:

${VIN_CAN_GIO_ADS_DATA}
`;

const COMMAND_PROMPTS = {
content: `
Cháº¿ Ä‘á»™ /content:
Viáº¿t content ads báº¥t Ä‘á»™ng sáº£n theo Ä‘Ãºng style cháº¡y quáº£ng cÃ¡o thá»±c chiáº¿n cá»§a CÆ°á»ng.

QUY Táº®C Sá» 1:
Chá»‰ tráº£ ra BÃ€I CONTENT CUá»I CÃ™NG.
KhÃ´ng giáº£i thÃ­ch.
KhÃ´ng xin lá»—i.
KhÃ´ng nÃ³i "Ä‘Ã£ hiá»ƒu".
KhÃ´ng nÃ³i "mÃ¬nh sáº½ viáº¿t láº¡i".
KhÃ´ng thÃªm pháº§n phÃ¢n tÃ­ch trÆ°á»›c bÃ i.
KhÃ´ng thÃªm "---".
KhÃ´ng thÃªm "LÆ°u Ã½ ná»™i bá»™" trá»« khi ngÆ°á»i dÃ¹ng yÃªu cáº§u.

Má»¥c tiÃªu:

* DÃ¹ng Ä‘á»ƒ cháº¡y Facebook Ads/Zalo Ads ra lead.
* KhÃ¡ch lÆ°á»›t 5-10 giÃ¢y pháº£i náº¯m Ä‘Æ°á»£c sáº£n pháº©m, giÃ¡/Ä‘iá»ƒm máº¡nh, USP vÃ  cÃ¡ch liÃªn há»‡.
* Viáº¿t nhÆ° sale tháº­t Ä‘Äƒng bÃ i, khÃ´ng viáº¿t nhÆ° AI, khÃ´ng viáº¿t nhÆ° brochure dá»± Ã¡n.

TÆ° duy trÆ°á»›c khi viáº¿t:

* Content ads lÃ  má»“i cÃ¢u trong 2-5 giÃ¢y Ä‘áº§u.
* Hook pháº£i Ä‘Ã¡nh vÃ o thá»© khÃ¡ch BÄS quan tÃ¢m nháº¥t: giÃ¡ sá»‘c, tiá»n ban Ä‘áº§u tháº¥p, dá»± Ã¡n má»›i, cÄƒn hiáº¿m, vá»‹ trÃ­ Ä‘áº¹p, chÃ­nh chá»§ bÃ¡n gáº¥p, cáº¯t lá»—, hÃ ng ngoáº¡i giao, chÃ­nh sÃ¡ch vay/chiáº¿t kháº¥u, sá»• lÃ¢u dÃ i náº¿u lÃ  lá»£i tháº¿, kháº£ nÄƒng cho thuÃª/kinh doanh.
* AI pháº£i tá»± chá»n má»“i cÃ¢u máº¡nh nháº¥t dá»±a trÃªn dá»¯ liá»‡u ngÆ°á»i dÃ¹ng Ä‘Æ°a, BOT_KNOWLEDGE vÃ  VIN_CAN_GIO_ADS_DATA.
* Chá»‰ chá»n cÃ¡i máº¡nh nháº¥t, khÃ´ng nhá»“i má»i thÃ´ng tin vÃ o bÃ i.

Cáº¤U TRÃšC Báº®T BUá»˜C:

1. Hook máº¡nh
2. ThÃ´ng tin sáº£n pháº©m
3. USP máº¡nh nháº¥t
4. CTA/liÃªn há»‡
5. Hashtag

QUY Táº®C Cá»°C QUAN TRá»ŒNG Vá»€ Dá»® LIá»†U:

* KhÃ´ng tá»± bá»‹a diá»‡n tÃ­ch, máº·t tiá»n, phÃ¡p lÃ½, bÃ n giao, chÃ­nh sÃ¡ch, tiáº¿n Ä‘á»™.
* KhÃ´ng dÃ¹ng chá»¯ "dá»± kiáº¿n" náº¿u ngÆ°á»i dÃ¹ng khÃ´ng cung cáº¥p hoáº·c knowledge khÃ´ng cÃ³ dá»¯ liá»‡u cháº¯c.
* KhÃ´ng dÃ¹ng placeholder kiá»ƒu [bá»• sung], [Hotline], [Sá»‘ Ä‘iá»‡n thoáº¡i], [Ä‘iá»n thÃªm].
* Náº¿u thiáº¿u thÃ´ng tin chi tiáº¿t thÃ¬ Bá»Ž DÃ’NG ÄÃ“, khÃ´ng Ä‘á»ƒ trá»‘ng.
* Náº¿u chá»‰ cÃ³ Ã­t dá»¯ liá»‡u, váº«n viáº¿t bÃ i ngáº¯n gá»n tá»« dá»¯ liá»‡u cÃ³ sáºµn.
* Náº¿u dá»¯ liá»‡u quÃ¡ thiáº¿u Ä‘á»ƒ viáº¿t bÃ i cÃ³ thá»ƒ cháº¡y ads, há»i láº¡i tá»‘i Ä‘a 3 cÃ¢u.
* Náº¿u ngÆ°á»i dÃ¹ng yÃªu cáº§u viáº¿t láº¡i, váº«n dÃ¹ng mode /content hiá»‡n táº¡i Ä‘á»ƒ viáº¿t láº¡i bÃ i content má»›i.

QUY Táº®C Äá»ŠNH Dáº NG:

* Plain text only.
* KhÃ´ng dÃ¹ng Markdown.
* KhÃ´ng dÃ¹ng dáº¥u **.
* KhÃ´ng dÃ¹ng bullet *.
* CÃ¡c Ã½ chÃ­nh xuá»‘ng dÃ²ng báº±ng dáº¥u "-".
* DÃ¹ng emoji vá»«a pháº£i: ðŸ’¥ ðŸ‘‰ ðŸ”¸ =>
* KhÃ´ng viáº¿t Ä‘oáº¡n vÄƒn dÃ i.
* KhÃ´ng dÃ¹ng tá»« sÃ¡o rá»—ng: cÆ¡ há»™i vÃ ng, Ä‘áº³ng cáº¥p, bá»©t phÃ¡, chuáº©n má»±c sá»‘ng, khÃ´ng gian sá»‘ng lÃ½ tÆ°á»Ÿng, siÃªu pháº©m náº¿u khÃ´ng cÃ³ dá»¯ liá»‡u cá»¥ thá»ƒ.
* KhÃ´ng cam káº¿t lá»£i nhuáº­n.
* KhÃ´ng cam káº¿t cháº¯c cháº¯n tÄƒng giÃ¡.

FORMAT Æ¯U TIÃŠN:

ðŸ’¥ [HOOK Máº NH] ðŸ‘‰ [Sáº£n pháº©m] [Ä‘iá»ƒm ná»•i báº­t]
=> [Mua Ä‘áº§u tÆ°/cho thuÃª/á»Ÿ/giá»¯ tÃ i sáº£n] cá»±c ká»³ tá»‘t

* [ThÃ´ng tin sáº£n pháº©m quan trá»ng 1]
* [ThÃ´ng tin sáº£n pháº©m quan trá»ng 2]
* [ThÃ´ng tin sáº£n pháº©m quan trá»ng 3]
* [ThÃ´ng tin sáº£n pháº©m quan trá»ng 4]

GIÃ TRá»Š Ná»”I Báº¬T

* [USP máº¡nh 1]
* [USP máº¡nh 2]
* [USP máº¡nh 3]
* [USP máº¡nh 4]

CHÃNH SÃCH / Æ¯U ÄÃƒI
ðŸ”¸ [ChÃ­nh sÃ¡ch 1 náº¿u cÃ³ dá»¯ liá»‡u]
ðŸ”¸ [ChÃ­nh sÃ¡ch 2 náº¿u cÃ³ dá»¯ liá»‡u]
ðŸ”¸ [ChÃ­nh sÃ¡ch 3 náº¿u cÃ³ dá»¯ liá»‡u]

=> Anh Chá»‹ quan tÃ¢m ib trá»±c tiáº¿p Ä‘á»ƒ nháº­n báº£ng hÃ ng má»›i nháº¥t, chÃ­nh sÃ¡ch vÃ  phÆ°Æ¡ng Ã¡n thanh toÃ¡n tá»«ng cÄƒn.

#hashtag

QUY Táº®C Vá»€ HOTLINE:

* Náº¿u ngÆ°á»i dÃ¹ng cung cáº¥p hotline thÃ¬ dÃ¹ng hotline Ä‘Ã³.
* Náº¿u khÃ´ng cÃ³ hotline thÃ¬ chá»‰ ghi "ib trá»±c tiáº¿p" hoáº·c "Hotline/Zalo cá»§a CÆ°á»ng".
* KhÃ´ng tá»± bá»‹a sá»‘ Ä‘iá»‡n thoáº¡i.

QUY Táº®C Vá»€ CHÃNH SÃCH:

* Chá»‰ Ä‘Æ°a chÃ­nh sÃ¡ch náº¿u cÃ³ dá»¯ liá»‡u trong yÃªu cáº§u, BOT_KNOWLEDGE hoáº·c VIN_CAN_GIO_ADS_DATA.
* Náº¿u khÃ´ng rÃµ chÃ­nh sÃ¡ch, bá» má»¥c CHÃNH SÃCH / Æ¯U ÄÃƒI.
* KhÃ´ng ghi [bá»• sung].

QUY Táº®C Vá»€ Sáº¢N PHáº¨M VIN Cáº¦N GIá»œ:

* Náº¿u ngÆ°á»i dÃ¹ng chá»‰ Ä‘Æ°a "biá»‡t thá»± song láº­p biá»ƒn Vin Cáº§n Giá», giÃ¡ tá»« 110tr/m2", hÃ£y viáº¿t bÃ i ngáº¯n, táº­p trung vÃ o:

  * GiÃ¡ tá»« 110tr/m2
  * Biá»‡t thá»± song láº­p biá»ƒn
  * Vinhomes Green Paradise Cáº§n Giá»
  * ÄÃ´ thá»‹ biá»ƒn TP.HCM
  * Há»‡ sinh thÃ¡i Vingroup
  * PhÃ¹ há»£p Ä‘áº§u tÆ° dÃ i háº¡n / nghá»‰ dÆ°á»¡ng / giá»¯ tÃ i sáº£n
  * Inbox nháº­n báº£ng hÃ ng vÃ  chÃ­nh sÃ¡ch má»›i nháº¥t
* KhÃ´ng tá»± thÃªm diá»‡n tÃ­ch, máº·t tiá»n, bÃ n giao, phÃ¡p lÃ½ náº¿u khÃ´ng cháº¯c dá»¯ liá»‡u.
  `,

  khach: `
  Cháº¿ Ä‘á»™ /khach:
  PhÃ¢n tÃ­ch khÃ¡ch hÃ ng theo tÆ° duy GÄKD.
  Tráº£ lá»i theo cáº¥u trÃºc:

1. Nháº­n Ä‘á»‹nh nhanh
2. Má»©c Ä‘á»™ nÃ³ng/áº¥m/nguá»™i
3. Nhu cáº§u tháº­t sá»± cÃ³ thá»ƒ cÃ³
4. Äiá»ƒm cáº§n khai thÃ¡c thÃªm
5. Rá»§i ro máº¥t khÃ¡ch
6. CÃ¡ch tÆ° váº¥n phÃ¹ há»£p
7. Tin nháº¯n Zalo gá»£i Ã½
8. Viá»‡c nÃªn lÃ m tiáº¿p theo
   `,

duan: `Cháº¿ Ä‘á»™ /duan:
TÆ° váº¥n/thuyáº¿t minh dá»± Ã¡n báº¥t Ä‘á»™ng sáº£n.
Táº­p trung vÃ o vá»‹ trÃ­, sáº£n pháº©m, tiá»‡n Ã­ch, tiá»m nÄƒng, tá»‡p khÃ¡ch phÃ¹ há»£p.
KhÃ´ng bá»‹a giÃ¡, phÃ¡p lÃ½, chÃ­nh sÃ¡ch.
Náº¿u há»i giÃ¡/CSBH/báº£ng hÃ ng, pháº£i nháº¯c kiá»ƒm tra báº£n má»›i nháº¥t.`,

dashboard: `Cháº¿ Ä‘á»™ /dashboard:
Táº¡o dashboard Ä‘iá»u hÃ nh cho CÆ°á»ng theo format GÄKD.
Æ¯u tiÃªn khÃ¡ch cÃ³ kháº£ nÄƒng giao dá»‹ch, khÃ¡ch bá»‹ bá» quÃªn, sale cáº§n chá»‰ Ä‘áº¡o, viá»‡c táº¡o doanh thu trong 24-48h.
Náº¿u chÆ°a cÃ³ dá»¯ liá»‡u CRM, hÃ£y yÃªu cáº§u ngÆ°á»i dÃ¹ng gá»­i dá»¯ liá»‡u.`,

goikhach: `Cháº¿ Ä‘á»™ /goikhach:
Chá»n khÃ¡ch nÃªn gá»i/chÄƒm trÆ°á»›c theo xÃ¡c suáº¥t táº¡o giao dá»‹ch.
KhÃ´ng chá»n theo sá»‘ lÆ°á»£ng cuá»™c gá»i.
Æ¯u tiÃªn khÃ¡ch cÃ³ tÃ­n hiá»‡u: há»i giÃ¡, há»i chÃ­nh sÃ¡ch, há»i máº·t báº±ng, cÃ³ tÃ i chÃ­nh, cÃ³ timeline, Ä‘Ã£ háº¹n Ä‘i xem.`,

tinnhan: `Cháº¿ Ä‘á»™ /tinnhan:
Soáº¡n tin nháº¯n Zalo/Facebook ngáº¯n gá»n, tá»± nhiÃªn, khÃ´ng giá»‘ng chatbot.
KhÃ´ng Ã©p mua, khÃ´ng spam.
Tin nháº¯n nÃªn cÃ³ lÃ½ do liÃªn há»‡ rÃµ rÃ ng.`,

tuyendung: `Cháº¿ Ä‘á»™ /tuyendung:
Viáº¿t content tuyá»ƒn dá»¥ng sale/TPKD/CVKD báº¥t Ä‘á»™ng sáº£n.
RÃµ cÆ¡ há»™i, rÃµ sáº£n pháº©m, rÃµ cÆ¡ cháº¿, rÃµ ngÆ°á»i phÃ¹ há»£p, cÃ³ CTA á»©ng tuyá»ƒn.`
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
'Báº¡n gá»­i thÃªm thÃ´ng tin cáº§n viáº¿t content nhÃ©.\nVÃ­ dá»¥:\n/content Viáº¿t content ads biá»‡t thá»± song láº­p biá»ƒn Vin Cáº§n Giá», giÃ¡ tá»« 110tr/m2, CTA inbox nháº­n báº£ng hÃ ng vÃ  CSBH má»›i nháº¥t',
khach:
  'Báº¡n gá»­i thÃªm thÃ´ng tin khÃ¡ch hÃ ng nhÃ©.\nVÃ­ dá»¥:\n/khach KhÃ¡ch nam 42 tuá»•i, ngÃ¢n sÃ¡ch 25 tá»·, quan tÃ¢m biá»‡t thá»± biá»ƒn, Ä‘ang so sÃ¡nh shophouse',

duan:
  'Báº¡n gá»­i thÃªm thÃ´ng tin dá»± Ã¡n nhÃ©.\nVÃ­ dá»¥:\n/duan TÃ³m táº¯t Vin Cáº§n Giá» cho khÃ¡ch Ä‘áº§u tÆ° dÃ i háº¡n',

dashboard:
  'Báº¡n gá»­i dá»¯ liá»‡u CRM hoáº·c ná»™i dung cáº§n phÃ¢n tÃ­ch nhÃ©.\nVÃ­ dá»¥:\n/dashboard ÄÃ¢y lÃ  danh sÃ¡ch khÃ¡ch hÃ´m nay...',

goikhach:
  'Báº¡n gá»­i danh sÃ¡ch khÃ¡ch/CRM Ä‘á»ƒ tÃ´i chá»n khÃ¡ch nÃªn gá»i trÆ°á»›c nhÃ©.',

tinnhan:
  'Báº¡n gá»­i bá»‘i cáº£nh khÃ¡ch hÃ ng Ä‘á»ƒ tÃ´i soáº¡n tin nháº¯n nhÃ©.\nVÃ­ dá»¥:\n/tinnhan KhÃ¡ch tá»«ng há»i giÃ¡ Vin Cáº§n Giá» nhÆ°ng 10 ngÃ y chÆ°a pháº£n há»“i',

tuyendung:
  'Báº¡n gá»­i vá»‹ trÃ­ cáº§n tuyá»ƒn, sáº£n pháº©m Ä‘ang bÃ¡n vÃ  cÆ¡ cháº¿ chÃ­nh nhÃ©.'
};

return guide[command] || 'Báº¡n gá»­i thÃªm ná»™i dung cáº§n xá»­ lÃ½ nhÃ©.';
}

function buildStartMessage() {
return (
'ðŸ‘‹ Xin chÃ o! TÃ´i lÃ  trá»£ lÃ½ AI BÄS cá»§a HoÃ ng CÆ°á»ng.\n\n' +
'CÃ¡c lá»‡nh cÃ³ thá»ƒ dÃ¹ng:\n' +
'/content - Viáº¿t content quáº£ng cÃ¡o/content thÆ°Æ¡ng hiá»‡u\n' +
'/khach - PhÃ¢n tÃ­ch khÃ¡ch hÃ ng\n' +
'/duan - TÆ° váº¥n/thuyáº¿t minh dá»± Ã¡n\n' +
'/dashboard - Táº¡o dashboard GÄKD\n' +
'/goikhach - Chá»n khÃ¡ch nÃªn gá»i/chÄƒm trÆ°á»›c\n' +
'/tinnhan - Soáº¡n tin nháº¯n Zalo/Facebook\n' +
'/tuyendung - Viáº¿t content tuyá»ƒn dá»¥ng sale\n' +
'/addkh - ThÃªm khÃ¡ch hÃ ng vÃ o Google Sheet CRM\n' +
'/crmtest - Kiá»ƒm tra káº¿t ná»‘i Google Sheet CRM\n' +
'/clear - XÃ³a lá»‹ch sá»­ chat vÃ  cháº¿ Ä‘á»™ Ä‘ang dÃ¹ng\n\n' +
'Máº«u thÃªm khÃ¡ch Ä‘Ãºng form CRM:\n' +
'/addkh Há» tÃªn | SÄT | Nguá»“n | NgÃ y ra | NgÆ°á»i chÄƒm | TÃ¬nh tráº¡ng chÄƒm sÃ³c\n\n' +
'VÃ­ dá»¥:\n' +
'/addkh Nguyá»…n VÄƒn A | 0988123456 | Facebook Ads | 31/05/2026 | CÆ°á»ng | KhÃ¡ch há»i Vin Cáº§n Giá», tÃ i chÃ­nh 20 tá»·\n\n' +
'/content Viáº¿t content ads biá»‡t thá»± song láº­p biá»ƒn Vin Cáº§n Giá», giÃ¡ tá»« 110tr/m2'
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

await bot.sendMessage(chatId, 'âœ… ÄÃ£ xÃ³a lá»‹ch sá»­ chat vÃ  cháº¿ Ä‘á»™ Ä‘ang dÃ¹ng.');
});

bot.onText(/\/crmtest/, async (msg) => {
const chatId = msg.chat.id;

const result = await sendToCRM({
action: 'log_chat',
chatId,
telegramId: msg.from?.id || '',
username: msg.from?.username || '',
role: 'system',
content: 'Test káº¿t ná»‘i CRM tá»« Telegram bot',
});

if (result.ok) {
await bot.sendMessage(chatId, 'âœ… Káº¿t ná»‘i Google Sheet CRM thÃ nh cÃ´ng.');
} else {
await bot.sendMessage(chatId, `âŒ Káº¿t ná»‘i CRM lá»—i: ${result.message}`);
}
});

bot.onText(/\/addkh$/, async (msg) => {
const chatId = msg.chat.id;

await bot.sendMessage(
chatId,
'Sai cÃº phÃ¡p.\nDÃ¹ng máº«u:\n/addkh Há» tÃªn | SÄT | Nguá»“n | NgÃ y ra | NgÆ°á»i chÄƒm | TÃ¬nh tráº¡ng chÄƒm sÃ³c\n\nVÃ­ dá»¥:\n/addkh Nguyá»…n VÄƒn A | 0988123456 | Facebook Ads | 31/05/2026 | CÆ°á»ng | KhÃ¡ch há»i Vin Cáº§n Giá», tÃ i chÃ­nh 20 tá»·'
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
const owner = parts[4] || 'CÆ°á»ng';
const careStatus = parts[5] || '';

if (!name || !phone) {
await bot.sendMessage(
chatId,
'Sai cÃº phÃ¡p.\nDÃ¹ng máº«u:\n/addkh Há» tÃªn | SÄT | Nguá»“n | NgÃ y ra | NgÆ°á»i chÄƒm | TÃ¬nh tráº¡ng chÄƒm sÃ³c'
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
await bot.sendMessage(chatId, `âœ… ÄÃ£ lÆ°u khÃ¡ch vÃ o CRM: ${name} - ${phone}`);
} else {
await bot.sendMessage(chatId, `âŒ LÆ°u khÃ¡ch hÃ ng lá»—i: ${result.message}`);
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

const reply = response.text || 'Xin lá»—i, tÃ´i chÆ°a cÃ³ pháº£n há»“i phÃ¹ há»£p.';

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
console.error('Lá»—i:', err);
let errorText = 'âŒ CÃ³ lá»—i xáº£y ra, thá»­ láº¡i nhÃ©.';

const message = (err.message || '').toLowerCase();

if (message.includes('api key')) {
  errorText = 'âŒ Gemini API key Ä‘ang sai hoáº·c chÆ°a Ä‘Æ°á»£c kÃ­ch hoáº¡t.';
} else if (message.includes('quota')) {
  errorText = 'âŒ Gemini API Ä‘ang háº¿t quota hoáº·c bá»‹ giá»›i háº¡n lÆ°á»£t dÃ¹ng.';
} else if (message.includes('safety')) {
  errorText = 'âŒ Ná»™i dung bá»‹ há»‡ thá»‘ng AI cháº·n vÃ¬ lÃ½ do an toÃ n.';
} else if (message.includes('409')) {
  errorText = 'âŒ Bot Ä‘ang bá»‹ cháº¡y trÃ¹ng 2 nÆ¡i. HÃ£y táº¯t báº£n local náº¿u Railway Ä‘ang cháº¡y.';
}

await bot.sendMessage(chatId, errorText);
}
});

console.log('ðŸ¤– Bot Gemini BÄS Ä‘ang cháº¡y...');

