// if (isPaid) {
//   try {
//     const member = await bot.telegram.getChatMember(
//       checkUser.groupId,
//       userTelegramId
//     );

//     if (["member", "administrator", "creator"].includes(member.status)) {
//       return ctx.reply("✅ You are already a member of the group.");
//     }
//     // ✅ Create a one-time invite link (expires in 10 mins)
//     const invite = await ctx.telegram.createChatInviteLink(
//       checkUser.groupId,
//       {
//         expire_date: Math.floor(Date.now() / 1000) + 60 * 10, // 10 mins
//         member_limit: 1,
//       }
//     );

//     // ✅ Send the invite to the user
//     await ctx.reply(
//       `🎉 You're verified!\nJoin the group using this link (valid for 10 mins):\n${invite.invite_link}`
//     );
//   } catch (err) {
//     console.error("❌ Invite creation failed:", err);
//     ctx.reply("Something went wrong generating the group invite.");
//   }
// }

// todo: Pay logic
// const payUrl = await InitializePayment({
//   amount: checkUser.amount,
//   firstName: checkUser.firstName,
//   lastName: checkUser.lastName,
//   phoneNumber: checkUser.phoneNumber,
// });

// if (!payUrl) {
//   return ctx.reply("Failed to initialize payment. Please try again later.");
// }
