import { SubscriptionRequest } from '../Model/SubscriptionReq.model';
import { bot } from './botInstance';
import { Transaction } from '../Model/Transaction.model';
import axios from 'axios';

export async function processVerifiedPayment(
  ctx: any,
  txRef: string,
  enrollSession: any,
  lang: 'en' | 'am'
) {
  try {
    const subRequest = await SubscriptionRequest.findOne({ tx_ref: txRef });
    if (!subRequest) {
      await ctx.reply(
        lang === 'en'
          ? '❌ Payment verified, but no subscription found. Please contact support.'
          : '❌ ክፍያ ተረጋግጧል፣ ግን ምዝገባ አልተገኘም። እባክዎ ድጋፍ ያግኙ።'
      );
      return;
    }

    subRequest.paymentStatus = 'paid' as any;
    subRequest.status = 'active' as any;
    (subRequest as any).joinDate = new Date();
    await subRequest.save();

    if (subRequest.userId && subRequest.groupId) {
      try {
        await SendGroupInvite(String(subRequest.userId), String(subRequest.groupId));
        await ctx.reply(
          lang === 'en'
            ? '✅ Payment verified and invite sent. Welcome!'
            : '✅ ክፍያ ተረጋግጧል እና ማስገቢያ ተልኳል። እንኳን በደህና መጡ!'
        );
      } catch (e) {
        await ctx.reply(
          lang === 'en'
            ? '✅ Payment verified, but failed to send invite. Contact support for manual access.'
            : '✅ ክፍያ ተረጋግጧል፣ ግን ማስገቢያ መላክ አልተሳካም። ለእጅ መዳረሻ ድጋፍ ያግኙ።'
        );
      }
    } else {
      await ctx.reply(
        lang === 'en'
          ? '✅ Payment verified, but group info is missing. Contact support.'
          : '✅ ክፍያ ተረጋግጧል፣ ግን የቡድን መረጃ ይጎዳል። ድጋፍ ያግኙ።'
      );
    }
  } catch (err) {
    await ctx.reply(
      lang === 'en'
        ? '❌ Failed to process payment. Please contact support.'
        : '❌ ክፍያ ማስኬድ አልተሳካም። እባክዎ ድጋፍ ያግኙ።'
    );
  }
}

export async function handleSuccessfulPayment(
  ctx: any,
  userLanguages: Map<number, 'en' | 'am'>,
  paymentSessions: Map<number, any>,
  enrollSessions: Map<number, any>
) {
  let lang: 'en' | 'am' = 'en';
  try {
    const userTelegramId = ctx.from?.id as number | undefined;
    if (!userTelegramId) {
      await ctx.reply('❌ Error: No user ID found. Please contact support.');
      return;
    }

    lang = (userLanguages.get(userTelegramId) || 'en') as 'en' | 'am';
    const payment = ctx.message?.successful_payment || ctx.update?.message?.successful_payment;
    if (!payment) {
      await ctx.reply(
        lang === 'en'
          ? '❌ Error: No payment data found. Please contact support.'
          : '❌ ስህተት፡ የክፍያ መረጃ አልተገኘም። እባክዎ ድጋፍ ያግኙ።'
      );
      return;
    }

    const txRef = String(payment.invoice_payload);
    console.log('🧾 handleSuccessfulPayment invoked with txRef (invoice_payload):', txRef);

    let subRequest: any = await SubscriptionRequest.findOne({ tx_ref: txRef });
    console.log('🔎 Lookup SubscriptionRequest by tx_ref result:', !!subRequest, subRequest?._id?.toString());
    if (!subRequest) {
      // Fallback: try to locate latest request for this user and community, then sync tx_ref
      const userIdStr = String(userTelegramId);
      const recovered = await SubscriptionRequest.findOne({ userId: userIdStr }).sort({ createdAt: -1 });
      if (recovered) {
        recovered.tx_ref = txRef as any;
        await recovered.save();
        subRequest = recovered;
        console.log('🛠️ Fallback matched latest request and synced tx_ref to:', txRef, 'docId:', subRequest._id.toString());
      } else {
        await ctx.reply(
          lang === 'en'
            ? '❌ Payment received, but no subscription found. Please contact support.'
            : '❌ ክፍያ ተቀብሏል፣ ግን ምዝገባ አልተገኘም። እባክዎ ድጋፍ ያግኙ።'
        );
        console.warn('❌ Could not find any SubscriptionRequest for user', userIdStr, 'to sync tx_ref', txRef);
        return;
      }
    }

    // Backfill missing group and identifiers from enrollment session if available
    const es = enrollSessions.get(userTelegramId);
    if (es) {
      if (!subRequest.groupId && es.community && es.community.groupId) {
        subRequest.groupId = String(es.community.groupId);
      }
      if (!subRequest.communityId && es.communityId) {
        subRequest.communityId = String(es.communityId);
      }
      if (!subRequest.communityName && es.communityName) {
        subRequest.communityName = String(es.communityName);
      }
      if (!subRequest.userId) {
        subRequest.userId = String(userTelegramId);
      }
    }

    console.log('📝 Updating SubscriptionRequest to paid/active:', {
      id: subRequest._id.toString(),
      userId: subRequest.userId,
      groupId: subRequest.groupId,
      communityId: subRequest.communityId,
      prevPaymentStatus: subRequest.paymentStatus,
      prevStatus: subRequest.status,
    });
    subRequest.paymentStatus = 'paid' as any;
    subRequest.status = 'active' as any;
    (subRequest as any).joinDate = new Date();
    // Set expireAt = joinDate + 1 month
    const expireAt = new Date((subRequest as any).joinDate);
    expireAt.setMonth(expireAt.getMonth() + 1);
    (subRequest as any).expireAt = expireAt;
    await subRequest.save();
    console.log('✅ Saved SubscriptionRequest after payment:', {
      id: subRequest._id.toString(),
      paymentStatus: subRequest.paymentStatus,
      status: subRequest.status,
      joinDate: subRequest.joinDate,
      expireAt: (subRequest as any).expireAt,
    });

    if (subRequest.userId && subRequest.groupId) {
      try {
        console.log('📨 Sending invite with groupId:', subRequest.groupId, 'to userId:', subRequest.userId);
        await SendGroupInvite(String(subRequest.userId), String(subRequest.groupId));
        const successMessage =
          lang === 'en'
            ? `✅ You successfully transferred ETB${(payment.total_amount / 100).toFixed(2)} to Tigat Bot for ${subRequest.communityName}. Your subscription is now active.\n\nJoin the group using the link sent above.\n⏳ The link will expire in 10 minutes.`
            : `✅ ለ${subRequest.communityName} ወደ Tigat Bot ETB${(payment.total_amount / 100).toFixed(2)} በተሳካ ሁኔታ አስተላልፈዋል። ምዝገባዎ አሁን ንቁ ነው።\n\nከላይ የተላከውን ሊንክ ተጠቅመው ቡድኑን ይቀላቀሉ።\n⏳ ሊንኩ በ10 ደቂቃ ውስጥ ይሽረሳል።`;
        await ctx.reply(successMessage);
        console.log('✅ Invite message sent to user', subRequest.userId);

        // === Update Transaction aggregation per community ===
        try {
          const amountPaid = Number(payment.total_amount) / 100; // ETB
          const commId = String((subRequest as any).communityId || '');
          if (commId) {
            await Transaction.findOneAndUpdate(
              { communityId: commId },
              { $inc: { totalAmount: amountPaid } },
              { upsert: true, new: true }
            );
            console.log('📈 Transaction total updated', { communityId: commId, amountPaid });
          } else {
            console.warn('⚠️ Missing communityId on subRequest; skipping Transaction update');
          }

          // === Post mentor revenue to external API ===
          try {
            const baseUrl = process.env.API_BASE_URL;
            if (!baseUrl) {
              console.warn('⚠️ API_BASE_URL is not set; skipping revenue post');
            } else {
              // Try to get mentorId from enrollment session community
              let mentorId: string | undefined;
              const es: any = enrollSessions.get(userTelegramId);
              if (es && es.community) {
                mentorId = es.community.mentorId || es.community.mentor?._id || es.community.mentor?.id || es.community.mentorId;
              }
              // If still missing, try fetching communities and match by communityId
              if (!mentorId && commId) {
                try {
                  const apiUrl = process.env.API_URL;
                  if (apiUrl) {
                    const resp = await axios.get(`${apiUrl}/api/v1/telegramCommunity/with-mentor`);
                    const list = Array.isArray(resp.data) ? resp.data : [];
                    const found = list.find((c: any) => (c.communityId === commId || c._id === commId || c.id === commId));
                    if (found) {
                      mentorId = found.mentorId || found.mentor?._id || found.mentor?.id;
                    }
                  }
                } catch (e) {
                  console.warn('⚠️ Failed to fetch communities for mentorId backfill', e);
                }
              }

              if (mentorId) {
                try {
                  const headers: any = {};
                  if (process.env.API_TOKEN) {
                    headers.Authorization = `Bearer ${process.env.API_TOKEN}`;
                  }
                  await axios.post(
                    `${baseUrl}/telegram-revenue/add`,
                    { mentorId, amount: amountPaid },
                    { headers }
                  );
                  console.log('💸 Mentor revenue posted', { mentorId, amountPaid });
                } catch (postErr: any) {
                  if (postErr?.response?.status === 404) {
                    console.warn('⚠️ Revenue record for mentor not found; skipping revenue post', { mentorId });
                  } else {
                    console.error('❌ Failed to post mentor revenue', postErr);
                  }
                }
              } else {
                console.warn('⚠️ mentorId not found; skipping revenue post');
              }
            }
          } catch (revErr) {
            console.error('❌ Revenue post flow failed', revErr);
          }
          // === end mentor revenue post ===
        } catch (aggErr) {
          console.error('❌ Failed to update Transaction totalAmount', aggErr);
        }
        // === end Transaction update ===
      } catch (e) {
        console.error('❌ Failed to send invite:', e);
        await ctx.reply(
          lang === 'en'
            ? `✅ You successfully transferred ETB${(payment.total_amount / 100).toFixed(2)} to Tigat Bot for ${subRequest.communityName}, but failed to send invite. Contact support for manual access.`
            : `✅ ለ${subRequest.communityName} ወደ Tigat Bot ETB${(payment.total_amount / 100).toFixed(2)} በተሳካ ሁኔታ አስተላልፈዋል፣ ግን ስያሜ መላክ አልተሳካም። ለእጅ መዳረሻ ድጋፍን ያግኙ።`
        );
      }
    } else {
      console.warn('⚠️ Missing userId or groupId for invite. userId:', subRequest.userId, 'groupId:', subRequest.groupId);
      await ctx.reply(
        lang === 'en'
          ? `✅ You successfully transferred ETB${(payment.total_amount / 100).toFixed(2)} to Tigat Bot for ${subRequest.communityName}, but group info is missing. Contact support for manual access.`
          : `✅ ለ${subRequest.communityName} ወደ Tigat Bot ETB${(payment.total_amount / 100).toFixed(2)} በተሳካ ሁኔታ አስተላልፈዋል፣ ግን የቡድን መረጃ ይጎዳል። ለእጅ መዳረሻ ድጋፍን ያግኙ።`
      );
    }
  } catch (err) {
    await ctx.reply(
      lang === 'en' ? '❌ Failed to process payment. Please contact support.' : '❌ ክፍያ ማስኬድ አልተሳካም። እባክዎ ድጋፍ ያግኙ።'
    );
  }
}

export async function SendGroupInvite(userId: string, groupId: string): Promise<void> {
  const inviteLink = await bot.telegram.createChatInviteLink(groupId, {
    member_limit: 1,
    creates_join_request: false,
    expire_date: Math.floor(Date.now() / 1000) + 10 * 60,
  });
  await bot.telegram.sendMessage(userId, `Join the group using this link: ${inviteLink.invite_link}`);

  // After 10 minutes, check if the user joined; if not, notify about expiration
  setTimeout(async () => {
    try {
      const member = await bot.telegram.getChatMember(groupId, Number(userId));
      const status = (member as any)?.status as string | undefined;
      const isMember = status === 'member' || status === 'administrator' || status === 'creator';
      if (!isMember) {
        await bot.telegram.sendMessage(
          userId,
          '⏰ Your invite link has expired. You did not join within 10 minutes. Reply here to request a new invite.'
        );
      }
    } catch (e) {
      // If we cannot check membership, ignore silently
    }
  }, 10 * 60 * 1000);
}