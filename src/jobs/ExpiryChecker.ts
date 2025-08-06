import cron from "node-cron";
import { SubscriptionRequest } from "../Model/SubscriptionReq.model";
import { bot } from "../bot/botInstance";
import { Status } from "../services/types";
import { Subscription } from "../Model/Subscription.model";

export function startExpireJob() {
  cron.schedule("* * * * *", async () => {
    // Every 1 minute (change to "0 2 * * *" for daily at 2AM in production)
    console.log("🔁 Running expiration and reminder check...");
    const now = new Date();

    const subs = await Subscription.find({
      status: Status.COMPLETED,
    });

    for (const sub of subs) {
      if (!sub.expireAt) {
        console.warn(`❗ No expireAt date found for user ${sub.telegramId}`);
        return;
      }
      const expiresAt = new Date(sub.expireAt);
      const timeDiff = expiresAt.getTime() - now.getTime();
      const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

      // ⏰ Reminder if 2 or 1 days left and not notified yet
      if (
        (daysLeft === 2 || daysLeft === 1) &&
        !sub.notifiedBeforeExpiry.includes(daysLeft)
      ) {
        try {
          const chat = await bot.telegram.getChat(sub.groupId); // Fetch group name
          const groupName =
            "title" in chat && chat.title ? chat.title : "your premium group";

          await bot.telegram.sendMessage(
            Number(sub.telegramId),
            `⏰ Your access to *${groupName}* expires in *${daysLeft} day${
              daysLeft === 1 ? "" : "s"
            }*.`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "🔁 Renew Now",
                      callback_data: `renew_${sub._id}`,
                    },
                  ],
                ],
              },
            }
          );

          sub.notifiedBeforeExpiry.push(daysLeft);
          await sub.save();

          console.log(
            `🔔 Notified ${sub.telegramId} for ${daysLeft} day(s) left.`
          );
        } catch (err) {
          console.error(`❌ Error notifying ${sub.telegramId}:`, err);
        }
      }

      // ❌ Kick expired users
      if (expiresAt <= now && sub.status === Status.COMPLETED) {
        // ✅ Check if user has another active sub for same group
        const hasOtherActiveSub = await Subscription.exists({
          _id: { $ne: sub._id }, // not this current sub
          telegramId: sub.telegramId,
          groupId: sub.groupId,
          status: Status.COMPLETED,
          expireAt: { $gt: now },
        });

        if (hasOtherActiveSub) {
          console.log(
            `✅ User ${sub.telegramId} has a newer active subscription for group ${sub.groupId}. Skipping kick.`
          );
          continue; // Skip kicking
        }

        try {
          await bot.telegram.kickChatMember(
            sub.groupId,
            Number(sub.telegramId)
          );
          await bot.telegram.unbanChatMember(
            sub.groupId,
            Number(sub.telegramId)
          );

          sub.status = Status.EXPIRED;
          await sub.save();
          await bot.telegram.sendMessage(
            Number(sub.telegramId),
            `⏰ Your access to the premium group had expired`,
            { parse_mode: "Markdown" }
          );
          console.log(`🚫 Removed expired user: ${sub.telegramId}`);
        } catch (err) {
          console.error(`❌ Error removing user ${sub.telegramId}:`, err);
        }
      }
    }
  });
}
