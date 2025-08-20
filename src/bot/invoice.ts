import axios from "axios";
import path from "path";
import { Context } from "telegraf";
import { InitializePayment } from "../utils/chapaIntialization";
import { response } from "express";

type Params = {
  ctx: Context;
  groupId: string;
  courseId: string;
  userId: string;
  telegramId: string;
  amount: string;
  courseName?: string; // Add courseName as optional
  phoneNumber?: string; // Add phoneNumber
};

export async function sendGroupPhotoWithPayment({
  ctx,
  groupId,
  courseId,
  userId,
  telegramId,
  amount,
}: Params) {
  try {
    const chat = await ctx.telegram.getChat(groupId);

    if (!chat.photo) {
      return "ℹ️ This group has no profile picture.";
    }

    const file = await ctx.telegram.getFile(chat.photo.big_file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const imagePath = path.join(__dirname, "../../public/assets/welcome.png");

    // Fetch the image as a stream using Axios
    const response = await axios.get(fileUrl, { responseType: "stream" });

    // Initialize Chapa payment to get payment_token
    const tx_ref = `${userId}_${courseId}_${Date.now()}`;
    // For demo, using dummy names and phone. Replace with real user info if available.
    const paymentInit = await InitializePayment({
      amount: amount.toString(),
      firstName: "TelegramUser",
      lastName: telegramId,
      phoneNumber: "0910000000",
      tx_ref,
    });

    // Log all incoming parameters and payment initialization response for tracing
    console.log("sendGroupPhotoWithPayment params:", {
      groupId,
      courseId,
      userId,
      telegramId,
      amount,
    });
    console.log("Chapa payment initialization request:", {
      amount: amount.toString(),
      firstName: "TelegramUser",
      lastName: telegramId,
      phoneNumber: "0910000000",
      tx_ref,
      channel: "telegram",
    });
    console.log("Chapa payment initialization response:", paymentInit);

    let paymentButtonUrl: string | undefined = undefined;
    let paymentButtonText = `Pay ${amount} Birr to Join`;
    if (paymentInit && paymentInit.payment_token) {
      paymentButtonUrl = `https://t.me/Mercato_Online_bot?start=${paymentInit.payment_token}`;
    } else if (paymentInit && paymentInit.url) {
      paymentButtonUrl = paymentInit.url;
      paymentButtonText += " (opens in browser)";
    } else {
      await ctx.reply(
        "❌ Could not initialize payment. Please try again later."
      );
      return;
    }

    // Send the image with payment button (Telegram deep link or fallback to checkout_url)
    await ctx.replyWithPhoto(
      { source: response.data },
      {
        caption: "📚 Welcome to the group!\n💳 Proceed to payment:",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: paymentButtonText,
                url: paymentButtonUrl,
              },
            ],
          ],
        },
      }
    );
  } catch (err) {
    console.error("❌ Failed to fetch/send group photo:", err);
    await ctx.reply("⚠️ Could not load the group photo or payment link.");
  }
}

// Function to send a Telegram invoice for group payment
export async function sendGroupInvoiceWithPayment({
  ctx,
  groupId,
  courseId,
  userId,
  telegramId,
  amount,
}: Params) {
  try {
    // Telegram expects amount in the smallest currency unit (e.g., cents)
    const priceInCents = Math.round(Number(amount) * 100);
    await ctx.replyWithInvoice({
      title: "Group Subscription",
      description: `Pay to join the group (Course ID: ${courseId})`,
      payload: `${userId}_${courseId}_${Date.now()}`,
      provider_token: process.env.CHAPA_PROVIDER_TOKEN || "",
      currency: "ETB",
      prices: [{ label: "Group Access", amount: priceInCents }],
      start_parameter: "pay",
      photo_url: "https://domain.com/path/to/photo.png",
    });
  } catch (err) {
    console.error("❌ Failed to send invoice:", err);
    await ctx.reply(
      "⚠️ Could not send the payment invoice. Please try again later."
    );
  }
}

// Combined function: send group photo and then payment invoice
export async function sendGroupPhotoAndInvoice({
  ctx,
  groupId,
  courseId,
  userId,
  telegramId,
  amount,
  courseName,
  phoneNumber,
}: Params) {
  try {
    // Try to fetch and send the group photo
    let photoSent = false;
    let image;
    try {
      const chat = await ctx.telegram.getChat(groupId);
      if (chat.photo) {
        const file = await ctx.telegram.getFile(chat.photo.big_file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        const response = await axios.get(fileUrl, { responseType: "stream" });
        image = response.data;
        await ctx.replyWithPhoto(
          { source: response.data },
          {
            caption: `📚 Welcome to the group!\n💳 Proceed to payment for: ${
              courseName || "the course"
            }`,
          }
        );
        photoSent = true;
      }
    } catch (err) {
      console.error("Could not fetch/send group photo:", err);
    }
    if (!photoSent) {
      await ctx.reply(
        `📚 Welcome to the group!\n💳 Proceed to payment for: ${
          courseName || "the course"
        }`
      );
    }

    // Now send the payment invoice
    if (!amount || isNaN(Number(amount))) {
      console.error("❌ Invalid amount provided:", amount);
      await ctx.reply("⚠️ Payment amount is invalid. Please contact support.");
      return;
    }
    const priceInCents = Math.round(Number(amount) * 100);
    await ctx.replyWithInvoice({
      title: courseName || "Group Subscription",
      description: `Pay to join the group for ${courseName || "this course"}`,
      payload: `${userId}_${courseId}_${Date.now()}`,
      provider_token:
        process.env.CHAPA_PROVIDER_TOKEN || "<YOUR_CHAPA_PROVIDER_TOKEN>",
      currency: "ETB",
      prices: [{ label: courseName || "Group Access", amount: priceInCents }],
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
}
