# 🏪 South Asia Mart — Telegram Mini Mart Project Overview

### Version
v1.2 — October 2025  
Maintained by: **Rahul Agrawal & ChatGPT (GPT-5 Assistant)**

---

## 🚀 Overview
South Asia Mart is a **Telegram Mini App** that allows users to browse, order, and pay for products directly within Telegram.  
The system is composed of:
1. A **Node.js + Express backend** for API and database.
2. A **PostgreSQL database** for products and orders.
3. A **Web front-end** hosted on Vercel.
4. A **Telegram bot** that connects users to the mini mart and posts shop buttons to channels.

---

## 🧩 Repository Structure
```text
telegram-mini-mart/
├── server/
│   └── server.js              # Express backend (API, DB, orders, admin)
├── src/
│   └── bot/
│       └── bot.js             # Telegram bot logic (Shop Now, /postshop, etc.)
├── web/
│   ├── index.html             # Storefront (user catalog)
│   ├── admin.html             # Admin panel
│   ├── admin-login.html       # Admin login page
│   ├── app.js, admin.js       # Front-end logic
│   └── styles.css             # Shared styling
├── package.json               # Dependencies + start scripts
├── README.md
└── docs/
    └── PROJECT_OVERVIEW.md    # ← This file
```

---

## 🧠 Current System Components

| Component | Description | Hosted On |
|------------|-------------|------------|
| **Backend** (`server.js`) | API for products, orders, payments | Render (free instance) |
| **Frontend (web)** | Mini app UI shown in Telegram | Vercel |
| **Bot Worker** (`src/bot/bot.js`) | Telegram bot long-polling + channel posting | Render (separate service) |
| **Database** | PostgreSQL (Render External DB) | Render |
| **Channel** | Public Telegram channel `@SouthAsiaMartChannel` | Telegram |
| **Bot** | `@SouthAsiaMartBot` | Telegram |

---

## 🔐 Environment Variables

| Key | Example / Purpose |
|-----|--------------------|
| `BOT_TOKEN` | From BotFather (Telegram bot API token) |
| `DATABASE_URL` | Postgres connection string from Render |
| `ADMIN_PASSWORD` | For admin console access |
| `OWNER_ID` | Your Telegram numeric ID (from `@userinfobot`) |
| `CHANNEL_ID` | `@SouthAsiaMartChannel` or numeric ID for private channel |
| `PROVIDER_TOKEN` | (optional) Telegram payment provider |
| `UPI_PAYEE` | yourupi@okbank |
| `UPI_NAME` | “South Asia Mart” |
| `WEBAPP_URL` | `https://telegram-mini-mart.vercel.app/` |
| `NODE_VERSION` | `18.x` or later |

---

## 🤖 Telegram Bot Summary

### Bot username
`@SouthAsiaMartBot`

### Bot Commands

| Command | Function |
|----------|-----------|
| `/start` | Sends welcome message + “Shop Now” keyboard |
| `/ping` | Health check (responds with `pong ✅`) |
| `/whoami` | Shows your Telegram ID and if you’re the OWNER |
| `/setmenu` | Resets the chat menu button |
| `/postshop` | Posts “Shop Now” message to the channel (requires Owner/Admin) |
| `/me` | Returns your Telegram user JSON info (debugging) |

---

## 💬 Channel Integration

1. Create or use your Telegram channel `@SouthAsiaMartChannel`.
2. Add `@SouthAsiaMartBot` as **Admin** with **Post Messages** permission.
3. In private chat with the bot, send:
   ```
   /postshop
   ```
4. The bot posts a message:
   > 🛒 *Welcome to South Asia Mart!* Tap below to start shopping 👇  
   > [🛍️ Shop Now]
5. Pin the message in the channel.  
   When users tap **Shop Now**, Telegram opens your Mini App instantly.

---

## 💻 Backend API Overview

| Method | Endpoint | Description |
|---------|-----------|-------------|
| `GET /` | Health check |
| `POST /verify` | Verifies Telegram initData |
| `GET /categories` | Returns distinct product categories |
| `GET /products` | Lists all products |
| `POST /cart/price` | Calculates total for selected items |
| `POST /order` | Places an order (COD/UPI) |
| `POST /checkout` | Telegram invoice flow (if enabled) |
| `POST /telegram/webhook` | Handles successful payments |
| `POST /admin/init` | Initializes DB tables |
| `POST /admin/seed` | Seeds demo data |
| `GET /admin/products` | Lists products (Admin only) |
| `POST /admin/products` | Adds or updates product |
| `DELETE /admin/products/:id` | Deletes product |

---

## 🧾 Admin Console

### Login
- URL: `https://telegram-mini-mart.vercel.app/admin-login.html`
- Enter `ADMIN_PASSWORD` → redirects to `admin.html`.

### Features
- Add / Update product  
- Delete product  
- Age-restricted toggle  
- Live catalog view  
- (Next phase: stock editing, category filtering, image uploads)

---

## 🛍️ User Flow Summary

1. User searches `@SouthAsiaMartBot` or opens pinned “Shop Now” message.
2. Bot opens mini app → loads `index.html`.
3. Mini app pre-fills user info (via `/me` and `initData` verification).
4. User adds items → checks out.
5. Name + phone auto-filled (from Telegram).
6. User selects delivery slot and submits order.
7. Order saved in DB; if UPI or Telegram Payments are configured, user can pay inline.

---

## 🧰 Deployment Details (Render)

### 1️⃣ Main backend service
| Setting | Value |
|----------|--------|
| Root Directory | `server` |
| Start Command | `node src/server/server.js` |
| Instance Type | Free |

### 2️⃣ Bot worker service
| Setting | Value |
|----------|--------|
| Root Directory | `src/bot` |
| Start Command | `node bot.js` |
| Instance Type | Free (if available) |

### 3️⃣ Common notes
- Always click **“Clear build cache & redeploy”** when updating dependencies.
- Check **Logs** tab for messages like:
  ```
  🤖 Bot running (long polling)…
  Backend running on :10000
  ```

---

## 🧱 Tech Stack

| Layer | Tools |
|--------|--------|
| Server | Node.js + Express |
| Bot | Telegraf |
| Database | PostgreSQL |
| Hosting | Render (backend + bot) |
| Frontend | Vercel (static deploy) |
| Auth | Telegram initData verification |
| UI | HTML + Tailwind-inspired CSS |
| Payments | UPI or Telegram Payments |

---

## 🔮 Next Planned Enhancements

| Area | Feature |
|------|----------|
| Orders | User order history & admin order view |
| Admin UI | Search, filter, edit inline, pagination |
| Notifications | Telegram alert for new orders |
| Roles | Multi-admin user management |
| UX | Better mobile layout, animations |
| Docs | Developer API documentation page |

---

## 🧭 Maintenance & Commands

### Local Testing
```bash
npm install
npm run start       # Runs backend
npm run start:bot   # Runs bot
```

### Deployment
- Push to `main` branch → Render auto-deploys.
- Or manually deploy with “Clear cache”.

### Health Checks
- `/ping` (bot)
- `GET https://telegram-mini-mart.onrender.com/__dbping`
- Telegram chat `/whoami` → should show your ID.

---

## 💡 Key Learnings / Notes

1. Telegram channels **cannot** use `web_app` buttons → must use `url:` + `startapp`.
2. Separate bot worker is required for stable long polling.
3. Environment management is crucial — always check `__envcheck`.
4. The admin console and storefront share the same backend.
5. Render free plan sleeps after inactivity → first request may delay by ~50s.

---

### ✅ Status: STABLE BASELINE
As of **October 7, 2025**,  
- Backend and bot both running on Render.  
- WebApp is live on Vercel.  
- Telegram channel integrated with pinned “Shop Now” button.  
- Admin console fully functional with DB sync.

---

*Next milestone: add persistent order management & live notifications.*
