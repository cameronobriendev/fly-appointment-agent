/**
 * Database query functions - simplified for standalone appointment booking
 * No multi-tenant complexity, no user lookup
 */

import { sql } from './neon.js';
import { logger } from '../utils/logger.js';

const dbLogger = logger.child('QUERIES');

/**
 * Create an appointment record in the database
 * @param {Object} appointmentData - Appointment details
 * @returns {Promise<Object>} Created appointment record
 */
export async function createAppointment(appointmentData) {
  try {
    const {
      callerName,
      callerPhone,
      appointmentTime,
      reason = 'Appointment',
      googleCalendarEventId,
      status = 'confirmed',
    } = appointmentData;

    dbLogger.info('Creating appointment in database', {
      name: callerName,
      phone: callerPhone,
      time: appointmentTime,
    });

    const result = await sql`
      INSERT INTO appointments (
        caller_name,
        caller_phone,
        appointment_time,
        reason,
        google_calendar_event_id,
        status
      )
      VALUES (
        ${callerName},
        ${callerPhone},
        ${appointmentTime},
        ${reason},
        ${googleCalendarEventId},
        ${status}
      )
      RETURNING *
    `;

    const appointment = result[0];

    dbLogger.info('Appointment created in database', {
      appointmentId: appointment.id,
    });

    return appointment;
  } catch (error) {
    dbLogger.error('Error creating appointment', error);
    throw error;
  }
}

/**
 * Get appointments for a phone number
 * @param {string} callerPhone - Phone number to lookup
 * @returns {Promise<Array>} Array of appointments
 */
export async function getAppointmentsByPhone(callerPhone) {
  try {
    dbLogger.info('Looking up appointments by phone', { phone: callerPhone });

    const result = await sql`
      SELECT *
      FROM appointments
      WHERE caller_phone = ${callerPhone}
      ORDER BY appointment_time DESC
    `;

    dbLogger.info('Appointments found', {
      phone: callerPhone,
      count: result.length,
    });

    return result;
  } catch (error) {
    dbLogger.error('Error fetching appointments', error, { phone: callerPhone });
    throw error;
  }
}

/**
 * Get upcoming appointments for a phone number
 * @param {string} callerPhone - Phone number to lookup
 * @returns {Promise<Array>} Array of upcoming appointments
 */
export async function getUpcomingAppointments(callerPhone) {
  try {
    const now = new Date().toISOString();

    dbLogger.info('Looking up upcoming appointments', { phone: callerPhone });

    const result = await sql`
      SELECT *
      FROM appointments
      WHERE caller_phone = ${callerPhone}
        AND appointment_time > ${now}
        AND status = 'confirmed'
      ORDER BY appointment_time ASC
    `;

    dbLogger.info('Upcoming appointments found', {
      phone: callerPhone,
      count: result.length,
    });

    return result;
  } catch (error) {
    dbLogger.error('Error fetching upcoming appointments', error);
    throw error;
  }
}

/**
 * Update appointment status
 * @param {string} appointmentId - Appointment ID
 * @param {string} status - New status (confirmed, cancelled, completed, no-show)
 * @returns {Promise<Object>} Updated appointment
 */
export async function updateAppointmentStatus(appointmentId, status) {
  try {
    dbLogger.info('Updating appointment status', {
      appointmentId,
      status,
    });

    const result = await sql`
      UPDATE appointments
      SET
        status = ${status},
        updated_at = NOW()
      WHERE id = ${appointmentId}
      RETURNING *
    `;

    if (result.length === 0) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }

    dbLogger.info('Appointment status updated', {
      appointmentId: result[0].id,
      status: result[0].status,
    });

    return result[0];
  } catch (error) {
    dbLogger.error('Error updating appointment status', error, {
      appointmentId,
    });
    throw error;
  }
}

/**
 * Mark SMS as sent for an appointment
 * @param {string} appointmentId - Appointment ID
 * @returns {Promise<Object>} Updated appointment
 */
export async function markSmsSent(appointmentId) {
  try {
    const result = await sql`
      UPDATE appointments
      SET sms_sent = true
      WHERE id = ${appointmentId}
      RETURNING *
    `;

    dbLogger.info('SMS marked as sent', { appointmentId });

    return result[0];
  } catch (error) {
    dbLogger.error('Error marking SMS as sent', error, { appointmentId });
    throw error;
  }
}

/**
 * Create a call log record
 * @param {Object} callData - Call data to insert
 * @returns {Promise<Object>} Created call log record
 */
export async function createCallLog(callData) {
  try {
    const {
      twilioCallSid,
      callerPhone,
      callStartedAt,
      callEndedAt = null,
      durationSeconds = 0,
      transcript = '',
      appointmentBooked = false,
      appointmentId = null,
    } = callData;

    dbLogger.info('Creating call log', {
      callSid: twilioCallSid,
      phone: callerPhone,
    });

    const result = await sql`
      INSERT INTO call_logs (
        twilio_call_sid,
        caller_phone,
        call_started_at,
        call_ended_at,
        duration_seconds,
        transcript,
        appointment_booked,
        appointment_id
      )
      VALUES (
        ${twilioCallSid},
        ${callerPhone},
        ${callStartedAt},
        ${callEndedAt},
        ${durationSeconds},
        ${transcript},
        ${appointmentBooked},
        ${appointmentId}
      )
      RETURNING *
    `;

    const callLog = result[0];

    dbLogger.info('Call log created', {
      callLogId: callLog.id,
    });

    return callLog;
  } catch (error) {
    dbLogger.error('Error creating call log', error);
    throw error;
  }
}

/**
 * Update call log with final details
 * @param {string} twilioCallSid - Twilio call SID
 * @param {Object} updateData - Data to update
 * @returns {Promise<Object>} Updated call log
 */
export async function updateCallLog(twilioCallSid, updateData) {
  try {
    const {
      callEndedAt,
      durationSeconds,
      transcript,
      appointmentBooked,
      appointmentId,
    } = updateData;

    dbLogger.info('Updating call log', { callSid: twilioCallSid });

    const result = await sql`
      UPDATE call_logs
      SET
        call_ended_at = ${callEndedAt || sql`call_ended_at`},
        duration_seconds = ${durationSeconds || sql`duration_seconds`},
        transcript = ${transcript || sql`transcript`},
        appointment_booked = ${appointmentBooked !== undefined ? appointmentBooked : sql`appointment_booked`},
        appointment_id = ${appointmentId || sql`appointment_id`}
      WHERE twilio_call_sid = ${twilioCallSid}
      RETURNING *
    `;

    if (result.length === 0) {
      throw new Error(`Call log not found: ${twilioCallSid}`);
    }

    dbLogger.info('Call log updated', {
      callLogId: result[0].id,
    });

    return result[0];
  } catch (error) {
    dbLogger.error('Error updating call log', error, {
      callSid: twilioCallSid,
    });
    throw error;
  }
}

/**
 * Get appointment by ID
 * @param {string} appointmentId - Appointment ID
 * @returns {Promise<Object>} Appointment record
 */
export async function getAppointmentById(appointmentId) {
  try {
    const result = await sql`
      SELECT *
      FROM appointments
      WHERE id = ${appointmentId}
    `;

    if (result.length === 0) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }

    return result[0];
  } catch (error) {
    dbLogger.error('Error fetching appointment by ID', error, {
      appointmentId,
    });
    throw error;
  }
}

export default {
  createAppointment,
  getAppointmentsByPhone,
  getUpcomingAppointments,
  updateAppointmentStatus,
  markSmsSent,
  createCallLog,
  updateCallLog,
  getAppointmentById,
};
