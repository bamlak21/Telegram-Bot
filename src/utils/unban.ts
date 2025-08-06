import { bot } from "../bot/botInstance";

export async function unbanIfBanned(chatId: string, userId: number) {
  const member = await bot.telegram.getChatMember(Number(chatId), userId);
  console.log(member.status);

  if (member.status === "kicked") {
    await bot.telegram.unbanChatMember(Number(chatId), userId, {
      only_if_banned: true,
    });
    console.log(`User ${userId} unbanned from chat ${chatId}`);
  } else {
    console.log(`User ${userId} is not banned.`);
  }
}
