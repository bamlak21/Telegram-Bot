import { Telegraf } from "telegraf";
import { ServerConfig } from "../config/ServerConfig";
import axios from "axios";
import { Verify } from "../utils/checkUser";
import { message } from "telegraf/filters";
import { InitializePayment } from "../utils/chapaIntialization";
import { error } from "console";
import { sendGroupPhotoAndInvoice } from "./photo";
import { bot } from "./botInstance";
import fs from "fs";
import path from "path";
import { ChatMemberUpdated } from "telegraf/typings/core/types/typegram";
import { Subscription } from "../Model/Subscription.model";
import { Course } from "../Model/Course.model";
import mongoose from 'mongoose';

mongoose.connect(ServerConfig.MongoUrl)
  .then(() => console.log('MongoDB connected in bot process'))
  .catch(err => console.error('MongoDB connection error in bot process:', err));

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

  await sendGroupPhotoAndInvoice({
    ctx,
    groupId: checkUser.groupId,
    courseId: checkUser.courseId,
    userId: checkUser.userId,
    telegramId: `${userTelegramId}`,
    amount: checkUser.groupSubPrice,
    courseName: checkUser.courseName,
    phoneNumber: checkUser.phoneNumber, 
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

// Handle pre-checkout query
bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));

// Handle successful payment
bot.on("successful_payment", async (ctx) => {
  await ctx.reply("✅ Payment received! You will be added to the group.");

  const payload = ctx.message.successful_payment.invoice_payload;
  const [userId, courseId] = payload.split("_");
  const telegramId = ctx.from?.id?.toString() || "";
  const tx_ref = payload;

  // Fetch groupId from Course model
  let groupId = "";
  try {
    const course = await Course.findById(courseId);
    if (course && course.groupId) {
      groupId = course.groupId;
    } else {
      console.error("Course not found or missing groupId for courseId:", courseId);
      await ctx.reply("⚠️ Could not find group information for your subscription.");
      return;
    }
  } catch (err) {
    console.error("Failed to fetch course for groupId:", err);
    await ctx.reply("⚠️ Could not find group information for your subscription.");
    return;
  }

  console.log('these is ', userId,
    telegramId,
    courseId,
    groupId,
    tx_ref,);
  
  // Create a Subscription document
  try {
    await Subscription.create({
      userId,
      telegramId,
      courseId,
      groupId,
      tx_ref,
      expireAt: undefined, // Set if you have an expiration policy
    });
    console.log("Subscription created for user:", userId, "course:", courseId);
  } catch (err) {
    console.error("Failed to create subscription:", err);
  }
});
