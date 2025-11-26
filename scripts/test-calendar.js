/**
 * Test Google Calendar API connection
 * Run with: node scripts/test-calendar.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { checkAvailability, getAvailableSlots } from '../src/services/google-calendar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  if (line && !line.startsWith('#') && line.includes('=')) {
    const [key, ...valueParts] = line.split('=');
    process.env[key.trim()] = valueParts.join('=').trim().replace(/^"|"$/g, '');
  }
});

async function testCalendar() {
  try {
    console.log('🔌 Testing Google Calendar API connection...\n');

    console.log('📅 Calendar ID:', process.env.GOOGLE_CALENDAR_ID);
    console.log('🔑 Service Account:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    console.log('');

    // Test 1: Check availability for tomorrow at 2 PM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);

    console.log('🔍 Test 1: Checking availability for tomorrow at 2 PM...');
    console.log('   Time:', tomorrow.toLocaleString());

    const isAvailable = await checkAvailability(tomorrow, 30);
    console.log(`   Result: ${isAvailable ? '✅ Available' : '❌ Not available'}\n`);

    // Test 2: Get all available slots for tomorrow
    console.log('🔍 Test 2: Getting available slots for tomorrow...');
    const slots = await getAvailableSlots(tomorrow, 30);

    console.log(`   Found ${slots.length} available 30-minute slots:\n`);
    slots.slice(0, 5).forEach(slot => {
      const startTime = slot.startTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      const endTime = slot.endTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      console.log(`   ✓ ${startTime} - ${endTime}`);
    });

    if (slots.length > 5) {
      console.log(`   ... and ${slots.length - 5} more\n`);
    }

    console.log('\n✅ Google Calendar API is working correctly!');
    console.log('\n💡 Ready to book appointments!');

  } catch (error) {
    console.error('\n❌ Calendar test failed:');
    console.error('Error:', error.message);
    if (error.errors) {
      console.error('Details:', error.errors);
    }
    process.exit(1);
  }
}

testCalendar();
