import cron from 'node-cron';
import { bot } from '../bot/botInstance';
import { SubscriptionRequest } from '../Model/SubscriptionReq.model';
import { UserProfile } from '../Model/UserProfile.model';

function scheduleExpiryJobs() {
  // Daily at 8:00 AM for production
  cron.schedule('0 8 * * *', async () => {
    try {
      const now = new Date();
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

      console.log('🕐 Daily expiry check running at 8:00 AM...');
      
      // Find subscriptions that should be expiring today
      // Use a simpler approach - get all paid/active subscriptions and filter in code
      const allPaidSubs = await SubscriptionRequest.find({
        paymentStatus: { $in: ['paid', 'renewed'] },
        status: 'active',
        expiryNoticeCount: { $lt: 3 }
      });
      
      // Filter in JavaScript to avoid MongoDB date comparison issues
      const expiring = allPaidSubs.filter((sub: any) => {
        if (!sub.expireAt) return false;
        const expireDate = new Date(sub.expireAt);
        const today = new Date();
        return expireDate.getUTCFullYear() === today.getUTCFullYear() &&
               expireDate.getUTCMonth() === today.getUTCMonth() &&
               expireDate.getUTCDate() === today.getUTCDate();
      });
      
      console.log(`📊 Found ${expiring.length} subscriptions expiring today`);

      // Filter out docs already notified today
      const toNotify = expiring.filter((d: any) => {
        const last = (d as any).lastNoticeAt ? new Date((d as any).lastNoticeAt) : undefined;
        return !last || last < startOfDay; // not notified today
      });

      // Group by userId to send one message listing multiple communities
      const byUser = new Map<string, any[]>();
      for (const doc of toNotify) {
        const key = String((doc as any).userId);
        const list = byUser.get(key) || [];
        list.push(doc);
        byUser.set(key, list);
      }

      console.log(`📤 Sending notifications to ${byUser.size} users`);
      for (const [userId, docs] of byUser.entries()) {
        try {
          // Add fallback for missing profiles
          const userProfile = await UserProfile.findOne({ telegramId: userId });
          if (!userProfile) {
            console.warn(`⚠️ No UserProfile found for user ${userId}, skipping notification`);
            continue;
          }
          
          const isAm = (userProfile.language === 'am');
          const lines: string[] = [];
          for (const d of docs) {
            lines.push(`• ${((d as any).communityName) || (isAm ? 'ማህበረሰብ' : 'Community')}`);
          }
          const msg = isAm
            ? `⚠️ የእርስዎ መዳረሻ ዛሬ ይሽረሳል፦\n\n${lines.join('\n')}\n\nለመቀጠል እድሳት ይጫኑ።`
            : `⚠️ Your access expires today for:\n\n${lines.join('\n')}\n\nTap Renew to continue access.`;

          const keyboard = {
            inline_keyboard: [
              [
                { text: isAm ? '🔄 እድሳት' : '🔄 Renew', callback_data: `renew_community_${(docs[0] as any).communityId}` },
                { text: isAm ? '🏠 ማህበረሰብ ዝርዝር' : '🏠 Community list', callback_data: 'back_to_communities' },
              ],
            ],
          } as any;

          console.log(`📨 Sent expiry notification to user ${userId}`);
          await bot.telegram.sendMessage(userId, msg, { reply_markup: keyboard });

          for (const d of docs) {
            (d as any).expiryNoticeCount = ((d as any).expiryNoticeCount || 0) + 1;
            (d as any).lastNoticeAt = now;
            await (d as any).save();
          }
        } catch (notifyErr) {
          console.error('❌ Failed to send expiry reminder to user', userId, notifyErr);
        }
      }

      console.log('🔍 Checking for expired users to remove...');
      // Final enforcement: kick users after 3 notices OR if already expired
      const needKick = await SubscriptionRequest.find({
        status: 'active',
        $or: [
          { expiryNoticeCount: { $gte: 3 } },  // After 3 notices
          { paymentStatus: 'expired' }         // Or already expired
        ]
      });

      console.log(`👢 Found ${needKick.length} expired users to remove`);
      for (const d of needKick) {
        const groupId = String((d as any).groupId || '');
        const userId = String((d as any).userId || '');
        if (!groupId || !userId) continue;
        try {
          // Send final notification before kicking
          const userProfile = await UserProfile.findOne({ telegramId: userId });
          const isAm = userProfile?.language === 'am';
          
          const finalMsg = isAm
            ? '⛔ መዳረሻዎ ልክ ሆኖ አልተዘማመነም፣ ከቡድኑ ተወግደዋል። እንደገና ለመዳረስ እድሳት ይጠቀሙ።'
            : '⛔ Your access has expired and you have been removed from the group. Use Renew to regain access.';
          
          await bot.telegram.sendMessage(userId, finalMsg);
          console.log(`📨 Final notification sent to user ${userId}`);
          
          // Kick from group
          console.log(`👢 Removing user ${userId} from group`);
          await bot.telegram.banChatMember(groupId, Number(userId));
          await bot.telegram.unbanChatMember(groupId, Number(userId));

          // Update status to expired
          (d as any).status = 'expired';
          (d as any).paymentStatus = 'expired';
          await (d as any).save();
          console.log(`✅ User ${userId} marked as expired`);
          
        } catch (kickErr) {
          console.error('❌ Failed to kick user', { groupId, userId, id: (d as any)._id?.toString?.() }, kickErr);
        }
      }
    } catch (err) {
      console.error('❌ Expiry cron error:', err);
    }
  });
}

export { scheduleExpiryJobs };