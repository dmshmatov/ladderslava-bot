// api/broadcast.js
// Массовая рассылка всем пользователям из Supabase leaderboard
// Вызывается POST-запросом с секретом, чтобы никто посторонний не мог запустить рассылку

const TG = {
  api: `https://api.telegram.org/bot${process.env.BOT_TOKEN}`
};

const SUPABASE = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY
};

const BROADCAST_SECRET = process.env.BROADCAST_SECRET;

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

async function fetchAllUsers() {
  const url =
    `${SUPABASE.url}/rest/v1/leaderboard` +
    `?select=telegram_user_id,username,first_name` +
    `&order=updated_at.desc`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE.key,
      Authorization: `Bearer ${SUPABASE.key}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }

  const rows = await res.json();

  // убираем пустые и дубли
  const uniqueMap = new Map();

  for (const row of rows) {
    const id = Number(row.telegram_user_id);
    if (!id) continue;
    if (!uniqueMap.has(id)) uniqueMap.set(id, row);
  }

  return Array.from(uniqueMap.values());
}

async function sendBroadcastMessage(chatId, text) {
  return await tg('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

function buildDefaultUpdateMessage() {
  return (
    `🔥 Обновление Ladders & Lava\n\n` +
    `Мы выпустили новую версию игры.\n\n` +
    `Что нового:\n` +
    `• улучшен интерфейс внутри бота\n` +
    `• рейтинг теперь обновляется удобнее\n` +
    `• убрано лишнее нагромождение сообщений\n\n` +
    `Заходи и попробуй 👇`
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({
      ok: true,
      message: 'Use POST'
    });
  }

  try {
    const body = req.body || {};
    const secret = String(body.secret || '');

    if (!BROADCAST_SECRET || secret !== BROADCAST_SECRET) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden'
      });
    }

    if (!process.env.BOT_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: 'BOT_TOKEN is missing'
      });
    }

    if (!SUPABASE.url || !SUPABASE.key) {
      return res.status(500).json({
        ok: false,
        error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing'
      });
    }

    const users = await fetchAllUsers();
    const text = String(body.text || '').trim() || buildDefaultUpdateMessage();

    let success = 0;
    let failed = 0;
    const errors = [];

    for (const user of users) {
      const chatId = Number(user.telegram_user_id);

      try {
        const result = await sendBroadcastMessage(chatId, text);

        if (result.ok) {
          success += 1;
        } else {
          failed += 1;
          errors.push({
            chat_id: chatId,
            error: result.description || 'Unknown Telegram error'
          });
        }
      } catch (error) {
        failed += 1;
        errors.push({
          chat_id: chatId,
          error: error.message || 'Unknown send error'
        });
      }

      // небольшая пауза, чтобы не долбить API слишком резко
      await new Promise(resolve => setTimeout(resolve, 60));
    }

    return res.status(200).json({
      ok: true,
      total: users.length,
      success,
      failed,
      errors
    });
  } catch (error) {
    console.error('Broadcast error:', error);

    return res.status(500).json({
      ok: false,
      error: error.message || 'Server error'
    });
  }
}
