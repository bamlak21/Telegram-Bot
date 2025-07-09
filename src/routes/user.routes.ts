import { Router } from "express";
import { CourseData } from "../controller/courseMockData";
import { PayInit } from "../controller/Payment";
import { VerifyPayment } from "../controller/VerifyPayment";

const router = Router();

router.get("/checkuser", CourseData);
router.get("/payinit", PayInit);
router.get("/verify/:tx_ref", VerifyPayment);

export default router;
