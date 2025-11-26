/**
 * Test Google Calendar integration
 */

import { createAppointment, getAvailableSlots } from './src/services/google-calendar.js';

async function testCalendar() {
  try {
    console.log('=== Testing Google Calendar Integration ===\n');

    // Test 1: Get available slots for today
    const today = new Date().toISOString().split('T')[0];
    console.log(`1. Getting available slots for ${today}...`);
    const slots = await getAvailableSlots(today);
    console.log(`✅ Found ${slots.length} available slots`);
    if (slots.length > 0) {
      console.log(`   First slot: ${slots[0]}`);
    }
    console.log('');

    // Test 2: Create test appointment
    const testTime = new Date();
    testTime.setHours(testTime.getHours() + 48); // 2 days from now

    console.log(`2. Creating test appointment for ${testTime.toISOString()}...`);
    const appointment = await createAppointment({
      callerName: 'Test User',
      callerPhone: '+15551234567',
      appointmentTime: testTime,
      reason: 'Test appointment',
      durationMinutes: 30
    });

    console.log(`✅ Appointment created successfully!`);
    console.log(`   Calendar Event ID: ${appointment.id}`);
    console.log(`   Event Link: ${appointment.htmlLink}`);
    console.log('');

    console.log('=== All Tests Passed ===');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

testCalendar();
