import { Request, Response } from "express";
import { SubscriptionRequest } from "../Model/SubscriptionReq.model";
import { Status } from "../services/types";
import { SendGroupInvite } from "../bot/SendInvite";
import axios from "axios";

export const VerifyPayment = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { tx_ref } = req.params;

  try {
    const sub = await SubscriptionRequest.findOne({ tx_ref });
    if (!sub) {
      res.status(400).json({ message: "Subscription Not Found" });
      return;
    }
    if (sub.status === "Completed") {
      res.status(200).json({ message: "Already verified" });
      return;
    }

    const chapaRes = await axios.get(
      `https://api.chapa.co/v1/transaction/verify/${tx_ref}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.CHAPA_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(chapaRes.data);
    if (!chapaRes) {
      res.json({ message: "failed" });
      return;
    }

    console.log(chapaRes);
    sub.status = Status.COMPLETED;
    // const expiresAt = new Date();
    // expiresAt.setMonth(expiresAt.getMonth() + 1); // Properly roll over months
    const expiresAt = new Date(Date.now() + 1 * 60 * 1000); // 1 minute just for testing

    sub.expireAt = new Date(Date.now() - 2 * 60 * 1000);
    await sub.save();

    await SendGroupInvite(sub.telegramId, sub.groupId);
    res.status(200).json({ success: true, message: "Payment verified" });
    return;
  } catch (error) {
    console.error("Failed to send invite:", error);
    res.status(500).send({ success: false, error: "Invite failed" });
  }
};
