// api/telegram.js — Telegram webhook + карточка игры + рейтинг из Supabase
// Версия:
// - onboarding встроен прямо в game message
// - отдельное приветственное сообщение больше не отправляется
// - рейтинг открывается отдельным сообщением
// - рейтинг обновляется одной кнопкой
// - в рейтинге есть "Закрыть"
// - добавлена owner-only команда /broadcast для рассылки игрокам

const TG = {
  token: process.env.BOT_TOKEN,
  api: `https://api.telegram.org/bot${process.env.BOT_TOKEN}`
};

const SUPABASE = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_ANON_KEY
};

// ОБЯЗАТЕЛЬНО заданы переменные окружения:
// BOT_TOKEN         — токен бота
// GAME_SHORT_NAME   — ladderslava
// GAME_URL_BASE     — https-домен игры (без слеша в конце)
// BOT_BASE          — https-домен ЭТОГО проекта (без слеша)
// SUPABASE_URL      — https://...supabase.co
// SUPABASE_ANON_KEY — sb_publishable_...
// OWNER_ID          — Telegram ID владельца бота

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
  const base = process.env.GAME_URL_BASE;
  const apiBase = process.env.BOT_BASE;

  const q = new URLSearchParams({
    v: String(Date.now()),
    api: apiBase || '',
    ...params
  });

  return `${base}/index.html?${q.toString()}`;
}

// ОБНОВЛЕНО:
// берём только первое слово сообщения, поэтому /broadcast нормально работает
// даже если ниже много строк текста
function getCommand(text) {
  const firstToken = String(text || '').trim().split(/\s+/)[0] || '';
  const m = firstToken.match(/^\/([a-zA-Z0-9_]+)(?:@[\w_]+)?$/);
  return m ? m[1].toLowerCase() : null;
}

function buildGameCardText() {
  return (
    `🔥 Ladders & Lava\n\n` +
    `Перепрыгивай между лестницами и избегай камней.\n\n` +
    `🎯 Цель:\n` +
    `набрать как можно больше очков\n\n` +
    `⚡ Особенность:\n` +
    `в бесконечном режиме появляются случайные биомы\n` +
    `и +15 монет за каждые 100 очков\n\n` +
    `👇 Как пользоваться:\n` +
    `🎮 Играть — запускает игру\n` +
    `🏆 Рейтинг — показывает топ игроков\n\n` +
    `🏆 Попробуй попасть в топ-3`
  );
}

function formatPlayerName(row) {
  if (row.username && String(row.username).trim()) {
    return '@' + String(row.username).trim();
  }

  if (row.first_name && String(row.first_name).trim()) {
    return String(row.first_name).trim();
  }

  return `Player ${row.telegram_user_id}`;
}

function medalPrefix(index) {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return `${index + 1}.`;
}

function helsinkiDayKey(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function todayHelsinkiKey() {
  return helsinkiDayKey(new Date());
}

async function fetchAllLeaderboardRows() {
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
    throw new Error(`Supabase leaderboard error ${res.status}: ${text}`);
  }

  return await res.json();
}

async function fetchAllBroadcastUsers() {
  if (!SUPABASE.url || !SUPABASE.key) {
    throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY is missing');
  }

  const url =
    `${SUPABASE.url}/rest/v1/leaderboard` +
    `?select=telegram_user_id` +
    `&order=updated_at.desc`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE.key,
      Authorization: `Bearer ${SUPABASE.key}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase broadcast users error ${res.status}: ${text}`);
  }

  const rows = await res.json();
  const ids = new Set();

  for (const row of rows) {
    const id = Number(row.telegram_user_id);
    if (id) ids.add(id);
  }

  return Array.from(ids);
}

async function runBroadcast(text) {
  const userIds = await fetchAllBroadcastUsers();

  let success = 0;
  let failed = 0;

  for (const chatId of userIds) {
    try {
      const result = await tg('sendMessage', {
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      });

      if (result.ok) {
        success += 1;
      } else {
        failed += 1;
      }
    } catch (e) {
      failed += 1;
    }

    await new Promise(resolve => setTimeout(resolve, 60));
  }

  return {
    total: userIds.length,
    success,
    failed
  };
}

function buildTodayRows(rows) {
  const todayKey = todayHelsinkiKey();

  return rows
    .filter(row => row.updated_at && helsinkiDayKey(row.updated_at) === todayKey)
    .sort((a, b) => {
      if ((b.last_score || 0) !== (a.last_score || 0)) {
        return (b.last_score || 0) - (a.last_score || 0);
      }

      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    });
}

function formatLeaderboardSection(title, rows, scoreField, emptyText) {
  let text = `${title}\n`;

  if (!rows.length) {
    text += emptyText;
    return text;
  }

  text += rows
    .slice(0, 10)
    .map((row, i) => `${medalPrefix(i)} ${formatPlayerName(row)} — ${row[scoreField] || 0}`)
    .join('\n');

  return text;
}

function getRankInfo(rows, userId) {
  const index = rows.findIndex(r => Number(r.telegram_user_id) === Number(userId));

  if (index === -1) return null;

  return {
    rank: index + 1,
    row: rows[index]
  };
}

async function buildLeaderboardText(userId) {
  const allRows = await fetchAllLeaderboardRows();
  const todayRows = buildTodayRows(allRows);

  const allTimeTop = [...allRows].sort((a, b) => {
    if ((b.best_score || 0) !== (a.best_score || 0)) {
      return (b.best_score || 0) - (a.best_score || 0);
    }

    return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  });

  const allTimeRank = getRankInfo(allTimeTop, userId);
  const todayRank = getRankInfo(todayRows, userId);

  let text = `🏆 Рейтинг Ladders & Lava\n\n`;
  text += formatLeaderboardSection('🌍 За всё время', allTimeTop, 'best_score', 'Пока что таблица пуста.');
  text += `\n\n`;
  text += formatLeaderboardSection('📅 За сегодня', todayRows, 'last_score', 'Сегодня ещё никто не играл.');

  if (allTimeRank) {
    text += `\n\nВаш лучший результат: ${allTimeRank.row.best_score}`;
    text += `\nВаше место за всё время: #${allTimeRank.rank}`;
    text += `\nСыграно игр: ${allTimeRank.row.games_played}`;
  } else {
    text += `\n\nВы пока ещё не попали в общий рейтинг. Сыграйте одну игру.`;
  }

  if (todayRank) {
    text += `\nВаше место за сегодня: #${todayRank.rank}`;
    text += `\nВаш результат за сегодня: ${todayRank.row.last_score}`;
  }

  text += `\n\nℹ️ Раздел "За сегодня" сейчас считается по последнему результату игрока за текущий день.`;

  return text;
}

function buildMainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Play ladderslava', callback_game: {} }],
      [{ text: '🏆 Рейтинг', callback_data: 'show_rating' }]
    ]
  };
}

function buildRatingKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔄 Обновить', callback_data: 'refresh_rating' }],
      [{ text: '❌ Закрыть', callback_data: 'close_rating' }]
    ]
  };
}

async function setGameMessageText(chatId, messageId) {
  return await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: buildGameCardText(),
    reply_markup: buildMainKeyboard()
  });
}

async function sendMainGameCard(chatId) {
  const sent = await tg('sendGame', {
    chat_id: chatId,
    game_short_name: process.env.GAME_SHORT_NAME,
    reply_markup: buildMainKeyboard()
  });

  if (sent?.ok && sent?.result?.message_id) {
    await setGameMessageText(chatId, sent.result.message_id);
  }

  return sent;
}

async function sendRatingMessage(chatId, userId) {
  const leaderboardText = await buildLeaderboardText(userId);

  return await tg('sendMessage', {
    chat_id: chatId,
    text: leaderboardText,
    reply_markup: buildRatingKeyboard()
  });
}

async function editRatingMessage(chatId, messageId, userId) {
  const leaderboardText = await buildLeaderboardText(userId);

  return await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: leaderboardText,
    reply_markup: buildRatingKeyboard()
  });
}

async function deleteRatingMessage(chatId, messageId) {
  return await tg('deleteMessage', {
    chat_id: chatId,
    message_id: messageId
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true, hello: 'Use POST for Telegram webhook' });
    return;
  }

  try {
    const update = req.body || {};

    // Текстовые сообщения
    if (update.message && typeof update.message.text === 'string') {
      const chatId = update.message.chat.id;
      const fromId = update.message.from?.id;
      const text = String(update.message.text || '');
      const cmd = getCommand(text);

      if (cmd === 'broadcast') {
        if (String(fromId) !== String(process.env.OWNER_ID)) {
          await tg('sendMessage', {
            chat_id: chatId,
            text: 'Нет доступа'
          });
          return res.status(200).json({ ok: true });
        }

        const textToSend = text.replace(/^\/broadcast(?:@[\w_]+)?\s*/i, '').trim();

        if (!textToSend) {
          await tg('sendMessage', {
            chat_id: chatId,
            text: 'После команды /broadcast нужно написать текст сообщения.'
          });
          return res.status(200).json({ ok: true });
        }

        await tg('sendMessage', {
          chat_id: chatId,
          text: '🚀 Рассылка запущена...'
        });

        const result = await runBroadcast(textToSend);

        await tg('sendMessage', {
          chat_id: chatId,
          text:
            `✅ Рассылка завершена\n\n` +
            `Всего пользователей: ${result.total}\n` +
            `Успешно: ${result.success}\n` +
            `Не удалось: ${result.failed}`
        });

        return res.status(200).json({ ok: true });
      }

      if (cmd === 'start' || cmd === 'play' || text === '🎮 Играть') {
        await sendMainGameCard(chatId);
        return res.status(200).json({ ok: true });
      }

      if (cmd === 'rating' || text === '🏆 Рейтинг') {
        await sendRatingMessage(chatId, fromId);
        return res.status(200).json({ ok: true });
      }
    }

    // Нажатие на игровую кнопку
    if (update.callback_query && update.callback_query.game_short_name) {
      const cq = update.callback_query;
      const userId = cq.from.id;
      const chatId = cq.message?.chat?.id;
      const messageId = cq.message?.message_id;

      const url = gameUrl({
        uid: String(userId),
        chat: chatId ? String(chatId) : '',
        msg: messageId ? String(messageId) : '',
        uname: cq.from?.username ? String(cq.from.username) : '',
        fname: cq.from?.first_name ? String(cq.from.first_name) : ''
      });

      await tg('answerCallbackQuery', {
        callback_query_id: cq.id,
        url
      });

      return res.status(200).json({ ok: true });
    }

    // Показать рейтинг
    if (update.callback_query && update.callback_query.data === 'show_rating') {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const userId = cq.from?.id;

      await tg('answerCallbackQuery', {
        callback_query_id: cq.id
      });

      await sendRatingMessage(chatId, userId);
      return res.status(200).json({ ok: true });
    }

    // Обновить рейтинг в том же сообщении
    if (update.callback_query && update.callback_query.data === 'refresh_rating') {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const messageId = cq.message?.message_id;
      const userId = cq.from?.id;

      await tg('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Рейтинг обновлён'
      });

      await editRatingMessage(chatId, messageId, userId);
      return res.status(200).json({ ok: true });
    }

    // Закрыть рейтинг
    if (update.callback_query && update.callback_query.data === 'close_rating') {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const messageId = cq.message?.message_id;

      await tg('answerCallbackQuery', {
        callback_query_id: cq.id
      });

      await deleteRatingMessage(chatId, messageId);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Webhook error:', e);
    return res.status(200).json({ ok: true });
  }
}
