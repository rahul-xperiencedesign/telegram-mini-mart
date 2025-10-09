// src/bot/bot.js
import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import fetch from 'node-fetch';

/* ========= ENV ========= */
const BOT_TOKEN       = process.env.BOT_TOKEN;
const WEBAPP_URL      = process.env.WEBAPP_URL || 'https://telegram-mini-mart.vercel.app/';
const API_URL         = process.env.API_URL || '';
const BOT_API_KEY     = process.env.BOT_API_KEY || ''; // must match backend
const CHANNEL_ID      = (process.env.CHANNEL_ID || '@SouthAsiaMartChannel').toString();
const SUPPORT_CHAT_ID = (process.env.SUPPORT_CHAT_ID || '').toString(); // e.g. -100123...
const OWNER_ID        = (process.env.OWNER_ID || '').toString();

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing');
  process.exit(1);
}

let BOT_USERNAME = '';
const bot = new Telegraf(BOT_TOKEN);

/* ========= SMALL UTILS ========= */
const isOwner = (ctx) => OWNER_ID && ctx.from?.id?.toString() === OWNER_ID;

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

async function deleteWebhookIfAny() {
  try {
    const info = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`).then(r => r.json());
    if (info?.result?.url) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`, { method: 'POST' });
      console.log('[bot] Webhook deleted → using long polling');
    } else {
      console.log('[bot] No webhook set (good). Using long polling.');
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
    if (resp.ok) console.log('✅ Chat menu button set');
    else console.warn('⚠️ setChatMenuButton failed:', resp);
  } catch (e) {
    console.warn('setChatMenuButton error:', e?.message || e);
  }
}

/* ========= DIAGNOSTICS / ADMIN ========= */
bot.command('whoami', (ctx) => {
  const id = ctx.from?.id?.toString();
  ctx.reply(`Your ID: ${id}\nOWNER_ID: ${OWNER_ID || '(not set)'}\nOwner? ${isOwner(ctx) ? 'YES ✅' : 'NO ❌'}`);
});

bot.command('ping', (ctx) => ctx.reply('pong ✅'));

bot.command('setmenu', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('❌ Unauthorized.');
  await setChatMenuButton();
  ctx.reply('✅ Menu button set');
});

// whereami → only replies inside groups/channels
bot.command('whereami', (ctx) => {
  const cid = ctx.chat?.id?.toString();
  ctx.reply(`chat.id = ${cid}`);
});

/* ========= START & SIMPLE FLOWS ========= */
bot.start(async (ctx) => {
  await setChatMenuButton();
  await ctx.reply(
    'Welcome to *South Asia Mart*! 🛍️\nTap **Shop Now** below to start ordering.',
    { parse_mode: 'Markdown', reply_markup: shopKeyboard() }
  );
});

bot.hears('🆘 Support', (ctx) =>
  ctx.reply('Send your message here. Our team will reply shortly. 🙌', { reply_markup: shopKeyboard() })
);

/* ========= ORDERS: /myorders ========= */
bot.hears('📦 My Orders', async (ctx) => showOrders(ctx));
bot.command('myorders', async (ctx) => showOrders(ctx));

async function showOrders(ctx) {
  try {
    if (!API_URL || !BOT_API_KEY) {
      return ctx.reply('Orders feature is not configured yet (API_URL or BOT_API_KEY missing).');
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

/* ========= CHANNEL POST (Shop Now) ========= */
bot.command('postshop', async (ctx) => {
  try {
    if (!isOwner(ctx)) return ctx.reply('❌ Unauthorized.');
    const startAppUrl = `https://t.me/${BOT_USERNAME}?startapp=shop`;
    await bot.telegram.sendMessage(
      CHANNEL_ID,
      '🛒 *Welcome to South Asia Mart!* Tap below to start shopping 👇',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🛍️ Shop Now', url: startAppUrl }]] } }
    );
    ctx.reply('✅ Posted "Shop Now" to the channel. Pin it there.');
  } catch (err) {
    console.error('postshop error:', err?.response || err);
    ctx.reply('❌ Failed to post. See bot logs.');
  }
});

/* ========= TWO-WAY SUPPORT: robust & stateless =========
   - DM from user → relay to support group with an inline “Reply to …” button
   - In support group:
      • tap button (reply-mode for 2 minutes)
      • OR simply reply to the bot’s forwarded message (it parses user ID from the header)
   - Uses in-memory map (adminId -> {userId, expires})
*/
const replyMap = new Map(); // adminId -> { userId, expires }
const REPLY_TTL_MS = 2 * 60 * 1000;

// Tiny helper to get a friendly name
function prettyUser(u) {
  const parts = [u?.first_name, u?.last_name].filter(Boolean);
  let name = parts.join(' ').trim();
  if (!name && u?.username) name = `@${u.username}`;
  return name || `User ${u?.id || ''}`.trim();
}

// 1) Relay from user DM → support group
bot.on(['message'], async (ctx, next) => {
  try {
    const chatType = ctx.chat?.type;
    if (chatType !== 'private') return next && next();
    if (!SUPPORT_CHAT_ID) return next && next();

    // Ignore pure commands like /myorders, /start etc — they have their own handlers
    if (ctx.message?.text && /^\/\w+/.test(ctx.message.text)) return next && next();

    const u = ctx.from || {};
    const title = prettyUser(u);
    const header = `From: *${title}*\nID: \`${u.id}\``;

    const replyBtn = Markup.inlineKeyboard([
      [Markup.button.callback(`Reply to ${u.first_name || 'user'}`, `reply:${u.id}`)]
    ]);

    if (ctx.message.photo) {
      const fileId = ctx.message.photo.slice(-1)[0].file_id;
      await ctx.telegram.sendPhoto(SUPPORT_CHAT_ID, fileId, { caption: header, parse_mode: 'Markdown', ...replyBtn });
    } else if (ctx.message.text) {
      await ctx.telegram.sendMessage(SUPPORT_CHAT_ID, `${header}\n\n${ctx.message.text}`, { parse_mode: 'Markdown', ...replyBtn });
    } else if (ctx.message.document) {
      await ctx.telegram.sendDocument(SUPPORT_CHAT_ID, ctx.message.document.file_id, { caption: header, parse_mode: 'Markdown', ...replyBtn });
    } else if (ctx.message.voice) {
      await ctx.telegram.sendVoice(SUPPORT_CHAT_ID, ctx.message.voice.file_id, { caption: header, parse_mode: 'Markdown', ...replyBtn });
    } else if (ctx.message.video) {
      await ctx.telegram.sendVideo(SUPPORT_CHAT_ID, ctx.message.video.file_id, { caption: header, parse_mode: 'Markdown', ...replyBtn });
    } else {
      // fallback: forward message + header
      await ctx.forwardMessage(SUPPORT_CHAT_ID);
      await ctx.telegram.sendMessage(SUPPORT_CHAT_ID, header, { parse_mode: 'Markdown', ...replyBtn });
    }
  } catch (e) {
    console.warn('relay -> support failed:', e?.message || e);
  }
});

// 2) Admin taps “Reply” button → enter reply mode for 2 minutes
bot.action(/reply:(\d+)/, async (ctx) => {
  try {
    if (ctx.chat?.id?.toString() !== SUPPORT_CHAT_ID) return ctx.answerCbQuery('Not here');
    const userId = ctx.match[1];
    const adminId = ctx.from?.id?.toString();
    const until = Date.now() + REPLY_TTL_MS;
    replyMap.set(adminId, { userId, expires: until });
    await ctx.answerCbQuery();
    await ctx.reply(`Replying to user ID ${userId}. Send your message now (text/photo).`);
  } catch (e) {
    console.warn('reply action error:', e?.message || e);
  }
});

// 3) Support group → user (reply-mode or reply-to forwarded header)
bot.on(['message'], async (ctx, next) => {
  try {
    if (ctx.chat?.id?.toString() !== SUPPORT_CHAT_ID) return next && next();

    // try reply-mode first
    const adminId = ctx.from?.id?.toString();
    const entry = replyMap.get(adminId);
    let userId = null;
    if (entry && entry.expires > Date.now()) {
      userId = entry.userId;
    } else {
      replyMap.delete(adminId);
    }

    // if not in reply-mode, parse the replied header "ID: `123`"
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
    } else if (ctx.message.document) {
      await ctx.telegram.sendDocument(userId, ctx.message.document.file_id, { caption: ctx.message.caption || '' });
    } else if (ctx.message.voice) {
      await ctx.telegram.sendVoice(userId, ctx.message.voice.file_id, { caption: ctx.message.caption || '' });
    } else if (ctx.message.video) {
      await ctx.telegram.sendVideo(userId, ctx.message.video.file_id, { caption: ctx.message.caption || '' });
    } else {
      // unhandled type → ignore silently
      return next && next();
    }

    // one-shot: clear mapping
    replyMap.delete(adminId);
  } catch (e) {
    console.warn('support -> user send failed:', e?.message || e);
  }
});

/* ========= ERRORS & LAUNCH ========= */
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

  try {
    const me = await bot.telegram.getMe();
    BOT_USERNAME = me.username;
    console.log('[bot] Bot username =', BOT_USERNAME);
  } catch (e) {
    console.warn('getMe failed:', e?.message || e);
  }

  await bot.launch();
  console.log('🤖 Bot running (long polling)…');
})();

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
