const axios = require('axios');
require('dotenv').config();

async function testBotConnection() {
  const botToken = process.env.BOT_TOKEN;
  
  if (!botToken) {
    console.log('❌ BOT_TOKEN not found in .env file');
    return;
  }
  
  console.log('🔑 Bot token found:', botToken.substring(0, 10) + '...');
  
  try {
    console.log('🌐 Testing connection to Telegram API...');
    
    // Test basic connectivity
    const response = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, {
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (response.data.ok) {
      console.log('✅ Bot connection successful!');
      console.log('🤖 Bot info:', response.data.result);
    } else {
      console.log('❌ Bot API error:', response.data);
    }
    
  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    
    if (error.code === 'ETIMEDOUT') {
      console.log('💡 This is a network timeout. Try:');
      console.log('   - Check your internet connection');
      console.log('   - Try a different network');
      console.log('   - Check firewall/proxy settings');
    } else if (error.code === 'ENOTFOUND') {
      console.log('💡 DNS resolution failed. Try:');
      console.log('   - Check your DNS settings');
      console.log('   - Try using Google DNS (8.8.8.8)');
    } else if (error.response) {
      console.log('💡 HTTP error:', error.response.status, error.response.statusText);
      if (error.response.status === 401) {
        console.log('   - Invalid bot token');
      }
    }
  }
}

// Test alternative endpoints
async function testAlternativeEndpoints() {
  const botToken = process.env.BOT_TOKEN;
  
  console.log('\n🌐 Testing alternative endpoints...');
  
  const endpoints = [
    'https://api.telegram.org',
    'https://core.telegram.org',
    'https://telegram.org'
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`Testing ${endpoint}...`);
      const response = await axios.get(endpoint, { timeout: 5000 });
      console.log(`✅ ${endpoint} - Status: ${response.status}`);
    } catch (error) {
      console.log(`❌ ${endpoint} - ${error.message}`);
    }
  }
}

// Run tests
async function runTests() {
  console.log('🧪 Testing Telegram Bot Connectivity\n');
  
  await testBotConnection();
  await testAlternativeEndpoints();
  
  console.log('\n🏁 Tests completed!');
}

runTests().catch(console.error); 