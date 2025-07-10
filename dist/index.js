"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const ServerConfig_1 = require("./config/ServerConfig");
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const app = (0, express_1.default)();
app.use(express_1.default.static("public"));
app.use("/uploads", express_1.default.static("uploads"));
app.use("/api/user", user_routes_1.default);
app.get("/", async (_req, res) => {
    res.send("sup");
    return;
});
async function StartServer() {
    try {
        await mongoose_1.default.connect(ServerConfig_1.ServerConfig.MongoUrl);
        console.log("Mongo Connected and running");
        app.listen(ServerConfig_1.ServerConfig.PORT, () => {
            console.log(`Server running on port: ${ServerConfig_1.ServerConfig.PORT}`);
        });
    }
    catch (error) {
        console.log(error);
        process.exit(1);
    }
}
StartServer();
