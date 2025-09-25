// src/bot/botInstance.ts
import { Telegraf } from "telegraf";
import { ServerConfig } from "../config/ServerConfig";

if (!ServerConfig.BOT_TOKEN) {
  throw new Error("Bot Token not Found in side .env");
}

const bot = new Telegraf(process.env.BOT_TOKEN || "");

export { bot };
