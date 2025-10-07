// Run this once to fix existing trial records missing trial fields
const mongoose = require('mongoose');

const SubscriptionRequestSchema = new mongoose.Schema({
  userId: String,
  communityId: String,
  paymentStatus: String,
  status: String,
  joinDate: Date,
  trialStartAt: Date,
  trialExpireAt: Date,
  trialUsed: Boolean,
  trialNoticeCount: Number,
  // ... other fields
}, { timestamps: true, strict: false });

const SubscriptionRequest = mongoose.model('SubscriptionRequest', SubscriptionRequestSchema);

async function fixTrialRecords() {
  try {
    await mongoose.connect(process.env.MONGO_URL || 'your-mongo-url');
    
    console.log('🔍 Finding trial records without trial fields...');
    
    const brokenTrials = await SubscriptionRequest.find({
      paymentStatus: 'trial',
      status: 'active',
      $or: [
        { trialStartAt: { $exists: false } },
        { trialExpireAt: { $exists: false } },
        { trialUsed: { $exists: false } }
      ]
    });
    
    console.log(`Found ${brokenTrials.length} trial records to fix`);
    
    for (const t of brokenTrials) {
      const joinDate = t.joinDate || t.createdAt || new Date();
      const trialStartAt = t.trialStartAt || joinDate;
      const trialExpireAt = t.trialExpireAt || (() => {
        const exp = new Date(trialStartAt);
        exp.setDate(exp.getDate() + 7);
        return exp;
      })();
      
      await SubscriptionRequest.findByIdAndUpdate(t._id, {
        trialStartAt,
        trialExpireAt,
        trialUsed: true,
        trialNoticeCount: t.trialNoticeCount || 0
      });
      
      console.log(`✅ Fixed trial for user ${t.userId}, expires: ${trialExpireAt.toISOString()}`);
    }
    
    console.log('🎉 Migration complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

fixTrialRecords();

