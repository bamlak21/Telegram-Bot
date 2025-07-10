import axios from "axios";
import path from "path";
import { Context } from "telegraf";

type Params = {
  ctx: Context;
  groupId: string;
  courseId: string;
  userId: string;
  telegramId: string;
  amount: string;
};

export async function sendGroupPhotoWithPayment({
  ctx,
  groupId,
  courseId,
  userId,
  telegramId,
  amount,
}: // paymentUrl,
Params) {
  try {
    const chat = await ctx.telegram.getChat(groupId);

    if (!chat.photo) {
      return "ℹ️ This group has no profile picture.";
    }

    const file = await ctx.telegram.getFile(chat.photo.big_file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

    // Fetch the image as a stream using Axios
    const response = await axios.get(fileUrl, { responseType: "stream" });

    // Send the image with payment button
    await ctx.replyWithPhoto(
      { source: response.data },
      {
        caption: "📚 Welcome to the group!\n💳 Proceed to payment:",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `Pay ${amount} Birr to Join`,
                url: `${process.env.NGROK}/api/user/payinit?groupId=${groupId}&courseId=${courseId}&userId=${userId}&telegramId=${telegramId}&amount=${amount}`,
              },
            ],
          ],
        },
      }
    );
  } catch (err) {
    console.error("❌ Failed to fetch/send group photo:", err);
    await ctx.reply("⚠️ Could not load the group photo.");
  }
}
