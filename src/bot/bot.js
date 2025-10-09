// src/bot/bot.js
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import fetch from 'node-fetch';

/* ───────────────────────────
   Environment
──────────────────────────── */
const BOT_TOKEN   = process.env.BOT_TOKEN;
const WEBAPP_URL  = process.env.WEBAPP_URL || 'https://telegram-mini-mart.vercel.app/';
const CHANNEL_ID  = (process.env.CHANNEL_ID || '@SouthAsiaMartChannel').toString();
const OWNER_ID    = (process.env.OWNER_ID || '').toString();

// NEW: backend base URL + shared secret for /myorders
const API_URL     = process.env.API_URL     || 'https://telegram-mini-mart.onrender.com';
const BOT_API_KEY = process.env.BOT_API_KEY || ''; // set this on BOTH backend and bot services

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing in environment variables');
  process.exit(1);
}

let BOT_USERNAME = ''; // filled via getMe()

console.log('──────── BOT STARTUP ────────');
console.log('WEBAPP_URL  =', WEBAPP_URL);
console.log('API_URL     =', API_URL);
console.log('CHANNEL_ID  =', CHANNEL_ID);
console.log('OWNER_ID    =', OWNER_ID || '(not set)');
console.log('BOT_API_KEY =', BOT_API_KEY ? '(set)' : '(missing)');
console.log('─────────────────────────────');

const bot = new Telegraf(BOT_TOKEN);

/* ───────────────────────────
   Helpers
──────────────────────────── */
async function deleteWebhookIfAny() {
  try {
    const info = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`).then(r => r.json());
    if (info?.result?.url) {
      console.log('Webhook currently set -> deleting…', info.result.url);
      const del = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`, { method: 'POST' }).then(r => r.json());
      console.log('deleteWebhook:', del);
    } else {
      console.log('No webhook set (good). Using long polling.');
    }
  } catch (e) {
    console.warn('get/delete webhook failed (ignored):', e?.message || e);
  }
}

async function setChatMenuButton() {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menu_button: {
          type: 'web_app',
          text: '🛒 Shop Now',
          web_app: { url: WEBAPP_URL } // works in private chat; fine as a global menu button
        }
      })
    });
    const json = await resp.json();
    if (json.ok) console.log('✅ Chat menu button set successfully');
    else console.warn('⚠️ setChatMenuButton failed:', json);
  } catch (e) {
    console.warn('setChatMenuButton error:', e?.message || e);
  }
}

function shopKeyboard() {
  return {
    keyboard: [
      [{ text: '🛒 Shop Now', web_app: { url: WEBAPP_URL } }],
      [{ text: '📦 My Orders' }, { text: '🆘 Support' }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

function isOwner(ctx) {
  const myId = ctx.from?.id?.toString();
  return OWNER_ID && myId === OWNER_ID;
}

/* ───────────────────────────
   Diagnostics
──────────────────────────── */
bot.command('whoami', (ctx) => {
  const myId = ctx.from?.id?.toString();
  return ctx.reply(
    `Your ID: ${myId}\nOWNER_ID (env): ${OWNER_ID || '(not set)'}\nOwner? ${isOwner(ctx) ? 'YES ✅' : 'NO ❌'}`
  );
});

bot.command('me', (ctx) =>
  ctx.reply('```json\n' + JSON.stringify(ctx.from || {}, null, 2) + '\n```', { parse_mode: 'Markdown' })
);

bot.command('ping', (ctx) => ctx.reply('pong ✅'));

bot.command('setmenu', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('❌ Unauthorized.');
  await setChatMenuButton();
  return ctx.reply('✅ Menu button set to WebApp.');
});

/* ───────────────────────────
   User flows (private chat)
──────────────────────────── */
bot.start(async (ctx) => {
  await setChatMenuButton();
  await ctx.reply(
    'Welcome to *South Asia Mart*! 🛍️\nTap **Shop Now** below to start ordering.',
    { parse_mode: 'Markdown', reply_markup: shopKeyboard() }
  );
});

bot.hears('📦 My Orders', (ctx) =>
  ctx.reply('Tip: type /myorders to see your recent orders.', { reply_markup: shopKeyboard() })
);

bot.hears('🆘 Support', (ctx) =>
  ctx.reply('Need help? Contact @YourSupportHandle.', { reply_markup: shopKeyboard() })
);

/* ───────────────────────────
   /myorders — list recent orders
──────────────────────────── */
function fmtOrder(o) {
  const dt = new Date(o.created_at);
  const when = dt.toLocaleString('en-IN', { hour12: true });
  return `#${o.id} — ${o.totalFormatted} — ${o.method?.toUpperCase() || '—'} — ${o.status} — ${when}`;
}

bot.command('myorders', async (ctx) => {
  try {
    if (!BOT_API_KEY) {
      return ctx.reply('Orders feature is not configured yet (BOT_API_KEY missing).');
    }
    const url = `${API_URL}/bot/user-orders?uid=${ctx.from.id}&key=${encodeURIComponent(BOT_API_KEY)}`;
    const r = await fetch(url).then(r => r.json());

    if (!r.ok || !Array.isArray(r.items) || r.items.length === 0) {
      return ctx.reply('You have no orders yet. Tap 🛒 Shop Now to begin!');
    }

    const lines = r.items.map(fmtOrder).join('\n');
    await ctx.reply(`🧾 *Your recent orders*\n${lines}`, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    ctx.reply('Sorry, failed to fetch your orders.');
  }
});

/* ───────────────────────────
   Channel post: "Shop Now" button
   (use deep link URL instead of web_app)
──────────────────────────── */
bot.command('postshop', async (ctx) => {
  try {
    if (!isOwner(ctx)) return ctx.reply('❌ Unauthorized: only the owner can post to the channel.');

    const startAppUrl = BOT_USERNAME
      ? `https://t.me/${BOT_USERNAME}?startapp=shop`
      : WEBAPP_URL; // fallback

    const resp = await bot.telegram.sendMessage(
      CHANNEL_ID,
      '🛒 *Welcome to South Asia Mart!* Tap below to start shopping 👇',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🛍️ Shop Now', url: startAppUrl }]] // URL (deep link), not web_app
        }
      }
    );

    console.log('sendMessage result:', resp);
    return ctx.reply('✅ Posted "Shop Now" button to the channel! Open the channel and pin it.');
  } catch (err) {
    const code = err?.response?.error_code;
    const desc = err?.response?.description;
    console.error('sendMessage error:', code, desc, err);
    return ctx.reply(`❌ Failed to post. Telegram says: ${code || ''} ${desc || ''}\nCheck Render logs for details.`);
  }
});

/* ───────────────────────────
   Global error guard & launch
──────────────────────────── */
bot.catch((err, ctx) => {
  console.error('Bot error for', ctx.updateType, err);
});

(async function main() {
  await deleteWebhookIfAny();

  // fill BOT_USERNAME for deep links
  try {
    const me = await bot.telegram.getMe();
    BOT_USERNAME = me.username;
    console.log('Bot username =', BOT_USERNAME);
  } catch (e) {
    console.warn('getMe failed:', e?.message || e);
  }

  await bot.launch();
  console.log('🤖 Bot running (long polling)…');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
