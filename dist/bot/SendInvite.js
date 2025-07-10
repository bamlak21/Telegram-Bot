"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SendGroupInvite = SendGroupInvite;
const botInstance_1 = require("./botInstance");
async function SendGroupInvite(telegramId, groupId) {
    try {
        const member = await botInstance_1.bot.telegram.getChatMember(groupId, Number(telegramId));
        if (["member", "administrator", "creator"].includes(member.status)) {
            await botInstance_1.bot.telegram.sendMessage(Number(telegramId), "✅ You are already a member of the group.");
            return;
        }
        // ✅ Create a one-time invite link (expires in 10 mins)
        const invite = await botInstance_1.bot.telegram.createChatInviteLink(groupId, {
            expire_date: Math.floor(Date.now() / 1000) + 600,
            member_limit: 1,
        });
        await botInstance_1.bot.telegram.sendMessage(Number(telegramId), `🎉 Payment verified! Join your group here:\n${invite.invite_link}`);
        return;
    }
    catch (error) {
        console.log(error);
        return;
    }
}
