/**
 * Appointment reminder scheduler
 * Checks for upcoming appointments and sends SMS reminders 24 hours before
 */

import { logger } from '../utils/logger.js';
import { getAppointmentsNeedingReminders, markReminderSent } from '../db/queries.js';
import { sendAppointmentReminder } from './sms.js';

const reminderLogger = logger.child('REMINDER');

/**
 * Check for appointments needing reminders and send them
 */
export async function checkAndSendReminders() {
  try {
    reminderLogger.info('Checking for appointments needing reminders');

    // Get appointments happening in 24 hours that haven't been reminded
    const appointments = await getAppointmentsNeedingReminders();

    if (appointments.length === 0) {
      reminderLogger.info('No appointments need reminders at this time');
      return { sent: 0, total: 0 };
    }

    reminderLogger.info(`Found ${appointments.length} appointments needing reminders`);

    let sent = 0;
    let failed = 0;

    for (const appointment of appointments) {
      try {
        // Send reminder SMS
        await sendAppointmentReminder({
          callerName: appointment.caller_name,
          callerPhone: appointment.caller_phone,
          appointmentTime: appointment.appointment_time,
          reason: appointment.reason,
        });

        // Mark reminder as sent in database
        await markReminderSent(appointment.id);

        sent++;

        reminderLogger.info('Reminder sent successfully', {
          appointmentId: appointment.id,
          callerName: appointment.caller_name,
          appointmentTime: appointment.appointment_time,
        });
      } catch (error) {
        failed++;
        reminderLogger.error('Failed to send reminder', error, {
          appointmentId: appointment.id,
          callerName: appointment.caller_name,
        });
      }
    }

    reminderLogger.info('Reminder batch complete', {
      total: appointments.length,
      sent,
      failed,
    });

    return { sent, failed, total: appointments.length };
  } catch (error) {
    reminderLogger.error('Error checking for reminders', error);
    throw error;
  }
}

/**
 * Start reminder scheduler (runs every hour)
 */
export function startReminderScheduler() {
  reminderLogger.info('Starting appointment reminder scheduler (runs hourly)');

  // Run immediately on startup
  checkAndSendReminders();

  // Then run every hour
  const intervalMs = 60 * 60 * 1000; // 1 hour
  setInterval(checkAndSendReminders, intervalMs);

  reminderLogger.info('Reminder scheduler started', {
    intervalMinutes: 60,
  });
}

export default {
  checkAndSendReminders,
  startReminderScheduler,
};
