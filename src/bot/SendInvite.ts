import { bot } from "./botInstance";

export async function SendGroupInvite(userId: string, groupId: string): Promise<void> {
  try {
    console.log(`📨 Attempting to send group invite for user ${userId} to group ${groupId}`);
    // Assuming you use Telegraf to send the invite link
    const inviteLink = await bot.telegram.createChatInviteLink(groupId, {
      member_limit: 1,
      creates_join_request: false,
    });
    await bot.telegram.sendMessage(userId, `Join the group using this link: ${inviteLink.invite_link}`);
    console.log(`✅ Invite link sent to user ${userId} for group ${groupId}`);
  } catch (error) {
    console.error(`❌ Failed to send group invite for user ${userId} to group ${groupId}:`, error);
    throw new Error(`Failed to send invite: ${(error as Error).message}`);
  }
}
