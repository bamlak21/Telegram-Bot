# 🚀 Telegram Bot Subscription System

A Telegram bot built using **Node.js, Telegraf, and MongoDB** that manages **premium Telegram group subscriptions**.

This bot:  
✅ Tracks user subscriptions  
✅ Sends expiry reminders (1–2 days before)  
✅ Kicks users with expired access  
✅ Supports subscription renewal via inline buttons  
✅ Handles payments using **Chapa API**  
✅ Automatically invites paid users to the premium group

---

## 📂 Features

- **Subscription Management**: Track users, expiry dates, and renewals.
- **Automated Reminders**: Sends alerts when access is about to expire.
- **Auto Removal**: Kicks users from groups once their subscription expires.
- **Payment Integration**: Accepts payments via **Chapa** and auto-extends subscriptions.
- **One-Click Renewal**: Users can renew with an inline "Renew Now" button.
- **Secure Group Access**: Invites are only sent after successful payment.
- **Admin Tools**: Fetch group ID using `/id` command.

---

## 🛠️ Tech Stack

- **Node.js** (Runtime)
- **Telegraf** (Telegram Bot framework)
- **MongoDB + Mongoose** (Database)
- **Chapa API** (Payment gateway for ETB)
- **Chapa telegram bot for payment**
- **TypeScript** (Optional if you're using `.ts` files)

---

## ⚙️ Installation & Setup

### 1️⃣ Clone the project

```bash
git clone https://github.com/bamlak21/Telegram-Bot.git
cd Telegram-Bot
```

### 2️⃣ Install dependencies

```bash
npm install
```

### 3️⃣ Create a \`.env\` file

Inside your project root, create a \`.env\` file and add:

```
BOT_TOKEN=your_telegram_bot_token
MONGO_URL=your_mongodb_connection_string
CHAPA_PROVIDER_TOKEN=your_chapa_api_key
```

### 4️⃣ Start MongoDB (if running locally)

Make sure you have MongoDB installed and running:

```bash
mongod
```

Or use MongoDB Atlas (cloud-hosted).

---

### 5️⃣ Run the bot

For development:

```bash
npm run dev
```

For production (using \`pm2\`):

```bash
pm2 start dist/bot.js --name subscription-bot
```

---

## 🚀 Usage Guide

### Starting the bot

- Open Telegram and search for your bot (e.g., \`@YourBotUsername\`).
- Click **Start** or use a special link:
  ```
  https://t.me/YourBotUsername?start=<userId>\_<courseId>
  ```
  This link verifies the user and shows them the subscription invoice.

---

### Renewal Flow

1. The bot checks daily for expiring subscriptions.
2. Sends reminders if 1–2 days are left:
   > "⏰ Your access expires in 2 days. Renew now!"
3. User clicks "Renew Now" → bot sends payment invoice.
4. After payment, subscription extends automatically.

---

### Admin Commands

- \`/id\` → Shows the group's Telegram ID.
- \`/start\` → Verifies user and sends invoice if needed.

---

## 📂 Project Structure

```
telegram-bot/
│── bot/ # Bot logic (handlers, callbacks)
│ ├── botInstance.ts # Telegraf bot instance
│ ├── photo.ts # Send invoice & group photo logic
│ ├── SendInvite.ts # Invite user to group after payment
│── Model/ # MongoDB models (Subscription, Course)
│── utils/ # Helper utilities (Verify, HasPaid)
│── config/ # Server config (Mongo URL, tokens)
│── cron/ # Expiry checker job
│── .env # Environment variables
│── package.json
│── README.md
```

---

## 🔑 Environment Variables

| Variable               | Description                            |
| ---------------------- | -------------------------------------- |
| `BOT_TOKEN`            | Telegram bot token from @BotFather     |
| `MONGO_URL`            | MongoDB connection string              |
| `CHAPA_PROVIDER_TOKEN` | API key from [Chapa](https://chapa.co) |
| `PORT`                 | Port number for running the bot/server |

---

## 🔮 Future Improvements

- Admin dashboard for subscription stats.
- Multi-currency payment support.
- Retry logic for failed payment verifications.
- Webhook mode for instant updates (instead of polling).

---

## 📝 License

This project is licensed under the **MIT License**.
