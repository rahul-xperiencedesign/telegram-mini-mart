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

