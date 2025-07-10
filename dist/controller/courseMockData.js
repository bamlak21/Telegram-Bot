"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseData = void 0;
const Course_model_1 = require("../Model/Course.model");
const User_model_1 = require("../Model/User.model");
const CourseData = async (req, res) => {
    const { userId, courseId } = req.query;
    if (!userId || !courseId) {
        res.status(400).json({ message: "Required Fields missing!" });
        return;
    }
    try {
        const user = await User_model_1.User.findOne({ _id: userId });
        const course = await Course_model_1.Course.findOne({ _id: courseId });
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
    }
    catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server Error" });
        return;
    }
};
exports.CourseData = CourseData;
