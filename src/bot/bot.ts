import { Telegraf } from "telegraf";
import { ServerConfig } from "../config/ServerConfig";
import axios from "axios";
import { Verify } from "../utils/checkUser";
import { message } from "telegraf/filters";
import { InitializePayment } from "../utils/chapaIntialization";
import { error } from "console";
import { sendGroupPhotoWithPayment } from "./photo";
import { bot } from "./botInstance";
import fs from "fs";
import path from "path";
import { ChatMemberUpdated } from "telegraf/typings/core/types/typegram";

bot.start(async (ctx) => {
  //Get user telegram ID
  const userTelegramId = ctx.from?.id;
  console.log(`User telegramId: ${userTelegramId}`);

  const params = ctx.message?.text || "";
  console.log(params);

  const payload = params.split(" ")[1];

  console.log(payload);
  if (!payload) {
    return ctx.reply("No start parameter is found");
  }

  //Get userId & courseId from the start parameter and verify user
  const [userId, courseId] = payload.split("_");
  if (!userId || !courseId) {
    return ctx.reply("Invalid Link");
  }

  // verification
  const checkUser = await Verify({ userId, courseId });
  console.log(checkUser);

  if (checkUser.success !== true) {
    return ctx.reply(
      "Access denied! User is not a registered user or have not enrolled to a course"
    );
  }

  if (!checkUser.groupId) {
    console.log("Group id not found");
  }

  await sendGroupPhotoWithPayment({
    ctx,
    groupId: checkUser.groupId,
    courseId: checkUser.courseId,
    userId: checkUser.userId,
    telegramId: `${userTelegramId}`,
    amount: checkUser.groupSubPrice,
  });
});

bot.on("new_chat_members", async (ctx) => {
  console.log(JSON.stringify(ctx.update, null, 2));
});

bot.command("id", (ctx) => {
  console.log("Chat ID:", ctx.chat.id);
  ctx.reply(`🆔 This group's ID is: \`${ctx.chat.id}\``, {
    parse_mode: "Markdown",
  });
});

bot.telegram.getMe().then((botInfo) => {
  console.log(
    `🤖 Logged in as @${botInfo.username}, 🤖 Telegram Bot is up and running!`
  );
});
bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
