// api/telegram.js — Telegram webhook (лички и группы) + выдача URL игры

const TG = {
  token: process.env.BOT_TOKEN,
  api: `https://api.telegram.org/bot${process.env.BOT_TOKEN}`
};

// ОБЯЗАТЕЛЬНО заданы переменные окружения:
// BOT_TOKEN        — токен бота
// GAME_SHORT_NAME  — ladderslava
// GAME_URL_BASE    — https-домен игры (без слеша в конце), напр. https://ladders-lava.vercel.app
// BOT_BASE         — https-домен ЭТОГО проекта (без слеша), напр. https://ladderslava-bot.vercel.app

async function tg(method, payload) {
  const res = await fetch(`${TG.api}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.ok) console.error('TG API error:', method, data);
  return data;
}

function gameUrl(params = {}) {
  const base = process.env.GAME_URL_BASE; // домен игры
  const apiBase = process.env.BOT_BASE;   // домен бота (для отправки очков)
  const q = new URLSearchParams({
    v: String(Date.now()),
    api: apiBase || '',
    ...params
  });
  // твой фронт слушает index.html
  return `${base}/index.html?${q.toString()}`;
}

// --- helper: корректно парсим /play и /play@ladderslava_bot ---
function getCommand(text) {
  const m = String(text || '').trim().match(/^\/([a-zA-Z0-9_]+)(?:@[\w_]+)?(?:\s+.*)?$/);
  return m ? m[1].toLowerCase() : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true, hello: 'Use POST for Telegram webhook' });
    return;
  }

  try {
    const update = req.body || {};

    // 1) /start и /play из ЛЮБОГО чата (private/group/supergroup)
    if (update.message && typeof update.message.text === 'string') {
      const chatId = update.message.chat.id;
      const cmd = getCommand(update.message.text);

      if (cmd === 'start' || cmd === 'play') {
        // отправляем карточку игры с кнопкой "Play" (так стабильнее в группах)
        await tg('sendGame', {
          chat_id: chatId,
          game_short_name: process.env.GAME_SHORT_NAME,
          reply_markup: {
            inline_keyboard: [[{ text: 'Play ladderslava', callback_game: {} }]]
          }
        });
        return res.status(200).json({ ok: true });
      }
    }

    // 2) Нажатие кнопки "Play ladderslava" под карточкой игры
    if (update.callback_query && update.callback_query.game_short_name) {
      const cq = update.callback_query;
      const userId = cq.from.id;
      const chatId = cq.message?.chat?.id;
      const messageId = cq.message?.message_id;

      const url = gameUrl({
        uid: String(userId),
        chat: chatId ? String(chatId) : '',
        msg: messageId ? String(messageId) : ''
      });

      await tg('answerCallbackQuery', {
        callback_query_id: cq.id,
        url
      });

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Webhook error:', e);
    return res.status(200).json({ ok: true });
  }
}
