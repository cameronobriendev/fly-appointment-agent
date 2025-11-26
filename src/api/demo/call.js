/**
 * Demo outbound call API
 * Initiates an outbound call to a user's phone with custom business name
 */

import twilio from 'twilio';
import { logger } from '../../utils/logger.js';

const demoLogger = logger.child('DEMO_CALL');

// Initialize Twilio client
let twilioClient = null;

function initializeTwilio() {
  if (twilioClient) return twilioClient;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured');
  }

  twilioClient = twilio(accountSid, authToken);
  return twilioClient;
}

/**
 * Handle demo call request
 * Note: Input validation and rate limiting handled by middleware
 */
export async function handleDemoCall(req, res) {
  const { phoneNumber } = req.body;

  // At this point, phoneNumber is already validated and sanitized by middleware

  try {
    const client = initializeTwilio();
    const from = process.env.TWILIO_PHONE_NUMBER;
    const streamUrl = process.env.FLY_STREAM_URL;

    if (!from) {
      throw new Error('TWILIO_PHONE_NUMBER not configured');
    }

    if (!streamUrl) {
      throw new Error('FLY_STREAM_URL not configured');
    }

    demoLogger.info('Initiating demo call', {
      to: phoneNumber,
      from
    });

    // Create TwiML that connects to our WebSocket stream
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="To" value="${from}" />
      <Parameter name="From" value="${phoneNumber}" />
    </Stream>
  </Connect>
  <Pause length="60"/>
</Response>`;

    // Initiate outbound call
    const call = await client.calls.create({
      twiml,
      to: phoneNumber,
      from,
    });

    demoLogger.info('Demo call initiated successfully', {
      callSid: call.sid,
      to: phoneNumber
    });

    res.json({
      success: true,
      callSid: call.sid,
      message: `Calling ${phoneNumber} for Dr. Smith's Dental Office`
    });

  } catch (error) {
    demoLogger.error('Failed to initiate demo call', error, {
      phoneNumber
    });

    res.status(500).json({
      error: 'Failed to initiate call: ' + error.message
    });
  }
}

export default {
  handleDemoCall
};
