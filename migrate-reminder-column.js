/**
 * One-time migration script to add reminder_sent column
 * Run: DATABASE_URL=... node migrate-reminder-column.js
 */

import { sql } from './src/db/neon.js';

async function migrate() {
  try {
    console.log('Adding reminder_sent column to appointments table...');

    await sql`
      ALTER TABLE appointments
      ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE
    `;

    console.log('✓ Migration complete! reminder_sent column added.');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();
