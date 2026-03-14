// api/telegram.js — Telegram webhook (лички и группы) + выдача URL игры + рейтинг из Supabase

const TG = {
  token: process.env.BOT_TOKEN,
  api: `https://api.telegram.org/bot${process.env.BOT_TOKEN}`
};

const SUPABASE = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_ANON_KEY
};

// ОБЯЗАТЕЛЬНО заданы переменные окружения:
// BOT_TOKEN        — токен бота
// GAME_SHORT_NAME  — ladderslava
// GAME_URL_BASE    — https-домен игры (без слеша в конце), напр. https://ladders-lava.vercel.app
// BOT_BASE         — https-домен ЭТОГО проекта (без слеша), напр. https://ladderslava-bot.vercel.app
// SUPABASE_URL     — https://...supabase.co
// SUPABASE_ANON_KEY — sb_publishable_...

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
  return `${base}/index.html?${q.toString()}`;
}

// --- helper: корректно парсим /play и /play@ladderslava_bot ---
function getCommand(text) {
  const m = String(text || '').trim().match(/^\/([a-zA-Z0-9_]+)(?:@[\w_]+)?(?:\s+.*)?$/);
  return m ? m[1].toLowerCase() : null;
}

function formatPlayerName(row) {
  if (row.username && String(row.username).trim()) return '@' + String(row.username).trim();
  if (row.first_name && String(row.first_name).trim()) return String(row.first_name).trim();
  return `Player ${row.telegram_user_id}`;
}

async function fetchLeaderboard(limit = 10) {
  if (!SUPABASE.url || !SUPABASE.key) {
    throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY is missing');
  }

  const url =
    `${SUPABASE.url}/rest/v1/leaderboard` +
    `?select=telegram_user_id,username,first_name,best_score,last_score,games_played,updated_at` +
    `&order=best_score.desc` +
    `&order=updated_at.asc` +
    `&limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE.key,
      Authorization: `Bearer ${SUPABASE.key}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase leaderboard error ${res.status}: ${text}`);
  }

  return await res.json();
}

async function fetchUserRank(userId) {
  if (!SUPABASE.url || !SUPABASE.key) {
    throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY is missing');
  }

  const url =
    `${SUPABASE.url}/rest/v1/leaderboard` +
    `?select=telegram_user_id,username,first_name,best_score,last_score,games_played,updated_at` +
    `&order=best_score.desc` +
    `&order=updated_at.asc`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE.key,
      Authorization: `Bearer ${SUPABASE.key}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase rank error ${res.status}: ${text}`);
  }

  const rows = await res.json();
  const index = rows.findIndex(r => Number(r.telegram_user_id) === Number(userId));

  if (index === -1) return null;

  return {
    rank: index + 1,
    row: rows[index]
  };
}

async function buildLeaderboardText(userId) {
  const top = await fetchLeaderboard(10);
  const me = await fetchUserRank(userId);

  let text = `🏆 Топ игроков Ladders & Lava\n\n`;

  if (!top.length) {
    text += `Пока что таблица пустая.`;
    return text;
  }

  text += top
    .map((row, i) => `${i + 1}. ${formatPlayerName(row)} — ${row.best_score}`)
    .join('\n');

  if (me) {
    text += `\n\nВаш лучший результат: ${me.row.best_score}`;
    text += `\nВаше место: #${me.rank}`;
    text += `\nСыграно игр: ${me.row.games_played}`;
  } else {
    text += `\n\nВы пока ещё не попали в таблицу. Сыграйте одну игру.`;
  }

  return text;
}

async function sendMainGameCard(chatId) {
  await tg('sendGame', {
    chat_id: chatId,
    game_short_name: process.env.GAME_SHORT_NAME,
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Play ladderslava', callback_game: {} }],
        [{ text: '🏆 Рейтинг', callback_data: 'show_rating' }]
      ]
    }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true, hello: 'Use POST for Telegram webhook' });
    return;
  }

  try {
    const update = req.body || {};

    // 1) /start, /play, /rating, текстовые кнопки
    if (update.message && typeof update.message.text === 'string') {
      const chatId = update.message.chat.id;
      const fromId = update.message.from?.id;
      const text = String(update.message.text || '');
      const cmd = getCommand(text);

      if (cmd === 'start' || cmd === 'play' || text === '🎮 Играть') {
        await sendMainGameCard(chatId);
        return res.status(200).json({ ok: true });
      }

      if (cmd === 'rating' || text === '🏆 Рейтинг') {
        const leaderboardText = await buildLeaderboardText(fromId);
        await tg('sendMessage', {
          chat_id: chatId,
          text: leaderboardText
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

    // 3) Нажатие inline-кнопки "🏆 Рейтинг"
    if (update.callback_query && update.callback_query.data === 'show_rating') {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const userId = cq.from?.id;

      const leaderboardText = await buildLeaderboardText(userId);

      await tg('answerCallbackQuery', {
        callback_query_id: cq.id
      });

      await tg('sendMessage', {
        chat_id: chatId,
        text: leaderboardText
      });

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Webhook error:', e);
    return res.status(200).json({ ok: true });
  }
}
