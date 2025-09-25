import axios from "axios";
import { randomUUID } from "crypto";

type params = {
  amount: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  tx_ref: string;
};

export async function InitializePayment({
  amount,
  firstName,
  lastName,
  phoneNumber,
  tx_ref,
}: params) {
  const chapa_url = `https://api.chapa.co/v1/transaction/initialize`;
  try {
    const chapaReq: any = {
      firstName: firstName,
      lastName: lastName,
      amount: amount,
      currency: "ETB",
      phone_number: phoneNumber,
      tx_ref: tx_ref,
      callback_url:
        process.env.CHAPA_CALLBACK_URL ||
        "http://localhost:5173/payment/success",
      return_url:
        process.env.CHAPA_RETURN_URL || "http://localhost:5173/payment/success",
      channel: "telegram",
    };

    const opt = {
      url: chapa_url,
      headers: {
        Authorization: `Bearer ${process.env.CHAPA_API_KEY || process.env.CHAPA_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    };
    const chapaRes = await axios.post(chapa_url, chapaReq, {
      headers: opt.headers,
    });

    console.log(chapaReq);
    console.log(chapaRes.data);

    const data = chapaRes.data?.data || {};
    const checkoutUrl: string = data.checkout_url;
    const paymentToken: string = data.payment_token;
    const echoedTxRef: string = data.tx_ref || tx_ref;
    console.log(checkoutUrl, paymentToken);

    return {
      url: checkoutUrl,
      payment_token: paymentToken,
      status: chapaRes.data.status,
      tx_ref: echoedTxRef,
    };
  } catch (error) {
    console.log(error);
    return undefined;
  }
}
