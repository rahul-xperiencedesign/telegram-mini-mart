// src/bot/bot.js
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import fetch from 'node-fetch';

const BOT_TOKEN  = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://telegram-mini-mart.vercel.app/';
// Prefer env if set (works for private numeric IDs like -100123..., or public handles like @SouthAsiaMartChannel)
const CHANNEL_ID = (process.env.CHANNEL_ID || '@SouthAsiaMartChannel').toString();
const OWNER_ID   = (process.env.OWNER_ID || '').toString();

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing in environment variables');
  process.exit(1);
}

console.log('──────── BOT STARTUP ────────');
console.log('WEBAPP_URL =', WEBAPP_URL);
console.log('CHANNEL_ID =', CHANNEL_ID);
console.log('OWNER_ID   =', OWNER_ID || '(not set)');
console.log('─────────────────────────────');

const bot = new Telegraf(BOT_TOKEN);

/* Utils */
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
          web_app: { url: WEBAPP_URL }
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

/* Diagnostics & admin helpers */
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

/* User flows */
bot.start(async (ctx) => {
  await setChatMenuButton();
  await ctx.reply(
    'Welcome to *South Asia Mart*! 🛍️\nTap **Shop Now** below to start ordering.',
    { parse_mode: 'Markdown', reply_markup: shopKeyboard() }
  );
});

bot.hears('📦 My Orders', (ctx) =>
  ctx.reply('You don’t have any orders yet. Tap 🛒 Shop Now to begin!', {
    reply_markup: shopKeyboard()
  })
);

bot.hears('🆘 Support', (ctx) =>
  ctx.reply('Need help? Contact @YourSupportHandle.', {
    reply_markup: shopKeyboard()
  })
);

/* Post “Shop Now” in channel (pin it there) — with detailed error logging */
bot.command('postshop', async (ctx) => {
  try {
    if (!isOwner(ctx)) return ctx.reply('❌ Unauthorized: only the owner can post to the channel.');

    const channel = CHANNEL_ID; // already prefers env if provided
    console.log('Attempting to post to channel:', channel);

    const resp = await bot.telegram.sendMessage(
      channel,
      '🛒 *Welcome to South Asia Mart!* Tap below to start shopping 👇',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🛍️ Shop Now', web_app: { url: WEBAPP_URL } }]]
        }
      }
    );

    console.log('sendMessage result:', resp);
    return ctx.reply('✅ Posted "Shop Now" button to the channel! Open the channel and pin it.');
  } catch (err) {
    // Telegraf surfaces API errors as err.response
    const code = err?.response?.error_code;
    const desc = err?.response?.description;
    console.error('sendMessage error:', code, desc, err);
    return ctx.reply(`❌ Failed to post. Telegram says: ${code || ''} ${desc || ''}\nCheck Render logs for details.`);
  }
});

/* Global error guard */
bot.catch((err, ctx) => {
  console.error('Bot error for', ctx.updateType, err);
});

/* Launch */
(async function main() {
  await deleteWebhookIfAny(); // make sure polling works
  await bot.launch();
  console.log('🤖 Bot running (long polling)…');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
