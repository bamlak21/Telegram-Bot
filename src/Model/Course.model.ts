import mongoose, { Schema } from "mongoose";

const CourseSchema = new Schema(
  {
    groupId: {
      type: String,
      required: true,
      unique: true,
    },
    groupSubPrice: {
      type: Number,
      required: true,
    },
    courseName: {
      type: String,
      required: true,
    },
    // Add more fields as needed
  },
  { timestamps: true }
);

export const Course = mongoose.model("Course", CourseSchema);
