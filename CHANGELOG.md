# 🧾 CHANGELOG — South Asia Mart

All notable changes to this project will be documented here.  
This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) principles  
and uses [Semantic Versioning](https://semver.org/).

---

## [v1.3.0] — *Upcoming (October 2025)*
### 🚧 Planned — “Order History & Notifications” Release
**Focus areas:**
- 🧠 Persistent user order tracking (both user-side & admin)
- 🔔 Telegram notification on new orders
- 📦 Admin enhancements — stock, category filter, inline edit
- 🧰 UI polishing — responsive layout and checkout improvements
- 📜 API endpoint docs (`/orders`, `/notifications`)
- 🔐 Stability & error-handling improvements for bot + backend

---

## [v1.2.0] — *Released October 7, 2025*
### ✅ Stabilization Release
**Highlights:**
- 🧾 Added complete documentation under `docs/PROJECT_OVERVIEW.md`
- 🤖 Refactored Telegram bot (`src/bot/bot.js`)  
  → fixed `/postshop` integration & `BUTTON_TYPE_INVALID` error  
  → migrated to `startapp` for proper inline app opening
- 💬 Configured “Shop Now” button for private chats and channels
- ⚙️ Cleaned up environment variables (`OWNER_ID`, `CHANNEL_ID`, `WEBAPP_URL`)
- 🖥️ Backend and bot hosted on **Render (free tier)**
- 🌐 Web front-end deployed to **Vercel**
- 🔄 Confirmed full Telegram → Mini App launch flow working end-to-end
- 📦 Updated `package.json` start scripts (`start`, `start:bot`, `start:both`)

---

## [v1.1.0] — *Released September 30, 2025*
### ⚙️ Infrastructure & Flow Update
- 🧱 Setup **Render** + **Vercel** deployments
- 🛠️ Added base database schema for products and orders
- 🧾 Improved checkout flow, including age-restricted product validation
- 🎨 Minor UX fixes to `index.html` and `admin.html`

---

## [v1.0.0] — *Released September 25, 2025*
### 🧩 Initial Project Bootstrap
- 🚀 Repository initialization (`telegram-mini-mart`)
- 💻 Created core files:  
  `server.js`, `index.html`, `admin.html`, `app.js`
- 📦 Implemented basic CRUD operations for products and orders
- 🤖 Registered Telegram bot via BotFather
- 🔐 Setup first-time Render + database connection
- 🧰 Defined base environment variables (`BOT_TOKEN`, `DATABASE_URL`, `ADMIN_PASSWORD`)

---

### 🧭 Versioning Policy
- **Major (X.0.0):** Architecture or framework-level change  
- **Minor (1.X.0):** New features or modules  
- **Patch (1.0.X):** Bug fixes or small enhancements

---

### 🧑‍💻 Maintainers
- **Rahul Agrawal** — Founder & Product Owner  
- **GPT-5 Assistant** — System Architect & Technical Guide  

---

📘 *For full architecture and setup details, see*  
👉 [docs/PROJECT_OVERVIEW.md](./docs/PROJECT_OVERVIEW.md)
