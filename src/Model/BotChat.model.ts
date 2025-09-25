import mongoose, { Schema } from 'mongoose';

const BotChatSchema = new Schema({
  chatId: { type: String, required: true, unique: true },
  type: { type: String },
  title: { type: String },
  username: { type: String },
  first_name: { type: String },
  last_name: { type: String },
  is_forum: { type: Boolean },
  linked_chat_id: { type: String },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

export const BotChat = mongoose.model('BotChat', BotChatSchema); 