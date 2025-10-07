import express, { Response } from "express";
import mongoose from "mongoose";
import cors from "cors";
import { ServerConfig } from "./config/ServerConfig";
import userRoute from "./routes/user.routes";
import notificationRoute from "./routes/notification.routes";
import { chapaWebhook } from "./controller/ChapaWebhook";
import { scheduleExpiryJobs } from "./cron/expiryCron";

const app = express();

// CORS configuration
const allowedOrigins = [
  "http://localhost:5173", // frontend local
  "https://admin.tigat.net" ,
  "http://localhost:5174"// replace with your production domain
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  })
);

app.use(express.json({ type: ["application/json", "application/*+json"], limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

app.use("/api/user", userRoute);
app.use("/api/notifications", notificationRoute);
app.post("/api/webhooks/chapa", chapaWebhook);

app.get("/", async (_req, res: Response): Promise<void> => {
  res.send("sup");
});

// Start server
async function StartServer() {
  try {
    await mongoose.connect(ServerConfig.MongoUrl);
    console.log("Mongo Connected and running");

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
