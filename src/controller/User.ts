import { Request, Response, RequestHandler } from 'express';
import { SubscriptionRequest } from '../Model/SubscriptionReq.model';
import { UserProfile } from '../Model/UserProfile.model';

export const getUsersByCommunity: RequestHandler = async (req, res) => {
  try {
    const { communityId } = req.params as { communityId?: string };
    if (!communityId) {
      res.status(400).json({ message: 'communityId is required' });
      return;
    }

    // Find all requests for the community (latest first)
    const requests = await SubscriptionRequest.find({ communityId }).sort({ createdAt: -1 }).lean();
    if (!requests || requests.length === 0) {
      res.json({ communityId, stats: { total: 0, paid: 0, pending: 0, male: 0, female: 0 }, users: [] });
      return;
    }

    // Build map of userId -> paymentStatus from requests (take latest status per user)
    const userIdToStatus = new Map<string, string>();
    for (const r of requests) {
      const uid = String((r as any).userId || '');
      if (!uid) continue;
      if (!userIdToStatus.has(uid)) {
        userIdToStatus.set(uid, String((r as any).paymentStatus || 'pending'));
      }
    }

    const userIds = Array.from(userIdToStatus.keys());
    const profiles = await UserProfile.find({ telegramId: { $in: userIds } }).lean();

    const telegramIdToProfile = new Map<string, any>();
    for (const p of profiles) {
      telegramIdToProfile.set(String((p as any).telegramId), p);
    }

    const users = userIds.map((uid) => {
      const prof = telegramIdToProfile.get(uid) || {};
      return {
        telegramId: uid,
        fullName: (prof as any)?.fullName || '',
        telegramUsername: (prof as any)?.telegramUsername || '',
        phoneNumber: (prof as any)?.phoneNumber || '',
        gender: (prof as any)?.gender || '',
        paymentStatus: userIdToStatus.get(uid) || 'pending',
      };
    });

    // Compute stats
    const total = users.length;
    const paid = users.filter(u => {
      const s = String(u.paymentStatus || '').toLowerCase();
      return s === 'paid' || s === 'renewed';
    }).length;
    const pending = users.filter(u => String(u.paymentStatus || '').toLowerCase() === 'pending').length;
    const trial = users.filter(u => String(u.paymentStatus || '').toLowerCase() === 'trial').length;
    const male = users.filter(u => String(u.gender || '').toLowerCase() === 'male').length;
    const female = users.filter(u => String(u.gender || '').toLowerCase() === 'female').length;

    res.json({ communityId, stats: { total, paid, pending, trial, male, female }, users });
  } catch (err) {
    console.error('getUsersByCommunity error', err);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
};
