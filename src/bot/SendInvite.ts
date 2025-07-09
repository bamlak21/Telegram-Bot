import { bot } from "./botInstance";

export async function SendGroupInvite(telegramId: string, groupId: string) {
  try {
    const member = await bot.telegram.getChatMember(
      groupId,
      Number(telegramId)
    );

    if (["member", "administrator", "creator"].includes(member.status)) {
      await bot.telegram.sendMessage(
        Number(telegramId),
        "✅ You are already a member of the group."
      );
      return;
    }

    // ✅ Create a one-time invite link (expires in 10 mins)

    const invite = await bot.telegram.createChatInviteLink(groupId, {
      expire_date: Math.floor(Date.now() / 1000) + 600,
      member_limit: 1,
    });

    await bot.telegram.sendMessage(
      Number(telegramId),
      `🎉 Payment verified! Join your group here:\n${invite.invite_link}`
    );
    return;
  } catch (error) {
    console.log(error);
    return;
  }
}
