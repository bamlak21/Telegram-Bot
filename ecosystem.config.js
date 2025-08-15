module.exports = {
  apps: [
    {
      name: "telegram-bot",
      script: "./dist/bot/bot.js", // relative path from project root
      watch: false,
    },
    {
      name: "express-server",
      script: "./dist/index.js", // relative path from project root
      watch: false,
    },
  ],
};

