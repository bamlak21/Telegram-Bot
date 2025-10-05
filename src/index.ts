import express, { Response } from "express";
import mongoose from "mongoose";
import { ServerConfig } from "./config/ServerConfig";
import userRoute from "./routes/user.routes";
import notificationRoute from "./routes/notification.routes";
import { Course } from "./Model/Course.model";
import { User } from "./Model/User.model";
import { chapaWebhook } from "./controller/ChapaWebhook";
import { scheduleExpiryJobs } from './cron/expiryCron';

const app = express();
app.use(express.json({ type: ["application/json", "application/*+json"], limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

app.use("/api/user", userRoute);
app.use("/api/notifications", notificationRoute);
app.post("/api/webhooks/chapa", chapaWebhook);

app.get("/", async (_req, res: Response): Promise<void> => {
  res.send("sup");
  return;
});



//createMocks();

async function StartServer() {
  try {
    await mongoose.connect(ServerConfig.MongoUrl);
    console.log("Mongo Connected and running");

    // Start cron jobs
    scheduleExpiryJobs();

    app.listen(ServerConfig.PORT, () => {
      console.log(`Server running on port: ${ServerConfig.PORT}`);
    });
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
}

StartServer();
