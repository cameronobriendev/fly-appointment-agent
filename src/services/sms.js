/**
 * Twilio SMS service
 * Handles sending SMS confirmations and reminders
 */

import twilio from 'twilio';
import { logger } from '../utils/logger.js';

const smsLogger = logger.child('SMS');

// Initialize Twilio client
let twilioClient = null;

/**
 * Initialize Twilio client
 */
function initializeTwilio() {
  if (twilioClient) return twilioClient;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured');
  }

  twilioClient = twilio(accountSid, authToken);

  smsLogger.info('Twilio client initialized');

  return twilioClient;
}

/**
 * Send appointment confirmation SMS
 * @param {Object} appointmentData - Appointment details
 * @returns {Promise<Object>} Twilio message response
 */
export async function sendAppointmentConfirmation(appointmentData) {
  const client = initializeTwilio();
  const from = process.env.TWILIO_PHONE_NUMBER;

  const {
    callerName,
    callerPhone,
    appointmentTime,
    reason = 'appointment',
  } = appointmentData;

  try {
    // Format appointment time nicely
    const apptDate = new Date(appointmentTime);
    const dateStr = apptDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = apptDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const businessName = process.env.BUSINESS_NAME || "Dr. Smith's Dental Office";

    // Create confirmation message
    const message = `Hi ${callerName}! Your ${reason} at ${businessName} is confirmed for ${dateStr} at ${timeStr}. Reply CANCEL to cancel. See you soon!`;

    smsLogger.info('Sending appointment confirmation', {
      to: callerPhone,
      from,
    });

    // Send SMS via Twilio
    const response = await client.messages.create({
      body: message,
      from,
      to: callerPhone,
    });

    smsLogger.info('SMS confirmation sent successfully', {
      messageSid: response.sid,
      to: callerPhone,
      status: response.status,
    });

    return {
      messageSid: response.sid,
      status: response.status,
      to: response.to,
    };
  } catch (error) {
    smsLogger.error('Error sending SMS confirmation', error, {
      to: callerPhone,
    });
    throw error;
  }
}

/**
 * Send appointment reminder SMS
 * @param {Object} appointmentData - Appointment details
 * @returns {Promise<Object>} Twilio message response
 */
export async function sendAppointmentReminder(appointmentData) {
  const client = initializeTwilio();
  const from = process.env.TWILIO_PHONE_NUMBER;

  const {
    callerName,
    callerPhone,
    appointmentTime,
  } = appointmentData;

  try {
    const apptDate = new Date(appointmentTime);
    const dateStr = apptDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = apptDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const businessName = process.env.BUSINESS_NAME || "Dr. Smith's Dental Office";

    const message = `Hi ${callerName}! Reminder: Your appointment at ${businessName} is tomorrow, ${dateStr} at ${timeStr}. Reply CANCEL if you need to cancel.`;

    smsLogger.info('Sending appointment reminder', {
      to: callerPhone,
      from,
    });

    const response = await client.messages.create({
      body: message,
      from,
      to: callerPhone,
    });

    smsLogger.info('SMS reminder sent successfully', {
      messageSid: response.sid,
      to: callerPhone,
    });

    return {
      messageSid: response.sid,
      status: response.status,
      to: response.to,
    };
  } catch (error) {
    smsLogger.error('Error sending SMS reminder', error, {
      to: callerPhone,
    });
    throw error;
  }
}

/**
 * Send cancellation confirmation SMS
 * @param {Object} appointmentData - Appointment details
 * @returns {Promise<Object>} Twilio message response
 */
export async function sendCancellationConfirmation(appointmentData) {
  const client = initializeTwilio();
  const from = process.env.TWILIO_PHONE_NUMBER;

  const { callerName, callerPhone } = appointmentData;

  try {
    const businessName = process.env.BUSINESS_NAME || "Dr. Smith's Dental Office";

    const message = `Hi ${callerName}, your appointment at ${businessName} has been canceled. Call us if you'd like to reschedule!`;

    smsLogger.info('Sending cancellation confirmation', {
      to: callerPhone,
      from,
    });

    const response = await client.messages.create({
      body: message,
      from,
      to: callerPhone,
    });

    smsLogger.info('Cancellation SMS sent successfully', {
      messageSid: response.sid,
      to: callerPhone,
    });

    return {
      messageSid: response.sid,
      status: response.status,
      to: response.to,
    };
  } catch (error) {
    smsLogger.error('Error sending cancellation SMS', error, {
      to: callerPhone,
    });
    throw error;
  }
}

export default {
  sendAppointmentConfirmation,
  sendAppointmentReminder,
  sendCancellationConfirmation,
};
