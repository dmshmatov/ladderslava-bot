// Минимальный вебхук для Telegram Game
// Обрабатывает: /start, /play -> sendGame
// И callback_query на кнопку "Играть" -> открывает твою игру по URL

const TG = {
  token: process.env.BOT_TOKEN,
  api: `https://api.telegram.org/bot${process.env.BOT_TOKEN}`
};

// ОБЯЗАТЕЛЬНО задай в переменных окружения:
// BOT_TOKEN        — токен бота от BotFather
// GAME_SHORT_NAME  — ladderslava
// GAME_URL_BASE    — твой https-домен игры на Vercel, например: https://yourgame.vercel.app

async function tg(method, payload) {
  const res = await fetch(`${TG.api}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.ok) {
    console.error('TG API error:', method, data);
  }
  return data;
}

function gameUrl(params = {}) {
  const base = process.env.GAME_URL_BASE; // например: https://ladderslava.vercel.app
  const q = new URLSearchParams({
    v: String(Date.now()),
    ...params
  });
  return `${base}/index.html?${q.toString()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true, hello: 'Use POST for Telegram webhook' });
    return;
  }

  try {
    const update = req.body;

    // 1) Команды /start и /play -> отправляем игру
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (text === '/start' || text === '/play') {
        await tg('sendGame', {
          chat_id: chatId,
          game_short_name: process.env.GAME_SHORT_NAME
        });
        return res.status(200).json({ ok: true });
      }
    }

    // 2) Нажатие кнопки "Играть" из карточки игры
    if (update.callback_query && update.callback_query.game_short_name) {
      const cq = update.callback_query;
      const userId = cq.from.id;
      const chatId = cq.message?.chat?.id;
      const messageId = cq.message?.message_id;

      // Возвращаем ссылку на твою игру.
      // Добавляем параметры (юзер/чат/сообщение) — они пригодятся дальше для лидеров.
      const url = gameUrl({
        uid: String(userId),
        chat: chatId ? String(chatId) : '',
        msg: messageId ? String(messageId) : ''
      });

      await tg('answerCallbackQuery', {
        callback_query_id: cq.id,
        url // Telegram откроет этот URL внутри WebView
      });

      return res.status(200).json({ ok: true });
    }

    // Прочие апдейты игнорируем
    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('Webhook error:', e);
    return res.status(200).json({ ok: true });
  }
}
