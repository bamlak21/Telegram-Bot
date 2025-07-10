import cron from "node-cron";
import { SubscriptionRequest } from "../Model/SubscriptionReq.model";
import { bot } from "../bot/botInstance";
import { Status } from "../services/types";

export function startExpireJob() {
  cron.schedule("* * * * *", async () => {
    // Every 1 minute (change to "0 2 * * *" for daily at 2AM in production)
    console.log("🔁 Running expiration and reminder check...");
    const now = new Date();

    const subs = await SubscriptionRequest.find({
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
          await bot.telegram.sendMessage(
            Number(sub.telegramId),
            `⏰ Your access to the premium group expires in *${daysLeft} day(s)*.\nRenew now to avoid removal.`,
            { parse_mode: "Markdown" }
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
