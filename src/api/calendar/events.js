/**
 * Calendar events API handler
 * Returns upcoming events from Google Calendar
 */

import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';

const apiLogger = logger.child('API:CALENDAR:EVENTS');

export async function getCalendarEvents(req, res) {
  try {
    const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
    const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

    // Validate environment variables
    if (!CALENDAR_ID || !SERVICE_ACCOUNT_KEY) {
      apiLogger.error('Missing Google Calendar credentials', {
        hasCalendarId: !!CALENDAR_ID,
        hasServiceAccountKey: !!SERVICE_ACCOUNT_KEY,
      });
      return res.status(500).json({
        error: 'Calendar not configured',
      });
    }

    // Decode base64-encoded service account key (same as working google-calendar.js)
    const serviceAccountKey = Buffer.from(SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8');
    const credentials = JSON.parse(serviceAccountKey);

    // Create JWT auth client (same pattern as working code)
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    const calendar = google.calendar({ version: 'v3', auth });

    // Get events from today (midnight) onwards (next 7 days)
    // This ensures events that started earlier today are still visible
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: todayStart.toISOString(),
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
      created: event.created, // When the event was created in Google Calendar
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
