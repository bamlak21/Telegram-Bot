import { Subscription } from "../Model/Subscription.model";

export const hasUserPaid = async (telegramId: number, groupId: number) => {
  const userId = String(telegramId);
  const groupIdString = String(groupId);

  const payment = await Subscription.findOne({ telegramId, groupId });

  return !!payment;
};
