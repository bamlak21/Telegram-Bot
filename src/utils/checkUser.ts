import axios from "axios";

type Data = {
  userId: string;
  courseId: string;
};

export async function Verify({
  userId = "686ba434f384c9ca4604e481",
  courseId = "686ba434f384c9ca4604e480",
}: Data) {
  console.log(`${userId} and ${courseId}`);

  if (!userId || !courseId) {
    console.log("Course and User Id not found");
    return { success: false, message: "Course and User Id not found" };
  }
  console.log(`User Id: ${userId} and Course Id: ${courseId}`);

  try {
    const res = await axios.get(`${process.env.NGROK}/api/user/checkuser`, {
      params: { userId, courseId },
    });

    if (res.status === 400 || res.status === 403) {
      console.log(res.data.message);
      return { success: false, message: res.data.message };
    }

    console.log(res);

    return { success: true, ...res.data };
  } catch (err) {
    console.error("Verify failed:", err);
    return { success: false, message: "Verification failed" };
  }
}
