import { Telegraf } from "telegraf";
import { ServerConfig } from "../config/ServerConfig";
import axios from "axios";
import { Verify } from "../utils/checkUser";
import { message } from "telegraf/filters";
import { sendGroupPhotoAndInvoice } from "./photo";
import { bot } from "./botInstance";
import { SubscriptionRequest } from "../Model/SubscriptionReq.model";
import mongoose from 'mongoose';
import { handleSuccessfulPayment, SendGroupInvite } from "./paymentHandler";
import { checkUserRegistrationStatus, UserRegistrationStatus } from "./userStatusChecker";
import { BotChat } from "../Model/BotChat.model";
import { UserProfile } from "../Model/UserProfile.model";
import { InlineKeyboardMarkup } from 'telegraf/types';
import path from 'path';

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
  | 'awaiting_payment_phone'
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
  profileUpdateMode?: boolean;
  paymentMode?: 'pay' | 'continue' | 'renew';
  pendingTxRef?: string;
  paymentPhone?: string;
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
const isValidDob = (s: string) => {
  const m = (s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (day < 1 || day > 30) return false;
  if (month < 1 || month > 13) return false;
  if (year < 1900 || year > 2100) return false;
  return true;
};
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
    ? 'Before we continue, please take a moment to review and accept our Terms of Service and Community Guidelines.'
    : 'ከመቀጠልዎ በፊት እባክ የአገልግሎት ውላችንን እና የማህበረሰብ መመሪያዎችን አንብበው መስማማትዎን ያረጋግጡ።';
  
  await ctx.reply(txt, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: lang === 'en' ? '📄 View Terms of Service' : '📄 የአገልግሎት ውሎችን ይመልከቱ', url: TERMS_URL },
          { text: lang === 'en' ? '📄 View Community Guidelines' : '📄 የማህበረሰብ መመሪያዎችን ይመልከቱ', url: GUIDELINES_URL }
        ],
        [
          { text: lang === 'en' ? '✅ I Accept' : '✅ አንብቤ እስማማለሁ', callback_data: 'accept_terms_and_guidelines' }
        ],
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
    ? '📱 **Step 1: Phone Number**\n\nTo create or find your account, please share your contact information by tapping the button below.'
    : '📱 **ደረጃ 1: የስልክ ቁጥር**\n\nአካውንት ለመፍጠር ወይም ለማግኘት፣ እባክዎ ከታች ያለውን ቁልፍ ተጭነው ስልክ ቁጥርዎን ያጋሩን።';
  
  await ctx.reply(txt, { 
    parse_mode: 'Markdown',
    reply_markup: contactKeyboard 
  });
}

async function promptFullName(ctx: any, lang: Lang) {
  const txt = lang === 'en'
    ? '✏️ Please enter your full name.Please use letters only. No numbers or symbols are allowed.'
    : '✏️ እባክዎ ሙሉ ስምዎን ያስገቡ። እባክዎ ፊደላትን ብቻ ይጠቀሙ። ቁጥሮችና ምልክቶች አይፈቀዱም።';
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
    ? 'What is your date of birth? Please use the Ethiopian Calendar and the format DD/MM/YYYY(for example, 12/03/2010).'
    : 'የትውልድ ቀንዎን ያስገቡ። እባክዎ የኢትዮጵያ ዘመን አቆጣጠርን በቀን/ወር/ዓመት (ለምሳሌ፡ 12/03/2010) ቅርጸት ይጠቀሙ።';
  await ctx.reply(txt);
}

async function promptResidence(ctx: any, lang: Lang) {
  const txt = lang === 'en' ? 'Where are you currently located? Please choose your city from the list.Free text is not allowed.' : 'የመኖሪያ ከተማዎን ከዝርዝሩ ውስጥ ይምረጡ። ከዝርዝሩ ውጪ በጽሁፍ ማስገባት አይቻልም።';
  await ctx.reply(txt, { reply_markup: buildResidenceKeyboard() });
}

async function promptEmail(ctx: any, lang: Lang) {
  const txt = lang === 'en'
    ? 'Enter your email (optional). Send "skip" to continue.'
    : 'ከተመቸዎት የኢሜይል አድራሻዎን ያስገቡ። ይህ አስገዳጅ አይደለም። እባክዎ ትክክለኛ የኢሜይል ቅርጸት ይጠቀሙ (ለምሳሌ: example@mail.com). ካልፈለጉ "skip" ይላኩ።';
  await ctx.reply(txt);
}

async function promptPayment(ctx: any, lang: Lang, s: EnrollmentSession) {
  const txt = lang === 'en'
    ? `Ready to pay and join ${s.communityName}?`
    : `${s.communityName} ለመቀላቀል ክፍያ ለማድረግ ዝግጁ ነዎት?`;
  await ctx.reply(txt, {
    reply_markup: {
      inline_keyboard: [
        [
        { text: lang === 'en' ? '💳 Pay' : '💳 ክፍያ', callback_data: `pay_${s.communityId}` },
          { text: lang === 'en' ? '🎁 Start Free 7-Day Trial' : '🎁 7-ቀን ነፃ ሙከራ', callback_data: `start_trial_${s.communityId}` }
        ],
        [
          { text: lang === 'en' ? '🏠 Back to Communities' : '🏠 ወደ ማህበረሰቦች ተመለስ', callback_data: 'back_to_communities' }
        ]
      ],
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

  // If this is a one-off profile update flow, short-circuit to show profile + update menu
  if (s.profileUpdateMode && !s.communityId) {
    // Reset update flag and render profile/update menu
    s.profileUpdateMode = false;
    enrollSessions.set(uid, s);

    const useAm = (lang === 'am');
    const profileMsg = useAm
      ? `👤 መገለጫ\n\nሙሉ ስም: ${s.fullName || 'አይገኝም'}\nስልክ: ${s.phone || 'አይገኝም'}\nየቴሌግራም ዩዘር: ${s.telegramUsername || 'አይገኝም'}\nአካባቢ: ${s.residence || 'አይገኝም'}\nኢሜል: ${s.email || 'አይገኝም'}\nጾታ: ${s.gender || 'አይገኝም'}\nየትውልድ ቀን: ${s.dob || 'አይገኝም'}\nቋንቋ: ${s.language || 'en'}`
      : `👤 Profile\n\nFull name: ${s.fullName || 'N/A'}\nPhone: ${s.phone || 'N/A'}\nUsername: ${s.telegramUsername || 'N/A'}\nLocation: ${s.residence || 'N/A'}\nEmail: ${s.email || 'N/A'}\nGender: ${s.gender || 'N/A'}\nDOB: ${s.dob || 'N/A'}\nLanguage: ${s.language || 'en'}`;

    await ctx.reply(profileMsg);

    const updateKeyboard = {
      inline_keyboard: [
        [
          { text: useAm ? '📱 ስልክ አዘምን' : '📱 Update Phone', callback_data: 'update_phone' },
          { text: useAm ? '✏️ ስም አዘምን' : '✏️ Update Name', callback_data: 'update_full_name' }
        ],
        [
          { text: useAm ? '⚧ ጾታ አዘምን' : '⚧ Update Gender', callback_data: 'update_gender' },
          { text: useAm ? '🎂 የትውልድ ቀን አዘምን' : '🎂 Update DOB', callback_data: 'update_dob' }
        ],
        [
          { text: useAm ? '🏙️ አካባቢ አዘምን' : '🏙️ Update Residence', callback_data: 'update_residence' },
          { text: useAm ? '📧 ኢሜል አዘምን' : '📧 Update Email', callback_data: 'update_email' }
        ],
        [
          { text: useAm ? '🏠 ወደ ማህበረሰቦች' : '🏠 Back to Communities', callback_data: 'back_to_communities' }
        ]
      ]
    } as InlineKeyboardMarkup;

    await ctx.reply(useAm ? 'ምን ማዘመን ትፈልጋሉ?' : 'What would you like to update?', { reply_markup: updateKeyboard });
    return;
  }

  if (!s.language) {
    s.step = 'awaiting_language';
    enrollSessions.set(uid, s);
    await promptLanguage(ctx);
    return;
  }

  if (!s.termsAccepted || !s.guidelinesAccepted) {
    s.step = 'awaiting_terms';
    enrollSessions.set(uid, s);
    await promptTerms(ctx, lang);
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

  // All required fields collected
  await upsertUserProfileFromSession(uid, s);

  if (s.communityId && !s.profileUpdateMode) {
    // In enrollment flow: show payment
  await promptPayment(ctx, lang, s);
  } else {
    // Profile-only or update flow: show summary and update menu
    const useAm = (lang === 'am');
    const profileMsg = useAm
      ? `👤 መገለጫ\n\nሙሉ ስም: ${s.fullName || 'አይገኝም'}\nስልክ: ${s.phone || 'አይገኝም'}\nየቴሌግራም ዩዘር: ${s.telegramUsername || 'አይገኝም'}\nአካባቢ: ${s.residence || 'አይገኝም'}\nኢሜል: ${s.email || 'አይገኝም'}\nጾታ: ${s.gender || 'አይገኝም'}\nየትውልድ ቀን: ${s.dob || 'አይገኝም'}\nቋንቋ: ${s.language || 'en'}`
      : `👤 Profile\n\nFull name: ${s.fullName || 'N/A'}\nPhone: ${s.phone || 'N/A'}\nUsername: ${s.telegramUsername || 'N/A'}\nLocation: ${s.residence || 'N/A'}\nEmail: ${s.email || 'N/A'}\nGender: ${s.gender || 'N/A'}\nDOB: ${s.dob || 'N/A'}\nLanguage: ${s.language || 'en'}`;

    await ctx.reply(profileMsg);

    const updateKeyboard = {
      inline_keyboard: [
        [
          { text: useAm ? '📱 ስልክ አዘምን' : '📱 Update Phone', callback_data: 'update_phone' },
          { text: useAm ? '✏️ ስም አዘምን' : '✏️ Update Name', callback_data: 'update_full_name' }
        ],
        [
          { text: useAm ? '⚧ ጾታ አዘምን' : '⚧ Update Gender', callback_data: 'update_gender' },
          { text: useAm ? '🎂 የትውልድ ቀን አዘምን' : '🎂 Update DOB', callback_data: 'update_dob' }
        ],
        [
          { text: useAm ? '🏙️ አካባቢ አዘምን' : '🏙️ Update Residence', callback_data: 'update_residence' },
          { text: useAm ? '📧 ኢሜል አዘምን' : '📧 Update Email', callback_data: 'update_email' }
        ],
        [
          { text: useAm ? '🏠 ወደ ማህበረሰቦች' : '🏠 Back to Communities', callback_data: 'back_to_communities' }
        ]
      ]
    } as InlineKeyboardMarkup;

    await ctx.reply(useAm ? 'ምን ማዘመን ትፈልጋሉ?' : 'What would you like to update?', { reply_markup: updateKeyboard });
  }
}

// Define helper functions
async function showCommunities(ctx: any, language: string) {
  try {
    const apiUrl = process.env.API_URL;
    const response = await axios.get(`${apiUrl}/api/v1/telegramCommunity/with-mentor`);

    if (Array.isArray(response.data) && response.data.length > 0) {
      const communities = response.data;

      // Build 2-column inline keyboard
        const keyboard: any[] = [];
        for (let i = 0; i < communities.length; i += 2) {
          const row: any[] = [];
        const c1 = communities[i];
        const id1 = c1.communityId || c1._id || c1.id;
        const name1 = c1.communityName || c1.name || 'Community';
        row.push({ text: `🏛️ ${name1}`, callback_data: `view_community_${id1}` });
          if (i + 1 < communities.length) {
          const c2 = communities[i + 1];
          const id2 = c2.communityId || c2._id || c2.id;
          const name2 = c2.communityName || c2.name || 'Community';
          row.push({ text: `🏛️ ${name2}`, callback_data: `view_community_${id2}` });
        }
          keyboard.push(row);
        }

      // Send image without caption; attach keyboard
      try {
        await ctx.replyWithPhoto(
          { source: './public/assets/logo.png' },
          { reply_markup: { inline_keyboard: keyboard } }
        );
      } catch {
        // Invisible fallback text so only the buttons show
        await ctx.reply('\u2063', { reply_markup: { inline_keyboard: keyboard } });
      }
    } else {
      if (language === "en") {
        await ctx.reply(`🎉 **Welcome to Tigat Premium Bot!**

Currently, there are no private communities available.

**Need help?** Type /help for more information.`, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(`🎉 **ወደ Tigat Premium Bot እንኳን በደህና መጡ!**

አሁን ምንም የግል ማህበረሰቦች አይገኙም።

**እርዳታ ያስፈልግዎታል?** /help ይፃፉ።`, { parse_mode: 'Markdown' });
      }
    }
  } catch (error) {
    console.error("Error fetching communities:", error);
    await ctx.reply(language === "en" ? `⚠️ Failed to load communities. Please try again later.` : `⚠️ ማህበረሰቦችን መጫን አልተቻለም። እባክዎ ቆየት ብለው ይሞክሩ።`);
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

// Add helper function for handling phone number changes (only once)
async function handlePhoneNumberChange(telegramId: number, phone: string) {
  const newTgId = String(telegramId);
  const phoneNorm = String(phone);
  
  // Find existing profiles
  const byTelegramId = await UserProfile.findOne({ telegramId: newTgId });
  const byPhone = await UserProfile.findOne({ phoneNumber: phoneNorm });
  
  if (byTelegramId && byPhone && String(byTelegramId._id) !== String(byPhone._id)) {
    // Two different profiles exist - merge them
    console.log(`🔄 Merging profiles: Telegram ID changed from ${byPhone.telegramId} to ${newTgId}`);
    
    // Merge data into the Telegram ID profile
    byTelegramId.phoneNumber = byPhone.phoneNumber || byTelegramId.phoneNumber;
    byTelegramId.fullName = byTelegramId.fullName || byPhone.fullName;
    byTelegramId.gender = byTelegramId.gender || byPhone.gender;
    byTelegramId.dob = byTelegramId.dob || byPhone.dob;
    byTelegramId.residence_location = byTelegramId.residence_location || byPhone.residence_location;
    byTelegramId.email = byTelegramId.email || byPhone.email;
    byTelegramId.language = byTelegramId.language || byPhone.language;
    byTelegramId.telegramUsername = byTelegramId.telegramUsername || byPhone.telegramUsername;
    
    await byTelegramId.save();
    
    // Update all SubscriptionRequests to use new Telegram ID
    await SubscriptionRequest.updateMany(
      { userId: byPhone.telegramId },
      { userId: newTgId }
    );
    
    // Delete old profile
    await UserProfile.deleteOne({ _id: byPhone._id });
    
    console.log(`✅ Profile merged successfully for phone ${phoneNorm}`);
    return byTelegramId;
  } else if (byPhone && !byTelegramId) {
    // Only phone profile exists - update to new Telegram ID
    byPhone.telegramId = newTgId;
    await byPhone.save();
    
    // Update SubscriptionRequests
    await SubscriptionRequest.updateMany(
      { userId: byPhone.telegramId },
      { userId: newTgId }
    );
    
    console.log(`🔄 Updated Telegram ID for existing phone profile`);
    return byPhone;
  } else if (byTelegramId) {
    // Only Telegram ID profile exists - update phone
    byTelegramId.phoneNumber = phoneNorm;
    await byTelegramId.save();
    return byTelegramId;
  } else {
    // No existing profile - create new
    return await UserProfile.findOneAndUpdate(
      { telegramId: newTgId },
      { telegramId: newTgId, phoneNumber: phoneNorm },
      { upsert: true, new: true }
    );
  }
}

// Add function to check and update user profile on start (only once)
async function checkAndUpdateUserProfile(telegramId: number, username?: string) {
  const tgId = String(telegramId);
  
  try {
    // Check if user has existing profile by Telegram ID
    let profile = await UserProfile.findOne({ telegramId: tgId });
    
    if (profile) {
      // Update username if it changed
      const telegramUsername = username ? `@${username}` : '';
      if (profile.telegramUsername !== telegramUsername) {
        profile.telegramUsername = telegramUsername;
        await profile.save();
        console.log(`🔄 Updated username for user ${tgId}: ${telegramUsername}`);
      }
      return profile;
    }
    
    // Check if there are any orphaned profiles with same phone but different Telegram ID
    // This handles the case where user deleted and recreated Telegram account
    const orphanedProfiles = await UserProfile.find({ 
      telegramId: { $ne: tgId },
      phoneNumber: { $exists: true, $ne: '' }
    });
    
    if (orphanedProfiles.length > 0) {
      console.log(`🔍 Found ${orphanedProfiles.length} potential orphaned profiles for user ${tgId}`);
      // For now, just log - user will need to share contact to merge
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error checking user profile for ${tgId}:`, error);
    return null;
  }
}

// Register command handlers
bot.command("start", async (ctx) => {
  console.log("🚀 /start command executed by user:", ctx.from?.id);

  const userTelegramId = ctx.from?.id;
  if (userTelegramId) {
    // Always check and update user profile on start
    const profile = await checkAndUpdateUserProfile(userTelegramId, ctx.from?.username);
    
    if (profile) {
      // Set user language from existing profile
      userLanguages.set(userTelegramId, (profile.language as 'en' | 'am') || 'en');
      console.log(`👤 Found existing profile for user ${userTelegramId}, language: ${profile.language}`);
    }
  }

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
  // Clear any stale enrollment sessions from previous incomplete flows
  if (userTelegramId) {
    enrollSessions.delete(userTelegramId);
    paymentSessions.delete(userTelegramId);
  }
  
  await ctx.reply("🌍 **Welcome! To get started, please select your preferred language.**\n\nእንኳን በደህና መጡ! ለመጀመር እባክዎ የሚፈልጉትን ቋንቋ ይምረጡ።", {
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
  await ctx.answerCbQuery("✅ Language set to English");
  const userTelegramId = ctx.from?.id;
  if (userTelegramId) {
    userLanguages.set(userTelegramId, "en");
    const s = enrollSessions.get(userTelegramId);
    // Only continue enrollment if in active enrollment with communityId
    if (s && s.communityId) {
      s.language = 'en';
      s.step = 'awaiting_terms';
      enrollSessions.set(userTelegramId, s);
      await continueEnrollment(ctx);
      return;
    } else {
      // Clear stale session if no community context
      enrollSessions.delete(userTelegramId);
    }
  }
  await ctx.reply("🇺🇸 **Language set to English!**\n\nLet me show you the available communities.");
  await showCommunities(ctx, "en");
});

bot.action("language_am", async (ctx) => {
  await ctx.answerCbQuery("✅ ቋንቋ ወደ አማርኛ ተቀይሯል");
  const userTelegramId = ctx.from?.id;
  if (userTelegramId) {
    userLanguages.set(userTelegramId, "am");
    const s = enrollSessions.get(userTelegramId);
    // Only continue enrollment if in active enrollment with communityId
    if (s && s.communityId) {
      s.language = 'am';
      s.step = 'awaiting_terms';
      enrollSessions.set(userTelegramId, s);
      await continueEnrollment(ctx);
      return;
    } else {
      // Clear stale session if no community context
      enrollSessions.delete(userTelegramId);
    }
  }
  await ctx.reply("🇪🇹 **ቋንቋ ወደ አማርኛ ተቀይሯል!**\n\nየሚገኙ ማህበረሰቦችን እንድያዩ ያድርጉኝ።");
  await showCommunities(ctx, "am");
});

bot.action('back_to_list', async (ctx) => {
  const userTelegramId = ctx.from?.id;
  const userLanguage = userTelegramId ? userLanguages.get(userTelegramId) || "en" : "en";

  await showCommunities(ctx, userLanguage);
  await ctx.answerCbQuery('✅ Returned to list');
});
bot.action(/^view_community_(.+)$/, async (ctx) => {
  const communityId = ctx.match![1];
  const userTelegramId = ctx.from?.id;
  const userLang = userTelegramId ? userLanguages.get(userTelegramId) || 'en' : 'en';

  try {
    const apiUrl = process.env.API_URL;
    const response = await axios.get(`${apiUrl}/api/v1/telegramCommunity/with-mentor`);
    const list = Array.isArray(response.data) ? response.data : [];
    const community = list.find((c: any) => (
      c.communityId === communityId || c._id === communityId || c.id === communityId
    ));

    if (!community) {
      await ctx.reply(userLang === 'en' ? '❌ Community not found.' : '❌ ማህበረሰብ አልተገኘም።');
      await ctx.answerCbQuery('❌ Not found');
      return;
    }

    const name = community.communityName || community.name || 'Community';
    const price = community.price ?? '';
    const mentorName = community.mentorName || community.mentor?.name || 'Unknown Mentor';
    const rawDescription = community.description || '';
    const description = String(rawDescription).replace(/([_*\[\]\(\)~`>#+\-=|{}\.\!])/g, '\\$1');
    const imagePath = community.photo || community.image || community.photoUrl;
    const imageUrl = imagePath
      ? (imagePath.startsWith('http') ? imagePath : `${apiUrl}${imagePath}`)
      : undefined;

    let detailMessage = '';
    let keyboard: InlineKeyboardMarkup;

    if (userLang === 'en') {
      detailMessage = `🏛️ **${name}**
📝 **Description:** ${description}
👨‍🏫 **Mentor:** ${mentorName}
💰 **Price:** ${price} birr`;

      keyboard = {
        inline_keyboard: [
          [{ text: `🚀 Join ${name}`, callback_data: `join_community_${communityId}` }],
          [{ text: '🔙 Back to List', callback_data: 'back_to_list' }]
        ]
      };
    } else {
      detailMessage = `🏛️ **${name}**
📝 **መግለጫ:** ${description}
👨‍🏫 **መምህር:** ${mentorName}
💰 **ዋጋ:** ${price} ብር`;

      keyboard = {
        inline_keyboard: [
          [{ text: `🚀 ${name} ላይ ተቀላቀል`, callback_data: `join_community_${communityId}` }],
          [{ text: '🔙 ወደ ዝርዝር ተመለስ', callback_data: 'back_to_list' }]
        ]
      };
    }

    if (imageUrl) {
      try {
        await ctx.replyWithPhoto(imageUrl, {
          caption: detailMessage,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } catch (photoError) {
        console.error('Error sending photo:', photoError);
        await ctx.reply(detailMessage, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
    } else {
      await ctx.reply(detailMessage, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }

    await ctx.answerCbQuery('✅ Community details loaded');

  } catch (error) {
    console.error('❌ Error viewing community:', error);
    await ctx.reply(userLang === 'en' ? '⚠️ Error loading details.' : '⚠️ ዝርዝር መጫን አልተቻለም።');
    await ctx.answerCbQuery('❌ Error');
  }
});

// Enhanced join community handler with multiple pending communities support
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
      
      // Fetch fresh UserProfile data to ensure we have complete info
      let userInfo = userStatus.userInfo;
      try {
        const freshProfile = await UserProfile.findOne({ telegramId: String(userTelegramId) });
        if (freshProfile) {
          userInfo = {
            fullName: (freshProfile as any)?.fullName || userInfo.fullName || '',
            phoneNumber: (freshProfile as any)?.phoneNumber || userInfo.phoneNumber || '',
            residence_location: (freshProfile as any)?.residence_location || userInfo.residence_location || '',
            email: (freshProfile as any)?.email || userInfo.email || '',
            amount: userInfo.amount,
            communityName: userInfo.communityName
          };
        }
      } catch (e) {
        console.warn('Failed to fetch fresh UserProfile:', e);
      }
      
      // Display user registration info
      const statusMessage = userLang === 'en'
        ? `👤 **Your Pending Community Details**\n\n**Full Name:** ${userInfo.fullName}\n**Phone:** ${userInfo.phoneNumber}\n**Location:** ${userInfo.residence_location}\n**Email:** ${userInfo.email || 'Not provided'}\n**Community:** ${userInfo.communityName}\n**Amount:** ${userInfo.amount} birr\n**Payment Status:** ${userStatus.paymentStatus?.toUpperCase()}`
        : `👤 **የእርስዎ ምዝገባ ዝርዝር**\n\n**ሙሉ ስም:** ${userInfo.fullName}\n**ስልክ:** ${userInfo.phoneNumber}\n**አድራሻ:** ${userInfo.residence_location}\n**ኢሜል:** ${userInfo.email || 'አልተሰጠም'}\n**ማህበር:** ${userInfo.communityName}\n**መጠን:** ${userInfo.amount} ብር\n**የክፍያ ሁኔታ:** ${userStatus.paymentStatus?.toUpperCase()}`;

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
      } else if (userStatus.paymentStatus === 'trial') {
        // On trial - show status
        const trialMessage = userLang === 'en'
          ? '\n\n🎁 **You are currently on a 7-day free trial for this community!**'
          : '\n\n🎁 **ለዚህ ማህበረሰብ 7-ቀን ነፃ ሙከራ ላይ ነዎት!**';
        
        await ctx.reply(statusMessage + trialMessage, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: userLang === 'en' ? '💳 Upgrade to Paid' : '💳 ወደ ክፍያ አድርግ', callback_data: `continue_payment_${communityId}` }],
              [{ text: userLang === 'en' ? '🏠 Back to Communities' : '🏠 ወደ ማህበረሰቦች ተመለስ', callback_data: 'back_to_communities' }]
            ]
          }
        });
        await ctx.answerCbQuery("✅ On trial");
        return;
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
    // Prefill enrollment from existing UserProfile so we don't ask again
    try {
      const s = enrollSessions.get(userTelegramId)!;
      const prof = await UserProfile.findOne({ telegramId: String(userTelegramId) });

      if (prof) {
        s.language = (s.language as Lang) || ((prof as any).language as Lang) || 'en';
        s.phone = s.phone || (prof as any).phoneNumber || '';
        s.fullName = s.fullName || (prof as any).fullName || '';
        s.gender = s.gender || (prof as any).gender || '';
        s.dob = s.dob || (prof as any).dob || '';
        s.residence = s.residence || (prof as any).residence_location || '';
        s.email = s.email === undefined ? ((prof as any).email || '') : s.email;
        s.telegramId = s.telegramId || String(userTelegramId);
        s.telegramUsername = s.telegramUsername || ((prof as any).telegramUsername || (ctx.from?.username ? `@${ctx.from.username}` : ''));

        s.termsAccepted = true;
        s.guidelinesAccepted = true;

        enrollSessions.set(userTelegramId, s);
      }
    } catch (e) {
      console.warn('Prefill from UserProfile failed', e);
    }

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
    const subRequest = await SubscriptionRequest.findOne({
      userId: String(userTelegramId),
      communityId: communityId
    }).sort({ createdAt: -1 });
    
    if (!subRequest) {
      await ctx.reply(userLang === 'en' ? '❌ No pending payment found.' : '❌ ምንም ክፍያ በመጠባበቅ አይገኝም።');
      await ctx.answerCbQuery("❌ No pending payment");
      return;
    }

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

    // Ensure session exists
    const s = enrollSessions.get(userTelegramId!) || ({ step: 'awaiting_language' } as EnrollmentSession);
    s.communityId = communityId;
    s.communityName = community.communityName;
    s.price = community.price;
    s.community = community;
    s.telegramId = String(userTelegramId);
    // Prefill phone/fullName from profile
    try {
      const prof = await UserProfile.findOne({ telegramId: String(userTelegramId) });
      if (prof) {
        s.phone = s.phone || (prof as any).phoneNumber || '';
        s.fullName = s.fullName || (prof as any).fullName || '';
        s.termsAccepted = true; s.guidelinesAccepted = true;
      }
    } catch {}
    s.step = 'awaiting_payment_phone';
    s.paymentMode = 'continue';
    enrollSessions.set(userTelegramId!, s);

    await ctx.answerCbQuery('');
    await promptConfirmPaymentPhone(ctx, userLang as Lang, s.phone || '');
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
        { tx_ref: txRef, paymentStatus: 'pending' as any, status: 'active' as any, amount: community.price, communityName: community.communityName },
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

// Add helper function for handling phone number changes
// Update the contact handler
bot.on(message('contact'), async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const s = enrollSessions.get(uid);
  const lang: Lang = (userLanguages.get(uid) || s?.language || 'en');

  console.log(`📞 Contact received from user ${uid}, current step: ${s?.step}`);

  if (!s || s.step !== 'awaiting_phone_contact') {
    console.log(`❌ No enrollment session or wrong step for user ${uid}`);

    const errorMsg = lang === 'en'
      ? 'Phone number received, but you are not in the enrollment process. Please start by selecting a community to join.'
      : 'የስልክ ቁጥር ተቀብሏል፣ ነገር ግን በምዝገባ ሂደት ውስጥ አይደሉም። እባክዎ ለመቀላቀል ማህበረሰብ በመምረጥ ይጀምሩ።';

    await ctx.reply(errorMsg);
    return;
  }

  const phone = ctx.message.contact.phone_number;
  const contactUserId = ctx.message.contact.user_id;

  if (!phone) {
    await ctx.reply(lang === 'en' ? 'Phone number not found. Please try again.' : 'ስልክ ቁጥር አልተገኘም። እባክዎ እንደገና ይሞክሩ።');
    return;
  }

  // ========== VALIDATION: Check if shared contact matches Telegram account ==========
  if (contactUserId && contactUserId !== uid) {
    const errorMsg = lang === 'en'
      ? '❌ **Phone Number Mismatch**\n\nYou must share YOUR OWN contact, not someone else\'s phone number.\n\nPlease tap "📱 Share Contact" again and make sure you select your own contact.'
      : '❌ **የስልክ ቁጥር አለመጣጣም**\n\nየሌላ ሰው ስልክ ቁጥር ሳይሆን የእራስዎን አድራሻ ማጋራት አለብዎት።\n\nእባኮትን እንደገና "📱 አጋራ አድራሻ" ንካ እና የራስህ አድራሻ መምረጥህን አረጋግጥ።';

    await ctx.reply(errorMsg, {
      parse_mode: 'Markdown',
      reply_markup: contactKeyboard
    });
    return;
  }

  // Additional validation: normalize and check phone format
  const normalizedPhone = phone.replace(/[\s\-\+]/g, '');
  if (normalizedPhone.length < 10) {
    await ctx.reply(lang === 'en'
      ? '❌ Invalid phone number format. Please share a valid contact.'
      : '❌ የተሳሳተ የስልክ ቁጥር ቅርፅ። እባክዎ የሚሰራ ስልክ ቁጥር ያጋሩ።',
      { reply_markup: contactKeyboard }
    );
    return;
  }

  // Handle phone number changes and Telegram ID changes
  const profile = await handlePhoneNumberChange(uid, phone);

  // Update session with phone
  s.phone = phone;
  await upsertUserProfileFromSession(uid, s);

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
    // If email already on file, skip asking and continue
    if (s.email && isValidEmail(s.email)) {
      enrollSessions.set(uid, s);
      await continueEnrollment(ctx);
      return;
    }

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
    ? '✅ **Phone Verified!**\n\nPhone number received: `' + phone + '`\n\nPlease enter your full name (letters only, 2–100 chars).'
    : '✅ **ስልክ ተረጋግጧል!**\n\nየስልክ ቁጥር ተቀብሏል: `' + phone + '`\n\nእባክዎ ሙሉ ስምዎን ያስገቡ (ፊደላት ብቻ, 2–100 ቁምፊ).';

  await ctx.reply(namePrompt, {
    parse_mode: 'Markdown',
    reply_markup: { remove_keyboard: true }
  });
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
          ? '❌ Invalid date. Use DD/MM/YYYY with day 1–30 and month 1–13 (e.g., 12/03/2010).'
          : '❌ የማይሰራ ቀን። DD/MM/YYYY ቅርጸት ይጠቀሙ፣ ቀን 1–30 እና ወር 1–13 (ለምሳሌ፣ 12/03/2010)።');
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
          const safeCommunityId = enroll.communityId || 'no_community';
          enroll.txRef = `community_${safeCommunityId}_${Date.now()}`;
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

    if (enroll.step === 'awaiting_payment_phone') {
      // Validate and set a new phone for payment
      const phoneText = text.replace(/[\s\-\+]/g, '');
      if (!/^\d{10,}$/.test(phoneText)) {
        await ctx.reply(lang === 'en'
          ? '❌ Invalid phone number. Please enter a valid number.'
          : '❌ የማይሰራ የስልክ ቁጥር። እባክዎ ትክክለኛ ቁጥር ያስገቡ።');
        return;
      }
      // Do NOT update profile phone here; use a temporary payment-only phone
      enroll.paymentPhone = phoneText;
      enrollSessions.set(userTelegramId, enroll);
      // proceed to invoice
      await generateInvoiceFromSession(ctx, lang, enroll);
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
  let userLanguage: 'en' | 'am' = 'en';
  if (userTelegramId) {
    const mapLang = userLanguages.get(userTelegramId);
    if (mapLang) {
      userLanguage = mapLang as any;
    } else {
      try {
        const prof = await UserProfile.findOne({ telegramId: String(userTelegramId) });
        const profLang = String((prof as any)?.language || '').toLowerCase();
        if (profLang === 'am' || profLang === 'en') {
          userLanguage = profLang as any;
          userLanguages.set(userTelegramId, userLanguage);
        }
      } catch {}
    }
    paymentSessions.delete(userTelegramId);
    enrollSessions.delete(userTelegramId); // Also clear enrollment session
  }
  
  // Check if user has pending communities
  try {
    const pendingCount = await SubscriptionRequest.countDocuments({
      userId: String(userTelegramId),
      paymentStatus: { $in: ['pending', 'expired'] }
    });
    
    if (pendingCount > 0) {
      const pendingMessage = userLanguage === 'en' 
        ? `📋 You have ${pendingCount} pending community registration(s).\n\nWhat would you like to do?`
        : `📋 ${pendingCount} የማህበረሰብ ምዝገባ(ዎች) በመጠባበቅ ላይ አሉ።\n\nምን ማድረግ ይፈልጋሉ?`;
      
      await ctx.reply(pendingMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: userLanguage === 'en' ? '📋 View Pending' : '📋 በመጠባበቅ ላይ ያሉትን ይመልከቱ', callback_data: 'show_pending_communities' },
              { text: userLanguage === 'en' ? '🏛️ Browse All' : '🏛️ ሁሉንም ይመልከቱ', callback_data: 'browse_all_communities' }
            ]
          ]
        }
      });
      await ctx.answerCbQuery("✅ Options displayed");
      return;
    }
  } catch (error) {
    console.error("❌ Error checking pending communities:", error);
  }
  
  // No pending communities, show all communities
  await showCommunities(ctx, userLanguage);
  await ctx.answerCbQuery("✅ Back to communities");
});

// Accept Terms
bot.action('accept_terms_and_guidelines', async (ctx) => {
  const uid = ctx.from?.id as number | undefined; 
  if (!uid) return;
  const s = enrollSessions.get(uid); 
  if (!s) return;
  
  s.termsAccepted = true; 
  s.guidelinesAccepted = true;
  s.step = 'awaiting_phone_contact';
  enrollSessions.set(uid, s);
  console.log(`✅ Terms and guidelines accepted by user ${uid}`);
  
  await ctx.answerCbQuery('✅ Terms and guidelines accepted');
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

  const selectedGender = ctx.match![1] as Gender;
  const lang: Lang = (userLanguages.get(uid) || s.language || 'en');

  s.gender = selectedGender;
  enrollSessions.set(uid, s);
  await upsertUserProfileFromSession(uid, s);
  console.log(`✅ Gender set to ${s.gender} for user ${uid}`);

  // ========== REMOVE THE BUTTONS: Edit the message to remove inline keyboard ==========
  try {
    const confirmationText = lang === 'en'
      ? `✅ Gender selected: **${selectedGender}**`
      : `✅ ጾታ ተመርጧል: **${selectedGender}**`;

    // Edit the original message to remove buttons and show confirmation
    await ctx.editMessageText(confirmationText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] } // Empty keyboard removes buttons
    });
  } catch (editError) {
    console.warn('Could not edit message:', editError);
    // Fallback: send new message if edit fails
    const confirmationText = lang === 'en'
      ? `✅ Gender selected: **${selectedGender}**`
      : `✅ ጾታ ተመርጧል: **${selectedGender}**`;
    await ctx.reply(confirmationText, { parse_mode: 'Markdown' });
  }

  await ctx.answerCbQuery('✅ Gender selected');
  await continueEnrollment(ctx);
});

// Residence selection
bot.action(/^residence_(.+)$/, async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const s = enrollSessions.get(uid);
  if (!s) return;

  const selectedResidence = ctx.match![1].replace('_', ' ');
  const lang: Lang = (userLanguages.get(uid) || s.language || 'en');

  s.residence = selectedResidence;
  s.step = 'awaiting_email';
  enrollSessions.set(uid, s);
  await upsertUserProfileFromSession(uid, s);
  console.log(`✅ Residence set to ${s.residence} for user ${uid}`);

  // ========== REMOVE THE BUTTONS: Edit the message to remove inline keyboard ==========
  try {
    const confirmationText = lang === 'en'
      ? `✅ Location selected: **${selectedResidence}**`
      : `✅ አካባቢ ተመርጧል: **${selectedResidence}**`;

    // Edit the original message to remove buttons and show confirmation
    await ctx.editMessageText(confirmationText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] }
    });
  } catch (editError) {
    console.warn('Could not edit message:', editError);
    const confirmationText = lang === 'en'
      ? `✅ Location selected: **${selectedResidence}**`
      : `✅ አካባቢ ተመርጧል: **${selectedResidence}**`;
    await ctx.reply(confirmationText, { parse_mode: 'Markdown' });
  }

  await ctx.answerCbQuery('✅ Residence selected');
  await continueEnrollment(ctx);
});

// Pay button -> Telegram invoice (Chapa)
// removed duplicate pay handler - unified confirmation flow is defined later

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
bot.on("callback_query", async (ctx, next) => {
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
        
        // Fetch current community price from API
        const apiUrl = process.env.API_URL;
        const response = await axios.get(`${apiUrl}/api/v1/telegramCommunity/with-mentor`);
        const list = Array.isArray(response.data) ? response.data : [];
        const community = list.find((c: any) => (
          c.communityId === (sub as any).communityId || c._id === (sub as any).communityId || c.id === (sub as any).communityId
        ));
        
        if (!community) {
          await ctx.reply("❌ Community not found or no longer available.");
          return;
        }
        
        // Use current community price, not stored amount
        const currentPrice = Number(community.price || 0);
        const priceInCents = Math.round(currentPrice * 100);
        
        console.log(`💰 Using current price: ${currentPrice} ETB (was stored: ${(sub as any).amount || 0} ETB)`);
        
        await ctx.replyWithInvoice({
          title: `Renew ${community.communityName}`,
          description: `Renew your subscription to ${community.communityName}`,
          payload: `renew_${(sub as any).communityId}_${(sub as any).userId}_${Date.now()}`,
          provider_token: process.env.CHAPA_PROVIDER_TOKEN || "<YOUR_CHAPA_PROVIDER_TOKEN>",
          currency: "ETB",
          prices: [{ label: "Community Renewal", amount: priceInCents }],
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

    return next();
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

// Profile command: show user's latest profile info
bot.command("profile", async (ctx) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  const fallbackLang: 'en' | 'am' = (userLanguages.get(uid) || 'en');

  try {
    const profile = await UserProfile.findOne({ telegramId: String(uid) });

    // Helper to show current profile
    const showProfile = async () => {
      const useAm = String((profile as any)?.language || fallbackLang).toLowerCase() === 'am';
      const infoEn = `👤 Profile

Full name: ${(profile as any)?.fullName || 'N/A'}
Phone: ${(profile as any)?.phoneNumber || 'N/A'}
Username: ${(profile as any)?.telegramUsername || 'N/A'}
Location: ${(profile as any)?.residence_location || 'N/A'}
Email: ${(profile as any)?.email || 'N/A'}
Gender: ${(profile as any)?.gender || 'N/A'}
DOB: ${(profile as any)?.dob || 'N/A'}
Language: ${(profile as any)?.language || 'en'}`;
      const infoAm = `👤 መገለጫ

ሙሉ ስም: ${(profile as any)?.fullName || 'አይገኝም'}
ስልክ: ${(profile as any)?.phoneNumber || 'አይገኝም'}
የቴሌግራም ዩዘር: ${(profile as any)?.telegramUsername || 'አይገኝም'}
አካባቢ: ${(profile as any)?.residence_location || 'አይገኝም'}
ኢሜል: ${(profile as any)?.email || 'አይገኝም'}
ጾታ: ${(profile as any)?.gender || 'አይገኝም'}
የትውልድ ቀን: ${(profile as any)?.dob || 'አይገኝም'}
ቋንቋ: ${(profile as any)?.language || 'en'}`;
      await ctx.reply(useAm ? infoAm : infoEn);
    };

    // Start/continue a profile completion session
    const s = enrollSessions.get(uid) || {
      step: 'awaiting_language',
    } as EnrollmentSession;

    s.language = (s.language as any) || ((profile as any)?.language as any) || fallbackLang;
    s.termsAccepted = true;
    s.guidelinesAccepted = true;
    s.telegramId = String(uid);
    s.telegramUsername = (profile as any)?.telegramUsername || (ctx.from?.username ? `@${ctx.from.username}` : '');

    const lang: Lang = (s.language as Lang) || 'en';

    if (!profile) {
      // No profile yet -> ask for contact first
      s.step = 'awaiting_phone_contact';
      enrollSessions.set(uid, s);
      await promptShareContact(ctx, lang);
      return;
    }

    // Prefill known fields
    s.phone = (profile as any)?.phoneNumber || '';
    s.fullName = (profile as any)?.fullName || '';
    s.gender = (profile as any)?.gender || '';
    s.dob = (profile as any)?.dob || '';
    s.residence = (profile as any)?.residence_location || '';
    s.email = (profile as any)?.email ?? '';

    // Decide next missing step (phone -> name -> gender -> dob -> residence -> email)
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
    if (!s.residence) {
      s.step = 'awaiting_residence';
      enrollSessions.set(uid, s);
      await promptResidence(ctx, lang);
      return;
    }

    // Email is optional; if missing, ask but allow skip
    if (s.email === undefined || s.email === '') {
      s.step = 'awaiting_email';
      enrollSessions.set(uid, s);
      const currentEmail = s.email || '';
      const prompt = lang === 'en'
        ? `📝 Optional: Update your email.\nCurrent: ${currentEmail || 'N/A'}\n\nSend a new email or type "skip" to continue.`
        : `📝 አማራጭ፡ ኢሜልዎን ያዘምኑ።\nየአሁኑ፡ ${currentEmail || 'አይገኝም'}\n\nአዲስ ኢሜል ይላኩ ወይም "skip" በማለት ይቀጥሉ።`;
      await ctx.reply(prompt);
      return;
    }
    // All good -> show profile
    await showProfile();

    // determine language for update menu
    const useAm = String((profile as any)?.language || fallbackLang).toLowerCase() === 'am';

    // Send update menu
    const updateKeyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: useAm ? '📱 ስልክ አዘምን' : '📱 Update Phone', callback_data: 'update_phone' },
          { text: useAm ? '✏️ ስም አዘምን' : '✏️ Update Name', callback_data: 'update_full_name' }
        ],
        [
          { text: useAm ? '⚧ ጾታ አዘምን' : '⚧ Update Gender', callback_data: 'update_gender' },
          { text: useAm ? '🎂 የትውልድ ቀን አዘምን' : '🎂 Update DOB', callback_data: 'update_dob' }
        ],
        [
          { text: useAm ? '🏙️ አካባቢ አዘምን' : '🏙️ Update Residence', callback_data: 'update_residence' },
          { text: useAm ? '📧 ኢሜል አዘምን' : '📧 Update Email', callback_data: 'update_email' }
        ],
        [
          { text: useAm ? '🏠 ወደ ማህበረሰቦች' : '🏠 Back to Communities', callback_data: 'back_to_communities' }
        ]
      ]
    };
    await ctx.reply(useAm ? 'ምን ማዘመን ትፈልጋሉ?' : 'What would you like to update?', { reply_markup: updateKeyboard });
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
    // Fetch paid/trial/active communities
    const subs = await SubscriptionRequest.find({ 
      userId: String(uid),
      paymentStatus: { $in: ['paid', 'renewed', 'trial'] },
      status: 'active'
    }).sort({ updatedAt: -1 });
    
    if (!subs || subs.length === 0) {
      await ctx.reply(lang === 'am' ? 'ምንም የተመዘገቡ ማህበረሰቦች የሉም።' : 'You have no active subscribed communities.');
      return;
    }

    // Group by community and show current status
    for (const s of subs) {
      const isAm = (s as any).language === 'am' || lang === 'am';
      const status = String((s as any).paymentStatus || 'paid');
      const isTrial = status === 'trial';
      
      // For trial, show trialExpireAt; for paid, show expireAt
      const expireAt = isTrial 
        ? ((s as any).trialExpireAt ? new Date((s as any).trialExpireAt as any) : undefined)
        : ((s as any).expireAt ? new Date((s as any).expireAt as any) : undefined);
      const expireStr = expireAt ? expireAt.toLocaleString() : (isAm ? 'አይገኝም' : 'N/A');
      
      // Check if subscription is expired
      const isExpired = expireAt && expireAt < new Date();

      const msg = isAm
        ? `🏛️ ${s.communityName}

ሁኔታ: ${status}${isTrial ? ' 🎁 (ነፃ ሙከራ)' : ''}
መጨረሻ ቀን: ${expireStr}`
        : `🏛️ ${s.communityName}

Status: ${status}${isTrial ? ' 🎁 (Free Trial)' : ''}
Expire At: ${expireStr}`;

      const keyboard: any = {
        inline_keyboard: []
      };

      // Show upgrade button if trial
      if (isTrial && !isExpired) {
        keyboard.inline_keyboard.push([
          { text: isAm ? '💳 ወደ ክፍያ አሻሽል' : '💳 Upgrade to Paid', callback_data: `continue_payment_${s.communityId}` }
        ]);
      }
      
      // Show renew button if expired
      if (isExpired) {
        keyboard.inline_keyboard.push([
          { text: isAm ? '🔄 እድሳት' : '🔄 Renew', callback_data: `renew_community_${s.communityId}` }
        ]);
      }
      
      keyboard.inline_keyboard.push([
        { text: isAm ? '🏠 ወደ ማህበረሰቦች' : '🏠 Back to Communities', callback_data: 'back_to_communities' }
      ]);

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




// Alias: support /admin-1234


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

// Add new action to show all pending communities
bot.action("show_pending_communities", async (ctx) => {
  const userTelegramId = ctx.from?.id;
  const userLang = userTelegramId ? userLanguages.get(userTelegramId) || 'en' : 'en';
  if (!userTelegramId) return;
  
  try {
    // Fetch all pending subscriptions for this user
    const pendingSubs = await SubscriptionRequest.find({
      userId: String(userTelegramId),
      paymentStatus: 'pending'
    }).sort({ createdAt: -1 });
    
    if (pendingSubs.length === 0) {
      const noPendingMessage = userLang === 'en' 
        ? '📋 **No Pending Communities**\n\nYou have no pending community registrations.'
        : '📋 **ምንም በመጠባበቅ ላይ ያሉ ማህበረሰቦች የሉም**\n\nምንም የማህበረሰብ ምዝገባዎች በመጠባበቅ ላይ አይገኙም።';
      
      await ctx.reply(noPendingMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: userLang === 'en' ? '🏠 Back to Communities' : '🏠 ወደ ማህበረሰቦች ተመለስ', callback_data: 'back_to_communities' }]
          ]
        }
      });
      await ctx.answerCbQuery("✅ No pending communities");
      return;
    }
    
    // Group by payment status
    const pendingCommunities = pendingSubs.filter(sub => sub.paymentStatus === 'pending');
    const expiredCommunities = pendingSubs.filter(sub => sub.paymentStatus === 'expired');
    
    let message = userLang === 'en' 
      ? `📋 **Your Pending Communities**\n\n`
      : `📋 **የእርስዎ በመጠባበቅ ላይ ያሉ ማህበረሰቦች**\n\n`;
    
    // Show pending communities
    if (pendingCommunities.length > 0) {
      message += userLang === 'en' ? '**Pending Payment:**\n' : '**በመጠባበቅ ላይ ያለ ክፍያ:**\n';
      for (let i = 0; i < pendingCommunities.length; i++) {
        const sub: any = pendingCommunities[i];
        const name = sub.communityName || 'Community';
        const amount = (sub.amount ?? 0);
        message += `${i + 1}. ${name} - ${amount} birr\n`;
      }
      message += '\n';
    }
    
    // Show expired communities
    if (expiredCommunities.length > 0) {
      message += userLang === 'en' ? '**Expired (Need Renewal):**\n' : '**የተሽረሸ (እድሳት ያስፈልጋል):**\n';
      for (let i = 0; i < expiredCommunities.length; i++) {
        const sub: any = expiredCommunities[i];
        const name = sub.communityName || 'Community';
        const amount = (sub.amount ?? 0);
        message += `${i + 1}. ${name} - ${amount} birr\n`;
      }
      message += '\n';
    }
    
    // Create keyboard with buttons for each community
    const keyboard: any = { inline_keyboard: [] };
    
    // Add buttons for pending communities
    for (const sub of pendingCommunities) {
      const name = (sub as any).communityName || 'Community';
      keyboard.inline_keyboard.push([
        { 
          text: `${userLang === 'en' ? '💳' : '💳'} ${name} - ${userLang === 'en' ? 'Continue Payment' : 'ክፍያ ቀጥል'}`, 
          callback_data: `continue_payment_${(sub as any).communityId}` 
        }
      ]);
    }
    // Add buttons for expired communities
    for (const sub of expiredCommunities) {
      const name = (sub as any).communityName || 'Community';
      keyboard.inline_keyboard.push([
        { 
          text: `${userLang === 'en' ? '🔄' : '🔄'} ${name} - ${userLang === 'en' ? 'Renew' : 'እድሳት'}`, 
          callback_data: `renew_community_${(sub as any).communityId}` 
        }
      ]);
    }
    
    // Add back button
    keyboard.inline_keyboard.push([
      { text: userLang === 'en' ? '🏠 Back to Communities' : '🏠 ወደ ማህበረሰቦች ተመለስ', callback_data: 'back_to_communities' }
    ]);
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
    await ctx.answerCbQuery("✅ Pending communities displayed");
  } catch (error) {
    console.error("❌ Error fetching pending communities:", error);
    await ctx.reply(userLang === 'en' ? '❌ Failed to fetch pending communities.' : '❌ በመጠባበቅ ላይ ያሉ ማህበረሰቦችን ማግኘት አልተሳካም።');
    await ctx.answerCbQuery("❌ Error occurred");
  }
});

// Add action for browsing all communities
bot.action("browse_all_communities", async (ctx) => {
  const userTelegramId = ctx.from?.id;
  const userLanguage = userTelegramId ? userLanguages.get(userTelegramId) || "en" : "en";
  
  await showCommunities(ctx, userLanguage);
  await ctx.answerCbQuery("✅ Browsing all communities");
});

// Update menu action handlers
bot.action('update_phone', async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const lang: Lang = (userLanguages.get(uid) || 'en');
  const s = enrollSessions.get(uid) || ({ step: 'awaiting_language', language: lang } as EnrollmentSession);
  s.language = (s.language as Lang) || lang;
  s.step = 'awaiting_phone_contact';
  s.profileUpdateMode = true;
  // Prefill from DB to preserve fields
  try {
    const prof = await UserProfile.findOne({ telegramId: String(uid) });
    if (prof) {
      s.phone = s.phone || (prof as any).phoneNumber || '';
      s.fullName = s.fullName || (prof as any).fullName || '';
      s.gender = s.gender || (prof as any).gender || '';
      s.dob = s.dob || (prof as any).dob || '';
      s.residence = s.residence || (prof as any).residence_location || '';
      if (s.email === undefined) s.email = (prof as any).email || '';
      s.telegramUsername = s.telegramUsername || (prof as any).telegramUsername || s.telegramUsername;
      s.termsAccepted = true; s.guidelinesAccepted = true;
    }
  } catch {}
  enrollSessions.set(uid, s);
  await ctx.answerCbQuery(lang === 'en' ? '📱 Update phone' : '📱 ስልክ አዘምን');
  await promptShareContact(ctx, s.language as Lang);
});

bot.action('update_full_name', async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const lang: Lang = (userLanguages.get(uid) || 'en');
  const s = enrollSessions.get(uid) || ({ step: 'awaiting_language', language: lang } as EnrollmentSession);
  s.language = (s.language as Lang) || lang;
  s.step = 'awaiting_full_name';
  s.profileUpdateMode = true;
  try {
    const prof = await UserProfile.findOne({ telegramId: String(uid) });
    if (prof) {
      s.phone = s.phone || (prof as any).phoneNumber || '';
      s.fullName = s.fullName || (prof as any).fullName || '';
      s.gender = s.gender || (prof as any).gender || '';
      s.dob = s.dob || (prof as any).dob || '';
      s.residence = s.residence || (prof as any).residence_location || '';
      if (s.email === undefined) s.email = (prof as any).email || '';
      s.telegramUsername = s.telegramUsername || (prof as any).telegramUsername || s.telegramUsername;
      s.termsAccepted = true; s.guidelinesAccepted = true;
    }
  } catch {}
  enrollSessions.set(uid, s);
  await ctx.answerCbQuery(lang === 'en' ? '✏️ Update name' : '✏️ ስም አዘምን');
  await promptFullName(ctx, s.language as Lang);
});

bot.action('update_gender', async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const lang: Lang = (userLanguages.get(uid) || 'en');
  const s = enrollSessions.get(uid) || ({ step: 'awaiting_language', language: lang } as EnrollmentSession);
  s.language = (s.language as Lang) || lang;
  s.step = 'awaiting_gender';
  s.profileUpdateMode = true;
  try {
    const prof = await UserProfile.findOne({ telegramId: String(uid) });
    if (prof) {
      s.phone = s.phone || (prof as any).phoneNumber || '';
      s.fullName = s.fullName || (prof as any).fullName || '';
      s.gender = s.gender || (prof as any).gender || '';
      s.dob = s.dob || (prof as any).dob || '';
      s.residence = s.residence || (prof as any).residence_location || '';
      if (s.email === undefined) s.email = (prof as any).email || '';
      s.telegramUsername = s.telegramUsername || (prof as any).telegramUsername || s.telegramUsername;
      s.termsAccepted = true; s.guidelinesAccepted = true;
    }
  } catch {}
  enrollSessions.set(uid, s);
  await ctx.answerCbQuery(lang === 'en' ? '⚧ Update gender' : '⚧ ጾታ አዘምን');
  await promptGender(ctx, s.language as Lang);
});

bot.action('update_dob', async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const lang: Lang = (userLanguages.get(uid) || 'en');
  const s = enrollSessions.get(uid) || ({ step: 'awaiting_language', language: lang } as EnrollmentSession);
  s.language = (s.language as Lang) || lang;
  s.step = 'awaiting_dob';
  s.profileUpdateMode = true;
  try {
    const prof = await UserProfile.findOne({ telegramId: String(uid) });
    if (prof) {
      s.phone = s.phone || (prof as any).phoneNumber || '';
      s.fullName = s.fullName || (prof as any).fullName || '';
      s.gender = s.gender || (prof as any).gender || '';
      s.dob = s.dob || (prof as any).dob || '';
      s.residence = s.residence || (prof as any).residence_location || '';
      if (s.email === undefined) s.email = (prof as any).email || '';
      s.telegramUsername = s.telegramUsername || (prof as any).telegramUsername || s.telegramUsername;
      s.termsAccepted = true; s.guidelinesAccepted = true;
    }
  } catch {}
  enrollSessions.set(uid, s);
  await ctx.answerCbQuery(lang === 'en' ? '🎂 Update DOB' : '🎂 የትውልድ ቀን አዘምን');
  await promptDob(ctx, s.language as Lang);
});

bot.action('update_residence', async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const lang: Lang = (userLanguages.get(uid) || 'en');
  const s = enrollSessions.get(uid) || ({ step: 'awaiting_language', language: lang } as EnrollmentSession);
  s.language = (s.language as Lang) || lang;
  s.step = 'awaiting_residence';
  s.profileUpdateMode = true;
  try {
    const prof = await UserProfile.findOne({ telegramId: String(uid) });
    if (prof) {
      s.phone = s.phone || (prof as any).phoneNumber || '';
      s.fullName = s.fullName || (prof as any).fullName || '';
      s.gender = s.gender || (prof as any).gender || '';
      s.dob = s.dob || (prof as any).dob || '';
      s.residence = s.residence || (prof as any).residence_location || '';
      if (s.email === undefined) s.email = (prof as any).email || '';
      s.telegramUsername = s.telegramUsername || (prof as any).telegramUsername || s.telegramUsername;
      s.termsAccepted = true; s.guidelinesAccepted = true;
    }
  } catch {}
  enrollSessions.set(uid, s);
  await ctx.answerCbQuery(lang === 'en' ? '🏙️ Update residence' : '🏙️ አካባቢ አዘምን');
  await promptResidence(ctx, s.language as Lang);
});

bot.action('update_email', async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const lang: Lang = (userLanguages.get(uid) || 'en');
  const s = enrollSessions.get(uid) || ({ step: 'awaiting_language', language: lang } as EnrollmentSession);
  s.language = (s.language as Lang) || lang;
  s.step = 'awaiting_email';
  s.profileUpdateMode = true;
  try {
    const prof = await UserProfile.findOne({ telegramId: String(uid) });
    if (prof) {
      s.phone = s.phone || (prof as any).phoneNumber || '';
      s.fullName = s.fullName || (prof as any).fullName || '';
      s.gender = s.gender || (prof as any).gender || '';
      s.dob = s.dob || (prof as any).dob || '';
      s.residence = s.residence || (prof as any).residence_location || '';
      if (s.email === undefined) s.email = (prof as any).email || '';
      s.telegramUsername = s.telegramUsername || (prof as any).telegramUsername || s.telegramUsername;
      s.termsAccepted = true; s.guidelinesAccepted = true;
    }
  } catch {}
  enrollSessions.set(uid, s);
  await ctx.answerCbQuery(lang === 'en' ? '📧 Update email' : '📧 ኢሜል አዘምን');
  const currentEmail = s.email || '';
  const prompt = (s.language as Lang) === 'en'
    ? `📝 Optional: Update your email.\nCurrent: ${currentEmail || 'N/A'}\n\nSend a new email or type "skip" to continue.`
    : `📝 አማራጭ፡ ኢሜልዎን ያዘምኑ።\nየአሁኑ፡ ${currentEmail || 'አይገኝም'}\n\nአዲስ ኢሜል ይላኩ ወይም "skip" በማለት ይቀጥሉ።`;
  await ctx.reply(prompt);
});

async function promptConfirmPaymentPhone(ctx: any, lang: Lang, phone: string) {
  const msg = lang === 'en'
    ? `📞 Is this your billing phone number?\n\n${phone}`
    : `📞 ክፍያ የሚፈፀምበት ስልክ ቁጥርዎ ይሄ ነው?\n\n${phone}`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: lang === 'en' ? '✅ Yes, use this' : '✅ አዎን፣ ይህን ተጠቀም', callback_data: 'confirm_payment_phone_yes' },
        { text: lang === 'en' ? '✏️ No, change' : '✏️ አይ፣ ለውጥ', callback_data: 'confirm_payment_phone_no' }
      ]
    ]
  } as InlineKeyboardMarkup;
  await ctx.reply(msg, { reply_markup: keyboard });
}

// Intercept pay button to confirm phone before invoice
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

  // Move to phone confirmation step
  s.step = 'awaiting_payment_phone';
  s.paymentMode = 'pay';
  enrollSessions.set(uid, s);
  await ctx.answerCbQuery('');
  await promptConfirmPaymentPhone(ctx, lang, s.phone!);
});

// Confirm/Change phone callbacks
bot.action('confirm_payment_phone_yes', async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const s = enrollSessions.get(uid);
  if (!s) return;
  const lang: Lang = (userLanguages.get(uid) || s.language || 'en');
  if (s.step !== 'awaiting_payment_phone') return;
  
  await ctx.answerCbQuery('✅');
  
  // Proceed to invoice for all payment modes
  s.step = 'ready_for_payment';
  enrollSessions.set(uid, s);
  await generateInvoiceFromSession(ctx, lang, s);
});

bot.action('confirm_payment_phone_no', async (ctx) => {
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const s = enrollSessions.get(uid);
  if (!s) return;
  const lang: Lang = (userLanguages.get(uid) || s.language || 'en');
  
  await ctx.answerCbQuery('✏️');
  
  // Ask for a new phone via reply and wait for text
  s.step = 'awaiting_payment_phone';
  enrollSessions.set(uid, s);
  await ctx.reply(lang === 'en' ? '📱 Please enter the phone number to use for payment.' : '📱 እባክዎ ለክፍያ የሚጠቀሙትን የስልክ ቁጥር ያስገቡ።');
});

// Helper to generate the invoice with session data
async function generateInvoiceFromSession(ctx: any, lang: Lang, s: EnrollmentSession) {
  const uid = Number(s.telegramId);
  const priceInCents = Math.round(Number(s.price || 0) * 100);
  try {
    const names = (s.fullName || '').trim().split(/\s+/);
    const firstName = names[0] || 'User';
    const lastName = names.slice(1).join(' ') || 'Telegram';
    const safeCommunityId = s.communityId || 'no_community';
    const desiredTxRef = s.txRef || `community_${safeCommunityId}_${Date.now()}`;
    const txRef = desiredTxRef;
    s.txRef = txRef;
    enrollSessions.set(uid, s);
    try {
      // Check if user is currently on trial
      const existing = await SubscriptionRequest.findOne({ userId: String(uid), communityId: s.communityId });
      const isOnTrial = existing && String((existing as any).paymentStatus) === 'trial' && String((existing as any).status) === 'active';
      
      if (isOnTrial) {
        // Preserve trial status; only store tx_ref for when payment succeeds
        await SubscriptionRequest.findOneAndUpdate(
          { userId: String(uid), communityId: s.communityId },
          { tx_ref: txRef, amount: s.price, communityName: s.communityName },
          { new: true }
        );
        console.log('💡 User on trial; preserving trial status, stored tx_ref for upgrade:', txRef);
      } else {
        // Not on trial; set to pending as usual
        await SubscriptionRequest.findOneAndUpdate(
          { userId: String(uid), communityId: s.communityId },
          { tx_ref: txRef, paymentStatus: 'pending' as any, status: 'active' as any, amount: s.price, communityName: s.communityName },
          { upsert: true, new: true }
        );
      }
    } catch {}
    const providerData = {
      phone: s.paymentPhone || s.phone,
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
    await ctx.replyWithInvoice({
      title: `${s.communityName}`,
      description: lang === 'en' ? `Pay to join ${s.communityName}` : `${s.communityName} ለመቀላቀል ክፍያ ያድርጉ` ,
      payload: txRef,
      provider_token: process.env.CHAPA_PROVIDER_TOKEN || "<YOUR_CHAPA_PROVIDER_TOKEN>",
      currency: "ETB",
      prices: [{ label: "Community Access", amount: priceInCents }],
      start_parameter: "pay",
      need_phone_number: true,
      send_phone_number_to_provider: true,
      provider_data: JSON.stringify(providerData),
    });
    await ctx.reply(lang === 'en' ? '💳 Payment invoice generated. Please complete your payment.' : '💳 ክፍያ ደረሰኝ ተፈጥሯል። እባክዎን ክፍያውን ያጠናቅቅ።');
  } catch (err) {
    await ctx.reply(lang === 'en' ? '⚠️ Failed to generate invoice. Please try again later.' : '⚠️ ደረሰኝ ማመንጨት አልተቻለም። እባክዎ በኋላ ይሞክሩ።');
  }
}

// Start Free 7-Day Trial handler
bot.action(/^start_trial_(.+)$/, async (ctx) => {
  const communityId = ctx.match![1];
  const uid = ctx.from?.id as number | undefined;
  if (!uid) return;
  const s = enrollSessions.get(uid);
  const lang: Lang = (userLanguages.get(uid) || s?.language || 'en');
  
  await ctx.answerCbQuery('');
  
  try {
    // Ensure session exists and matches community
    if (!s || s.communityId !== communityId) {
      await ctx.reply(lang === 'en' ? 'Session expired. Please select the community again.' : 'ክፍለ ጊዜ አልቆሞታል። እባክዎ ማህበረሰቡን እንደገና ይምረጡ።');
      return;
    }
    
    // Check if profile is complete
    const missing: string[] = [];
    if (!s.phone) missing.push('phone');
    if (!s.fullName) missing.push('full name');
    if (!s.gender) missing.push('gender');
    if (!s.dob) missing.push('dob');
    if (!s.residence) missing.push('residence');
    
    if (missing.length > 0) {
      await ctx.reply(lang === 'en' ? 'Please complete your profile first.' : 'እባክዎ መገለጫዎን በመጀመሪያ ያጠናቅቁ።');
      await continueEnrollment(ctx);
      return;
    }
    
    // Check trial eligibility
    const latest = await SubscriptionRequest.findOne({ userId: String(uid), communityId }).sort({ createdAt: -1 });
    const alreadyPaid = latest && ['paid', 'renewed'].includes(String((latest as any).paymentStatus || ''));
    const trialUsed = latest && Boolean((latest as any).trialUsed);
    const ongoingTrial = latest && String((latest as any).paymentStatus) === 'trial' && String((latest as any).status) === 'active';
    
    if (alreadyPaid) {
      await ctx.reply(lang === 'en' ? '✅ You already have an active membership.' : '✅ አስቀድሞ ንቁ አባልነት አለዎት።');
      return;
    }
    if (ongoingTrial) {
      await ctx.reply(lang === 'en' ? '✅ You already have an active trial for this community.' : '✅ ለዚህ ማህበረሰብ ንቁ ሙከራ አሎት።');
      return;
    }
    if (trialUsed) {
      await ctx.reply(lang === 'en' ? '❌ Free trial already used for this community. Please pay to join.' : '❌ ለዚህ ማህበረሰብ ነፃ ሙከራ ተጠቅመውታል። ለመቀላቀል ክፍያ ያድርጉ።');
      return;
    }
    
    // Start 7-day trial
    const now = new Date();
    const trialExpireAt = new Date(now);
    trialExpireAt.setDate(trialExpireAt.getDate() + 7);
    
    // Generate tx_ref for trial
    const trialTxRef = `trial_${communityId}_${uid}_${Date.now()}`;
    
    const doc = await SubscriptionRequest.findOneAndUpdate(
      { userId: String(uid), communityId },
      {
        userId: String(uid),
        communityId,
        communityName: s.communityName,
        groupId: (s.community && (s.community as any).groupId) || '',
        tx_ref: trialTxRef,
        status: 'active' as any,
        paymentStatus: 'trial' as any,
        joinDate: now,
        trialStartAt: now,
        trialExpireAt,
        trialUsed: true,
        trialNoticeCount: 0,
        amount: s.price,
      },
      { upsert: true, new: true }
    );
    
    console.log('🎁 Trial started for user', uid, 'community', communityId);
    
    // Send welcome + invite
    const welcomeMsg = lang === 'en' 
      ? `👋 **You are now in a 7-day free trial for ${s.communityName}.**\n\nYou have full access for the next 7 days. After that, you'll need to pay to continue.\n\nWe'll send you a reminder on Day 5.`
      : `👋 **ወደ ${s.communityName} 7-ቀን ነፃ ሙከራ ተቀላቀሉ።**\n\nለሚቀጥሉት 7 ቀናት ሙሉ መዳረሻ አሎት። ከዚያ በኋላ ለመቀጠል መክፈል ይኖርብዎታል።\n\nበቀን 5 ላይ ማስታወሻ እንልክዎታለን።`;
    
    await ctx.reply(welcomeMsg, { parse_mode: 'Markdown' });
    
    if ((doc as any).groupId) {
      try {
        await SendGroupInvite(String(uid), String((doc as any).groupId));
        console.log('✅ Trial invite sent to user', uid);
      } catch (inviteErr) {
        console.error('❌ Failed to send trial invite', inviteErr);
        await ctx.reply(lang === 'en' ? '⚠️ Trial activated but invite failed. Contact support.' : '⚠️ ሙከራ ገብተናል ግን ግብዣው አልተሳካም። ድጋፍ ያግኙ።');
      }
    } else {
      await ctx.reply(lang === 'en' ? '⚠️ Trial started but group info missing. Contact support.' : '⚠️ ሙከራ ተጀምሯል ግን የቡድን መረጃ ይጎዳል። ድጋፍ ያግኙ።');
    }
  } catch (err) {
    console.error('❌ start_trial error', err);
    await ctx.reply(lang === 'en' ? '⚠️ Failed to start free trial. Please try again.' : '⚠️ ነፃ ሙከራ መጀመር አልተቻለም። እባክዎ እንደገና ይሞክሩ።');
  }
});

