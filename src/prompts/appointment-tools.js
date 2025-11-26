/**
 * Tool definitions for appointment booking
 * These allow the AI to check availability, create appointments, and send confirmations
 */

export const APPOINTMENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Check if a specific time slot is available on the calendar. Returns available or not available. IMPORTANT: Convert natural language dates to YYYY-MM-DD format before calling.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format (e.g., 2024-03-15). NEVER pass natural language like "this week" or "next Tuesday" - you MUST convert to YYYY-MM-DD format.',
          },
          time: {
            type: 'string',
            description: 'Time in HH:MM format, 24-hour (e.g., 14:30 for 2:30 PM)',
          },
          duration: {
            type: 'number',
            description: 'Duration in minutes (default: 30)',
          },
        },
        required: ['date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description: 'Get a list of all available time slots for a specific date. Returns array of available times. IMPORTANT: You must convert the user\'s natural language date (like "this week" or "next Tuesday") to YYYY-MM-DD format before calling this function.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format (e.g., 2024-03-15). NEVER pass natural language like "this week" or "tomorrow" - you MUST convert to YYYY-MM-DD format.',
          },
          duration: {
            type: 'number',
            description: 'Appointment duration in minutes (default: 30)',
          },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_appointment',
      description: 'Create an appointment on the calendar and in the database. Call this ONLY after confirming availability and getting all required information from the caller.',
      parameters: {
        type: 'object',
        properties: {
          callerName: {
            type: 'string',
            description: 'Full name of the caller',
          },
          callerPhone: {
            type: 'string',
            description: 'Phone number of the caller',
          },
          date: {
            type: 'string',
            description: 'Appointment date in YYYY-MM-DD format',
          },
          time: {
            type: 'string',
            description: 'Appointment time in HH:MM format, 24-hour',
          },
          reason: {
            type: 'string',
            description: 'Reason for appointment (e.g., "dental cleaning", "checkup")',
          },
          duration: {
            type: 'number',
            description: 'Duration in minutes (default: 30)',
          },
        },
        required: ['callerName', 'callerPhone', 'date', 'time', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_appointment_info',
      description: 'Silently update appointment information as you collect it during the conversation. Do not announce this to the caller.',
      parameters: {
        type: 'object',
        properties: {
          callerName: {
            type: 'string',
            description: "Caller's full name",
          },
          callerPhone: {
            type: 'string',
            description: "Caller's phone number",
          },
          preferredDate: {
            type: 'string',
            description: 'Preferred appointment date',
          },
          preferredTime: {
            type: 'string',
            description: 'Preferred appointment time',
          },
          reason: {
            type: 'string',
            description: 'Reason for appointment',
          },
          notes: {
            type: 'string',
            description: 'Any additional notes or details',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'end_call_with_confirmation',
      description: 'End the call after successfully booking an appointment or handling the request. Call this when the conversation is complete.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of what was accomplished on the call',
          },
          appointmentBooked: {
            type: 'boolean',
            description: 'Whether an appointment was successfully booked',
          },
        },
        required: ['summary', 'appointmentBooked'],
      },
    },
  },
];

export default {
  APPOINTMENT_TOOLS,
};
