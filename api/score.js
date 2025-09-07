// api/score.js — приём очков от игры + вызов Telegram setGameScore
const TG = {
  token: process.env.BOT_TOKEN,
  api: `https://api.telegram.org/bot${process.env.BOT_TOKEN}`
};

// Разрешаем запросы только с домена твоей игры
const ALLOWED_ORIGIN = process.env.GAME_URL_BASE; // например: https://ladders-lava.vercel.app

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

function setCors(res) {
  if (ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = req.body || {};
    const uid = Number(body.uid);
    const chat = body.chat ? Number(body.chat) : undefined;
    const msg = body.msg ? Number(body.msg) : undefined;
    const score = Math.max(0, Math.floor(Number(body.score)));

    if (!uid || (!chat || !msg) || !Number.isFinite(score)) {
      return res.status(400).json({ ok: false, error: 'bad params', body });
    }

    // Важно: лидерборды Games привязаны к (chat_id + message_id)
    const payload = {
      user_id: uid,
      score: score,
      chat_id: chat,
      message_id: msg,
      disable_edit_message: true // чтобы не перерисовывать сообщение
    };

    const r = await tg('setGameScore', payload);
    return res.status(200).json(r);
  } catch (e) {
    console.error('score error', e);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
}
