// src/bot/bot.js
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import fetch from 'node-fetch';

const BOT_TOKEN   = process.env.BOT_TOKEN;
const WEBAPP_URL  = process.env.WEBAPP_URL || 'https://telegram-mini-mart.vercel.app/';
const CHANNEL_ID  = "@SouthAsiaMartChannel"; // <── replace with your actual channel handle (no spaces)
const OWNER_ID    = process.env.OWNER_ID || "";

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing in environment variables");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ── Set Chat Menu Button ────────────────────────────────
async function setChatMenuButton() {
  const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      menu_button: {
        type: "web_app",
        text: "🛒 Shop Now",
        web_app: { url: WEBAPP_URL }
      }
    })
  });
  const json = await resp.json();
  if (json.ok) console.log("✅ Chat menu button set successfully");
  else console.warn("⚠️ setChatMenuButton failed:", json);
}

// ── Reply keyboard for private chat ─────────────────────
function shopKeyboard() {
  return {
    keyboard: [
      [{ text: "🛒 Shop Now", web_app: { url: WEBAPP_URL } }],
      [{ text: "📦 My Orders" }, { text: "🆘 Support" }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

// ── Handlers ────────────────────────────────────────────
bot.start(async (ctx) => {
  await setChatMenuButton();
  await ctx.reply(
    "Welcome to *South Asia Mart*! 🛍️\nTap the button below to start shopping.",
    { parse_mode: "Markdown", reply_markup: shopKeyboard() }
  );
});

bot.hears("📦 My Orders", (ctx) =>
  ctx.reply("You don’t have any orders yet. Tap 🛒 Shop Now to begin!", {
    reply_markup: shopKeyboard(),
  })
);

bot.hears("🆘 Support", (ctx) =>
  ctx.reply("Need help? Contact @YourSupportHandle.", {
    reply_markup: shopKeyboard(),
  })
);

// ── Admin Command: Post Shop Now in Channel ─────────────
bot.command("postshop", async (ctx) => {
  if (OWNER_ID && ctx.from.id.toString() !== OWNER_ID) {
    return ctx.reply("❌ Unauthorized: only the owner can post to the channel.");
  }

  await bot.telegram.sendMessage(
    CHANNEL_ID,
    "🛒 *Welcome to South Asia Mart!* Tap below to start shopping 👇",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🛍️ Shop Now", web_app: { url: WEBAPP_URL } }]],
      },
    }
  );

  ctx.reply("✅ Posted 'Shop Now' button to the channel!");
});

// ── Launch ──────────────────────────────────────────────
bot.launch().then(() => console.log("🤖 Bot running..."));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
