# Telegram Bot Community Integration

This document explains how the Telegram bot now handles private community access through deep links.

## Overview

The bot now supports two types of deep links:
1. **Course Enrollment**: `/start userid_courseid` (existing functionality)
2. **Private Community**: `/start userid_slug` (new functionality)

## Deep Link Format

### Private Community Access
```
https://t.me/Mercato_Online_bot?start=USERID_LECTURERSLUG
```

**Example:**
```
https://t.me/Mercato_Online_bot?start=6868ddba5bfe0a77e6e5d56a_Wolfgang-Mozart-cmdg0222500074qjug8ihbz7s
```

**Parameters:**
- `USERID`: The user's ID from localStorage (`rawUserData._id`)
- `LECTURERSLUG`: The lecturer's slug (e.g., `Wolfgang-Mozart-cmdg0222500074qjug8ihbz7s`)

## How It Works

### Method 1: Deep Link (Primary)
1. **User clicks "PRIVATE COMMUNITY"** button on lecturer profile
2. **Deep link is generated** with user ID and lecturer slug
3. **Telegram opens** and should automatically send `/start userid_slug` to the bot
4. **Bot processes the command** and provides community access

### Method 2: Manual Command (Fallback)
If the deep link doesn't work automatically, users can manually type:
```
/community USERID_LECTURERSLUG
```

### Method 3: Smart Detection (Fallback)
The bot can detect when users paste or type the parameters directly and offer to access the community.

## Bot Commands

- `/start` - Welcome message and deep link processing
- `/community USERID_LECTURERSLUG` - Manual community access
- `/id` - Get current chat ID

## Bot Response

When a user accesses a private community, the bot responds with:

- **Welcome message** with community details
- **Interactive buttons** for different features:
  - 🌐 Visit Community (direct link)
  - 💬 Join Discussion (coming soon)
  - 📚 Course Materials (coming soon)
  - 🎯 Contact Mentor (coming soon)

## API Integration

The bot fetches community data from the main backend API instead of maintaining its own database. This ensures data consistency and centralized management.

**API Endpoint:**
```
GET /api/v1/community-management?mentorSlug={lecturerSlug}
```

**Response Format:**
```typescript
interface Community {
  id: string;
  name: string;
  url: string;
  price: number;
  mentor: {
    id: string;
    slug: string;
    name: string;
    email: string;
  };
  mentorId: string;
  mentorSlug: string;
  createdAt: string;
  updatedAt: string;
}
```

## Testing

Run the community test script to verify functionality:

```bash
cd src/bot
npx ts-node communityTest.ts
```

**Note:** The test script will attempt to call the API endpoint. If the backend is not running, the API test will fail, but the deep link parsing tests will still work.

## Frontend Integration

The frontend (LecturerProfile.tsx) generates deep links by:

1. **Extracting user ID** from localStorage (`rawUserData._id`)
2. **Getting lecturer slug** from URL params
3. **Creating deep link** in format: `https://t.me/Mercato_Online_bot?start=USERID_SLUG`

## Security Considerations

- **User validation**: The bot can implement additional user verification
- **Access control**: Communities can implement membership requirements
- **Rate limiting**: Consider implementing rate limiting for deep link access

## Future Enhancements

- **Real-time notifications** when users join communities
- **Payment integration** for premium communities
- **Analytics tracking** for community engagement
- **Automated group management** for community discussions

## Troubleshooting

### Common Issues

1. **"Private community not found"**
   - Check if the community exists in the database
   - Verify the mentor slug matches exactly

2. **"Invalid private community link"**
   - Ensure the deep link format is correct
   - Check that both user ID and slug are present

3. **Bot not responding**
   - Verify the bot token is correct
   - Check MongoDB connection
   - Review bot logs for errors

4. **Deep link doesn't automatically send start command**
   - This is a known Telegram issue
   - Use fallback method: `/community USERID_LECTURERSLUG`
   - Or paste the parameters directly and let the bot detect them

### Deep Link Troubleshooting

If the deep link opens the bot but doesn't automatically send the start command:

1. **Try the manual command:**
   ```
   /community 6868ddba5bfe0a77e6e5d56a_Wolfgang-Mozart-cmdg0222500074qjug8ihbz7s
   ```

2. **Paste the parameters directly:**
   ```
   6868ddba5bfe0a77e6e5d56a_Wolfgang-Mozart-cmdg0222500074qjug8ihbz7s
   ```

3. **Check the bot logs** to see what's being received

### Debug Mode

Enable debug logging by checking the console output:
- User ID and lecturer slug parsing
- Community lookup results
- Button callback handling

## Support

For issues or questions about the community integration, check:
1. Bot logs for error messages
2. MongoDB connection status
3. Community model data integrity
4. Frontend deep link generation 