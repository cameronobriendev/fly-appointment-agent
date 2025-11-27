/**
 * Calendar events API handler
 * Returns upcoming events from Google Calendar
 */

import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';

const apiLogger = logger.child('API:CALENDAR:EVENTS');

// Google Calendar setup
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

export async function getCalendarEvents(req, res) {
  try {
    // Validate environment variables
    if (!CALENDAR_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
      apiLogger.error('Missing Google Calendar credentials');
      return res.status(500).json({ error: 'Calendar not configured' });
    }

    // Authenticate with service account
    const auth = new google.auth.JWT(
      SERVICE_ACCOUNT_EMAIL,
      null,
      PRIVATE_KEY,
      ['https://www.googleapis.com/auth/calendar']
    );

    const calendar = google.calendar({ version: 'v3', auth });

    // Get events from now onwards (next 7 days)
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: weekFromNow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    const events = response.data.items || [];

    // Format events for frontend
    const formattedEvents = events.map((event) => ({
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
      attendees: event.attendees?.map(a => ({
        email: a.email,
        displayName: a.displayName
      })),
      htmlLink: event.htmlLink,
    }));

    apiLogger.info('Calendar events fetched', {
      eventCount: formattedEvents.length,
    });

    return res.status(200).json({
      success: true,
      events: formattedEvents,
      count: formattedEvents.length,
    });

  } catch (error) {
    apiLogger.error('Error fetching calendar events', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch calendar events',
    });
  }
}
