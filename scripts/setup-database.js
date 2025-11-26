/**
 * Setup database schema for appointment agent
 * Run with: node scripts/setup-database.js
 */

import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  if (line && !line.startsWith('#') && line.includes('=')) {
    const [key, ...valueParts] = line.split('=');
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const DATABASE_URL = envVars.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in .env file');
  process.exit(1);
}

console.log('🔌 Connecting to database...');

const sql = neon(DATABASE_URL);

async function setupDatabase() {
  try {
    console.log('📋 Creating appointments table...');

    await sql`
      CREATE TABLE IF NOT EXISTS appointments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        caller_name VARCHAR(255),
        caller_phone VARCHAR(20) NOT NULL,
        appointment_time TIMESTAMP NOT NULL,
        reason TEXT,
        google_calendar_event_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'confirmed',
        sms_sent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    console.log('✅ Appointments table created');

    console.log('📋 Creating indexes...');

    await sql`CREATE INDEX IF NOT EXISTS idx_appointments_caller_phone ON appointments(caller_phone)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_appointments_time ON appointments(appointment_time)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_appointments_calendar_event ON appointments(google_calendar_event_id)`;

    console.log('✅ Indexes created');

    console.log('📋 Creating call_logs table...');

    await sql`
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
      )
    `;

    console.log('✅ Call logs table created');

    await sql`CREATE INDEX IF NOT EXISTS idx_call_logs_twilio_sid ON call_logs(twilio_call_sid)`;

    console.log('✅ Call logs index created');

    // Verify tables exist
    const tables = await sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename IN ('appointments', 'call_logs')
      ORDER BY tablename
    `;

    console.log('\n📊 Database schema ready:');
    tables.forEach(table => {
      console.log(`  ✓ ${table.tablename}`);
    });

    console.log('\n✅ Database setup complete!');

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    process.exit(1);
  }
}

setupDatabase();
