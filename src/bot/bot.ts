import { Telegraf } from "telegraf";
import { ServerConfig } from "../config/ServerConfig";
import axios from "axios";
import { Verify } from "../utils/checkUser";
import { message } from "telegraf/filters";
import { sendGroupPhotoAndInvoice } from "./photo";
import { bot } from "./botInstance";
import { SubscriptionRequest } from "../Model/SubscriptionReq.model";
import mongoose from 'mongoose';
import { handleSuccessfulPayment } from "./paymentHandler";
import { checkUserRegistrationStatus, UserRegistrationStatus } from "./userStatusChecker";
import { BotChat } from "../Model/BotChat.model";
import { UserProfile } from "../Model/UserProfile.model";
// import { pollingService } from "./pollingService";

// Define storage variables
const userLanguages = new Map();
const pendingInvites = new Map();
const paymentSessions = new Map();

// ========= Enrollment System =========
type Lang = 'en' | 'am';
type Gender = 'Male' | 'Female';
type EnrollmentStep =
  | 'awaiting_language'
  | 'awaiting_terms'
  | 'awaiting_guidelines'
  | 'awaiting_phone_contact'
  | 'awaiting_full_name'
  | 'awaiting_gender'
  | 'awaiting_dob'
  | 'awaiting_residence'
  | 'awaiting_email'
  | 'ready_for_payment';

type EnrollmentSession = {
  step: EnrollmentStep;
  language?: Lang;
  termsAccepted?: boolean;
  guidelinesAccepted?: boolean;
  fullName?: string;
  gender?: Gender;
  dob?: string; // dd/mm/yyyy
  residence?: string;
  email?: string;
  phone?: string;
  communityId?: string;
  communityName?: string;
  price?: number;
  community?: any;
  telegramId?: string;
  telegramUsername?: string;
  txRef?: string;
};

const enrollSessions = new Map<number, EnrollmentSession>();

async function upsertUserProfileFromSession(telegramId: number, s: EnrollmentSession) {
  try {
    await UserProfile.findOneAndUpdate(
      { telegramId: String(telegramId) },
      {
        telegramId: String(telegramId),
        phoneNumber: s.phone || '',
        fullName: s.fullName || '',
        gender: s.gender || '',
        dob: s.dob || '',
        residence_location: s.residence || '',
        email: s.email || '',
        language: s.language || '',
        telegramUsername: s.telegramUsername || ''
      },
      { upsert: true }
    );
  } catch (e) {
    console.warn('⚠️ upsertUserProfileFromSession failed for', telegramId, e);
  }
}

const TERMS_URL = process.env.TERMS_URL || 'https://docs.google.com';
const GUIDELINES_URL = process.env.GUIDELINES_URL || 'https://docs.google.com';

const ETHIOPIAN_CITIES = [
  'Addis Ababa','Dire Dawa','Mekelle','Gondar','Bahir Dar','Hawassa','Adama','Jimma','Jijiga','Shashamane',
];

const isValidFullName = (name: string) => /^[A-Za-zÀ-ÖØ-öø-ÿ' ]{2,100}$/.test((name || '').trim());
const isValidDob = (s: string) => /^\d{2}\/\d{2}\/\d{4}$/.test((s || '').trim());
const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim());

const buildResidenceKeyboard = () => {
  const rows: any[] = [];
  for (let i = 0; i < ETHIOPIAN_CITIES.length; i += 2) {
    const row: any[] = [];
    row.push({ text: ETHIOPIAN_CITIES[i], callback_data: `residence_${ETHIOPIAN_CITIES[i]}` });
    if (ETHIOPIAN_CITIES[i + 1]) {
      row.push({ text: ETHIOPIAN_CITIES[i + 1], callback_data: `residence_${ETHIOPIAN_CITIES[i + 1]}` });
    }
    rows.push(row);
  }
  return { inline_keyboard: rows };
};

const contactKeyboard = {
  keyboard: [[{ text: '📱 Share Contact', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

async function promptTerms(ctx: any, lang: Lang) {
  const txt = lang === 'en'
    ? 'Please review the Terms of Service and press Accept to continue.'
    : 'እባክዎ የአገልግሎት ውሎችን ይመልከቱ እና ለመቀጠል ተቀብለው ይጫኑ።';
  await ctx.reply(txt, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📄 View Terms', url: TERMS_URL }],
        [{ text: lang === 'en' ? '✅ Accept Terms' : '✅ ውሎችን ተቀብለዋል', callback_data: 'accept_terms' }],
      ],
    },
  });
}

async function promptGuidelines(ctx: any, lang: Lang) {
  const txt = lang === 'en'
    ? 'Please review the Community Guidelines and press Accept to continue.'
    : 'እባክዎ የማህበረሰብ መመሪያዎችን ይመልከቱ እና ለመቀጠል ተቀብለው ይጫኑ።';
  await ctx.reply(txt, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📄 View Guidelines', url: GUIDELINES_URL }],
        [{ text: lang === 'en' ? '✅ Accept Guidelines' : '✅ መመሪያዎችን ተቀብለዋል', callback_data: 'accept_guidelines' }],
      ],
    },
  });
}

async function promptShareContact(ctx: any, lang: Lang) {
  const txt = lang === 'en'
    ? '📱 **Step 1: Phone Number**\n\nPlease share your phone number using the button below to continue with your enrollment.'
    : '📱 **ደረጃ 1: የስልክ ቁጥር**\n\nእባክዎ ምዝገባዎን ለመቀጠል በታች ያለውን አዝራር በመጠቀም የስልክ ቁጥርዎን ያካፍሉ።';
  
  await ctx.reply(txt, { 
    parse_mode: 'Markdown',
    reply_markup: contactKeyboard 
  });
}

async function promptFullName(ctx: any, lang: Lang) {
  const txt = lang === 'en'
    ? '✏️ Please enter your full name (letters only, 2–100 chars).'
    : '✏️ እባክዎ ሙሉ ስምዎን ያስገቡ (ፊደላት ብቻ, 2–100 ቁምፊ).';
  await ctx.reply(txt, { reply_markup: { remove_keyboard: true } });
}

async function promptGender(ctx: any, lang: Lang) {
  const txt = lang === 'en' ? 'Select your gender.' : 'እባክዎ ጾታዎን ይምረጡ።';
  await ctx.reply(txt, {
    reply_markup: {
      inline_keyboard: [[
        { text: lang === 'en' ? 'Male' : 'ወንድ', callback_data: 'gender_Male' },
        { text: lang === 'en' ? 'Female' : 'ሴት', callback_data: 'gender_Female' },
      ]],
    },
  });
}

async function promptDob(ctx: any, lang: Lang) {
  const txt = lang === 'en'
    ? 'Enter your Date of Birth in dd/mm/yyyy (Ethiopian calendar).'
    : 'የትውልድ ቀንዎን dd/mm/yyyy (የኢትዮጵያ ዘመን) ቅርጽ ያስገቡ።';
  await ctx.reply(txt);
}

async function promptResidence(ctx: any, lang: Lang) {
  const txt = lang === 'en' ? 'Select your residence location.' : 'የመኖሪያ ከተማዎን ይምረጡ።';
  await ctx.reply(txt, { reply_markup: buildResidenceKeyboard() });
}

async function promptEmail(ctx: any, lang: Lang) {
  const txt = lang === 'en'
    ? 'Enter your email (optional). Send "skip" to continue.'
    : 'ኢሜልዎን ያስገቡ (አማራጭ). ለመቀጠል "skip" ይላኩ።';
  await ctx.reply(txt);
}

async function promptPayment(ctx: any, lang: Lang, s: EnrollmentSession) {
  const txt = lang === 'en'
    ? `Ready to pay and join ${s.communityName}?`
    : `${s.communityName} ለመቀላቀል ክፍያ ለማድረግ ዝግጁ ነዎት?`;
  await ctx.reply(txt, {
    reply_markup: {
      inline_keyboard: [[
        { text: lang === 'en' ? '💳 Pay' : '💳 ክፍያ', callback_data: `pay_${s.communityId}` },
        { text: lang === 'en' ? '🏠 Back to Communities' : '🏠 ወደ ማህበረሰቦች ተመለስ', callback_data: 'back_to_communities' },
      ]],
    },
  });
}

async function continueEnrollment(ctx: any) {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const s = enrollSessions.get(uid);
  if (!s) return;
  const lang: Lang = (userLanguages.get(uid) || s.language || 'en');

  console.log(`📋 Continue enrollment for user ${uid}, current step: ${s.step}`);

  if (!s.language) {
    s.step = 'awaiting_language';
    enrollSessions.set(uid, s);
    await promptLanguage(ctx);
    return;
  }

  if (!s.termsAccepted) {
    s.step = 'awaiting_terms';
    enrollSessions.set(uid, s);
    await promptTerms(ctx, lang);
    return;
  }

  if (!s.guidelinesAccepted) {
    s.step = 'awaiting_guidelines';
    enrollSessions.set(uid, s);
    await promptGuidelines(ctx, lang);
    return;
  }

  if (!s.phone) {
    s.step = 'awaiting_phone_contact';
    enrollSessions.set(uid, s);
    await promptShareContact(ctx, lang);
    return;
  }

  if (!s.fullName) {
    s.step = 'awaiting_full_name';
    enrollSessions.set(uid, s);
    await promptFullName(ctx, lang);
    return;
  }

  if (!s.gender) {
    s.step = 'awaiting_gender';
    enrollSessions.set(uid, s);
    await promptGender(ctx, lang);
    return;
  }

  if (!s.dob) {
    s.step = 'awaiting_dob';
    enrollSessions.set(uid, s);
    await promptDob(ctx, lang);
    return;
  }

  if (s.email === undefined) {
    s.step = 'awaiting_email';
    enrollSessions.set(uid, s);
    await promptEmail(ctx, lang);
    return;
  }

  if (!s.residence) {
    s.step = 'awaiting_residence';
    enrollSessions.set(uid, s);
    await promptResidence(ctx, lang);
    return;
  }

  // All required fields collected, show payment
  await promptPayment(ctx, lang, s);
}

// Define helper functions
async function showCommunities(ctx: any, language: string) {
  try {
    // Fetch all available communities
    const apiUrl = process.env.API_URL;
    const response = await axios.get(`${apiUrl}/api/v1/telegramCommunity/with-mentor`);
    
    if (Array.isArray(response.data) && response.data.length > 0) {
      const communities = response.data;
      
      // Debug logging
      console.log('Communities count:', communities.length);
      console.log('First community raw:', communities[0]);
      
      if (language === "en") {
        // English welcome message
        const welcomeMessage = `🎉 **Welcome to Tigat Premium Bot!**

Here are the available private communities you can join:

**Total Communities:** ${communities.length}`;
        
        await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
      } else {
        // Amharic welcome message
        const welcomeMessage = `🎉 **ወደ Tigat Premium Bot እንኳን በደህና መጡ!**

እነዚህ ሊቀላቀሉ የሚችሉ የግል ማህበረሰቦች ናቸው:

**ጠቅላላ ማህበረሰቦች:** ${communities.length}`;
        
        await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
      }
      
      // Send each community with image and join button
      for (let i = 0; i < communities.length; i++) {
        const community = communities[i];
        
        // Normalize fields per provided service
        const id = community.communityId || community._id || community.id;
        const name = community.communityName || community.name || 'Community';
        const price = community.price ?? '';
        const imagePath = community.photo || community.image || community.photoUrl;
        const imageUrl = imagePath
          ? (imagePath.startsWith('http') ? imagePath : `${apiUrl}${imagePath}`)
          : undefined;
        const mentorName = community.mentorName || community.mentor?.name || 'Unknown Mentor';
        
        // Debug logging
        console.log('Community normalized:', { id, name, price, imageUrl, mentorName, groupId: community.groupId });
        
        // Prepare community message
        let communityMessage = '';
        let keyboard = {};
        
        if (language === "en") {
          // English community message
          communityMessage = `🏛️ **${name}**

👨‍🏫 **Mentor:** ${mentorName}
💰 **Price:** ${price} birr`;
          
          keyboard = {
            inline_keyboard: [
              [
                {
                  text: `🚀 Join ${name}`,
                  callback_data: `join_community_${id}` // Use community ID instead
                }
              ]
            ]
          };
        } else {
          // Amharic community message
          communityMessage = `🏛️ **${name}**

👨‍🏫 **መምህር:** ${mentorName}
💰 **ዋጋ:** ${price} ብር`;
          
          keyboard = {
            inline_keyboard: [
              [
                {
                  text: `🚀 ${name} ላይ ተቀላቀል`,
                  callback_data: `join_community_${id}` // Use community ID instead
                }
              ]
            ]
          };
        }
        
        // Send community with image if available
        if (imageUrl) {
          try {
            // Send photo with caption
            await ctx.replyWithPhoto(imageUrl, {
              caption: communityMessage,
              parse_mode: 'Markdown',
              reply_markup: keyboard
            });
            
            console.log(`✅ Sent community ${name} with image: ${imageUrl}`);
          } catch (photoError) {
            console.error('Error sending photo, falling back to text message:', photoError);
            // Fallback to text message if photo fails
            await ctx.reply(communityMessage, {
              parse_mode: 'Markdown',
              reply_markup: keyboard
            });
          }
        } else {
          // No image, send text message only
          await ctx.reply(communityMessage, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        }
      }
      
    } else {
      // No communities available
      if (language === "en") {
        await ctx.reply(`🎉 **Welcome to Tigat Premium Bot!**

Currently, there are no private communities available.

**To access a community:**
1. Type: /join_community COMMUNITY_NAME
2. Or paste the community name directly
3. I'll help you access it immediately!

**Need help?** Type /help for more information.`);
      } else {
        await ctx.reply(`🎉 **ወደ Tigat Premium Bot እንኳን በደህና መጡ!**

አሁን ምንም የግል ማህበረሰቦች አይገኙም።

**ማህበረሰብ ለመድረስ:**
1. ይፃፉ: /join_community የማህበረሰብ_ስም
2. ወይም የማህበረሰብ ስምን በቀጥታ ያስገቡ
3. ወዲያውኑ እረዳዎታለሁ!

**እርዳታ ያስፈልግዎታል?** /help ይፃፉ።`);
      }
    }
    
  } catch (error) {
    console.error("Error fetching communities:", error);
    
    // Fallback message if API fails
    if (language === "en") {
      await ctx.reply(`🎉 **Welcome to Tigat Premium Bot!**

**To access a private community:**
1. Type: /join_community COMMUNITY_NAME
2. Or paste the community name directly
3. I'll help you access it immediately!

**Need help?** Type /help for more information.`);
    } else {
      await ctx.reply(`🎉 **ወደ Tigat Premium Bot እንኳን በደህና መጡ!**

**የግል ማህበረሰብ ለመድረስ:**
1. ይፃፉ: /join_community የማህበረሰብ_ስም
2. ወይም የማህበረሰብ ስምን በቀጥታ ያስገቡ
3. ወዲያውኑ እረዳዎታለሁ!

**እርዳታ ያስፈልግዎታል?** /help ይፃፉ።`);
    }
  }
}

async function promptLanguage(ctx: any) {
  await ctx.reply("🌍 **Please select your language:**", {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🇺🇸 English", callback_data: "language_en" },
          { text: "🇪🇹 አማርኛ", callback_data: "language_am" }
        ]
      ]
    }
  });
}

// Connect to MongoDB
mongoose.connect(ServerConfig.MongoUrl)
  .then(() => console.log('✅ MongoDB connected in bot process'))
  .catch(err => console.error('❌ MongoDB connection error in bot process:', err));

// Add this at the very beginning of your bot file, right after imports
console.log("🚀 Bot file loaded, setting up handlers...");

// Register command handlers
bot.command("start", async (ctx) => {
  console.log("🚀 /start command executed by user:", ctx.from?.id);

  // Deep-link payment flow support: /start userId_courseId
  const text = ctx.message?.text || "";
  const maybePayload = text.split(" ")[1];
  if (maybePayload && maybePayload.includes("_")) {
    const [userId, courseId] = maybePayload.split("_");
    if (!userId || !courseId) {
      await ctx.reply("Invalid Link");
      return;
    }

    // Verify user/course
    const checkUser = await Verify({ userId, courseId });
    console.log("/start verify:", checkUser);

    if (checkUser.success !== true) {
      await ctx.reply("Access denied! User is not a registered user or has not enrolled to a course");
      return;
    }
    if (!checkUser.groupId) {
      console.log("Group id not found");
      return;
    }

    // Proceed with existing photo+invoice flow
    const userTelegramId = ctx.from?.id;
    await sendGroupPhotoAndInvoice({
      ctx,
      groupId: checkUser.groupId,
      courseId: checkUser.courseId,
      userId: checkUser.userId,
      telegramId: `${userTelegramId}`,
      amount: checkUser.groupSubPrice,
      courseName: checkUser.courseName,
      phoneNumber: checkUser.phoneNumber,
    });
    return;
  }

  // Default: show language selection
  await ctx.reply("🌍 **Welcome! Please select your language:**", {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🇺🇸 English", callback_data: "language_en" },
          { text: "🇪🇹 አማርኛ", callback_data: "language_am" }
        ]
      ]
    }
  });
});

// Add debug command
bot.command("debug_payment", async (ctx) => {
  const args = ctx.message?.text?.split(" ");
  const txRef = args?.[1];
  
  if (!txRef) {
    await ctx.reply("Usage: /debug_payment <transaction_id>");
    return;
  }
  
  console.log("🔧 Manual payment verification requested for:", txRef);
  
  try {
    const verification = { success: false, status: 'disabled' } as any;
    
    await ctx.reply(`🔍 **Payment Verification Result**\n\n**Transaction ID:** ${txRef}\n**Success:** ${verification.success}\n**Status:** ${verification.status || 'N/A'}\n**Amount:** ${verification.amount || 'N/A'}\n**Reference:** ${verification.reference || 'N/A'}`, {
      parse_mode: 'Markdown'
    });
    
    if (verification.success) {
      // Try to find enrollment session for this user
      const userTelegramId = ctx.from?.id;
      if (userTelegramId) {
        const enrollSession = enrollSessions.get(userTelegramId);
        if (enrollSession) {
          await ctx.reply("🔄 Found enrollment session, processing payment...");
          await handleSuccessfulPayment(ctx, userLanguages, paymentSessions, enrollSessions);
        } else {
          await ctx.reply("⚠️ Payment verified but no enrollment session found. Contact support for manual processing.");
        }
      }
    }
    
  } catch (error) {
    await ctx.reply(`❌ Verification failed: ${(error as Error).message}`);
  }
});

// Add polling status command
bot.command("polling_status", async (ctx) => {
    const status = { totalActive: 0, sessions: [] as any[] };
  
  const statusMessage = `📊 **Polling Status**\n\n**Active Sessions:** ${status.totalActive}\n\n${
    status.sessions.map(s => 
      `**TX:** ${s.txRef.slice(-10)}\n**User:** ${s.telegramId}\n**Progress:** ${s.attempts}/${s.maxAttempts}\n**Elapsed:** ${Math.round(s.elapsedSeconds)}s\n`
    ).join('\n')
  }`;
  
  await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
});

// Register action handlers
bot.action("language_en", async (ctx) => {
  const userTelegramId = ctx.from?.id;
  if (userTelegramId) {
    userLanguages.set(userTelegramId, "en");
    const s = enrollSessions.get(userTelegramId);
    if (s) {
      s.language = 'en';
      s.step = 'awaiting_terms'; // Add this line to update the step
      enrollSessions.set(userTelegramId, s);
      await ctx.answerCbQuery("✅ Language set to English");
      await continueEnrollment(ctx);
      return;
    }
  }
  await ctx.reply("🇺🇸 **Language set to English!**\n\nWelcome to Tigat Premium Bot! Let me show you the available communities.");
  await showCommunities(ctx, "en");
  await ctx.answerCbQuery("✅ Language set to English");
});

bot.action("language_am", async (ctx) => {
  const userTelegramId = ctx.from?.id;
  if (userTelegramId) {
    userLanguages.set(userTelegramId, "am");
    const s = enrollSessions.get(userTelegramId);
    if (s) {
      s.language = 'am';
      s.step = 'awaiting_terms'; // Add this line to update the step
      enrollSessions.set(userTelegramId, s);
      await ctx.answerCbQuery("✅ ቋንቋ ወደ አማርኛ ተቀይሯል");
      await continueEnrollment(ctx);
      return;
    }
  }
  await ctx.reply("🇪🇹 **ቋንቋ ወደ አማርኛ ተቀይሯል!**\n\nወደ Tigat Premium Bot እንኳን በደህና መጡ! የሚገኙ ማህበረሰቦችን እንድያዩ ያድርጉኝ።");
  await showCommunities(ctx, "am");
  await ctx.answerCbQuery("✅ ቋንቋ ወደ አማርኛ ተቀይሯል");
});

// Enhanced join community handler with user status check
bot.action(/^join_community_(.+)$/, async (ctx) => {
  const communityId = ctx.match![1];
  const userTelegramId = ctx.from?.id;
  const userLang = userTelegramId ? userLanguages.get(userTelegramId) || 'en' : 'en';
  
  console.log(`🚀 Join community button clicked - User: ${userTelegramId}, Community ID: ${communityId}`);
  
  try {
    // Check if user is already registered for this community
    const userStatus = await checkUserRegistrationStatus(String(userTelegramId), communityId);
    
    if (userStatus.isRegistered && userStatus.userInfo) {
      console.log(`👤 User ${userTelegramId} already registered, status: ${userStatus.paymentStatus}`);
      
      // Display user registration info
      const userInfo = userStatus.userInfo;
      const statusMessage = userLang === 'en' 
        ? `👤 **Your Registration Details**\n\n**Full Name:** ${userInfo.fullName}\n**Phone:** ${userInfo.phoneNumber}\n**Location:** ${userInfo.residence_location}\n**Email:** ${userInfo.email || 'Not provided'}\n\n**Payment Status:** ${userStatus.paymentStatus?.toUpperCase()}`
        : `👤 **የእርስዎ ምዝገባ ዝርዝር**\n\n**ሙሉ ስም:** ${userInfo.fullName}\n**ስልክ:** ${userInfo.phoneNumber}\n**አድራሻ:** ${userInfo.residence_location}\n**ኢሜል:** ${userInfo.email || 'አልተሰጠም'}\n\n**የክፍያ ሁኔታ:** ${userStatus.paymentStatus?.toUpperCase()}`;

      // Create appropriate buttons based on payment status
      let keyboard: any = { inline_keyboard: [] };
      
      if (userStatus.paymentStatus === 'pending') {
        // Show continue payment button
        keyboard.inline_keyboard.push([
          { 
            text: userLang === 'en' ? '💳 Continue Payment' : '💳 ክፍያ ቀጥል', 
            callback_data: `continue_payment_${communityId}` 
          }
        ]);
      } else if (userStatus.paymentStatus === 'expired' || userStatus.needsRenewal) {
        // Show renew community button
        keyboard.inline_keyboard.push([
          { 
            text: userLang === 'en' ? '🔄 Renew Community' : '🔄 ማህበረሰብ አድስ', 
            callback_data: `renew_community_${communityId}` 
          }
        ]);
      } else if (userStatus.paymentStatus === 'paid') {
        // Already active member
        const activeMessage = userLang === 'en'
          ? '\n\n✅ **You are already an active member of this community!**'
          : '\n\n✅ **እርስዎ ቀድሞውኑ የዚህ ማህበረሰብ ንቁ አባል ነዎት!**';
        
        await ctx.reply(statusMessage + activeMessage, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: userLang === 'en' ? '🏠 Back to Communities' : '🏠 ወደ ማህበረሰቦች ተመለስ', callback_data: 'back_to_communities' }]
            ]
          }
        });
        await ctx.answerCbQuery("✅ Already registered");
        return;
      }
      
      // Add back button
      keyboard.inline_keyboard.push([
        { text: userLang === 'en' ? '🏠 Back to Communities' : '🏠 ወደ ማህበረሰቦች ተመለስ', callback_data: 'back_to_communities' }
      ]);
      
      await ctx.reply(statusMessage, { 
        parse_mode: 'Markdown', 
        reply_markup: keyboard 
      });
      await ctx.answerCbQuery("✅ Registration details displayed");
      return;
    }

    // User not registered, proceed with normal enrollment
    // Fetch all communities and find by id
    const apiUrl = process.env.API_URL;
    const response = await axios.get(`${apiUrl}/api/v1/telegramCommunity/with-mentor`);
    const list = Array.isArray(response.data) ? response.data : [];
    const community = list.find((c: any) => (
      c.communityId === communityId || c._id === communityId || c.id === communityId
    ));
    
    if (!community) {
      await ctx.reply(`❌ Community not found or no longer available.\n\nPlease try /start to see the current list of communities.`);
      await ctx.answerCbQuery(`❌ Community not found`);
      return;
    }

    // Initialize enrollment session
    if (userTelegramId) {
      const username = ctx.from?.username ? `@${ctx.from.username}` : '';
      enrollSessions.set(userTelegramId, {
        step: 'awaiting_language',
        language: userLanguages.get(userTelegramId),
        communityId,
        communityName: community.communityName || 'Community',
        price: community.price || 0,
        community,
        telegramId: String(userTelegramId),
        telegramUsername: username,
      });
    }
    // Proceed
    await continueEnrollment(ctx);
    await ctx.answerCbQuery("✅ Starting enrollment process");
  } catch (error) {
    console.error("❌ Error in join community handler:", error);
    await ctx.reply(`⚠️ Could not process your request. Please try again later.`);
    await ctx.answerCbQuery(`❌ Error occurred`);
  }
});

// Handle continue payment button
bot.action(/^continue_payment_(.+)$/, async (ctx) => {
  const communityId = ctx.match![1];
  const userTelegramId = ctx.from?.id;
  const userLang = userTelegramId ? userLanguages.get(userTelegramId) || 'en' : 'en';
  
  console.log(`💳 Continue payment for user ${userTelegramId}, community ${communityId}`);
  
  try {
    // Get existing subscription request
    const subRequest = await SubscriptionRequest.findOne({
      userId: String(userTelegramId),
      communityId: communityId
    }).sort({ createdAt: -1 });
    
    if (!subRequest) {
      await ctx.reply(userLang === 'en' ? '❌ No pending payment found.' : '❌ ምንም ክፍያ በመጠባበቅ አይገኝም።');
      await ctx.answerCbQuery("❌ No pending payment");
      return;
    }

    // Fetch community data
    const apiUrl = process.env.API_URL;
    const response = await axios.get(`${apiUrl}/api/v1/telegramCommunity/with-mentor`);
    const list = Array.isArray(response.data) ? response.data : [];
    const community = list.find((c: any) => (
      c.communityId === communityId || c._id === communityId || c.id === communityId
    ));
    
    if (!community) {
      await ctx.reply('❌ Community not found.');
      await ctx.answerCbQuery("❌ Community not found");
      return;
    }

    // Fetch user profile for provider data
    const userProfile = await UserProfile.findOne({ telegramId: String(userTelegramId) });
    const profPhone = (userProfile as any)?.phoneNumber || '';
    const profName = (userProfile as any)?.fullName || '';

    const priceInCents = Math.round(Number(community.price || 0) * 100);
    // Generate tx_ref locally for Telegram payment
    const nameParts = (profName || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || 'Telegram';
    const desiredTxRef = subRequest.tx_ref || `continue_${communityId}_${userTelegramId}_${Date.now()}`;
    const txRef = desiredTxRef;
    
    // Ensure DB has a record with the FINAL tx_ref before sending invoice
    try {
      await SubscriptionRequest.findOneAndUpdate(
        { userId: String(userTelegramId), communityId: communityId },
        { tx_ref: txRef, paymentStatus: 'pending' as any, status: 'active' as any, amount: community.price },
        { upsert: true, new: true }
      );
      console.log('🔄 Synchronized SubscriptionRequest with final tx_ref for continue_payment:', txRef);
    } catch (syncErr) {
      console.error('❌ Failed to sync SubscriptionRequest tx_ref (continue_payment):', syncErr);
    }

    const providerData2 = {
      phone: profPhone,
      fullName: profName,
      tx_ref: txRef,
    };
    console.log('🧾 Sending Telegram invoice (continue_payment)', { txRef, priceInCents, providerData: providerData2 });
    
    await ctx.replyWithInvoice({
      title: `${community.communityName}`,
      description: `Continue payment to join ${community.communityName}`,
      payload: txRef,
      provider_token: process.env.CHAPA_PROVIDER_TOKEN || "<YOUR_CHAPA_PROVIDER_TOKEN>",
      currency: "ETB",
      prices: [{ label: "Community Access", amount: priceInCents }],
      start_parameter: "pay",
      need_phone_number: true,
      send_phone_number_to_provider: true,
      provider_data: JSON.stringify(providerData2),
    });

    await ctx.answerCbQuery('✅ Payment invoice sent');
    await ctx.reply(userLang === 'en' ? '💳 Payment invoice generated. Please complete your payment.' : '💳 ክፍያ ደረሰኝ ተፈጥሯል። እባክዎን ክፍያውን ያጠናቅቅ።');
    
    // Polling disabled; relying on Telegram successful_payment only
    const enrollSession: EnrollmentSession = {
      step: 'ready_for_payment',
      language: userLang as Lang,
      fullName: profName,
      phone: profPhone,
      communityId: communityId,
      communityName: community.communityName,
      price: community.price,
      community: community,
      telegramId: String(userTelegramId),
      telegramUsername: ctx.from?.username ? `@${ctx.from.username}` : '',
      txRef: txRef
    };
    
    // polling disabled
  } catch (error) {
    console.error('❌ Error in continue payment:', error);
    await ctx.reply('⚠️ Error processing payment. Please try again.');
    await ctx.answerCbQuery("❌ Payment error");
  }
});

// Handle renew community button
bot.action(/^renew_community_(.+)$/, async (ctx) => {
  const communityId = ctx.match![1];
  const userTelegramId = ctx.from?.id;
  const userLang = userTelegramId ? userLanguages.get(userTelegramId) || 'en' : 'en';
  
  console.log(`🔄 Renew community for user ${userTelegramId}, community ${communityId}`);
  
  try {
    // Get existing subscription request
    const subRequest = await SubscriptionRequest.findOne({
      userId: String(userTelegramId),
      communityId: communityId
    }).sort({ createdAt: -1 });
    
    if (!subRequest) {
      await ctx.reply(userLang === 'en' ? '❌ No existing subscription found.' : '❌ ምንም ቀደም ያሉ ምዝገባ አይገኙም።');
      await ctx.answerCbQuery("❌ No subscription found");
      return;
    }

    // Fetch community data
    const apiUrl = process.env.API_URL;
    const response = await axios.get(`${apiUrl}/api/v1/telegramCommunity/with-mentor`);
    const list = Array.isArray(response.data) ? response.data : [];
    const community = list.find((c: any) => (
      c.communityId === communityId || c._id === communityId || c.id === communityId
    ));
    
    if (!community) {
      await ctx.reply('❌ Community not found.');
      await ctx.answerCbQuery("❌ Community not found");
      return;
    }

    // Fetch user profile for provider data
    const userProfile = await UserProfile.findOne({ telegramId: String(userTelegramId) });
    const profPhone = (userProfile as any)?.phoneNumber || '';
    const profName = (userProfile as any)?.fullName || '';

    const priceInCents = Math.round(Number(community.price || 0) * 100);
    // Generate tx_ref locally for Telegram payment
    const nameParts = (profName || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || 'Telegram';
    const desiredTxRef = subRequest.tx_ref || `renew_${communityId}_${userTelegramId}_${Date.now()}`;
    const txRef = desiredTxRef;
    
    // Ensure DB has a record with the FINAL tx_ref before sending invoice
    try {
      await SubscriptionRequest.findOneAndUpdate(
        { userId: String(userTelegramId), communityId: communityId },
        { tx_ref: txRef, paymentStatus: 'pending' as any, status: 'active' as any, amount: community.price },
        { upsert: true, new: true }
      );
      console.log('🔄 Synchronized SubscriptionRequest with final tx_ref for renew_community:', txRef);
    } catch (syncErr) {
      console.error('❌ Failed to sync SubscriptionRequest tx_ref (renew_community):', syncErr);
    }
    
    const providerData3 = {
      phone: profPhone,
      fullName: profName,
      tx_ref: txRef,
    };
    console.log('🧾 Sending Telegram invoice (renew_community)', { txRef, priceInCents, providerData: providerData3 });

    await ctx.replyWithInvoice({
      title: `Renew ${community.communityName}`,
      description: `Renew your subscription to ${community.communityName}`,
      payload: txRef,
      provider_token: process.env.CHAPA_PROVIDER_TOKEN || "<YOUR_CHAPA_PROVIDER_TOKEN>",
      currency: "ETB",
      prices: [{ label: "Community Renewal", amount: priceInCents }],
      start_parameter: "renew",
      need_phone_number: true,
      send_phone_number_to_provider: true,
      provider_data: JSON.stringify(providerData3),
    });

    await ctx.answerCbQuery('✅ Renewal invoice sent');
    await ctx.reply(userLang === 'en' ? '💳 Renewal invoice generated. Please complete your payment.' : '💳 የእድሳት ደረሰኝ ተፈጥሯል። እባክዎን ክፍያውን ያጠናቅቅ።');
    
    // Polling disabled; relying on Telegram successful_payment only
    const enrollSession: EnrollmentSession = {
      step: 'ready_for_payment',
      language: userLang as Lang,
      fullName: profName,
      phone: profPhone,
      communityId: communityId,
      communityName: community.communityName,
      price: community.price,
      community: community,
      telegramId: String(userTelegramId),
      telegramUsername: ctx.from?.username ? `@${ctx.from.username}` : '',
      txRef: txRef
    };
    
    // polling disabled
  } catch (error) {
    console.error('❌ Error in renew community:', error);
    await ctx.reply('⚠️ Error processing renewal. Please try again.');
    await ctx.answerCbQuery("❌ Renewal error");
  }
});

// FIXED: Contact handler (Share Contact button) - removed incorrect answerCbQuery call
bot.on(message('contact'), async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const s = enrollSessions.get(uid);
  const lang: Lang = (userLanguages.get(uid) || s?.language || 'en');
  
  console.log(`📞 Contact received from user ${uid}, current step: ${s?.step}`);
  
  if (!s || s.step !== 'awaiting_phone_contact') {
    console.log(`❌ No enrollment session or wrong step for user ${uid}. Expected: awaiting_phone_contact, Got: ${s?.step}`);
    
    // Provide helpful feedback to user
    const errorMsg = lang === 'en' 
      ? 'Phone number received, but you are not in the enrollment process. Please start by selecting a community to join.'
      : 'የስልክ ቁጥር ተቀብሏል፣ ነገር ግን በምዝገባ ሂደት ውስጥ አይደሉም። እባክዎ ለመቀላቀል ማህበረሰብ በመምረጥ ይጀምሩ።';
    
    await ctx.reply(errorMsg);
    return;
  }

  const phone = ctx.message.contact.phone_number;
  if (!phone) {
    await ctx.reply(lang === 'en' ? 'Phone number not found. Please try again.' : 'ስልክ ቁጥር አልተገኘም። እባክዎ እንደገና ይሞክሩ።');
    return;
  }

  // Update session with phone
  s.phone = phone;
  await upsertUserProfileFromSession(uid, s);

  // Upsert UserProfile separately
  try {
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';
    const pre = await UserProfile.findOne({ $or: [{ telegramId: String(uid) }, { phoneNumber: phone }] }).sort({ updatedAt: -1 });
    const fullName = s.fullName || (pre as any)?.fullName || '';
    const gender = s.gender || (pre as any)?.gender || '';
    const dob = s.dob || (pre as any)?.dob || '';
    const residence = s.residence || (pre as any)?.residence_location || '';
    const email = (s.email === undefined ? (pre as any)?.email : s.email) || '';
    const language = s.language || (pre as any)?.language || (lang as string);

    await UserProfile.findOneAndUpdate(
      { telegramId: String(uid) },
      {
        telegramId: String(uid),
        phoneNumber: phone,
        fullName,
        gender,
        dob,
        residence_location: residence,
        email,
        language,
        telegramUsername: username,
      },
      { upsert: true }
    );
  } catch (e) {
    console.warn('UserProfile upsert failed', e);
  }

  // Prefill from UserProfile
  try {
    const prof = await UserProfile.findOne({ telegramId: String(uid) });
    if (prof) {
      s.fullName = s.fullName || (prof as any).fullName || s.fullName;
      s.gender = s.gender || (prof as any).gender || s.gender;
      s.dob = s.dob || (prof as any).dob || s.dob;
      s.residence = s.residence || (prof as any).residence_location || s.residence;
      if (s.email === undefined && (prof as any).email) { s.email = (prof as any).email; }
      s.language = s.language || ((prof as any).language as Lang) || s.language;
      s.telegramUsername = s.telegramUsername || (prof as any).telegramUsername || s.telegramUsername;
    }
  } catch {}

  const missingRequired: string[] = [];
  if (!s.fullName) missingRequired.push('full_name');
  if (!s.gender) missingRequired.push('gender');
  if (!s.dob) missingRequired.push('dob');
  if (!s.residence) missingRequired.push('residence');

  if (missingRequired.length === 0) {
    s.step = 'awaiting_email';
    enrollSessions.set(uid, s);

    const currentEmail = s.email || '';
    const prompt = lang === 'en'
      ? `📝 Optional: Update your email.\nCurrent: ${currentEmail || 'N/A'}\n\nSend a new email or type "skip" to continue.`
      : `📝 አማራጭ፡ ኢሜልዎን ያዘምኑ።\nየአሁኑ፡ ${currentEmail || 'አይገኝም'}\n\nአዲስ ኢሜል ይላኩ ወይም "skip" በማለት ይቀጥሉ።`;
    await ctx.reply(prompt);
    return;
  }

  s.step = 'awaiting_full_name';
  enrollSessions.set(uid, s);

  const namePrompt = lang === 'en' 
    ? '📝 **Step 2: Personal Information**\n\nGreat! Phone number received: `' + phone + '`\n\nNow, please enter your full name (2-100 characters, letters only):'
    : '📝 **ደረጃ 2: የግል መረጃ**\n\nግሩም! የስልክ ቁጥር ተቀብሏል: `' + phone + '`\n\nአሁን፣ እባክዎ ሙሉ ስምዎን ያስገቡ (2-100 ቁምፊዎች፣ ፊደላት ብቻ)።';
  await ctx.reply(namePrompt, { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } });
});

// Collect name and other text messages
bot.on(message('text'), async (ctx, next) => {
  if (!('text' in ctx.message) || !ctx.message.text) return next();
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return next(); // pass commands through
  const userTelegramId = ctx.from?.id;
  if (!userTelegramId) return;

  // Handle enrollment flow first if exists
  const enroll = enrollSessions.get(userTelegramId);
  if (enroll) {
    const lang: Lang = (userLanguages.get(userTelegramId) || enroll.language || 'en');

    console.log(`📝 Processing text message for user ${userTelegramId}, step: ${enroll.step}, text: ${text}`);

    if (enroll.step === 'awaiting_full_name') {
      // Validate full name
      if (!isValidFullName(text)) {
        await ctx.reply(lang === 'en' 
          ? '❌ Invalid name. Please enter only letters and spaces, 2-100 characters long.'
          : '❌ የማይሰራ ስም። እባክዎ ፊደላት እና ክፍተቶች ብቻ፣ 2-100 ቁምፊዎች ያስገቡ።');
        return;
      }

      // Update session and continue
      enroll.fullName = text;
      enrollSessions.set(userTelegramId, enroll);
      await upsertUserProfileFromSession(userTelegramId, enroll);
      console.log(`✅ Full name set: ${text} for user ${userTelegramId}`);

      // Continue enrollment flow
      await continueEnrollment(ctx);
      return;
    }

    if (enroll.step === 'awaiting_dob') {
      // Validate DOB
      if (!isValidDob(text)) {
        await ctx.reply(lang === 'en'
          ? '❌ Invalid date format. Please use dd/mm/yyyy format (e.g., 12/03/2010).'
          : '❌ የማይሰራ ቀን ቅርጸት። እባክዎ dd/mm/yyyy ቅርጸት ይጠቀሙ (ለምሳሌ፣ 12/03/2010)።');
        return;
      }

      // Update session and continue
      enroll.dob = text;
      enrollSessions.set(userTelegramId, enroll);
      await upsertUserProfileFromSession(userTelegramId, enroll);
      console.log(`✅ DOB set: ${text} for user ${userTelegramId}`);

      // Prompt email next directly
      enroll.step = 'awaiting_email';
      enrollSessions.set(userTelegramId, enroll);
      const currentEmail = enroll.email || '';
      const prompt = lang === 'en'
        ? `📝 Optional: Update your email.\nCurrent: ${currentEmail || 'N/A'}\n\nSend a new email or type "skip" to continue.`
        : `📝 አማራጭ፡ ኢሜልዎን ያዘምኑ።\nየአሁኑ፡ ${currentEmail || 'አይገኝም'}\n\nአዲስ ኢሜል ይላኩ ወይም "skip" በማለት ይቀጥሉ።`;
      await ctx.reply(prompt);
      return;
    }

    if (enroll.step === 'awaiting_email') {
      // Validate email (optional)
      if (text.toLowerCase() === 'skip') {
        enroll.email = '';
        await upsertUserProfileFromSession(userTelegramId, enroll);
      } else if (!isValidEmail(text)) {
        await ctx.reply(lang === 'en'
          ? '❌ Invalid email format. Please enter a valid email address or type "skip" to continue without email.'
          : '❌ የማይሰራ ኢሜይል ቅርጸት። እባክዎ ትክክለኛ ኢሜይል አድራሻ ያስገቡ ወይም ኢሜይል ሳይኖር ለመቀጠል "skip" ይተይቡ።');
        return;
      } else {
        enroll.email = text;
        await upsertUserProfileFromSession(userTelegramId, enroll);
      }

      // Update session and continue
      enrollSessions.set(userTelegramId, enroll);
      console.log(`✅ Email set: ${enroll.email} for user ${userTelegramId}`);

      // Create or update a pending SubscriptionRequest before payment
      try {
        const now = new Date();
        const expireAt = new Date(now);
        expireAt.setMonth(expireAt.getMonth() + 1);

        // Generate tx_ref if not set yet and store in session
        if (!enroll.txRef) {
          enroll.txRef = `community_${enroll.communityId}_${Date.now()}`;
          enrollSessions.set(userTelegramId, enroll);
        }

        // Upsert pending request (status: pending)
        await SubscriptionRequest.findOneAndUpdate(
          { tx_ref: enroll.txRef },
          {
            userId: String(userTelegramId),
            groupId: (enroll.community && enroll.community.groupId) || '',
            tx_ref: enroll.txRef,
            status: 'active',
            paymentStatus: 'pending',
            communityId: enroll.communityId,
            communityName: enroll.communityName,
            amount: enroll.price,
          },
          { upsert: true, new: true }
        );
        console.log('📝 Pending SubscriptionRequest upserted with tx_ref:', enroll.txRef);
      } catch (pendingErr) {
        console.error('❌ Failed to create pending SubscriptionRequest:', pendingErr);
        await ctx.reply(lang === 'en' ? '⚠️ Could not save your enrollment. Please try again.' : '⚠️ ምዝገባዎን ማስቀመጥ አልተቻለም። እባክዎ ይሞክሩ እንደገና።');
        return;
      }

      // Continue enrollment flow
      await continueEnrollment(ctx);
      return;
    }

    // If we reach here, it's an invalid step for text input
    await ctx.reply(lang === 'en' 
      ? 'Please use the buttons provided above to continue.'
      : 'እባክዎ ከላይ የተሰጡትን ቁልፎች ይጠቀሙ।');
    return;
  }

  // Original community quick flow using paymentSessions remains
  const session = paymentSessions.get(userTelegramId);
  if (!session) return;

  const userLang = (userLanguages.get(userTelegramId) || 'en');

  if (session.step === 'awaiting_full_name') {
    session.fullName = text;
    session.step = 'awaiting_phone';
    paymentSessions.set(userTelegramId, session);
    if (userLang === 'en') {
      await ctx.reply(`📞 Thanks, ${session.fullName}! Now enter your phone number (10 digits, e.g., 0912345678):`);
    } else {
      await ctx.reply(`📞 አመሰግናለሁ, ${session.fullName}! አሁን የስልክ ቁጥርዎን ያስገቡ (10 አሃዝ, ምሳሌ 0912345678):`);
    }
    return;
  }

  if (session.step === 'awaiting_phone') {
    // basic validate 10 digits
    if (!/^\d{10}$/.test(text)) {
      if (userLang === 'en') {
        await ctx.reply(`❌ Invalid phone. Please enter a 10-digit phone (e.g., 0912345678):`);
      } else {
        await ctx.reply(`❌ የትክክለኛ ስልክ ቁጥር አይደለም። 10 አሃዝ የስልክ ቁጥር ያስገቡ (ምሳሌ 0912345678):`);
      }
      return;
    }

    session.phone = text;
    session.step = 'ready';
    paymentSessions.set(userTelegramId, session);

    // Send invoice now
    const priceInCents = Math.round(Number(session.price || 0) * 100);
    console.log(`💳 Sending invoice for ${session.communityName} - Price: ${session.price} ETB (${priceInCents} cents)`);
    
    try {
      await ctx.replyWithInvoice({
        title: `${session.communityName}`,
        description: `Pay to join ${session.communityName}`,
        payload: `community_${session.communityId}_${Date.now()}`,
        provider_token: process.env.CHAPA_PROVIDER_TOKEN || "<YOUR_CHAPA_PROVIDER_TOKEN>",
        currency: "ETB",
        prices: [{ label: "Community Access", amount: priceInCents }],
        start_parameter: "pay",
        need_phone_number: true,
        send_phone_number_to_provider: true,
        provider_data: JSON.stringify({ phone: session.phone, fullName: session.fullName })
      });

      if (userLang === 'en') {
        await ctx.reply(`💳 Invoice generated. Please complete your payment.`);
      } else {
        await ctx.reply(`💳 ክፍያ ደረሰኝ ተፈጥሯል። እባክዎን ክፍያውን ያጠናቅቁ።`);
      }
    } catch (invoiceError) {
      console.error('❌ Failed to send invoice:', invoiceError);
      await ctx.reply('⚠️ Failed to generate invoice. Please try again later.');
    }

    return;
  }
});

// Add back to communities handler
bot.action("back_to_communities", async (ctx) => {
  const userTelegramId = ctx.from?.id;
  const userLanguage = userTelegramId ? userLanguages.get(userTelegramId) || "en" : "en";
  
  if (userTelegramId) {
    paymentSessions.delete(userTelegramId);
    enrollSessions.delete(userTelegramId); // Also clear enrollment session
  }
  
  await showCommunities(ctx, userLanguage);
  await ctx.answerCbQuery("✅ Back to communities");
});

// Accept Terms
bot.action('accept_terms', async (ctx) => {
  const uid = ctx.from?.id as number | undefined; 
  if (!uid) return;
  const s = enrollSessions.get(uid); 
  if (!s) return;
  
  s.termsAccepted = true; 
  s.step = 'awaiting_guidelines';
  enrollSessions.set(uid, s);
  console.log(`✅ Terms accepted by user ${uid}`);
  
  await ctx.answerCbQuery('✅ Terms accepted');
  await continueEnrollment(ctx);
});

// Accept Guidelines
bot.action('accept_guidelines', async (ctx) => {
  const uid = ctx.from?.id as number | undefined; 
  if (!uid) return;
  const s = enrollSessions.get(uid); 
  if (!s) return;
  
  s.guidelinesAccepted = true; 
  s.step = 'awaiting_phone_contact';
  enrollSessions.set(uid, s);
  console.log(`✅ Guidelines accepted by user ${uid}`);
  
  await ctx.answerCbQuery('✅ Guidelines accepted');
  await continueEnrollment(ctx);
});

// Gender selection
bot.action(/^gender_(Male|Female)$/, async (ctx) => {
  const uid = ctx.from?.id as number | undefined; 
  if (!uid) return;
  const s = enrollSessions.get(uid); 
  if (!s) return;
  
  s.gender = (ctx.match![1] as Gender); 
  enrollSessions.set(uid, s);
  await upsertUserProfileFromSession(uid, s);
  console.log(`✅ Gender set to ${s.gender} for user ${uid}`);
  
  await ctx.answerCbQuery('✅ Gender selected');
  await continueEnrollment(ctx);
});

// Residence selection
bot.action(/^residence_(.+)$/, async (ctx) => {
  const uid = ctx.from?.id as number | undefined; 
  if (!uid) return;
  const s = enrollSessions.get(uid); 
  if (!s) return;
  
  s.residence = ctx.match![1].replace('_', ' '); // Handle underscores in city names
  s.step = 'awaiting_email'; // Add this line to update the step
  enrollSessions.set(uid, s);
  await upsertUserProfileFromSession(uid, s);
  console.log(`✅ Residence set to ${s.residence} for user ${uid}`);
  
  await ctx.answerCbQuery('✅ Residence selected');
  await continueEnrollment(ctx);
});

// Pay button -> Telegram invoice (Chapa)
bot.action(/^pay_(.+)$/, async (ctx) => {
  const uid = ctx.from?.id as number | undefined; 
  if (!uid) return;
  const s = enrollSessions.get(uid);
  
  if (!s || s.communityId !== ctx.match![1]) {
    await ctx.answerCbQuery('❌ Session expired');
    await ctx.reply('Session expired. Please select the community again.');
    return;
  }

  const lang: Lang = (userLanguages.get(uid) || s.language || 'en');
  const missing: string[] = [];
  if (!s.termsAccepted) missing.push('terms');
  if (!s.guidelinesAccepted) missing.push('guidelines');
  if (!s.phone) missing.push('phone');
  if (!s.fullName) missing.push('full_name');
  if (!s.gender) missing.push('gender');
  if (!s.dob) missing.push('dob');
  if (!s.residence) missing.push('residence');

  if (missing.length) {
    console.log(`❌ Missing info for user ${uid}: ${missing.join(', ')}`);
    await ctx.reply(lang === 'en' ? 'Please complete your profile first.' : 'እባክዎ መግለጫዎን በመጀመሪያ ያጠናቅቁ።');
    await ctx.answerCbQuery('❌ Incomplete profile');
    await continueEnrollment(ctx);
    return;
  }

  const priceInCents = Math.round(Number(s.price || 0) * 100);
  console.log(`💳 Generating invoice for user ${uid}, amount: ${priceInCents} cents`);
  
  try {
    // Initialize Chapa transaction to get a valid tx_ref for verification
    const names = (s.fullName || '').trim().split(/\s+/);
    const firstName = names[0] || 'User';
    const lastName = names.slice(1).join(' ') || 'Telegram';
    const desiredTxRef = s.txRef || `community_${s.communityId}_${Date.now()}`;
    const txRef = desiredTxRef;
    s.txRef = txRef;
    enrollSessions.set(uid, s);

    // Ensure DB has a record with the FINAL tx_ref before sending invoice
    try {
      await SubscriptionRequest.findOneAndUpdate(
        { userId: String(uid), communityId: s.communityId },
        { tx_ref: txRef, paymentStatus: 'pending' as any, status: 'active' as any, amount: s.price },
        { upsert: true, new: true }
      );
      console.log('🔄 Synchronized SubscriptionRequest with final tx_ref for pay_:', txRef);
    } catch (syncErr) {
      console.error('❌ Failed to sync SubscriptionRequest tx_ref (pay_):', syncErr);
    }

    const providerData = {
      phone: s.phone,
      fullName: s.fullName,
      gender: s.gender,
      dob: s.dob,
      residence: s.residence,
      email: s.email || '',
      termsAccepted: s.termsAccepted,
      guidelinesAccepted: s.guidelinesAccepted,
      telegramId: s.telegramId,
      telegramUsername: s.telegramUsername,
      tx_ref: s.txRef,
    };
    console.log('🧾 Sending Telegram invoice (pay_)', { txRef, priceInCents, providerData });

    await ctx.replyWithInvoice({
      title: `${s.communityName}`,
      description: `Pay to join ${s.communityName}`,
      payload: txRef,
      provider_token: process.env.CHAPA_PROVIDER_TOKEN || "<YOUR_CHAPA_PROVIDER_TOKEN>",
      currency: "ETB",
      prices: [{ label: "Community Access", amount: priceInCents }],
      start_parameter: "pay",
      need_phone_number: true,
      send_phone_number_to_provider: true,
      provider_data: JSON.stringify(providerData),
    });

    await ctx.answerCbQuery('✅ Invoice sent');
    await ctx.reply(lang === 'en' ? '💳 Payment invoice generated. Please complete your payment.' : '💳 ክፍያ ደረሰኝ ተፈጥሯል። እባክዎን ክፍያውን ያጠናቅቅ።');
    
    // Polling disabled; relying on Telegram successful_payment only
  } catch (err) {
    console.error('❌ Failed to send invoice:', err);
    await ctx.answerCbQuery('❌ Invoice failed');
    await ctx.reply('⚠️ Failed to generate invoice. Please try again later.');
  }
});

// Add simple test command
bot.command("hello", (ctx) => {
  console.log("👋 /hello command executed");
  ctx.reply("Hello! Bot is working!");
});

// Add receipt handler
bot.action(/^receipt_(.+)$/, async (ctx) => {
  const txRef = ctx.match![1];
  const userTelegramId = ctx.from?.id;
  const userLang = userTelegramId ? userLanguages.get(userTelegramId) || 'en' : 'en';
  
  try {
    // Find the subscription by tx_ref
    const subRequest = await SubscriptionRequest.findOne({ tx_ref: txRef });
    
    if (subRequest) {
      const amount = (subRequest as any)?.amount ?? 'N/A';
      const receiptMessage = userLang === 'en' 
        ? `🧾 **Payment Receipt**\n\n**Transaction Details:**\n• Transaction ID: ${txRef}\n• Status: ✅ Completed\n• Date: ${new Date().toLocaleDateString()}\n• Amount: ${amount} ETB\n\n**Service:** Community Access\n\nThank you for your payment!`
        : `🧾 **የክፍያ ደረሰኝ**\n\n**የግብይት ዝርዝር:**\n• የግብይት መቁጠሪያ: ${txRef}\n• ሁኔታ: ✅ ተጠናቋል\n• ቀን: ${new Date().toLocaleDateString()}\n• መጠን: ${amount} ብር\n\n**አገልግሎት:** የማህበረሰብ መዳረሻ\n\nለክፍያዎ እናመሰግናለን!`;
      
      await ctx.reply(receiptMessage, { parse_mode: 'Markdown' });
    } else {
      const errorMessage = userLang === 'en' 
        ? '❌ Receipt not found for this transaction.'
        : '❌ ለዚህ ግብይት ደረሰኝ አልተገኘም።';
      await ctx.reply(errorMessage);
    }
    
    await ctx.answerCbQuery("✅ Receipt displayed");
  } catch (error) {
    console.error('❌ Error fetching receipt:', error);
    await ctx.reply("⚠️ Error retrieving receipt. Please try again later.");
    await ctx.answerCbQuery("❌ Error occurred");
  }
});

// Handle verify payment callback (for manual retries)
bot.action(/^verify_payment_(.+)$/, async (ctx) => {
  const txRef = ctx.match![1];
  const userTelegramId = ctx.from?.id;
  const userLang = userTelegramId ? userLanguages.get(userTelegramId) || 'en' : 'en';
  
  console.log(`🔧 Manual payment verification requested by user ${userTelegramId} for ${txRef}`);
  
  try {
    const result = { success: false, message: 'verification disabled' };
    
    const resultMessage = userLang === 'en'
      ? `🔍 **Manual Verification Result**\n\n**Success:** ${result.success ? '✅ Yes' : '❌ No'}\n**Message:** ${result.message}\n\n${result.success ? 'Your access is being processed!' : 'Please contact support if you believe this is an error.'}`
      : `🔍 **የእጅ ማረጋገጫ ውጤት**\n\n**ተሳካ:** ${result.success ? '✅ አዎ' : '❌ አይ'}\n**መልዕክት:** ${result.message}\n\n${result.success ? 'የእርስዎ መዳረሻ እየተሰራ ነው!' : 'ይህ ስህተት እንደሆነ ከሚያምኑ ድጋፍ ያግኙ።'}`;
    
    await ctx.reply(resultMessage, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery(result.success ? '✅ Verified' : '❌ Not verified');
    
  } catch (error) {
    console.error('❌ Manual verification failed:', error);
    await ctx.reply(userLang === 'en' ? '❌ Verification failed. Please try again later.' : '❌ ማረጋገጫ አልተሳካም። በኋላ እንደገና ይሞክሩ።');
    await ctx.answerCbQuery('❌ Verification failed');
  }
});

// Enhanced successful payment handlers with more robust detection
bot.on("successful_payment", async (ctx) => {
  console.log("🎉 SUCCESSFUL PAYMENT EVENT TRIGGERED!");
  await handleSuccessfulPayment(ctx, userLanguages, paymentSessions, enrollSessions);
});

bot.on(message("successful_payment"), async (ctx) => {
  console.log("🎯 SUCCESSFUL PAYMENT MESSAGE FILTER!");
  await handleSuccessfulPayment(ctx, userLanguages, paymentSessions, enrollSessions);
});

// Enhanced middleware to catch successful payments
bot.use(async (ctx, next) => {
  if (ctx.message && 'successful_payment' in ctx.message) {
    console.log("🎯 CAUGHT SUCCESSFUL PAYMENT IN MIDDLEWARE!");
    await handleSuccessfulPayment(ctx, userLanguages, paymentSessions, enrollSessions);
    return;
  }
  return next();
});

// Handle renew subscription via callback
bot.on("callback_query", async (ctx) => {
  const callbackQuery = ctx.callbackQuery;
  if ("data" in callbackQuery && typeof callbackQuery.data === "string") {
    const data = callbackQuery.data;

    if (data.startsWith("renew_")) {
      const [, subId] = data.split("_");
      console.log("➡️ Renew request received");
      console.log("Sub ID:", subId);
      await ctx.answerCbQuery();
      try {
        const sub = await SubscriptionRequest.findOne({ _id: subId });
        if (!sub) {
          console.log("❌ Subscription doesn't exist");
          return;
        }
        const priceInCents = Math.round(Number((sub as any).amount || 0) * 100);
        await ctx.replyWithInvoice({
          title: "Renew Subscription",
          description: `Renew to continue to have access`,
          payload: `renew_${(sub as any).communityId}_${(sub as any).userId}_${Date.now()}`,
          provider_token: process.env.CHAPA_PROVIDER_TOKEN || "<YOUR_CHAPA_PROVIDER_TOKEN>",
          currency: "ETB",
          prices: [{ label: "Group Access", amount: priceInCents }],
          start_parameter: "pay",
          need_phone_number: true,
          send_phone_number_to_provider: true,
        });
      } catch (err) {
        console.error("❌ Failed to send invoice:", err);
        await ctx.reply("⚠️ Could not send the payment invoice. Please try again later.");
      }
      return;
    }

    await ctx.answerCbQuery("❓ Unknown action.");
  } else {
    console.warn("⚠️ Callback query has no data.");
  }
});

// Pre-checkout: approve
bot.on("pre_checkout_query", (ctx) => {
  console.log("✅ Pre-checkout query received, approving...");
  ctx.answerPreCheckoutQuery(true);
});

// Add debug middleware to catch ALL updates
bot.use(async (ctx, next) => {
  // Only log successful payments to avoid spam
  if (ctx.message && 'successful_payment' in ctx.message) {
    console.log("🔍 SUCCESSFUL_PAYMENT DETECTED IN DEBUG MIDDLEWARE!");
    console.log("Payment details:", JSON.stringify(ctx.message.successful_payment, null, 2));
  }
  
  return next();
});

// Keep only ONE bot.launch() at the very end
bot.launch()
  .then(() => console.log('🤖 Bot launched successfully'))
  .catch(err => console.error('❌ Bot launch failed:', err));

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

export { bot, userLanguages, paymentSessions, enrollSessions };
// Add manual verification command
bot.command("verify_payment", async (ctx) => {
  const args = ctx.message?.text?.split(" ");
  const txRef = args?.[1];
  
  if (!txRef) {
    await ctx.reply("Usage: /verify_payment <transaction_id>\n\nExample: /verify_payment community_1234567890_1234567890");
    return;
  }
  
  console.log("🔧 Manual payment verification requested for:", txRef);
  
  try {
    await ctx.reply("🔍 Payment verification is disabled. Rely on Telegram successful_payment.");
    
    // Try to process via successful_payment handler as a fallback
    await handleSuccessfulPayment(ctx, userLanguages, paymentSessions, enrollSessions);
  } catch (error) {
    await ctx.reply(`❌ Verification failed: ${(error as Error).message}`);
  }
});

// Add command to stop polling for a transaction
bot.command("stop_polling", async (ctx) => {
  await ctx.reply("🛑 Polling is disabled.");
});

// Daily expiry reminder and enforcement scheduler (runs hourly)
// setInterval(async () => {
//   try {
//     const now = new Date();
//     const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
//     const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
//
//     // Find all subscriptions expiring today and still active/paid
//     const expiring = await SubscriptionRequest.find({
//       paymentStatus: { $in: ['paid', 'renewed'] },
//       status: 'active',
//       expireAt: { $gte: startOfDay, $lt: endOfDay },
//     });
//
//     // Group by userId to send one message listing multiple communities
//     const byUser = new Map<string, any[]>();
//     for (const doc of expiring) {
//       const key = String((doc as any).userId);
//       const list = byUser.get(key) || [];
//       list.push(doc);
//       byUser.set(key, list);
//     }
//
//     for (const [userId, docs] of byUser.entries()) {
//       try {
//         // Build message listing all communities expiring today for this user
//         const lines: string[] = [];
//         for (const d of docs) {
//           lines.push(`• ${((d as any).communityName) || 'Community'} (ID: ${((d as any).communityId)})`);
//         }
//         const msg = `⚠️ Your access expires today for:\n\n${lines.join('\n')}\n\nTap Renew to continue access.`;
//
//         // Use first doc's language for UX, and create a single keyboard to open bot
//         const keyboard = {
//           inline_keyboard: [
//             [{ text: '🔄 Renew', callback_data: `renew_community_${(docs[0] as any).communityId}` }],
//           ],
//         } as any;
//
//         await bot.telegram.sendMessage(userId, msg, { reply_markup: keyboard });
//
//         // Increment notice count on each doc
//         for (const d of docs) {
//           (d as any).expiryNoticeCount = ((d as any).expiryNoticeCount || 0) + 1;
//           await (d as any).save();
//         }
//       } catch (notifyErr) {
//         console.error('❌ Failed to send expiry reminder to user', userId, notifyErr);
//       }
//     }
//
//     // Final enforcement for users who got 3 notices (3 days) and are still expired
//     const overdue = await SubscriptionRequest.find({
//       status: 'active',
//       paymentStatus: { $in: ['paid', 'renewed'] },
//       expireAt: { $lt: startOfDay },
//       expiryNoticeCount: { $gte: 3 },
//     });
//
//     for (const d of overdue) {
//       const groupId = String((d as any).groupId || '');
//       const userId = String((d as any).userId || '');
//       if (!groupId || !userId) continue;
//       try {
//         // Kick (ban+unban) and mark expired
//         await bot.telegram.banChatMember(groupId, Number(userId));
//         await bot.telegram.unbanChatMember(groupId, Number(userId));
//
//         (d as any).status = 'expired';
//         (d as any).paymentStatus = 'expired';
//         await (d as any).save();
//
//         await bot.telegram.sendMessage(userId, '⛔ Your access has expired and you have been removed from the group. Use Renew to regain access.');
//       } catch (kickErr) {
//         console.error('❌ Failed to kick expired user', { groupId, userId }, kickErr);
//       }
//     }
//   } catch (err) {
//     console.error('❌ Expiry scheduler error:', err);
//   }
// }, 5000); // run every 5 seconds (testing)

// Profile command: show user's latest profile info
bot.command("profile", async (ctx) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  const fallbackLang: 'en' | 'am' = (userLanguages.get(uid) || 'en');

  try {
    const profile = await UserProfile.findOne({ telegramId: String(uid) });
    if (!profile) {
      await ctx.reply(fallbackLang === 'am' ? 'መገለጫ አልተገኘም። እባክዎ መጀመሪያ መረጃዎን ያቅርቡ (ምሳሌ፡ የስልክ እና ስም).' : 'No profile found. Please share your contact to create one.');
      return;
    }

    const useAm = String((profile as any).language || '').toLowerCase() === 'am';

    const infoEn = `👤 Profile\n\nFull name: ${profile.fullName || 'N/A'}\nPhone: ${profile.phoneNumber || 'N/A'}\nUsername: ${profile.telegramUsername || 'N/A'}\nLocation: ${profile.residence_location || 'N/A'}\nEmail: ${profile.email || 'N/A'}\nGender: ${profile.gender || 'N/A'}\nDOB: ${profile.dob || 'N/A'}\nLanguage: ${profile.language || 'en'}`;

    const infoAm = `👤 መገለጫ\n\nሙሉ ስም: ${profile.fullName || 'አይገኝም'}\nስልክ: ${profile.phoneNumber || 'አይገኝም'}\nየቴሌግራም ዩዘር: ${profile.telegramUsername || 'አይገኝም'}\nአካባቢ: ${profile.residence_location || 'አይገኝም'}\nኢሜል: ${profile.email || 'አይገኝም'}\nጾታ: ${profile.gender || 'አይገኝም'}\nየትውልድ ቀን: ${profile.dob || 'አይገኝም'}\nቋንቋ: ${profile.language || 'en'}`;

    await ctx.reply(useAm ? infoAm : infoEn);
  } catch (err) {
    console.error('/profile error', err);
    await ctx.reply(fallbackLang === 'am' ? 'መገለጫ መረጃ ማሳየት አልተቻለም።' : 'Failed to fetch profile info.');
  }
});

// my-community command (underscore form)
bot.command("my_community", async (ctx) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  const lang: 'en' | 'am' = (userLanguages.get(uid) || 'en');

  try {
    const subs = await SubscriptionRequest.find({ userId: String(uid) }).sort({ updatedAt: -1 });
    if (!subs || subs.length === 0) {
      await ctx.reply(lang === 'am' ? 'ምንም የተመዘገቡ ማህበረሰቦች የሉም።' : 'You have no subscribed communities.');
      return;
    }

    // Group by community and show current status
    for (const s of subs) {
      const isAm = (s as any).language === 'am' || lang === 'am';
      const status = String((s as any).paymentStatus || 'pending');
      const expireAt = (s as any).expireAt ? new Date((s as any).expireAt as any) : undefined;
      const expireStr = expireAt ? expireAt.toLocaleString() : (isAm ? 'አይገኝም' : 'N/A');

      const msg = isAm
        ? `🏛️ ${s.communityName}

ሁኔታ: ${status}
መጨረሻ ቀን: ${expireStr}`
        : `🏛️ ${s.communityName}

Status: ${status}
Expire At: ${expireStr}`;

      const keyboard: any = {
        inline_keyboard: [
          [{ text: isAm ? '🔄 እድሳት' : '🔄 Renew', callback_data: `renew_community_${s.communityId}` }],
          [{ text: isAm ? '🏠 ወደ ማህበረሰቦች' : '🏠 Back to Communities', callback_data: 'back_to_communities' }]
        ]
      };

      await ctx.reply(msg, { reply_markup: keyboard });
    }
  } catch (err) {
    console.error('/my_community error', err);
    await ctx.reply(lang === 'am' ? 'ማህበረሰቦችን ማሳየት አልተቻለም።' : 'Failed to fetch communities.');
  }
});

// Support hyphen command via hears (Telegram command names don't allow hyphen reliably)
bot.hears(/^\/my\-community(?:@[^\s]+)?$/i, async (ctx) => {
  // Delegate to my_community
  (ctx as any).message.text = '/my_community';
  await (bot as any).handleUpdate(ctx.update);
});

// Middleware: upsert chat info on every update
bot.use(async (ctx, next) => {
  try {
    const chat = ctx.chat as any;
    if (chat && chat.id) {
      await BotChat.findOneAndUpdate(
        { chatId: String(chat.id) },
        {
          chatId: String(chat.id),
          type: chat.type,
          title: chat.title,
          username: chat.username,
          first_name: chat.first_name,
          last_name: chat.last_name,
          is_forum: chat.is_forum,
          linked_chat_id: chat.linked_chat_id ? String(chat.linked_chat_id) : undefined,
          lastSeenAt: new Date(),
        },
        { upsert: true }
      );
    }
  } catch (e) {
    console.warn('Chat upsert failed', e);
  }
  return next();
});

// Admin command to list connected group chats (admin-only)
bot.command('admin_1234', async (ctx) => {
  const uid = ctx.from?.id ? String(ctx.from.id) : '';
  const adminIds = (process.env.ADMIN_IDS || process.env.PRIMARY_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!uid || (adminIds.length > 0 && !adminIds.includes(uid))) {
    return;
  }

  try {
    const chats = await BotChat.find({ type: { $in: ['group', 'supergroup'] } }).sort({ updatedAt: -1 }).limit(100);
    if (!chats || chats.length === 0) {
      await ctx.reply('No connected groups found.');
      return;
    }

    const lines: string[] = [];
    for (let i = 0; i < chats.length; i++) {
      const c: any = chats[i];
      let title = c.title || c.username || c.first_name || 'Group';
      let memberCount = 'N/A';
      try {
        const info: any = await ctx.telegram.getChat(c.chatId);
        title = (info && (info as any).title) ? (info as any).title : title;
        try {
          const count = await (ctx.telegram as any).getChatMembersCount(c.chatId);
          memberCount = String(count);
        } catch { /* ignore */ }
      } catch { /* ignore */ }

      lines.push(`${i + 1}. ${title}\n   id: ${c.chatId}\n   type: ${c.type}${c.is_forum ? ' (forum)' : ''}\n   members: ${memberCount}\n   lastSeen: ${new Date(c.lastSeenAt || c.updatedAt).toLocaleString()}`);
    }

    const header = `Connected groups (${chats.length}):`;
    let buffer = header + '\n\n';
    for (const line of lines) {
      if ((buffer + line + '\n').length > 3500) {
        await ctx.reply(buffer.trim());
        buffer = '';
      }
      buffer += line + '\n';
    }
    if (buffer.trim().length) {
      await ctx.reply(buffer.trim());
    }
  } catch (err) {
    console.error('/admin-1234 error', err);
    await ctx.reply('Failed to fetch connected groups.');
  }
});

// Alias: support /admin-1234
bot.hears(/^\/admin-1234(?:@[^\s]+)?$/i, async (ctx) => {
  (ctx as any).message.text = '/admin_1234';
  await (bot as any).handleUpdate(ctx.update);
});

// Capture when the bot is added/updated in a chat (e.g., added to a group)
bot.on('my_chat_member', async (ctx) => {
  try {
    const upd: any = (ctx as any).update?.my_chat_member;
    const chat = upd?.chat;
    if (chat && chat.id) {
      await BotChat.findOneAndUpdate(
        { chatId: String(chat.id) },
        {
          chatId: String(chat.id),
          type: chat.type,
          title: chat.title,
          username: chat.username,
          first_name: chat.first_name,
          last_name: chat.last_name,
          is_forum: chat.is_forum,
          linked_chat_id: chat.linked_chat_id ? String(chat.linked_chat_id) : undefined,
          lastSeenAt: new Date(),
        },
        { upsert: true }
      );
      console.log('✅ Registered chat via my_chat_member:', { chatId: chat.id, type: chat.type, title: chat.title });
    }
  } catch (e) {
    console.warn('my_chat_member upsert failed', e);
  }
});

// Command to register the current group explicitly
bot.command('register_group', async (ctx) => {
  const chat: any = ctx.chat;
  if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
    await ctx.reply('Use this command inside a group where the bot is added.');
    return;
  }
  try {
    await BotChat.findOneAndUpdate(
      { chatId: String(chat.id) },
      {
        chatId: String(chat.id),
        type: chat.type,
        title: chat.title,
        username: chat.username,
        first_name: chat.first_name,
        last_name: chat.last_name,
        is_forum: chat.is_forum,
        linked_chat_id: chat.linked_chat_id ? String(chat.linked_chat_id) : undefined,
        lastSeenAt: new Date(),
      },
      { upsert: true }
    );
    await ctx.reply('✅ Group registered with the bot. It will now appear in admin listings.');
  } catch (e) {
    console.error('register_group failed', e);
    await ctx.reply('❌ Failed to register this group.');
  }
});

// Command to display group chat information
bot.command('id', async (ctx) => {
  const chat = ctx.chat;
  if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
    await ctx.reply('This command can only be used in a group or supergroup.');
    return;
  }

  try {
    // Get chat information
    const chatId = String(chat.id);
    const chatType = chat.type;
    const chatName = chat.title || 'Unnamed Group';

    // Check if the bot is an admin
    const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
    const isAdmin = chatMember.status === 'administrator';

    if (!isAdmin) {
      await ctx.reply('This bot must be an administrator to provide group information.');
      return;
    }

    // Get bot's permissions
    const permissions = chatMember as any;
    const canBanUsers = permissions.can_restrict_members ?? false;
    const canDeleteMessages = permissions.can_delete_messages ?? false;

    // Prepare response message
    const response = `Chat Information:

Chat ID: ${chatId}
Chat Type: ${chatType}
Chat Name: ${chatName}
Bot Status: ${chatMember.status}

To use this group for a community:
1. Copy the Chat ID: ${chatId}
2. Use it in your community creation/editing
3. Make sure bot has admin rights for user management

Current Bot Permissions:
• Can Ban Users: ${canBanUsers ? '✅ Yes' : '❌ No'}
• Can Delete Messages: ${canDeleteMessages ? '✅ Yes' : '❌ No'}
• Is Admin: ✅ Yes`;

    await ctx.reply(response);
  } catch (error) {
    console.error('Error handling /id command:', error);
    await ctx.reply('❌ Failed to retrieve group information. Please try again later.');
  }
});

