"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerConfig = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.ServerConfig = {
    PORT: process.env.PORT || "4000",
    MongoUrl: process.env.MongoUrl || "mongodb://localhost:27018/teleBot",
    BOT_TOKEN: process.env.BOT_TOKEN || "BotToken",
};
