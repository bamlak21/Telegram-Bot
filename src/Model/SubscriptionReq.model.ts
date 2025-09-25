import mongoose, { Schema, Document } from "mongoose";
import { Status } from "../services/types";

const SubscriptionRequestSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    groupId: { type: String, required: true },
    tx_ref: { type: String, required: true, index: true },
    status: {
      type: String,
      required: true,
      default: "active",
    },
    paymentStatus: { type: String, enum: ["pending", "paid", "renewed", "expired"], default: "pending", index: true },
    joinDate: { type: Date },
    expireAt: { type: Date, index: true },
    communityId: { type: String, index: true },
    communityName: { type: String },
    amount: { type: Number },
    expiryNoticeCount: { type: Number, default: 0 },
    lastNoticeAt: { type: Date },
  },
  { timestamps: true }
);

export const SubscriptionRequest = mongoose.model(
  "SubscriptionRequest",
  SubscriptionRequestSchema
);
