import mongoose, { Schema, Document } from "mongoose";
import { Status } from "../services/types";

const SubscriptionSchema = new Schema(
  {
    userId: { type: String, required: true },
    telegramId: { type: String, required: true },
    courseId: { type: String, required: true },
    groupId: { type: String, required: true },
    price: { type: Number, required: true },
    tx_ref: { type: String, required: true },
    expireAt: Date,
    status: {
      type: String,
      required: true,
      enum: Object.values(Status),
      default: Status.PENDING,
    },
    notifiedBeforeExpiry: {
      type: [Number],
      default: [],
    },
  },
  { timestamps: true }
);

export const Subscription = mongoose.model("Subscription", SubscriptionSchema);
