/**
 * Test database queries
 */
import { createAppointment, getAppointmentsByPhone, updateAppointmentStatus } from '../src/db/queries.js';
import * as fs from 'fs';

// Load env
const envContent = fs.readFileSync('.env', 'utf-8');
envContent.split('\n').forEach(line => {
  if (line && !line.startsWith('#') && line.includes('=')) {
    const [key, ...valueParts] = line.split('=');
    process.env[key.trim()] = valueParts.join('=').trim().replace(/^"|"$/g, '');
  }
});

async function testQueries() {
  try {
    console.log('🧪 Testing database queries...\n');

    // Test 1: Create appointment
    console.log('📝 Test 1: Creating test appointment...');
    const testAppt = await createAppointment({
      callerName: 'Test User',
      callerPhone: '+15551234567',
      appointmentTime: new Date('2025-12-01 14:00:00'),
      reason: 'Dental cleaning',
      googleCalendarEventId: 'test-event-123',
      status: 'confirmed',
    });
    console.log('   ✅ Appointment created:', testAppt.id, '\n');

    // Test 2: Fetch appointments
    console.log('📝 Test 2: Fetching appointments by phone...');
    const appointments = await getAppointmentsByPhone('+15551234567');
    console.log(`   ✅ Found ${appointments.length} appointment(s)\n`);

    // Test 3: Update status
    console.log('📝 Test 3: Updating appointment status...');
    const updated = await updateAppointmentStatus(testAppt.id, 'completed');
    console.log('   ✅ Status updated to:', updated.status, '\n');

    console.log('✅ All database queries working!\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testQueries();
