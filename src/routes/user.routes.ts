import { Router } from "express";
import { CourseData } from "../controller/courseMockData";
import { PayInit } from "../controller/Payment";
import { VerifyPayment } from "../controller/VerifyPayment";
import { getUsersByCommunity } from '../controller/User';

const router = Router();

router.get("/checkuser", CourseData);
router.get("/payinit", PayInit);
router.get("/verify/:tx_ref", VerifyPayment);
router.get('/community/:communityId/users', getUsersByCommunity);

export default router;
