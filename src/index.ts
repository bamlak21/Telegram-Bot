import express, { Response } from "express";
import mongoose from "mongoose";
import { ServerConfig } from "./config/ServerConfig";
import userRoute from "./routes/user.routes";
import { Course } from "./Model/Course.model";
import { User } from "./Model/User.model";

const app = express();
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

app.use("/api/user", userRoute);

app.get("/", async (_req, res: Response): Promise<void> => {
  res.send("sup");
  return;
});

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
