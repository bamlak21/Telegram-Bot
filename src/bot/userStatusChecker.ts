import { SubscriptionRequest } from '../Model/SubscriptionReq.model';
import { UserProfile } from '../Model/UserProfile.model';

export interface UserRegistrationStatus {
  isRegistered: boolean;
  subscription?: any;
  paymentStatus?: 'pending' | 'paid' | 'expired';
  needsRenewal?: boolean;
  userInfo?: {
    fullName: string;
    phoneNumber: string;
    residence_location: string;
    email?: string;
  };
}

/**
 * Check if user is already registered for a specific community
 */
export async function checkUserRegistrationStatus(
  telegramId: string, 
  communityId: string
): Promise<UserRegistrationStatus> {
  try {
    console.log(`🔍 Checking registration status for user ${telegramId}, community ${communityId}`);
    
    // Check SubscriptionRequest for existing registration
    const subRequest = await SubscriptionRequest.findOne({
      userId: telegramId,
      communityId: communityId
    }).sort({ createdAt: -1 });

    if (subRequest) {
      const now = new Date();
      const isExpired = !!(subRequest.expireAt && new Date(subRequest.expireAt) < now);
      
      console.log(`✅ Found existing registration:`, {
        status: subRequest.status,
        paymentStatus: subRequest.paymentStatus,
        isExpired,
        expireAt: subRequest.expireAt
      });
      
      let paymentStatus: 'pending' | 'paid' | 'expired' = 'pending';
      
      if (isExpired) {
        paymentStatus = 'expired';
      } else if (subRequest.paymentStatus === 'paid' && subRequest.status === 'active') {
        paymentStatus = 'paid';
      } else {
        paymentStatus = 'pending';
      }

      // Load user profile details separately
      const prof = await UserProfile.findOne({ telegramId });
      const userInfo = {
        fullName: (prof as any)?.fullName || '',
        phoneNumber: (prof as any)?.phoneNumber || '',
        residence_location: (prof as any)?.residence_location || '',
        email: (prof as any)?.email || ''
      };
      
      return {
        isRegistered: true,
        subscription: subRequest,
        paymentStatus,
        needsRenewal: isExpired,
        userInfo
      };
    }

    console.log(`ℹ️ No existing registration found for user ${telegramId}, community ${communityId}`);
    return { isRegistered: false };
    
  } catch (error) {
    console.error('❌ Error checking user registration:', error);
    return { isRegistered: false };
  }
}