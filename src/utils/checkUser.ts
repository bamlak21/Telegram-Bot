import { SendGroupInvite } from "../bot/SendInvite";
import { Subscription } from "../Model/Subscription.model";
import axios from "axios";

type Data = {
  userId: string;
  courseId: string;
  userTelegramId: Number;
};

export async function Verify({ userId, courseId, userTelegramId }: Data) {
  console.log(`${userId} and ${courseId} and ${userTelegramId}`);
  const telegramId = String(userTelegramId);

  if (!userId || !courseId) {
    console.log("Course and User Id not found");
    return { success: false, message: "Course and User Id not found" };
  }
  console.log(`User Id: ${userId} and Course Id: ${courseId}`);

  try {
    const res = await axios.get(`${process.env.BaseUrl}/api/user/checkuser`, {
      params: { userId, courseId },
    });

    if (res.status === 400 || res.status === 403) {
      console.log(res.data.message);
      return { success: false, message: res.data.message };
    }

    const existingSub = await Subscription.findOne({
      userId,
      courseId,
      telegramId,
      status: "Completed",
      expireAt: { $gt: new Date() },
    }).lean();

    console.log("Existing Sub: ", existingSub);

    if (existingSub) {
      console.log("user already subbed");
      return {
        success: true,
        exists: true,
        ...existingSub,
      };
    }

    return { success: true, ...res.data };
  } catch (err) {
    console.error("Verify failed:", err);
    return { success: false, message: "Verification failed" };
  }
}
