"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayInit = void 0;
const chapaIntialization_1 = require("../utils/chapaIntialization");
const crypto_1 = require("crypto");
const User_model_1 = require("../Model/User.model");
const SubscriptionReq_model_1 = require("../Model/SubscriptionReq.model");
const PayInit = async (req, res) => {
    const { groupId, courseId, userId, telegramId, amount } = req.query;
    if (!groupId || !courseId || !userId || !telegramId || !amount) {
        res.status(400).json({ message: "Missing Required Fields" });
        return;
    }
    try {
        const tx_ref = "TX-" + (0, crypto_1.randomUUID)();
        const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const user = await User_model_1.User.findOne({ _id: userId });
        if (!user) {
            res.status(400).json({ message: "User not found" });
            return;
        }
        const payment = await (0, chapaIntialization_1.InitializePayment)({
            amount: String(amount),
            firstName: user?.firstName,
            lastName: user?.lastName,
            phoneNumber: user?.phoneNumber,
            tx_ref: tx_ref,
        });
        if (!payment?.url) {
            res.status(500).json({ message: "Failed to init payment" });
            return;
        }
        const subReq = await SubscriptionReq_model_1.SubscriptionRequest.create({
            userId,
            telegramId,
            courseId,
            groupId,
            tx_ref,
            expireAt,
        });
        await subReq.save();
        res.send(`
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="refresh" content="2;url=${payment.url}" />
      <title>Redirecting to Payment</title>
      <style>
        body {
          font-family: 'Segoe UI', Arial, sans-serif;
          background: #f7f9fa;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
        }
        .container {
          background: #fff;
          padding: 2rem 1.5rem;
          border-radius: 16px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.07);
          max-width: 350px;
          width: 90vw;
          text-align: center;
        }
        .spinner {
          margin: 1.5rem auto;
          width: 48px;
          height: 48px;
          border: 5px solid #e3e3e3;
          border-top: 5px solid #007bff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        a {
          color: #007bff;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        @media (max-width: 500px) {
          .container {
            padding: 1.2rem 0.5rem;
            font-size: 1rem;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="spinner"></div>
        <h2>Processing...</h2>
        <p>You are being redirected to the payment page.</p>
        <p>If you are not redirected, <a href="${payment.url}">click here</a>.</p>
      </div>
    </body>
  </html>
`);
        return;
    }
    catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server Error" });
        return;
    }
};
exports.PayInit = PayInit;
