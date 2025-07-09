import { Request, Response } from "express";
import { Course } from "../Model/Course.model";
import { User } from "../Model/User.model";

export const CourseData = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { userId, courseId } = req.query;

  if (!userId || !courseId) {
    res.status(400).json({ message: "Required Fields missing!" });
    return;
  }

  try {
    const user = await User.findOne({ _id: userId });
    const course = await Course.findOne({ _id: courseId });
    if (!user || !course) {
      res.status(400).json({ message: "User or course not Found." });
      return;
    }
    const responseData = {
      userId: user?._id,
      firstName: user?.firstName,
      lastName: user?.lastName,
      phoneNumber: user?.phoneNumber,
      courseId: course?._id,
      groupId: course?.groupId,
      groupSubPrice: course?.groupSubPrice,
    };
    res.status(200).json({ message: "User and course Found", ...responseData });
    return;
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
    return;
  }
};
