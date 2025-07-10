"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerifyPayment = void 0;
const SubscriptionReq_model_1 = require("../Model/SubscriptionReq.model");
const types_1 = require("../services/types");
const SendInvite_1 = require("../bot/SendInvite");
const axios_1 = __importDefault(require("axios"));
const VerifyPayment = async (req, res) => {
    const { tx_ref } = req.params;
    try {
        const sub = await SubscriptionReq_model_1.SubscriptionRequest.findOne({ tx_ref });
        if (!sub) {
            res.status(400).json({ message: "Subscription Not Found" });
            return;
        }
        if (sub.status === "Completed") {
            res.status(200).json({ message: "Already verified" });
            return;
        }
        const chapaRes = await axios_1.default.get(`https://api.chapa.co/v1/transaction/verify/${tx_ref}`, {
            headers: {
                Authorization: `Bearer ${process.env.CHAPA_API_KEY}`,
                "Content-Type": "application/json",
            },
        });
        console.log(chapaRes.data);
        if (!chapaRes) {
            res.json({ message: "failed" });
            return;
        }
        console.log(chapaRes);
        sub.status = types_1.Status.COMPLETED;
        await sub.save();
        await (0, SendInvite_1.SendGroupInvite)(sub.telegramId, sub.groupId);
        res.status(200).json({ success: true, message: "Payment verified" });
        return;
    }
    catch (error) {
        console.error("Failed to send invite:", error);
        res.status(500).send({ success: false, error: "Invite failed" });
    }
};
exports.VerifyPayment = VerifyPayment;
