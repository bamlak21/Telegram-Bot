import { bot } from "./botInstance";

export async function SendGroupInvite(
  telegramId: string,
  groupId: string,
  text: string
) {
  try {
    // ✅ Create a one-time invite link (expires in 10 mins)
    console.log("telegramId type:", typeof telegramId);
    console.log("GroupId type: ", typeof groupId);

    const invite = await bot.telegram.createChatInviteLink(Number(groupId), {
      member_limit: 1,
    });

    await bot.telegram.sendMessage(
      Number(telegramId),
      `🎉 ${text} the group here:\n${invite.invite_link}`
    );

    console.log(
      "Sent invite to user: ",
      telegramId,
      "link: ",
      invite.invite_link
    );

    return;
  } catch (error) {
    console.log(error);
    return;
  }
}
