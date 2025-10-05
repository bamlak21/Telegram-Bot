import mongoose, { Schema } from 'mongoose';

const TransactionSchema = new Schema({
  communityId: { type: String, required: true, unique: true, index: true },
  totalAmount: { type: Number, required: true, default: 0 },
}, { timestamps: true });

export const Transaction = mongoose.model('Transaction', TransactionSchema); 