// src/bot/bot.js
import 'dotenv/config';
import { Telegraf, Markup, session } from 'telegraf';
import fetch from 'node-fetch';

const BOT_TOKEN       = process.env.BOT_TOKEN;
const WEBAPP_URL      = process.env.WEBAPP_URL || 'https://telegram-mini-mart.vercel.app/';
const API_URL         = process.env.API_URL || '';
const BOT_API_KEY     = process.env.BOT_API_KEY || '';             // must match backend
const CHANNEL_ID      = (process.env.CHANNEL_ID || '@SouthAsiaMartChannel').toString();
const SUPPORT_CHAT_ID = (process.env.SUPPORT_CHAT_ID || '').toString();   // e.g. -1001234567890
const OWNER_ID        = (process.env.OWNER_ID || '').toString();

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing');
  process.exit(1);
}

let BOT_USERNAME = '';

/* ───────────────────────── Bot bootstrap ───────────────────────── */
const bot = new Telegraf(BOT_TOKEN);
// enable per-chat ephemeral state used by the reply flow
bot.use(session());

/* ───────────────────────── Utilities ───────────────────────────── */
async function deleteWebhookIfAny() {
  try {
    const info = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`).then(r => r.json());
    if (info?.result?.url) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`, { method: 'POST' });
      console.log('Webhook removed, using long polling.');
    } else {
      console.log('No webhook set (good). Using long polling.');
    }
  } catch (e) {
    console.warn('Webhook check failed:', e?.message || e);
  }
}

async function setChatMenuButton() {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menu_button: { type: 'web_app', text: '🛒 Shop Now', web_app: { url: WEBAPP_URL } }
      })
    }).then(r => r.json());
    if (resp.ok) console.log('✅ Menu button set');
    else console.warn('⚠️ setChatMenuButton failed:', resp);
  } catch (e) {
    console.warn('setChatMenuButton error:', e?.message || e);
  }
}

function isOwner(ctx) {
  return OWNER_ID && ctx.from?.id?.toString() === OWNER_ID;
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

/* ───────────────────────── Diagnostics ─────────────────────────── */
bot.command('whoami', (ctx) => {
  const id = ctx.from?.id?.toString();
  ctx.reply(
    `Your ID: ${id}\nOWNER_ID: ${OWNER_ID || '(not set)'}\nOwner? ${isOwner(ctx) ? 'YES ✅' : 'NO ❌'}`
  );
});

bot.command('ping', (ctx) => ctx.reply('pong ✅'));

bot.command('setmenu', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('❌ Unauthorized.');
  await setChatMenuButton();
  ctx.reply('✅ Menu button set');
});

/* Debug helpers (safe to keep; remove later if you wish) */
bot.command('envcheck', (ctx) => {
  const msg =
`SUPPORT_CHAT_ID = ${SUPPORT_CHAT_ID || '(unset)'}
API_URL         = ${API_URL || '(unset)'}
CHANNEL_ID      = ${CHANNEL_ID || '(unset)'}
BOT_USERNAME    = ${BOT_USERNAME || '(unknown)'}
BOT_API_KEY     = ${BOT_API_KEY ? '(set)' : '(missing)'}
(Only SUPPORT_CHAT_ID, API_URL and BOT_API_KEY matter for /myorders & support replies)`;
  return ctx.reply('```txt\n' + msg + '\n```', { parse_mode: 'Markdown' });
});

bot.command('supportping', async (ctx) => {
  try {
    if (!SUPPORT_CHAT_ID) return ctx.reply('❌ SUPPORT_CHAT_ID is not set.');
    await bot.telegram.sendMessage(
      SUPPORT_CHAT_ID,
      `🔔 supportping from ${BOT_USERNAME} (${new Date().toISOString()})`
    );
    return ctx.reply('✅ Sent ping to SUPPORT_CHAT_ID. If it’s not visible in the group, the ID is wrong or the bot lacks rights.');
  } catch (e) {
    return ctx.reply('❌ Failed to send: ' + (e?.response?.description || e.message));
  }
});

// Print chat.id anywhere (group, channel, DM)
bot.command('whereami', (ctx) => ctx.reply(`chat.id = ${ctx.chat?.id}`));
bot.command('forcewhere', (ctx) => ctx.reply(`chat.id = ${ctx.chat?.id}`));

/* ───────────────────────── User flow ───────────────────────────── */
bot.start(async (ctx) => {
  await setChatMenuButton();
  await ctx.reply(
    'Welcome to *South Asia Mart*! 🛍️\nTap **Shop Now** below to start ordering.',
    { parse_mode: 'Markdown', reply_markup: shopKeyboard() }
  );
});

bot.hears('🆘 Support', (ctx) =>
  ctx.reply('Send me your message here. Our team will reply shortly. 🙌', { reply_markup: shopKeyboard() })
);

/* ───────────────────────── Orders: /myorders ───────────────────── */
bot.hears('📦 My Orders', async (ctx) => showOrders(ctx));
bot.command('myorders', async (ctx) => showOrders(ctx));

async function showOrders(ctx) {
  try {
    if (!API_URL || !BOT_API_KEY) {
      return ctx.reply('Orders feature is not configured yet (BOT_API_KEY or API_URL missing).');
    }
    const res = await fetch(`${API_URL}/myorders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-key': BOT_API_KEY },
      body: JSON.stringify({ tg_user_id: ctx.from.id })
    });
    const json = await res.json();

    if (!json.ok) throw new Error(json.error || 'Fetch failed');

    if (!json.items?.length) {
      return ctx.reply('You have no orders yet. Tap 🛒 Shop Now to begin!', { reply_markup: shopKeyboard() });
    }

    const lines = json.items.slice(0, 10).map(o =>
      `#${o.id} — ₹${(o.total/100).toFixed(2)} — ${o.payment_method} — ${o.status} — ${new Date(o.created_at).toLocaleString()}`
    );
    await ctx.replyWithMarkdown(`🧾 *Your recent orders*\n${lines.join('\n')}`, { reply_markup: shopKeyboard() });

  } catch (e) {
    console.error('myorders error:', e);
    ctx.reply('Sorry, failed to fetch your orders.');
  }
}

/* ───────────────── Channel “Shop Now” post ─────────────────────── */
bot.command('postshop', async (ctx) => {
  try {
    if (!isOwner(ctx)) return ctx.reply('❌ Unauthorized.');
    const startAppUrl = `https://t.me/${BOT_USERNAME}?startapp=shop`;
    await bot.telegram.sendMessage(
      CHANNEL_ID,
      '🛒 *Welcome to South Asia Mart!* Tap below to start shopping 👇',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🛍️ Shop Now', url: startAppUrl }]] }
      }
    );
    ctx.reply('✅ Posted "Shop Now" to the channel. Pin it there.');
  } catch (err) {
    console.error('postshop error:', err?.response || err);
    ctx.reply('❌ Failed to post. See bot logs.');
  }
});

/* ───────────────── Two-way support relay ─────────────────────────
   - User sends text/photo → forward to SUPPORT_CHAT_ID with a Reply button
   - Admin taps Reply button or replies to the header → bot sends message back
------------------------------------------------------------------- */

// 1) Relay messages from **user DM** to the support group
bot.on(
  ['text', 'photo', 'document', 'voice', 'video', 'video_note', 'sticker', 'location', 'contact'],
  async (ctx, next) => {
    try {
      // only relay private chats (users)
      if (ctx.chat?.type !== 'private') return next && next();
      if (!SUPPORT_CHAT_ID) return next && next();

      const u = ctx.from || {};
      const title = `👤 ${u.first_name || ''} ${u.last_name || ''} ${u.username ? `(@${u.username})` : ''}`.trim();
      const header = `From: *${title}*\nID: \`${u.id}\``;

      const replyBtn = Markup.inlineKeyboard([
        [Markup.button.callback(`Reply to ${u.first_name || 'user'}`, `reply:${u.id}`)]
      ]);

      if (ctx.message.photo) {
        const fileId = ctx.message.photo.slice(-1)[0].file_id;
        await ctx.telegram.sendPhoto(SUPPORT_CHAT_ID, fileId, { caption: header, parse_mode: 'Markdown', ...replyBtn });
      } else if (ctx.message.text) {
        await ctx.telegram.sendMessage(SUPPORT_CHAT_ID, `${header}\n\n${ctx.message.text}`, { parse_mode: 'Markdown', ...replyBtn });
      } else {
        // fallback forward and append header
        await ctx.forwardMessage(SUPPORT_CHAT_ID);
        await ctx.telegram.sendMessage(SUPPORT_CHAT_ID, header, { parse_mode: 'Markdown', ...replyBtn });
      }
    } catch (e) {
      console.warn('relay -> support failed:', e?.message || e);
    }
  }
);

// 2) Admin taps “Reply” button in the support group → we enter reply mode
bot.action(/reply:(\d+)/, async (ctx) => {
  try {
    if (ctx.chat?.id?.toString() !== SUPPORT_CHAT_ID) return ctx.answerCbQuery('Not here');
    const userId = ctx.match[1];
    ctx.session = ctx.session || {};
    ctx.session.replyTo = userId;  // store target user for the next message
    await ctx.answerCbQuery();
    await ctx.reply(`Replying to user ID ${userId}. Send your message now (text/photo).`);
  } catch (e) {
    console.warn('reply action error:', e?.message || e);
  }
});

// 3) Any message in the support group while in reply mode (or replying to the header) → DM to user
bot.on(['text', 'photo'], async (ctx, next) => {
  try {
    if (ctx.chat?.id?.toString() !== SUPPORT_CHAT_ID) return next && next();

    let userId = ctx.session?.replyTo;

    // also support "replying to the header message" flow
    if (!userId && ctx.message?.reply_to_message?.text) {
      const m = ctx.message.reply_to_message.text.match(/ID:\s*`?(\d+)`?/);
      if (m) userId = m[1];
    }

    if (!userId) return next && next();

    if (ctx.message.photo) {
      const fileId = ctx.message.photo.slice(-1)[0].file_id;
      await ctx.telegram.sendPhoto(userId, fileId, { caption: ctx.message.caption || '' });
    } else if (ctx.message.text) {
      await ctx.telegram.sendMessage(userId, ctx.message.text);
    }

    // clear one-shot reply state
    ctx.session.replyTo = null;
  } catch (e) {
    console.warn('support -> user send failed:', e?.response?.description || e.message);
  }
});

/* ───────────────── Errors & Launch ─────────────────────────────── */
bot.catch((err, ctx) => {
  console.error('Bot error for', ctx.updateType, err);
});

(async function main() {
  console.log('________ BOT STARTUP ________');
  console.log('[bot] WEBAPP_URL      =', WEBAPP_URL);
  console.log('[bot] API_URL         =', API_URL);
  console.log('[bot] CHANNEL_ID      =', CHANNEL_ID);
  console.log('[bot] SUPPORT_CHAT_ID =', SUPPORT_CHAT_ID || '(not set)');
  console.log('[bot] BOT_API_KEY     =', BOT_API_KEY ? '(set)' : '(missing)');

  await deleteWebhookIfAny();

  const me = await bot.telegram.getMe();
  BOT_USERNAME = me.username;
  console.log('[bot] Bot username =', BOT_USERNAME);

  await bot.launch();
  console.log('🤖 Bot running (long polling)…');
})();

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
