"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InitializePayment = InitializePayment;
const axios_1 = __importDefault(require("axios"));
async function InitializePayment({ amount, firstName, lastName, phoneNumber, tx_ref, }) {
    const chapa_url = `https://api.chapa.co/v1/transaction/initialize`;
    try {
        const chapaReq = {
            firstName: firstName,
            lastName: lastName,
            amount: amount,
            currency: "ETB",
            phone_number: phoneNumber,
            tx_ref: tx_ref,
            callback_url: process.env.CHAPA_CALLBACK_URL ||
                "http://localhost:5173/payment/success",
            return_url: process.env.CHAPA_RETURN_URL || "http://localhost:5173/payment/success",
            // meta: false,
        };
        const opt = {
            url: chapa_url,
            headers: {
                Authorization: `Bearer ${process.env.CHAPA_API_KEY}`,
                "Content-Type": "application/json",
            },
        };
        const chapaRes = axios_1.default.post(chapa_url, chapaReq, {
            headers: opt.headers,
        });
        console.log(chapaReq);
        console.log(chapaRes);
        const checkoutUrl = (await chapaRes).data.data.checkout_url;
        console.log(checkoutUrl);
        return {
            url: (await chapaRes).data.data.checkout_url,
            status: (await chapaRes).data.status,
        };
    }
    catch (error) {
        console.log(error);
    }
}
