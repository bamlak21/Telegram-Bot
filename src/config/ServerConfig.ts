import dotenv from "dotenv";
dotenv.config();

type server = {
  PORT: string;
  MongoUrl: string;
  BOT_TOKEN: string;
};

export const ServerConfig: server = {
  PORT: process.env.PORT || "4000",
  MongoUrl: process.env.MongoUrl || "mongodb://localhost:27018/teleBot",
  BOT_TOKEN: process.env.BOT_TOKEN || "BotToken",
};
