/**
 * Google Calendar API service
 * Handles appointment booking, availability checking, and calendar management
 */

import { google } from 'googleapis';
import { logger } from '../utils/logger.js';

const calendarLogger = logger.child('CALENDAR');

// Initialize Google Calendar API client
let calendar = null;

/**
 * Initialize calendar client with service account credentials
 */
function initializeCalendar() {
  if (calendar) return calendar;

  try {
    // Decode base64-encoded service account key
    const serviceAccountKey = Buffer.from(
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
      'base64'
    ).toString('utf-8');

    const credentials = JSON.parse(serviceAccountKey);

    // Create JWT auth client
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    // Initialize calendar API
    calendar = google.calendar({ version: 'v3', auth });

    calendarLogger.info('Google Calendar API initialized', {
      serviceAccount: credentials.client_email,
      calendarId: process.env.GOOGLE_CALENDAR_ID,
    });

    return calendar;
  } catch (error) {
    calendarLogger.error('Failed to initialize calendar', error);
    throw new Error('Calendar initialization failed');
  }
}

/**
 * Check if a time slot is available
 * @param {Date} startTime - Start time to check
 * @param {number} durationMinutes - Duration in minutes (default 30)
 * @returns {Promise<boolean>} True if available, false if conflict
 */
export async function checkAvailability(startTime, durationMinutes = 30) {
  const cal = initializeCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  try {
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    calendarLogger.info('Checking availability', {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    });

    // Query calendar for events in the time range
    const response = await cal.events.list({
      calendarId,
      timeMin: startTime.toISOString(),
      timeMax: endTime.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];

    if (events.length > 0) {
      calendarLogger.info('Time slot unavailable (conflict found)', {
        conflictingEvents: events.length,
      });
      return false;
    }

    calendarLogger.info('Time slot available');
    return true;
  } catch (error) {
    calendarLogger.error('Error checking availability', error);
    throw error;
  }
}

/**
 * Create an appointment in Google Calendar
 * @param {Object} appointmentData - Appointment details
 * @returns {Promise<Object>} Created calendar event
 */
export async function createAppointment(appointmentData) {
  const cal = initializeCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  const {
    callerName,
    callerPhone,
    appointmentTime,
    reason = 'Dental appointment',
    durationMinutes = 30,
  } = appointmentData;

  try {
    const startTime = new Date(appointmentTime);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    calendarLogger.info('Creating appointment', {
      name: callerName,
      phone: callerPhone,
      startTime: startTime.toISOString(),
    });

    // Create calendar event
    const event = {
      summary: `${reason} - ${callerName}`,
      description: `Patient: ${callerName}\nPhone: ${callerPhone}\nReason: ${reason}`,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: process.env.BUSINESS_TIMEZONE || 'America/Los_Angeles',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: process.env.BUSINESS_TIMEZONE || 'America/Los_Angeles',
      },
      attendees: [
        {
          email: callerPhone + '@sms.example.com', // Placeholder
          displayName: callerName,
        },
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'sms', minutes: 24 * 60 }, // 24 hours before
          { method: 'popup', minutes: 60 }, // 1 hour before
        ],
      },
    };

    const response = await cal.events.insert({
      calendarId,
      requestBody: event,
    });

    const createdEvent = response.data;

    calendarLogger.info('Appointment created successfully', {
      eventId: createdEvent.id,
      htmlLink: createdEvent.htmlLink,
    });

    return {
      eventId: createdEvent.id,
      htmlLink: createdEvent.htmlLink,
      startTime: createdEvent.start.dateTime,
      endTime: createdEvent.end.dateTime,
    };
  } catch (error) {
    calendarLogger.error('Error creating appointment', error);
    throw error;
  }
}

/**
 * Cancel an appointment (delete calendar event)
 * @param {string} eventId - Google Calendar event ID
 * @returns {Promise<void>}
 */
export async function cancelAppointment(eventId) {
  const cal = initializeCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  try {
    calendarLogger.info('Canceling appointment', { eventId });

    await cal.events.delete({
      calendarId,
      eventId,
    });

    calendarLogger.info('Appointment canceled successfully', { eventId });
  } catch (error) {
    calendarLogger.error('Error canceling appointment', error, { eventId });
    throw error;
  }
}

/**
 * Reschedule an appointment (update calendar event time)
 * @param {string} eventId - Google Calendar event ID
 * @param {Date} newStartTime - New appointment time
 * @param {number} durationMinutes - Duration in minutes
 * @returns {Promise<Object>} Updated calendar event
 */
export async function rescheduleAppointment(eventId, newStartTime, durationMinutes = 30) {
  const cal = initializeCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  try {
    const endTime = new Date(newStartTime.getTime() + durationMinutes * 60000);

    calendarLogger.info('Rescheduling appointment', {
      eventId,
      newStartTime: newStartTime.toISOString(),
    });

    // First check if new time is available
    const available = await checkAvailability(newStartTime, durationMinutes);
    if (!available) {
      throw new Error('New time slot is not available');
    }

    // Update event
    const response = await cal.events.patch({
      calendarId,
      eventId,
      requestBody: {
        start: {
          dateTime: newStartTime.toISOString(),
          timeZone: process.env.BUSINESS_TIMEZONE || 'America/Los_Angeles',
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: process.env.BUSINESS_TIMEZONE || 'America/Los_Angeles',
        },
      },
    });

    const updatedEvent = response.data;

    calendarLogger.info('Appointment rescheduled successfully', {
      eventId: updatedEvent.id,
      newStartTime: updatedEvent.start.dateTime,
    });

    return {
      eventId: updatedEvent.id,
      startTime: updatedEvent.start.dateTime,
      endTime: updatedEvent.end.dateTime,
    };
  } catch (error) {
    calendarLogger.error('Error rescheduling appointment', error, { eventId });
    throw error;
  }
}

/**
 * Get available time slots for a given date
 * @param {Date} date - Date to check
 * @param {number} slotDuration - Duration of each slot in minutes
 * @returns {Promise<Array>} Array of available time slots
 */
export async function getAvailableSlots(date, slotDuration = 30) {
  const cal = initializeCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  try {
    // Business hours from environment
    const businessStart = process.env.BUSINESS_HOURS_START || '09:00';
    const businessEnd = process.env.BUSINESS_HOURS_END || '17:00';

    // Create start and end of business day
    const startOfDay = new Date(date);
    const [startHour, startMin] = businessStart.split(':');
    startOfDay.setHours(parseInt(startHour), parseInt(startMin), 0, 0);

    const endOfDay = new Date(date);
    const [endHour, endMin] = businessEnd.split(':');
    endOfDay.setHours(parseInt(endHour), parseInt(endMin), 0, 0);

    calendarLogger.info('Getting available slots', {
      date: date.toDateString(),
      businessHours: `${businessStart}-${businessEnd}`,
    });

    // Get all events for the day
    const response = await cal.events.list({
      calendarId,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const bookedEvents = response.data.items || [];

    // Generate all possible slots
    const availableSlots = [];
    let currentTime = new Date(startOfDay);

    while (currentTime < endOfDay) {
      const slotEnd = new Date(currentTime.getTime() + slotDuration * 60000);

      // Check if this slot conflicts with any booked event
      const hasConflict = bookedEvents.some((event) => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);

        return (
          (currentTime >= eventStart && currentTime < eventEnd) ||
          (slotEnd > eventStart && slotEnd <= eventEnd) ||
          (currentTime <= eventStart && slotEnd >= eventEnd)
        );
      });

      if (!hasConflict) {
        availableSlots.push({
          startTime: new Date(currentTime),
          endTime: new Date(slotEnd),
        });
      }

      // Move to next slot
      currentTime = new Date(slotEnd);
    }

    calendarLogger.info('Available slots found', {
      totalSlots: availableSlots.length,
    });

    return availableSlots;
  } catch (error) {
    calendarLogger.error('Error getting available slots', error);
    throw error;
  }
}

export default {
  checkAvailability,
  createAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getAvailableSlots,
};
