"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const checkUser_1 = require("../utils/checkUser");
const photo_1 = require("./photo");
const botInstance_1 = require("./botInstance");
botInstance_1.bot.start(async (ctx) => {
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
    const checkUser = await (0, checkUser_1.Verify)({ userId, courseId });
    console.log(checkUser);
    if (checkUser.success !== true) {
        return ctx.reply("Access denied! User is not a registered user or have not enrolled to a course");
    }
    if (!checkUser.groupId) {
        console.log("Group id not found");
    }
    await (0, photo_1.sendGroupPhotoWithPayment)({
        ctx,
        groupId: checkUser.groupId,
        courseId: checkUser.courseId,
        userId: checkUser.userId,
        telegramId: `${userTelegramId}`,
        amount: checkUser.groupSubPrice,
    });
});
botInstance_1.bot.on("new_chat_members", async (ctx) => {
    console.log(JSON.stringify(ctx.update, null, 2));
});
botInstance_1.bot.command("id", (ctx) => {
    console.log("Chat ID:", ctx.chat.id);
    ctx.reply(`🆔 This group's ID is: \`${ctx.chat.id}\``, {
        parse_mode: "Markdown",
    });
});
botInstance_1.bot.telegram.getMe().then((botInfo) => {
    console.log(`🤖 Logged in as @${botInfo.username}, 🤖 Telegram Bot is up and running!`);
});
botInstance_1.bot.launch();
// Enable graceful stop
process.once("SIGINT", () => botInstance_1.bot.stop("SIGINT"));
process.once("SIGTERM", () => botInstance_1.bot.stop("SIGTERM"));
