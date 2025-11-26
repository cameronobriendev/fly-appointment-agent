-- ====================================================================
-- Database Schema for Standalone Appointment Booking Agent
-- For Neon Postgres or Vercel Postgres
-- ====================================================================

-- Create appointments table
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_name VARCHAR(255),
  caller_phone VARCHAR(20) NOT NULL,
  appointment_time TIMESTAMP NOT NULL,
  reason TEXT,
  google_calendar_event_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'confirmed',
  sms_sent BOOLEAN DEFAULT FALSE,
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast phone number lookup (rescheduling, cancellations)
CREATE INDEX IF NOT EXISTS idx_appointments_caller_phone ON appointments(caller_phone);

-- Index for upcoming appointments (efficient queries)
CREATE INDEX IF NOT EXISTS idx_appointments_time ON appointments(appointment_time);

-- Index for calendar event lookup
CREATE INDEX IF NOT EXISTS idx_appointments_calendar_event ON appointments(google_calendar_event_id);

-- Optional: Call logs table (simple logging without multi-tenant complexity)
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_call_sid VARCHAR(255) UNIQUE,
  caller_phone VARCHAR(20),
  call_started_at TIMESTAMP,
  call_ended_at TIMESTAMP,
  duration_seconds INTEGER DEFAULT 0,
  transcript TEXT,
  appointment_booked BOOLEAN DEFAULT FALSE,
  appointment_id UUID REFERENCES appointments(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for call log lookup by Twilio SID
CREATE INDEX IF NOT EXISTS idx_call_logs_twilio_sid ON call_logs(twilio_call_sid);

-- ====================================================================
-- Example data (for testing)
-- ====================================================================

-- Uncomment to insert test appointment:
/*
INSERT INTO appointments (
  caller_name,
  caller_phone,
  appointment_time,
  reason,
  status
) VALUES (
  'John Doe',
  '+15551234567',
  '2025-12-01 14:00:00',
  'Dental cleaning',
  'confirmed'
);
*/

-- ====================================================================
-- Verify schema
-- ====================================================================

-- View all tables:
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- View appointments:
-- SELECT * FROM appointments ORDER BY appointment_time DESC LIMIT 10;

-- View call logs:
-- SELECT * FROM call_logs ORDER BY created_at DESC LIMIT 10;
