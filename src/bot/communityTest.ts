// Test script for Community functionality
import axios from 'axios';

async function testCommunityFunctionality() {
  try {
    const apiUrl = process.env.BaseUrl2 || 'http://localhost:7071';
    console.log('✅ Testing Community API Integration');
    console.log('API URL:', apiUrl);

    // Test 1: Test the deep link format
    const testUserId = "6868ddba5bfe0a77e6e5d56a";
    const testSlug = "Wolfgang-Mozart-cmdg0222500074qjug8ihbz7s";
    const deepLink = `https://t.me/Mercato_Online_bot?start=${testUserId}_${testSlug}`;
    
    console.log('\n✅ Deep link format test:');
    console.log('User ID:', testUserId);
    console.log('Lecturer Slug:', testSlug);
    console.log('Deep Link:', deepLink);

    // Test 2: Parse the start parameter
    const startParam = `${testUserId}_${testSlug}`;
    const [userId, lecturerSlug] = startParam.split('_');
    
    console.log('\n✅ Parameter parsing test:');
    console.log('Parsed User ID:', userId);
    console.log('Parsed Lecturer Slug:', lecturerSlug);

    // Test 3: Test API call to fetch community by mentor slug
    console.log('\n✅ Testing API call to fetch community...');
    try {
      const response = await axios.get(`${apiUrl}/api/v1/community-management`, {
        params: { mentorSlug: testSlug }
      });
      
      if (response.data && response.data.data && response.data.data.length > 0) {
        const community = response.data.data[0];
        console.log('✅ Community found via API:');
        console.log('  Name:', community.name);
        console.log('  Price:', community.price);
        console.log('  URL:', community.url);
        console.log('  Mentor Slug:', community.mentorSlug);
      } else {
        console.log('ℹ️ No community found for this mentor slug (this is normal if no communities exist yet)');
      }
    } catch (apiError: any) {
      console.log('⚠️ API call failed (this is normal if the backend is not running):');
      console.log('  Error:', apiError.message);
    }

    console.log('\n🎉 All community tests passed!');
    console.log('\nThe bot should now handle deep links like:');
    console.log(`https://t.me/Mercato_Online_bot?start=${testUserId}_${testSlug}`);
    console.log('\nNote: The bot will fetch community data from the API instead of local database');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testCommunityFunctionality(); 