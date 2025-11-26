/**
 * Check recent appointments and call logs
 */

import { sql } from './src/db/neon.js';

async function checkRecentData() {
  try {
    console.log('=== Recent Appointments (last 24 hours) ===\n');

    const appointments = await sql`
      SELECT
        id,
        caller_name,
        caller_phone,
        appointment_time,
        reason,
        status,
        google_calendar_event_id,
        sms_sent,
        created_at
      FROM appointments
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 10
    `;

    if (appointments.length === 0) {
      console.log('❌ No appointments found in last 24 hours\n');
    } else {
      appointments.forEach((apt, i) => {
        console.log(`${i + 1}. ${apt.caller_name} (${apt.caller_phone})`);
        console.log(`   Time: ${apt.appointment_time}`);
        console.log(`   Reason: ${apt.reason}`);
        console.log(`   Status: ${apt.status}`);
        console.log(`   Calendar Event: ${apt.google_calendar_event_id || 'NONE'}`);
        console.log(`   SMS Sent: ${apt.sms_sent}`);
        console.log(`   Created: ${apt.created_at}`);
        console.log('');
      });
    }

    console.log('=== Recent Call Logs (last 24 hours) ===\n');

    const calls = await sql`
      SELECT
        id,
        twilio_call_sid,
        caller_phone,
        call_started_at,
        call_ended_at,
        duration_seconds,
        appointment_booked,
        appointment_id,
        created_at
      FROM call_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 10
    `;

    if (calls.length === 0) {
      console.log('❌ No call logs found in last 24 hours\n');
    } else {
      calls.forEach((call, i) => {
        console.log(`${i + 1}. ${call.caller_phone}`);
        console.log(`   Call SID: ${call.twilio_call_sid}`);
        console.log(`   Started: ${call.call_started_at}`);
        console.log(`   Ended: ${call.call_ended_at || 'Still active'}`);
        console.log(`   Duration: ${call.duration_seconds}s`);
        console.log(`   Appointment Booked: ${call.appointment_booked}`);
        console.log(`   Appointment ID: ${call.appointment_id || 'NONE'}`);
        console.log('');
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkRecentData();
