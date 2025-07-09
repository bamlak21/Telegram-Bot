import mongoose, { Schema } from "mongoose";

const UserSchema = new Schema(
  {
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
    },
    subscribedGroups: [
      {
        type: String, // Store groupId as string
        required: true,
      },
    ],
    // Add more fields as needed
  },
  { timestamps: true }
);

export const User = mongoose.model("User", UserSchema);
