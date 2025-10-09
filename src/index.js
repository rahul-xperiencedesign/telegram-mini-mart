// src/index.js
// Launch *one* Node process that boots both the API server and the bot.

import './server/server.js'; // starts Express and listens on PORT
import './bot/bot.js';        // starts Telegraf (long polling)
