import mongoose, { Schema, Document } from "mongoose";
import { Status } from "../services/types";

const SubscriptionSchema = new Schema(
  {
    userId: { type: String, required: true },
    telegramId: { type: String, required: true, unique: true },
    courseId: { type: String, required: true },
    groupId: { type: String, required: true },
    tx_ref: { type: String, required: true },
    expireAt: Date,
  },
  { timestamps: true }
);

export const Subscription = mongoose.model("Subscription", SubscriptionSchema);
