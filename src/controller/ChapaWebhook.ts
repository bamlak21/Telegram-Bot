import { Request, Response } from "express";
import { SubscriptionRequest } from "../Model/SubscriptionReq.model";
import { SendGroupInvite } from "../bot/SendInvite";

export async function chapaWebhook(req: Request, res: Response): Promise<void> {
  try {
    const event = req.body || {};
    console.log("🔔 Chapa webhook received:", JSON.stringify(event, null, 2));

    // Normalize txRef and status based on payload formats
    const txRef: string | undefined = event?.payload || event?.tx_ref || event?.data?.tx_ref || event?.data?.reference;
    const statusRaw: string | undefined = event?.status || event?.data?.status;
    const status = (statusRaw || '').toLowerCase();
    const amountRaw = event?.amount || event?.data?.amount;
    const chatId = event?.chat_id || event?.telegram_id || event?.user_id;

    if (!txRef) {
      res.status(400).json({ success: false, message: "tx_ref (payload) missing" });
      return;
    }

    const sub = await SubscriptionRequest.findOne({ tx_ref: txRef });
    if (!sub) {
      console.warn("⚠️ SubscriptionRequest not found for tx_ref:", txRef);
      res.status(404).json({ success: false, message: "Subscription not found" });
      return;
    }

    if (status === "success") {
      const now = new Date();
      const expireAt = new Date(now);
      expireAt.setMonth(expireAt.getMonth() + 1);

      sub.paymentStatus = 'paid' as any;
      sub.status = 'active' as any;
      (sub as any).joinDate = now as any;
      sub.expireAt = sub.expireAt || (expireAt as any);
      if (amountRaw && !(sub as any).amount) {
        (sub as any).amount = Number(amountRaw);
      }
      await sub.save();

      const telegramId = (sub as any).userId || (chatId ? String(chatId) : undefined);
      const groupId = (sub as any).groupId;

      if (telegramId && groupId) {
        try {
          await SendGroupInvite(String(telegramId), String(groupId));
        } catch (e) {
          console.error('❌ Failed to send invite from webhook:', e);
        }
      } else {
        console.warn('⚠️ Missing telegramId or groupId for invite:', { telegramId, groupId });
      }

      res.status(200).json({ success: true });
      return;
    }

    // Non-success statuses acknowledged without changes
    res.status(200).json({ success: true, message: `ignored status: ${statusRaw}` });
  } catch (err) {
    console.error('Chapa webhook error', err);
    res.status(500).json({ success: false });
  }
} 