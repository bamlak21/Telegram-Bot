import cron from 'node-cron';
import { bot } from '../bot/botInstance';
import { SubscriptionRequest } from '../Model/SubscriptionReq.model';

function scheduleExpiryJobs() {
  // Every minute for testing (use '0 8 * * *' for daily at 08:00)
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

      const expiring = await SubscriptionRequest.find({
        paymentStatus: { $in: ['paid', 'renewed'] },
        status: 'active',
        expireAt: { $gte: startOfDay, $lt: endOfDay },
        expiryNoticeCount: { $lt: 3 },
      });

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

      for (const [userId, docs] of byUser.entries()) {
        try {
          const isAm = ((docs[0] as any).language === 'am');
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

      // Final enforcement: require BOTH expired status and 3 notices, then remove from group
      const needKick = await SubscriptionRequest.find({
        status: 'active',
        paymentStatus: 'expired',
        expiryNoticeCount: { $gte: 3 },
      });

      for (const d of needKick) {
        const groupId = String((d as any).groupId || '');
        const userId = String((d as any).userId || '');
        if (!groupId || !userId) continue;
        try {
          await bot.telegram.banChatMember(groupId, Number(userId));
          await bot.telegram.unbanChatMember(groupId, Number(userId));

          (d as any).status = 'expired';
          (d as any).paymentStatus = 'expired';
          await (d as any).save();

          const isAm = ((d as any).language === 'am');
          await bot.telegram.sendMessage(
            userId,
            isAm
              ? '⛔ መዳረሻዎ ልክ ሆኖ አልተዘማመነም፣ ከቡድኑ ተወግደዋል። እንደገና ለመዳረስ እድሳት ይጠቀሙ።'
              : '⛔ Your access has expired and you have been removed from the group. Use Renew to regain access.'
          );
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