// src/bot/botInstance.ts
import { Telegraf } from "telegraf";
import { ServerConfig } from "../config/ServerConfig";

if (!ServerConfig.BOT_TOKEN) {
  throw new Error("Bot Token not Found in side .env");
}

export const bot = new Telegraf(ServerConfig.BOT_TOKEN);
