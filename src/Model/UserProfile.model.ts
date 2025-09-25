import mongoose, { Schema } from 'mongoose';

const UserProfileSchema = new Schema({
  telegramId: { type: String, unique: true, index: true, required: true },
  phoneNumber: { type: String, index: true },
  fullName: { type: String },
  gender: { type: String },
  dob: { type: String },
  residence_location: { type: String },
  email: { type: String },
  language: { type: String },
  telegramUsername: { type: String },
}, { timestamps: true });

export const UserProfile = mongoose.model('UserProfile', UserProfileSchema); 