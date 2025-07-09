import mongoose, { Schema, Document } from "mongoose";
import { Status } from "../services/types";

const SubscriptionRequestSchema = new Schema(
  {
    userId: { type: String, required: true },
    telegramId: { type: String, required: true },
    courseId: { type: String, required: true },
    groupId: { type: String, required: true },
    tx_ref: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(Status),
      default: Status.PENDING,
    },
    expireAt: Date,
  },
  { timestamps: true }
);

export const SubscriptionRequest = mongoose.model(
  "SubscriptionRequest",
  SubscriptionRequestSchema
);
