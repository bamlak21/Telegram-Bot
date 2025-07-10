import { Request, Response } from "express";
import { SubscriptionRequest } from "../Model/SubscriptionReq.model";
import { Status } from "../services/types";
import { randomUUID } from "crypto";

export const RenewSubscription = async (req: Request, res: Response) => {
  const { telegramId, groupId, courseId, userId } = req.body;

  if (!telegramId || !groupId || !courseId || !userId) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // Create new expiration date (1 month from today, safe for 28/30/31)
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + 1); // handles month rollover correctly

    // Generate new tx_ref
    const tx_ref = `TX-${randomUUID()}`;

    // Create new subscription document
    const newSub = new SubscriptionRequest({
      telegramId,
      groupId,
      courseId,
      userId,
      tx_ref,
      status: Status.PENDING,
      expiresAt,
    });

    await newSub.save();

    // Optionally send back tx_ref or redirect to payment
    res.status(201).json({
      success: true,
      message: "Renewal initialized",
      tx_ref,
      expiresAt,
    });
  } catch (error) {
    console.error("Renewal failed:", error);
    res.status(500).json({ message: "Failed to renew subscription" });
  }
};
