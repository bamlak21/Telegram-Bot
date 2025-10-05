import { Router, Request, Response } from "express";
import { sendNewCommunityNotification, sendTargetedNotification } from "../controller/CommunityNotification";

const router = Router();

router.post("/community/new", async (req: Request, res: Response) => {
  const result = await sendNewCommunityNotification(req.body);
  res.json(result);
});

router.post("/targeted", async (req: Request, res: Response) => {
  const result = await sendTargetedNotification(req.body.targetUsers, req.body.message, req.body.keyboard);
  res.json(result);
});

export default router;
