import express, { Response } from "express";
import mongoose from "mongoose";
import { ServerConfig } from "./config/ServerConfig";
import userRoute from "./routes/user.routes";
import { Course } from "./Model/Course.model";
import { User } from "./Model/User.model";
import { startExpireJob } from "./jobs/ExpiryChecker";
import { Subscription } from "./Model/Subscription.model";
import { Status } from "./services/types";

const app = express();
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

app.use("/api/user", userRoute);

app.get("/", async (_req, res: Response): Promise<void> => {
  res.send("sup");
  return;
});

const mockCourse = {
  groupId: "-1001234567890",
  groupSubPrice: 1,
  courseName: "Telegram Bot Development",
};

const mockUser = {
  firstName: "John",
  lastName: "Doe",
  phoneNumber: "0912345678",
  subscribedGroups: ["-1001234567890", "-1009876543210"],
};

async function createMocks() {
  await new Course(mockCourse).save();
  // await new User(mockUser).save();
}

// createMocks();

async function StartServer() {
  try {
    await mongoose.connect(ServerConfig.MongoUrl);
    console.log("Mongo Connected and running");

    app.listen(ServerConfig.PORT, () => {
      console.log(`Server running on port: ${ServerConfig.PORT}`);
    });
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
}

StartServer();

startExpireJob();

async function mock() {
  const mockSubs = [
    {
      telegramId: "430031826",
      courseId: "686ba434f384c9ca4604e480",
      userId: "686cfb8c65967762ca997a96",
      groupId: "-1002776270741",
      price: 1,
      tx_ref: "fasdfasdw",
      status: Status.COMPLETED,
      expireAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
    },
    // {
    //   userId: "686cfb8c65967762ca997a96",
    //   courseId: "686ba434f384c9ca4604e480",
    //   telegramId: "430031826",
    //   price: 1,
    //   tx_ref: "fasdfasd",
    //   groupId: "-1002776270741",
    //   status: Status.COMPLETED,
    //   expireAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1 day from now
    // },
  ];

  // Insert into your MongoDB "subscriptions" collection
  await Subscription.insertMany(mockSubs);
}

// mock();
