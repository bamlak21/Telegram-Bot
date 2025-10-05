import { bot } from '../bot/botInstance';
import { UserProfile } from '../Model/UserProfile.model';
import { SubscriptionRequest } from '../Model/SubscriptionReq.model';

interface CommunityData {
  communityId: string;
  communityName: string;
  description?: string;
  price: number;
  mentorName?: string;
  category?: string;
}

export async function sendNewCommunityNotification(communityData: CommunityData) {
  try {
    console.log('📢 Sending new community notification to all users...');

    const allUsers = await UserProfile.find({}).select('telegramId language');
    console.log(`📊 Found ${allUsers.length} users to notify`);

    let successCount = 0;
    let errorCount = 0;

    for (const user of allUsers) {
      try {
        const telegramId = user.telegramId;
        const userLang = user.language || 'en';
        const isAmharic = userLang === 'am';

        // Professional description, ignoring user-provided description
        const professionalDesc = isAmharic
          ? `እንኳን ወደ አዲሱ ማህበረሰብ በደህና መጡ። በዚህ ማህበረሰብ ውስጥ እርስዎ የሚፈልጉትን መረጃ እና ዕውቀት ማግኘት ይችላሉ።`
          : `Welcome to the new community! Here you can access curated resources, connect with mentors, and engage with other members to enhance your skills and knowledge.`;

        const message = isAmharic
          ? `🎉 **አዲስ ማህበረሰብ ተፈጥሯል!**

🏛️ **${communityData.communityName}**
📝 ${professionalDesc}
💰 **ዋጋ:** ${communityData.price} ብር
${communityData.mentorName ? `👨‍🏫 **መምህር:** ${communityData.mentorName}` : ''}

🔗 **ለመቀላቀል:** /start ይጫኑ እና አዲሱን ማህበረሰብ ይመርጡ።

---
*ይህ አዲስ ማህበረሰብ ነው። ለመቀላቀል እባክዎ /start ይጫኑ።*`
          : `🎉 **New Community Created!**

🏛️ **${communityData.communityName}**
📝 ${professionalDesc}
💰 **Price:** ${communityData.price} ETB
${communityData.mentorName ? `👨‍🏫 **Mentor:** ${communityData.mentorName}` : ''}

🔗 **To Join:** Use /start and select the new community.

---
*This is a new community. To join, please use /start.*`;

        const keyboard = {
          inline_keyboard: [
            [
              {
                text: isAmharic ? '🚀 ማህበረሰብ ይመልከቱ' : '🚀 View Communities',
                callback_data: 'back_to_communities'
              }
            ],
            [
              {
                text: isAmharic ? '📱 ማህበረሰቦቼ' : '📱 My Communities',
                callback_data: 'my_communities'
              }
            ]
          ]
        };

        await bot.telegram.sendMessage(telegramId, message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });

        successCount++;
        console.log(`✅ Notification sent to user ${telegramId} (${userLang})`);

        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        errorCount++;
        console.error(`❌ Failed to send notification to user ${user.telegramId}:`, error);
      }
    }

    console.log(`📢 Notification complete: ${successCount} sent, ${errorCount} failed`);

    return { success: true, totalUsers: allUsers.length, successCount, errorCount };

  } catch (error) {
    console.error('❌ Error sending community notifications:', error);
    return { success: false, error: (error as Error).message };
  }
}


// Function to send targeted notifications to specific user groups
export async function sendTargetedNotification(
  targetUsers: string[], 
  message: string, 
  keyboard?: any
) {
  try {
    console.log(`📢 Sending targeted notification to ${targetUsers.length} users...`);
    
    let successCount = 0;
    let errorCount = 0;

    for (const telegramId of targetUsers) {
      try {
        await bot.telegram.sendMessage(telegramId, message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,

        });

        successCount++;
        console.log(`✅ Targeted notification sent to user ${telegramId}`);

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error) {
        errorCount++;
        console.error(`❌ Failed to send targeted notification to user ${telegramId}:`, error);
      }
    }

    console.log(`📢 Targeted notification complete: ${successCount} sent, ${errorCount} failed`);
    
    return {
      success: true,
      totalUsers: targetUsers.length,
      successCount,
      errorCount
    };

  } catch (error) {
    console.error('❌ Error sending targeted notifications:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}
