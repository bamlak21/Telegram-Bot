"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = void 0;
// src/bot/botInstance.ts
const telegraf_1 = require("telegraf");
const ServerConfig_1 = require("../config/ServerConfig");
if (!ServerConfig_1.ServerConfig.BOT_TOKEN) {
    throw new Error("Bot Token not Found in side .env");
}
exports.bot = new telegraf_1.Telegraf(ServerConfig_1.ServerConfig.BOT_TOKEN);
