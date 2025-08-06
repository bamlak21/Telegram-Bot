import { Telegraf } from "telegraf";
import { ServerConfig } from "../config/ServerConfig";
import { Verify } from "../utils/checkUser";
import { sendGroupInvoiceWithPayment, sendGroupPhotoAndInvoice } from "./photo";
import { bot } from "./botInstance";
import { Subscription } from "../Model/Subscription.model";
import { Course } from "../Model/Course.model";
import mongoose from "mongoose";
import { Status } from "../services/types";
import { hasUserPaid } from "../utils/HasPaid";
import { SendGroupInvite } from "./SendInvite";
import { unbanIfBanned } from "../utils/unban";

mongoose
  .connect(ServerConfig.MongoUrl)
  .then(() => console.log("MongoDB connected in bot process"))
  .catch((err) =>
    console.error("MongoDB connection error in bot process:", err)
  );

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
  const checkUser = await Verify({ userId, courseId, userTelegramId });
  console.log(checkUser);

  if (checkUser.success !== true) {
    return ctx.reply(
      "Access denied! User is not a registered user or have not enrolled to a course"
    );
  }

  if (!checkUser.groupId) {
    console.log("Group id not found");
    return;
  }

  await unbanIfBanned(checkUser.groupId, userTelegramId);

  if (
    checkUser.exists &&
    checkUser.expireAt &&
    new Date(checkUser.expireAt) > new Date()
  ) {
    console.log(
      "✅ User already has an active subscription:",
      checkUser.expireAt
    );

    return ctx.reply(
      `🎉 You already have an active subscription until **${new Date(
        checkUser.expireAt
      ).toLocaleDateString()}**.\n\nNo payment is needed.`
    );
  }

  console.log("sub Price:", checkUser.groupSubPrice);

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

bot.on("left_chat_member", async (ctx) => {
  try {
    await ctx.deleteMessage(ctx.message.message_id);
    console.log("Deleted left message");
  } catch (err) {
    console.error("Failed to delete left message:", err);
  }
});

bot.on("new_chat_members", async (ctx) => {
  try {
    await ctx.deleteMessage(ctx.message.message_id);
    console.log("Deleted join message");
  } catch (err) {
    console.error("Failed to delete join message:", err);
  }
  // 🎯 Process each new member
  const newMembers = ctx.message.new_chat_members;

  console.log(newMembers);

  for (const member of newMembers) {
    const fullName = `${member.first_name} ${member.last_name || ""}`;
    const userId = member.id;
    const groupId = ctx.chat.id;
    console.log(`New user joined: ${fullName} (${userId})`);

    // Send welcome message
    const welcome = await ctx.reply(
      `👋 Welcome, ${fullName}!\n\nPlease make sure to follow the group rules:\n1. Be respectful\n2. No spam\n3. Follow admin instructions`
    );

    //Delete welcome message after 2 min
    setTimeout(async () => {
      try {
        await ctx.deleteMessage(welcome.message_id);
        console.log("Welcome message deleted");
      } catch (err) {
        console.error("Failed to deleted message");
      }
    }, 1000 * 60 * 2);

    // Check if user paid and remove if not
    const userPaid = await hasUserPaid(userId, groupId);
    setTimeout(async () => {
      if (!userPaid) {
        await Promise.all([
          ctx.kickChatMember(userId),
          ctx.unbanChatMember(userId),
        ]);
        console.log(`Removed ${fullName} for not paying.`);
      }
    }, 5000);
  }
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

bot.on("callback_query", async (ctx) => {
  const callbackQuery = ctx.callbackQuery;

  if ("data" in callbackQuery && typeof callbackQuery.data === "string") {
    const data = callbackQuery.data;

    if (data.startsWith("renew_")) {
      const [, subId] = data.split("_");

      console.log("➡️ Renew request received");
      console.log("Sub ID:", subId);

      await ctx.answerCbQuery(); // closes the loading on button

      try {
        const sub = await Subscription.findOne({ _id: subId });

        if (!sub) {
          console.log("Subscription doesn't exist");
          return;
        }

        const priceInCents = Math.round(Number(sub.price) * 100);

        await ctx.replyWithInvoice({
          title: "Renew Subscription",
          description: `Renew to continue to have access`,
          payload: `r_${sub.userId}_${sub.courseId}_${Date.now()}`,
          provider_token:
            process.env.CHAPA_PROVIDER_TOKEN || "<YOUR_CHAPA_PROVIDER_TOKEN>",
          currency: "ETB",
          prices: [{ label: "Group Access", amount: priceInCents }],
          start_parameter: "pay",
          need_phone_number: true,
          send_phone_number_to_provider: true,
          // provider_data: JSON.stringify({ phone: phoneNumber || "" }),
          // Optionally, you can use the group photo URL as photo_url
        });
      } catch (err) {
        console.error("❌ Failed to send group photo and invoice:", err);
        await ctx.reply(
          "⚠️ Could not send the payment invoice. Please try again later."
        );
      }
    } else {
      await ctx.answerCbQuery("❓ Unknown action.");
    }
  } else {
    console.warn("⚠️ Callback query has no data.");
  }
});

// Handle pre-checkout query
bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));

// Handle successful payment
bot.on("successful_payment", async (ctx) => {
  const payload = ctx.message.successful_payment.invoice_payload;
  const amountInCents = ctx.message.successful_payment.total_amount;
  const parts = payload.split("_");
  const isRenewal = payload.startsWith("r_");

  const userId = isRenewal ? parts[1] : parts[0];
  const courseId = isRenewal ? parts[2] : parts[1];
  const telegramId = ctx.from?.id?.toString() || "";
  const tx_ref = payload;
  const amount = amountInCents / 100;

  // Fetch groupId from Course model
  try {
    const course = await Course.findById(courseId);
    if (!course?.groupId) {
      await ctx.reply("⚠️ Could not find group information.");
      return;
    }
    const groupId = course.groupId;
    console.log(groupId);

    console.log("these is ", userId, telegramId, courseId, groupId, tx_ref);

    // Create a Subscription document

    const now = new Date();
    // Check for renewal past subscription
    let pastSub = null;
    if (isRenewal) {
      pastSub = await Subscription.findOne({
        telegramId,
        userId,
        groupId,
        status: Status.COMPLETED,
      });
    }

    // Calculate expiration
    let expireAt: Date;
    if (isRenewal && pastSub?.expireAt && pastSub.expireAt > now) {
      expireAt = new Date(pastSub.expireAt);
      console.log("Renewal");
    } else {
      expireAt = new Date(now);
      console.log("New");
    }
    expireAt.setMonth(expireAt.getMonth() + 1);

    // Create subscription
    await Subscription.create({
      userId,
      telegramId,
      courseId,
      groupId,
      price: amount,
      tx_ref,
      status: Status.COMPLETED,
      expireAt,
    });

    await SendGroupInvite(telegramId, groupId, "Payment verified! Join");

    console.log(
      "Subscription created for user:",
      telegramId,
      "course:",
      courseId
    );
  } catch (err) {
    console.error("Failed to create subscription:", err);
    await ctx.reply(
      "⚠️ Something went wrong while processing your payment. Contact support."
    );
  }
});
